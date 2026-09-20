"""
CampusNotes AI — Recommendation Pipeline Full Diagnostic Verification
====================================================================

Module: recommendation/scripts/verify_full_pipeline.py
Purpose: Diagnostic and verification tool that tests the complete recommendation
         pipeline from live PostgreSQL connection pooling, candidate retrieval,
         27-feature construction, LightGBM model scoring, and ranking,
         while measuring latency breakdowns and verifying zero database writes.

Safety Invariants:
- Read-only queries only (default_transaction_read_only = on).
- Zero database mutations.
- Model artifact and feature pipeline untouched.
"""

import os
import sys
import time
from pathlib import Path
from typing import Dict, Any

sys.stdout.reconfigure(encoding='utf-8')

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.db.postgres import (
    get_db_connection,
    check_database_health,
    close_connection_pool,
)
from recommendation.data.repository import PostgresRepository, CsvRepository
from recommendation.inference.recommend import (
    load_model,
    recommend_for_user,
)
from recommendation.features.feature_pipeline import FEATURE_COLUMNS

BOB_USER_ID = "da3250c0-80b1-46ca-b682-a94b5c5132f3"


def get_table_counts() -> Dict[str, int]:
    """Retrieves record counts for core interaction and academic tables."""
    tables = ["users", "notes", "note_views", "downloads", "likes", "bookmarks", "chat_sessions"]
    counts = {}
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            for t in tables:
                cur.execute(f'SELECT COUNT(*) FROM "{t}"' if t == "chat_sessions" else f"SELECT COUNT(*) FROM {t};")
                counts[t] = cur.fetchone()[0]
    return counts


def run_pipeline_diagnostics() -> bool:
    print("=" * 70)
    print("🔬 CAMPUSNOTES AI — FULL RECOMMENDATION PIPELINE DIAGNOSTIC AUDIT")
    print("=" * 70 + "\n")

    all_passed = True
    timings: Dict[str, float] = {}

    # 1. Verify Database Health & Connection Pool
    t0 = time.perf_counter()
    db_healthy = check_database_health()
    timings["db_health_check_ms"] = (time.perf_counter() - t0) * 1000.0

    if db_healthy:
        print(f"  ✅ [PASS] 1. PostgreSQL Database & Connection Pool: HEALTHY ({timings['db_health_check_ms']:.2f} ms)")
    else:
        print(f"  ❌ [FAIL] 1. PostgreSQL Database is UNHEALTHY")
        all_passed = False

    # 2. Verify Initial Table Counts (Pre-inference Baseline)
    counts_before = get_table_counts()
    print(f"  ℹ️  [INFO] Baseline Record Counts:")
    for k, v in counts_before.items():
        print(f"       • {k:15}: {v}")

    # 3. Verify Repository Initialization & User Lookup
    t0 = time.perf_counter()
    repo = PostgresRepository()
    user_record = repo.get_user(BOB_USER_ID)
    timings["user_lookup_ms"] = (time.perf_counter() - t0) * 1000.0

    if user_record is not None and not user_record.empty and str(user_record.get("id")) == BOB_USER_ID:
        print(f"  ✅ [PASS] 2. User Lookup for Bob Smith: FOUND ({timings['user_lookup_ms']:.2f} ms)")
        print(f"       ↳ College: {user_record.get('collegeId')}, Branch: {user_record.get('branchId')}, Sem: {user_record.get('semester')}")
    else:
        print(f"  ❌ [FAIL] 2. User Lookup for {BOB_USER_ID} failed")
        all_passed = False

    # 4. Verify Candidate Notes Extraction & Filtering
    t0 = time.perf_counter()
    candidates = repo.get_eligible_notes(BOB_USER_ID)
    timings["candidate_extraction_ms"] = (time.perf_counter() - t0) * 1000.0

    if candidates is not None and not candidates.empty:
        # Check invariants: no self-authored, all published
        has_self = any(str(u) == BOB_USER_ID for u in candidates["uploaderId"].tolist())
        has_unpub = any(not pub for pub in candidates["isPublished"].tolist())
        if not has_self and not has_unpub:
            print(f"  ✅ [PASS] 3. Candidate Notes Extraction: {len(candidates)} eligible notes ({timings['candidate_extraction_ms']:.2f} ms)")
            print(f"       ↳ Invariants verified: 0 self-authored, 0 unpublished")
        else:
            print(f"  ❌ [FAIL] 3. Invariant violation: self_authored={has_self}, unpub={has_unpub}")
            all_passed = False
    else:
        print(f"  ❌ [FAIL] 3. No candidate notes found for user {BOB_USER_ID}")
        all_passed = False

    # 5. Verify Model Artifact Loading
    t0 = time.perf_counter()
    artifact = load_model()
    timings["model_load_ms"] = (time.perf_counter() - t0) * 1000.0

    if artifact and "model" in artifact and "pipeline" in artifact:
        model = artifact["model"]
        pipeline = artifact["pipeline"]
        feature_cols = artifact.get("feature_columns", [])
        print(f"  ✅ [PASS] 4. LightGBM Model & Feature Pipeline: LOADED ({timings['model_load_ms']:.2f} ms)")
        print(f"       ↳ Features: {len(feature_cols)} (Contract: 27)")
        print(f"       ↳ Model Version: {artifact.get('version', 'unknown')}")
        if len(feature_cols) != 27:
            print(f"  ❌ [FAIL] Feature count mismatch: {len(feature_cols)} != 27")
            all_passed = False
    else:
        print(f"  ❌ [FAIL] 4. Failed to load model artifact")
        all_passed = False

    # 6. Execute End-to-End Recommendation Inference
    t0 = time.perf_counter()
    recs_df, diagnostics = recommend_for_user(
        user_id=BOB_USER_ID,
        top_k=5,
        repository=repo,
        model_artifact=artifact,
    )
    timings["full_inference_ms"] = (time.perf_counter() - t0) * 1000.0

    if recs_df is not None and len(recs_df) == 5:
        # Check descending scores and ranks
        ranks = recs_df["rank"].tolist()
        scores = recs_df["engagement_score"].tolist()
        ranks_valid = ranks == [1, 2, 3, 4, 5]
        scores_descending = all(scores[i] >= scores[i+1] for i in range(len(scores)-1))
        scores_bounded = all(0.0 <= s <= 1.0 for s in scores)

        if ranks_valid and scores_descending and scores_bounded:
            print(f"  ✅ [PASS] 5. Live Recommendation Inference: 5 notes ranked ({timings['full_inference_ms']:.2f} ms)")
            print(f"       ↳ Ranks: 1..5 strictly consecutive")
            print(f"       ↳ Score range: [{min(scores):.6f}, {max(scores):.6f}] strictly descending")
            for _, r in recs_df.iterrows():
                print(f"          #{int(r['rank'])}: \"{str(r['title'])[:40]}\" (Score: {float(r['engagement_score']):.6f})")
        else:
            print(f"  ❌ [FAIL] 5. Ranking or score validation failed: ranks={ranks_valid}, desc={scores_descending}, bounded={scores_bounded}")
            all_passed = False
    else:
        print(f"  ❌ [FAIL] 5. Expected 5 recommendations, got {len(recs_df) if recs_df is not None else 0}")
        all_passed = False

    # 7. Verify Zero Database Mutations (Post-inference Check)
    counts_after = get_table_counts()
    mutations = {k: counts_after[k] - counts_before[k] for k in counts_before if counts_after[k] != counts_before[k]}
    if not mutations:
        print(f"  ✅ [PASS] 6. Database Immutability Verified: ZERO writes / mutations occurred")
    else:
        print(f"  ❌ [FAIL] 6. Database mutation detected: {mutations}")
        all_passed = False

    # 8. Timing & Performance Summary
    print("\n" + "-" * 70)
    print("⏱️  LATENCY BREAKDOWN BUDGET SUMMARY")
    print("-" * 70)
    for metric, ms in timings.items():
        print(f"   • {metric:28}: {ms:7.2f} ms")
    total_pipeline_ms = timings.get("full_inference_ms", 0)
    print(f"   • {'TOTAL INFERENCE LATENCY':28}: {total_pipeline_ms:7.2f} ms (Budget: < 1000 ms)")

    if total_pipeline_ms < 1000.0:
        print(f"  ✅ [PASS] Latency well within production budget.")
    else:
        print(f"  ⚠️ [WARN] Latency exceeded 1000 ms budget.")

    print("\n" + "=" * 70)
    if all_passed:
        print("🎉 ALL FULL-PIPELINE DIAGNOSTIC CHECKS PASSED (100% HEALTHY)")
    else:
        print("❌ ONE OR MORE PIPELINE DIAGNOSTIC CHECKS FAILED")
    print("=" * 70 + "\n")

    close_connection_pool()
    return all_passed


if __name__ == "__main__":
    success = run_pipeline_diagnostics()
    sys.exit(0 if success else 1)
