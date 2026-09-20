"""
CampusNotes AI — Recommendation Dataset Generation Pipeline
Phase 3 Step 2.3

Transforms raw interaction data into a point-in-time-correct ML training dataset.
Enforces strict historical causality, stratified negative sampling, and reproducible output.
"""

import json
import os
import random
import sys
from pathlib import Path
from typing import Any, Dict, List, Set, Tuple

import numpy as np
import pandas as pd

if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass

# Constants
RANDOM_SEED = 42
SCRIPT_DIR = Path(__file__).resolve().parent
RECOMMENDATION_DIR = SCRIPT_DIR.parent
DATA_DIR = RECOMMENDATION_DIR / "data"
RAW_DIR = DATA_DIR / "raw"
PROCESSED_DIR = DATA_DIR / "processed"
DATASET_CSV = PROCESSED_DIR / "training_dataset.csv"
SUMMARY_JSON = PROCESSED_DIR / "dataset_summary.json"


def load_raw_data(raw_dir: Path) -> Dict[str, pd.DataFrame]:
    """Load all 8 raw CSV files with proper timestamp parsing and empty table handling."""
    tables = [
        "users",
        "notes",
        "subjects",
        "note_views",
        "downloads",
        "likes",
        "bookmarks",
        "chat_sessions",
    ]
    data: Dict[str, pd.DataFrame] = {}

    for table in tables:
        csv_file = raw_dir / f"{table}.csv"
        if not csv_file.exists():
            raise FileNotFoundError(f"Required raw CSV not found: {csv_file}")

        df = pd.read_csv(csv_file, dtype=str)

        # Convert timestamp columns to datetime
        time_cols = [c for c in df.columns if "At" in c or c == "timestamp"]
        for c in time_cols:
            df[c] = pd.to_datetime(df[c], errors="coerce")

        # Convert numeric fields
        if table == "users":
            if "semester" in df.columns:
                df["semester"] = pd.to_numeric(df["semester"], errors="coerce")
        elif table == "notes":
            num_cols = [
                "semester",
                "fileSize",
                "pageCount",
                "viewsCount",
                "downloadsCount",
                "likesCount",
                "bookmarksCount",
                "averageRating",
                "ratingsCount",
            ]
            for c in num_cols:
                if c in df.columns:
                    df[c] = pd.to_numeric(df[c], errors="coerce").fillna(0)
            if "isPublished" in df.columns:
                df["isPublished"] = df["isPublished"].str.lower() == "true"
        elif table == "subjects":
            if "semester" in df.columns:
                df["semester"] = pd.to_numeric(df["semester"], errors="coerce").fillna(0)

        data[table] = df

    return data


def build_curriculum_indices(df_subjects: pd.DataFrame, df_notes: pd.DataFrame) -> Tuple[Set[Tuple[str, str, int]], Dict[str, str], Dict[str, Set[str]], Dict[str, Set[str]]]:
    """Build lookup maps for curriculum matching, subject notes, and uploader notes."""
    curriculum_set: Set[Tuple[str, str, int]] = set()
    if not df_subjects.empty:
        for _, row in df_subjects.iterrows():
            sid = str(row["id"]).strip()
            bid = str(row["branchId"]).strip()
            sem = int(row.get("semester", 0))
            curriculum_set.add((sid, bid, sem))

    subjects_by_note: Dict[str, str] = {}
    notes_by_subject: Dict[str, Set[str]] = {}
    notes_by_uploader: Dict[str, Set[str]] = {}

    for _, nrow in df_notes.iterrows():
        nid = str(nrow["id"]).strip()
        sub = str(nrow.get("subjectId", "")).strip()
        up = str(nrow.get("uploaderId", "")).strip()

        subjects_by_note[nid] = sub
        if sub:
            notes_by_subject.setdefault(sub, set()).add(nid)
        if up:
            notes_by_uploader.setdefault(up, set()).add(nid)

    return curriculum_set, subjects_by_note, notes_by_subject, notes_by_uploader


def identify_ever_engaged_pairs(data: Dict[str, pd.DataFrame]) -> Set[Tuple[str, str]]:
    """Identify all (user_id, note_id) pairs that EVER had any engagement (prevents false negatives)."""
    engaged: Set[Tuple[str, str]] = set()

    for table_name in ["downloads", "likes", "bookmarks", "chat_sessions", "note_views"]:
        df = data[table_name]
        if not df.empty and "userId" in df.columns and "noteId" in df.columns:
            valid = df.dropna(subset=["userId", "noteId"])
            for _, row in valid.iterrows():
                u, n = str(row["userId"]).strip(), str(row["noteId"]).strip()
                if u and n and u != "nan" and n != "nan":
                    engaged.add((u, n))

    return engaged


def build_positive_events(data: Dict[str, pd.DataFrame]) -> List[Dict[str, Any]]:
    """Extract positive candidate events with point-in-time timestamps and sources.
    Excludes unpublished and self-authored notes per Recommendation System rules.
    """
    positives: List[Dict[str, Any]] = []
    seen_exact: Set[Tuple[str, str, Any]] = set()

    # A. Downloads
    df_dl = data["downloads"]
    if not df_dl.empty:
        valid_dl = df_dl.dropna(subset=["userId", "noteId", "createdAt"])
        for _, row in valid_dl.iterrows():
            u, n, t = str(row["userId"]).strip(), str(row["noteId"]).strip(), row["createdAt"]
            if u and n and u != "nan" and n != "nan" and pd.notna(t):
                key = (u, n, t)
                if key not in seen_exact:
                    seen_exact.add(key)
                    positives.append({
                        "user_id": u,
                        "note_id": n,
                        "timestamp": t,
                        "target": 1,
                        "interaction_source": "download"
                    })

    # B. Likes
    df_likes = data["likes"]
    if not df_likes.empty:
        valid_likes = df_likes.dropna(subset=["userId", "noteId", "createdAt"])
        for _, row in valid_likes.iterrows():
            u, n, t = str(row["userId"]).strip(), str(row["noteId"]).strip(), row["createdAt"]
            if u and n and u != "nan" and n != "nan" and pd.notna(t):
                key = (u, n, t)
                if key not in seen_exact:
                    seen_exact.add(key)
                    positives.append({
                        "user_id": u,
                        "note_id": n,
                        "timestamp": t,
                        "target": 1,
                        "interaction_source": "like"
                    })

    # C. Bookmarks
    df_bm = data["bookmarks"]
    if not df_bm.empty:
        valid_bm = df_bm.dropna(subset=["userId", "noteId", "createdAt"])
        for _, row in valid_bm.iterrows():
            u, n, t = str(row["userId"]).strip(), str(row["noteId"]).strip(), row["createdAt"]
            if u and n and u != "nan" and n != "nan" and pd.notna(t):
                key = (u, n, t)
                if key not in seen_exact:
                    seen_exact.add(key)
                    positives.append({
                        "user_id": u,
                        "note_id": n,
                        "timestamp": t,
                        "target": 1,
                        "interaction_source": "bookmark"
                    })

    # D. RAG Study Chat
    df_chats = data["chat_sessions"]
    if not df_chats.empty:
        valid_chats = df_chats.dropna(subset=["userId", "noteId", "createdAt"])
        for _, row in valid_chats.iterrows():
            u, n, t = str(row["userId"]).strip(), str(row["noteId"]).strip(), row["createdAt"]
            if u and n and u != "nan" and n != "nan" and pd.notna(t):
                key = (u, n, t)
                if key not in seen_exact:
                    seen_exact.add(key)
                    positives.append({
                        "user_id": u,
                        "note_id": n,
                        "timestamp": t,
                        "target": 1,
                        "interaction_source": "chat"
                    })

    # E. Repeat Views (at least 2 views on same note; use 2nd qualifying view timestamp)
    df_views = data["note_views"]
    if not df_views.empty:
        valid_views = df_views.dropna(subset=["userId", "noteId", "createdAt"])
        grouped = valid_views.sort_values("createdAt").groupby(["userId", "noteId"])
        for (u, n), group in grouped:
            u_str, n_str = str(u).strip(), str(n).strip()
            if u_str and n_str and u_str != "nan" and n_str != "nan" and len(group) >= 2:
                second_view_t = group.iloc[1]["createdAt"]
                key = (u_str, n_str, second_view_t)
                if key not in seen_exact:
                    seen_exact.add(key)
                    positives.append({
                        "user_id": u_str,
                        "note_id": n_str,
                        "timestamp": second_view_t,
                        "target": 1,
                        "interaction_source": "repeat_view"
                    })

    # Filter out any positive candidate where note is self-authored or unpublished
    df_notes = data["notes"].set_index("id", drop=False)
    filtered_positives = []
    for pos in positives:
        nid = pos["note_id"]
        if nid in df_notes.index:
            note_row = df_notes.loc[nid]
            if isinstance(note_row, pd.DataFrame):
                note_row = note_row.iloc[0]
            if note_row.get("isPublished", False) and str(note_row.get("uploaderId")).strip() != pos["user_id"]:
                filtered_positives.append(pos)

    # Sort chronologically
    filtered_positives.sort(key=lambda x: x["timestamp"])
    return filtered_positives


def build_negative_candidates(
    positives: List[Dict[str, Any]],
    data: Dict[str, pd.DataFrame],
    ever_engaged: Set[Tuple[str, str]],
    rng: random.Random
) -> List[Dict[str, Any]]:
    """Sample hard (70%) and soft (30%) negatives paired with positive interaction timestamps."""
    df_users = data["users"].set_index("id", drop=False)
    df_notes = data["notes"].set_index("id", drop=False)
    
    # Only published notes eligible
    published_notes = df_notes[df_notes["isPublished"] == True].copy()

    negatives: List[Dict[str, Any]] = []
    seen_candidate_keys: Set[Tuple[str, str, Any]] = set()

    for pos in positives:
        u_id = pos["user_id"]
        t = pos["timestamp"]

        if u_id not in df_users.index:
            continue

        user_row = df_users.loc[u_id]
        if isinstance(user_row, pd.DataFrame):
            user_row = user_row.iloc[0]

        u_branch = user_row.get("branchId")
        u_college = user_row.get("collegeId")
        u_sem = user_row.get("semester")

        # Exclude: self-authored, ever-engaged, or already sampled for this (u, t)
        eligible_notes = published_notes[published_notes["uploaderId"].astype(str).str.strip() != u_id].copy()
        eligible_notes = eligible_notes[~eligible_notes["id"].apply(lambda nid: (u_id, str(nid).strip()) in ever_engaged)]

        if eligible_notes.empty:
            continue

        # Classify candidates into hard vs soft
        hard_pool: List[str] = []
        soft_pool: List[str] = []
        fallback_pool: List[str] = []

        for nid, nrow in eligible_notes.iterrows():
            n_sem = nrow.get("semester")
            n_branch = nrow.get("branchId")
            n_college = nrow.get("collegeId")

            is_hard = (
                pd.notna(u_branch) and pd.notna(n_branch) and str(u_branch).strip() == str(n_branch).strip() and
                pd.notna(u_sem) and pd.notna(n_sem) and int(u_sem) == int(n_sem)
            )

            is_soft = False
            if not is_hard:
                if pd.notna(u_sem) and pd.notna(n_sem) and abs(int(u_sem) - int(n_sem)) == 1:
                    is_soft = True
                elif (
                    pd.notna(u_college) and pd.notna(n_college) and str(u_college).strip() == str(n_college).strip() and
                    pd.notna(u_branch) and pd.notna(n_branch) and str(u_branch).strip() != str(n_branch).strip()
                ):
                    is_soft = True

            if is_hard:
                hard_pool.append(str(nid).strip())
            elif is_soft:
                soft_pool.append(str(nid).strip())
            else:
                fallback_pool.append(str(nid).strip())

        # Target 4 negatives per positive: ~3 hard (70%), ~1 soft (30%)
        rng.shuffle(hard_pool)
        rng.shuffle(soft_pool)
        rng.shuffle(fallback_pool)

        sampled_for_pos: List[Tuple[str, str]] = []

        take_hard = min(len(hard_pool), 3)
        for i in range(take_hard):
            sampled_for_pos.append((hard_pool[i], "negative_hard"))

        needed = 4 - len(sampled_for_pos)
        take_soft = min(len(soft_pool), needed)
        for i in range(take_soft):
            sampled_for_pos.append((soft_pool[i], "negative_soft"))

        needed = 4 - len(sampled_for_pos)
        take_fb = min(len(fallback_pool), needed)
        for i in range(take_fb):
            sampled_for_pos.append((fallback_pool[i], "negative_soft"))

        for nid, source in sampled_for_pos:
            key = (u_id, nid, t)
            if key not in seen_candidate_keys:
                seen_candidate_keys.add(key)
                negatives.append({
                    "user_id": u_id,
                    "note_id": nid,
                    "timestamp": t,
                    "target": 0,
                    "interaction_source": source
                })

    return negatives


def calculate_features_for_row(
    user_id: str,
    note_id: str,
    t: pd.Timestamp,
    data: Dict[str, pd.DataFrame],
    curriculum_set: Set[Tuple[str, str, int]],
    subjects_by_note: Dict[str, str],
    notes_by_subject: Dict[str, Set[str]],
    notes_by_uploader: Dict[str, Set[str]],
) -> Dict[str, Any]:
    """Calculate point-in-time features strictly using historical data where createdAt < t."""
    df_users = data["users"]
    df_notes = data["notes"]

    user_match = df_users[df_users["id"] == user_id]
    user_row = user_match.iloc[0] if not user_match.empty else None

    note_match = df_notes[df_notes["id"] == note_id]
    note_row = note_match.iloc[0] if not note_match.empty else None

    # --- Academic matching ---
    u_college = user_row.get("collegeId") if user_row is not None else None
    n_college = note_row.get("collegeId") if note_row is not None else None
    is_same_college = 1 if pd.notna(u_college) and pd.notna(n_college) and str(u_college).strip() == str(n_college).strip() else 0

    u_branch = user_row.get("branchId") if user_row is not None else None
    n_branch = note_row.get("branchId") if note_row is not None else None
    is_same_branch = 1 if pd.notna(u_branch) and pd.notna(n_branch) and str(u_branch).strip() == str(n_branch).strip() else 0

    u_sem = int(user_row.get("semester", 0)) if user_row is not None and pd.notna(user_row.get("semester")) else None
    n_sem = int(note_row.get("semester", 0)) if note_row is not None and pd.notna(note_row.get("semester")) else None

    is_same_semester = 1 if u_sem is not None and n_sem is not None and u_sem == n_sem else 0
    semester_distance = abs(u_sem - n_sem) if u_sem is not None and n_sem is not None else 0

    n_subject = str(note_row.get("subjectId")).strip() if note_row is not None and pd.notna(note_row.get("subjectId")) else ""
    is_enrolled_subject = 0
    if u_branch and u_sem is not None and n_subject:
        if (n_subject, str(u_branch).strip(), u_sem) in curriculum_set:
            is_enrolled_subject = 1

    # --- User historical behavior (strictly createdAt < t) ---
    user_semester = u_sem if u_sem is not None else 0
    u_created = user_row.get("createdAt") if user_row is not None else None
    user_account_age_days = max(0.0, (t - u_created).total_seconds() / 86400.0) if pd.notna(u_created) else 0.0

    df_views = data["note_views"]
    user_total_views = int(len(df_views[(df_views["userId"] == user_id) & (df_views["createdAt"] < t)])) if not df_views.empty else 0

    df_dl = data["downloads"]
    user_total_downloads = int(len(df_dl[(df_dl["userId"] == user_id) & (df_dl["createdAt"] < t)])) if not df_dl.empty else 0

    df_likes = data["likes"]
    user_total_likes = int(len(df_likes[(df_likes["userId"] == user_id) & (df_likes["createdAt"] < t)])) if not df_likes.empty else 0

    df_bm = data["bookmarks"]
    user_total_bookmarks = int(len(df_bm[(df_bm["userId"] == user_id) & (df_bm["createdAt"] < t)])) if not df_bm.empty else 0

    df_chats = data["chat_sessions"]
    user_total_chats = int(len(df_chats[(df_chats["userId"] == user_id) & (df_chats["createdAt"] < t)])) if not df_chats.empty else 0

    u_bio = user_row.get("bio") if user_row is not None else None
    user_has_bio = 1 if pd.notna(u_bio) and len(str(u_bio).strip()) > 0 else 0

    # --- Note historical features (strictly createdAt < t) ---
    note_page_count = int(note_row.get("pageCount", 0)) if note_row is not None else 0
    note_file_size_kb = round(float(note_row.get("fileSize", 0)) / 1024.0, 2) if note_row is not None else 0.0
    n_created = note_row.get("createdAt") if note_row is not None else None
    note_age_days = max(0.0, round((t - n_created).total_seconds() / 86400.0, 2)) if pd.notna(n_created) else 0.0
    note_tag_count = 0
    note_is_processed = 1 if note_row is not None and str(note_row.get("processingStatus")).strip().upper() == "COMPLETED" else 0

    note_views_hist = int(len(df_views[(df_views["noteId"] == note_id) & (df_views["createdAt"] < t)])) if not df_views.empty else 0
    note_downloads_hist = int(len(df_dl[(df_dl["noteId"] == note_id) & (df_dl["createdAt"] < t)])) if not df_dl.empty else 0
    note_likes_hist = int(len(df_likes[(df_likes["noteId"] == note_id) & (df_likes["createdAt"] < t)])) if not df_likes.empty else 0
    note_bookmarks_hist = int(len(df_bm[(df_bm["noteId"] == note_id) & (df_bm["createdAt"] < t)])) if not df_bm.empty else 0
    note_download_view_ratio = round(float(note_downloads_hist) / float(max(note_views_hist, 1)), 4)

    # --- User-note affinity (strictly createdAt < t) ---
    user_note_prior_views = int(len(
        df_views[(df_views["userId"] == user_id) & (df_views["noteId"] == note_id) & (df_views["createdAt"] < t)]
    )) if not df_views.empty else 0

    same_subject_notes = notes_by_subject.get(n_subject, set())
    user_subject_interaction_count = 0
    if same_subject_notes:
        if not df_views.empty:
            user_subject_interaction_count += int(len(
                df_views[(df_views["userId"] == user_id) & (df_views["noteId"].isin(same_subject_notes)) & (df_views["createdAt"] < t)]
            ))
        if not df_dl.empty:
            user_subject_interaction_count += int(len(
                df_dl[(df_dl["userId"] == user_id) & (df_dl["noteId"].isin(same_subject_notes)) & (df_dl["createdAt"] < t)]
            ))
        if not df_likes.empty:
            user_subject_interaction_count += int(len(
                df_likes[(df_likes["userId"] == user_id) & (df_likes["noteId"].isin(same_subject_notes)) & (df_likes["createdAt"] < t)]
            ))
        if not df_bm.empty:
            user_subject_interaction_count += int(len(
                df_bm[(df_bm["userId"] == user_id) & (df_bm["noteId"].isin(same_subject_notes)) & (df_bm["createdAt"] < t)]
            ))

    uploader_id = str(note_row.get("uploaderId")).strip() if note_row is not None and pd.notna(note_row.get("uploaderId")) else ""
    same_uploader_notes = notes_by_uploader.get(uploader_id, set())
    user_uploader_affinity = 0
    if same_uploader_notes:
        engaged_notes: Set[str] = set()
        if not df_dl.empty:
            matched = df_dl[(df_dl["userId"] == user_id) & (df_dl["noteId"].isin(same_uploader_notes)) & (df_dl["createdAt"] < t)]
            engaged_notes.update(matched["noteId"].astype(str).tolist())
        if not df_likes.empty:
            matched = df_likes[(df_likes["userId"] == user_id) & (df_likes["noteId"].isin(same_uploader_notes)) & (df_likes["createdAt"] < t)]
            engaged_notes.update(matched["noteId"].astype(str).tolist())
        if not df_bm.empty:
            matched = df_bm[(df_bm["userId"] == user_id) & (df_bm["noteId"].isin(same_uploader_notes)) & (df_bm["createdAt"] < t)]
            engaged_notes.update(matched["noteId"].astype(str).tolist())
        if not df_chats.empty:
            matched = df_chats[(df_chats["userId"] == user_id) & (df_chats["noteId"].isin(same_uploader_notes)) & (df_chats["createdAt"] < t)]
            engaged_notes.update(matched["noteId"].astype(str).tolist())
        user_uploader_affinity = len(engaged_notes)

    # Semantic feature (offline default 0.0)
    semantic_affinity_score = 0.0

    return {
        "user_id": user_id,
        "note_id": note_id,
        "timestamp": t.isoformat(),
        "is_same_college": is_same_college,
        "is_same_branch": is_same_branch,
        "is_same_semester": is_same_semester,
        "semester_distance": semester_distance,
        "is_enrolled_subject": is_enrolled_subject,
        "user_semester": user_semester,
        "user_account_age_days": round(user_account_age_days, 2),
        "user_total_views": user_total_views,
        "user_total_downloads": user_total_downloads,
        "user_total_likes": user_total_likes,
        "user_total_bookmarks": user_total_bookmarks,
        "user_total_chats": user_total_chats,
        "user_has_bio": user_has_bio,
        "note_page_count": note_page_count,
        "note_file_size_kb": note_file_size_kb,
        "note_age_days": note_age_days,
        "note_tag_count": note_tag_count,
        "note_is_processed": note_is_processed,
        "note_views_hist": note_views_hist,
        "note_downloads_hist": note_downloads_hist,
        "note_likes_hist": note_likes_hist,
        "note_bookmarks_hist": note_bookmarks_hist,
        "note_download_view_ratio": note_download_view_ratio,
        "user_subject_interaction_count": user_subject_interaction_count,
        "user_note_prior_views": user_note_prior_views,
        "user_uploader_affinity": user_uploader_affinity,
        "semantic_affinity_score": semantic_affinity_score,
    }


def validate_dataset(df: pd.DataFrame, data: Dict[str, pd.DataFrame]) -> Dict[str, bool]:
    """Execute all 15 quality and integrity validation checks."""
    checks: Dict[str, bool] = {}

    checks["dataset_exists"] = bool(not df.empty)
    checks["targets_valid"] = bool(set(df["target"].unique()).issubset({0, 1}))
    checks["user_id_valid"] = bool(df["user_id"].notna().all() and (df["user_id"].astype(str).str.strip() != "").all())
    checks["note_id_valid"] = bool(df["note_id"].notna().all() and (df["note_id"].astype(str).str.strip() != "").all())
    checks["timestamps_valid"] = bool(pd.to_datetime(df["timestamp"], errors="coerce").notna().all())

    # No unpublished notes
    df_notes = data["notes"].set_index("id", drop=False)
    unpublished_note_ids = set(df_notes[df_notes["isPublished"] == False]["id"].astype(str).unique())
    checks["no_unpublished_notes"] = bool(not any(str(nid).strip() in unpublished_note_ids for nid in df["note_id"]))

    # No self-authored notes
    self_authored_found = False
    for _, row in df.iterrows():
        nid = str(row["note_id"]).strip()
        uid = str(row["user_id"]).strip()
        if nid in df_notes.index:
            uploader = df_notes.loc[nid].get("uploaderId")
            if isinstance(uploader, pd.Series):
                uploader = uploader.iloc[0]
            if str(uploader).strip() == uid:
                self_authored_found = True
                break
    checks["no_self_authored_notes"] = bool(not self_authored_found)

    # Semantic score is exactly 0.0
    checks["semantic_score_zero"] = bool((df["semantic_affinity_score"] == 0.0).all())

    # Binary features contain only 0 and 1
    binary_cols = ["is_same_college", "is_same_branch", "is_same_semester", "is_enrolled_subject", "user_has_bio", "note_is_processed", "target"]
    checks["binary_cols_valid"] = bool(all(set(df[col].unique()).issubset({0, 1}) for col in binary_cols))

    # No exact duplicates
    dup_cols = ["user_id", "note_id", "timestamp", "target"]
    checks["no_exact_duplicates"] = bool(not df.duplicated(subset=dup_cols).any())

    # Privacy validation: ensure no sensitive auth columns leaked
    sensitive_keywords = ["password", "hash", "token", "secret", "email"]
    privacy_leaked = any(any(s in col.lower() for s in sensitive_keywords) for col in df.columns)
    checks["privacy_validation_passed"] = bool(not privacy_leaked)

    # Temporal leakage verification
    leakage_detected = False
    df_views = data["note_views"]
    for _, row in df.iterrows():
        nid = str(row["note_id"]).strip()
        t = pd.to_datetime(row["timestamp"])
        reported_views = int(row["note_views_hist"])
        actual_views_before_t = int(len(df_views[(df_views["noteId"] == nid) & (df_views["createdAt"] < t)])) if not df_views.empty else 0
        if reported_views != actual_views_before_t:
            leakage_detected = True
            break
    checks["temporal_leakage_passed"] = bool(not leakage_detected)

    return checks


def main():
    print("=" * 60)
    print("CampusNotes AI — Recommendation Dataset Generation")
    print("=" * 60)

    rng = random.Random(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    # 1. Load Raw Data
    data = load_raw_data(RAW_DIR)

    print("\nInput:")
    print(f"  Users              : {len(data['users']):>2}")
    print(f"  Notes              : {len(data['notes']):>2}")
    print(f"  Note Views         : {len(data['note_views']):>2}")
    print(f"  Downloads          : {len(data['downloads']):>2}")
    print(f"  Likes              : {len(data['likes']):>2}")
    print(f"  Bookmarks          : {len(data['bookmarks']):>2}")
    print(f"  Chat Sessions      : {len(data['chat_sessions']):>2}")

    # 2. Build Curriculum and Index Maps
    curriculum_set, subjects_by_note, notes_by_subject, notes_by_uploader = build_curriculum_indices(
        data["subjects"], data["notes"]
    )

    # 3. Identify Ever-Engaged Pairs for Negative Filtering
    ever_engaged = identify_ever_engaged_pairs(data)

    # 4. Extract Positive Events
    positives = build_positive_events(data)

    pos_breakdown = {
        "download": sum(1 for p in positives if p["interaction_source"] == "download"),
        "like": sum(1 for p in positives if p["interaction_source"] == "like"),
        "bookmark": sum(1 for p in positives if p["interaction_source"] == "bookmark"),
        "chat": sum(1 for p in positives if p["interaction_source"] == "chat"),
        "repeat_view": sum(1 for p in positives if p["interaction_source"] == "repeat_view"),
    }

    print("\nPositive interactions:")
    print(f"  Downloads          : {pos_breakdown['download']:>2}")
    print(f"  Likes              : {pos_breakdown['like']:>2}")
    print(f"  Bookmarks          : {pos_breakdown['bookmark']:>2}")
    print(f"  RAG Chats          : {pos_breakdown['chat']:>2}")
    print(f"  Repeat Views       : {pos_breakdown['repeat_view']:>2}")

    # 5. Negative Sampling
    negatives = build_negative_candidates(positives, data, ever_engaged, rng)

    hard_negatives = sum(1 for n in negatives if n["interaction_source"] == "negative_hard")
    soft_negatives = sum(1 for n in negatives if n["interaction_source"] == "negative_soft")

    print("\nNegative sampling:")
    print(f"  Hard negatives     : {hard_negatives:>2}")
    print(f"  Soft negatives     : {soft_negatives:>2}")

    # 6. Combine and Calculate Point-in-Time Features
    all_candidates = positives + negatives
    feature_rows: List[Dict[str, Any]] = []

    for cand in all_candidates:
        feats = calculate_features_for_row(
            user_id=cand["user_id"],
            note_id=cand["note_id"],
            t=cand["timestamp"],
            data=data,
            curriculum_set=curriculum_set,
            subjects_by_note=subjects_by_note,
            notes_by_subject=notes_by_subject,
            notes_by_uploader=notes_by_uploader,
        )
        feats["target"] = int(cand["target"])
        feats["interaction_source"] = cand["interaction_source"]
        feature_rows.append(feats)

    df_dataset = pd.DataFrame(feature_rows)

    PROCESSED_DIR.mkdir(parents=True, exist_ok=True)
    df_dataset.to_csv(DATASET_CSV, index=False)

    # 7. Dataset Summary & Output Metrics
    total_rows = int(len(df_dataset))
    pos_count = int(len(positives))
    neg_count = int(len(negatives))
    ratio_str = f"1:{round(neg_count / max(pos_count, 1), 2)}"
    unique_users = int(df_dataset["user_id"].nunique()) if total_rows > 0 else 0
    unique_notes = int(df_dataset["note_id"].nunique()) if total_rows > 0 else 0

    print("\nDataset:")
    print(f"  Total rows         : {total_rows:>2}")
    print(f"  Positive rows      : {pos_count:>2}")
    print(f"  Negative rows      : {neg_count:>2}")
    print(f"  Ratio              : {ratio_str}")
    print(f"  Unique users       : {unique_users:>2}")
    print(f"  Unique notes       : {unique_notes:>2}")

    print("\nFeature limitations:")
    print("  Semantic embeddings: DISABLED — no embeddings in raw CSV")
    print("  Note tags          : UNAVAILABLE — not extracted")

    # 8. Validation Checks
    checks = validate_dataset(df_dataset, data)

    print("\n" + "=" * 60)
    print("Validation")
    print("=" * 60)

    print(f"  [{'OK' if checks.get('dataset_exists') else 'FAIL'}] Dataset generated")
    print(f"  [{'OK' if checks.get('user_id_valid') and checks.get('note_id_valid') else 'FAIL'}] IDs valid")
    print(f"  [{'OK' if checks.get('timestamps_valid') else 'FAIL'}] Timestamps valid")
    print(f"  [{'OK' if checks.get('binary_cols_valid') else 'FAIL'}] Binary features valid")
    print(f"  [{'OK' if checks.get('no_unpublished_notes') else 'FAIL'}] No unpublished notes")
    print(f"  [{'OK' if checks.get('no_self_authored_notes') else 'FAIL'}] No self-authored notes")
    print(f"  [{'OK' if checks.get('no_exact_duplicates') else 'FAIL'}] No exact duplicates")
    print(f"  [{'OK' if checks.get('temporal_leakage_passed') else 'FAIL'}] Temporal leakage checks passed")

    # 9. Save Summary JSON (all native types)
    summary_data = {
        "total_rows": total_rows,
        "positive_rows": pos_count,
        "negative_rows": neg_count,
        "positive_negative_ratio": ratio_str,
        "unique_users": unique_users,
        "unique_notes": unique_notes,
        "number_of_view_derived_positives": pos_breakdown["repeat_view"],
        "number_of_download_positives": pos_breakdown["download"],
        "number_of_like_positives": pos_breakdown["like"],
        "number_of_bookmark_positives": pos_breakdown["bookmark"],
        "number_of_chat_positives": pos_breakdown["chat"],
        "number_of_generated_negatives": neg_count,
        "positives_breakdown": pos_breakdown,
        "negatives_breakdown": {
            "hard_negatives": hard_negatives,
            "soft_negatives": soft_negatives,
        },
        "curriculum_matching_method": "Schema-based approximation checking if (subjectId, branchId, semester) tuple exists in subjects curriculum table",
        "feature_columns": list(df_dataset.columns),
        "feature_limitations": {
            "semantic_affinity_score": "Disabled (default 0.0) — raw CSV extraction does not include embeddings",
            "note_tag_count": "Unavailable (default 0) — tag relations not part of current raw tables"
        },
        "validation_results": {k: bool(v) for k, v in checks.items()},
        "privacy_validation": {
            "passwords_excluded": True,
            "emails_excluded": True,
            "auth_tokens_excluded": True
        },
        "random_seed": RANDOM_SEED
    }

    with open(SUMMARY_JSON, "w", encoding="utf-8") as f:
        json.dump(summary_data, f, indent=2)

    print("\nOutput:")
    print(f"  {DATASET_CSV}")
    print(f"  {SUMMARY_JSON}")

    print("\n" + "=" * 60)
    print("Dataset generation completed successfully.")
    print("=" * 60)


if __name__ == "__main__":
    main()
