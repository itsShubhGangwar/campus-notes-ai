"""
CampusNotes AI — Unit Tests for Offline Recommendation Inference
===============================================================

Module: recommendation/tests/test_inference.py
Purpose: Unit and integration testing for the offline recommendation inference
         pipeline (recommend.py). Verifies model loading, feature construction,
         candidate filtering, self-authored exclusion, unpublished exclusion,
         score calculation, ranking order, top_k slicing, unknown user handling,
         and deterministic reproducibility.
"""

from datetime import datetime, timezone
from pathlib import Path
import sys
import numpy as np
import pandas as pd

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.features.feature_pipeline import FEATURE_COLUMNS, METADATA_COLUMNS, TARGET_COLUMN
from recommendation.inference.recommend import (
    load_model,
    load_raw_data,
    build_candidate_features,
    score_candidates,
    rank_recommendations,
    recommend_for_user,
    save_recommendations,
    validate_inference,
)

# Test constants
TEST_TIMESTAMP = datetime(2026, 9, 15, 12, 0, 0, tzinfo=timezone.utc)
BOB_USER_ID = "da3250c0-80b1-46ca-b682-a94b5c5132f3"   # 0 notes uploaded, 30 eligible
ALEX_USER_ID = "57bcfcff-0d5f-4eac-83b6-7f368664f0ad"  # 29 notes uploaded, 1 eligible


def test_1_model_loading():
    """Verify model artifact loads and contains expected components."""
    print("Test 1: Model Artifact Loading...")
    artifact = load_model()
    assert artifact is not None, "Artifact loaded as None"
    assert "model" in artifact, "Missing 'model' key in artifact"
    assert "pipeline" in artifact, "Missing 'pipeline' key in artifact"
    assert "feature_columns" in artifact, "Missing 'feature_columns' in artifact"
    assert len(artifact["feature_columns"]) == 27, f"Expected 27 features, got {len(artifact['feature_columns'])}"
    assert artifact["feature_columns"] == FEATURE_COLUMNS, "Feature column ordering mismatch"
    print("  [PASS] Model artifact loaded and validated (27 features).")


def test_2_feature_shape_and_integrity():
    """Verify candidate feature construction generates clean (N, 27) DataFrame."""
    print("Test 2: Feature Construction & Shape...")
    data = load_raw_data()
    user_row = data["users"][data["users"]["id"] == BOB_USER_ID].iloc[0]
    candidate_notes = data["notes"][(data["notes"]["isPublished"] == True) & (data["notes"]["uploaderId"] != BOB_USER_ID)]

    features = build_candidate_features(user_row, candidate_notes, data, TEST_TIMESTAMP)
    assert features.shape == (len(candidate_notes), 27), f"Expected shape ({len(candidate_notes)}, 27), got {features.shape}"
    assert list(features.columns) == FEATURE_COLUMNS, "Feature column ordering mismatch"
    assert features.isnull().sum().sum() == 0, "NaN values present in raw features"
    assert not np.isinf(features.to_numpy()).any(), "Infinite values present in raw features"
    assert TARGET_COLUMN not in features.columns, "Target leaked into inference features"
    for meta in METADATA_COLUMNS:
        assert meta not in features.columns, f"Metadata column '{meta}' leaked into inference features"
    print(f"  [PASS] Successfully generated features for {len(candidate_notes)} candidates with 0 NaNs.")


def test_3_candidate_exclusion_filtering():
    """Verify published filter and basic candidate exclusion."""
    print("Test 3: Candidate Exclusion Filtering...")
    data = load_raw_data()
    all_notes = data["notes"]
    published_notes = all_notes[all_notes["isPublished"] == True]
    assert len(published_notes) == 30, f"Expected 30 published notes, found {len(published_notes)}"
    print(f"  [PASS] {len(published_notes)} published notes verified in catalog.")


def test_4_self_authored_exclusion():
    """Verify that notes uploaded by the user are strictly excluded from candidates."""
    print("Test 4: Self-Authored Note Exclusion...")
    data = load_raw_data()
    artifact = load_model()

    # Alex Rivera uploaded 29 of the 30 notes
    recs, diag = recommend_for_user(
        user_id=ALEX_USER_ID,
        top_k=10,
        inference_time=TEST_TIMESTAMP,
        model_artifact=artifact,
        raw_data=data,
    )

    # Eligible notes must be exactly 30 - 29 = 1
    assert diag["eligible_candidates_count"] == 1, f"Expected 1 eligible candidate, got {diag['eligible_candidates_count']}"
    assert len(recs) == 1, f"Expected 1 recommendation returned, got {len(recs)}"
    assert recs.iloc[0]["note_id"] not in data["notes"][data["notes"]["uploaderId"] == ALEX_USER_ID]["id"].values
    print("  [PASS] 29 self-authored notes successfully excluded; exactly 1 external candidate recommended.")


def test_5_unpublished_exclusion():
    """Verify unpublished notes are never recommended."""
    print("Test 5: Unpublished Note Exclusion...")
    data = load_raw_data()
    artifact = load_model()

    # In-memory test: mark one note as unpublished
    target_note_id = "8706bbb8-8343-4edc-9af4-244b9cad76aa"
    data_copy = {k: v.copy() for k, v in data.items()}
    data_copy["notes"].loc[data_copy["notes"]["id"] == target_note_id, "isPublished"] = False

    recs, diag = recommend_for_user(
        user_id=BOB_USER_ID,
        top_k=30,
        inference_time=TEST_TIMESTAMP,
        model_artifact=artifact,
        raw_data=data_copy,
    )

    assert target_note_id not in recs["note_id"].values, "Unpublished note leaked into recommendations!"
    assert len(recs) == 29, f"Expected 29 eligible notes, got {len(recs)}"
    print("  [PASS] Unpublished notes strictly excluded from candidate set.")


def test_6_score_generation():
    """Verify predicted scores are probabilities in [0.0, 1.0] and finite."""
    print("Test 6: Score Generation & Validity...")
    artifact = load_model()
    data = load_raw_data()
    user_row = data["users"][data["users"]["id"] == BOB_USER_ID].iloc[0]
    candidate_notes = data["notes"][(data["notes"]["isPublished"] == True) & (data["notes"]["uploaderId"] != BOB_USER_ID)]

    features = build_candidate_features(user_row, candidate_notes, data, TEST_TIMESTAMP)
    scores = score_candidates(artifact["model"], artifact["pipeline"], features)

    assert len(scores) == len(candidate_notes), "Score count mismatch"
    assert np.all(np.isfinite(scores)), "Non-finite scores detected"
    assert np.all((scores >= 0.0) & (scores <= 1.0)), "Scores outside [0.0, 1.0] range"
    print(f"  [PASS] {len(scores)} valid probability scores generated in [0.0, 1.0].")


def test_7_descending_ranking():
    """Verify recommendations are strictly ordered by engagement_score descending."""
    print("Test 7: Descending Ranking Order...")
    recs, _ = recommend_for_user(BOB_USER_ID, top_k=10, inference_time=TEST_TIMESTAMP)
    scores = recs["engagement_score"].values
    for i in range(len(scores) - 1):
        assert scores[i] >= scores[i + 1], f"Ranking violation at position {i}: {scores[i]} < {scores[i+1]}"
    assert recs["engagement_score"].is_monotonic_decreasing, "Recommendations not monotonically decreasing"
    print("  [PASS] Recommendations are strictly sorted descending by engagement score.")


def test_8_top_k_behavior():
    """Verify top_k parameter behavior across multiple values."""
    print("Test 8: Top-K Slicing Behavior...")
    # top_k = 5
    recs5, _ = recommend_for_user(BOB_USER_ID, top_k=5, inference_time=TEST_TIMESTAMP)
    assert len(recs5) == 5, f"Expected 5 recommendations, got {len(recs5)}"
    assert list(recs5["rank"]) == [1, 2, 3, 4, 5], "Rank column mismatch for top_k=5"

    # top_k = 1
    recs1, _ = recommend_for_user(BOB_USER_ID, top_k=1, inference_time=TEST_TIMESTAMP)
    assert len(recs1) == 1, f"Expected 1 recommendation, got {len(recs1)}"

    # top_k = 100 (more than available 30)
    recs_all, _ = recommend_for_user(BOB_USER_ID, top_k=100, inference_time=TEST_TIMESTAMP)
    assert len(recs_all) == 30, f"Expected 30 recommendations, got {len(recs_all)}"
    print("  [PASS] Top-K slicing correctly handles k=1, k=5, and k > available.")


def test_9_unknown_user_handling():
    """Verify non-existent user raises clear ValueError."""
    print("Test 9: Unknown User Handling...")
    try:
        recommend_for_user("non-existent-uuid-12345", top_k=5)
        assert False, "Should have raised ValueError for non-existent user"
    except ValueError as e:
        assert "not found in users.csv" in str(e)
    print("  [PASS] Unknown user cleanly raises ValueError with descriptive message.")


def test_10_deterministic_reproducibility():
    """Verify identical scores and rankings across repeated runs with same timestamp."""
    print("Test 10: Deterministic Reproducibility...")
    recs_run1, _ = recommend_for_user(BOB_USER_ID, top_k=10, inference_time=TEST_TIMESTAMP)
    recs_run2, _ = recommend_for_user(BOB_USER_ID, top_k=10, inference_time=TEST_TIMESTAMP)

    assert list(recs_run1["note_id"]) == list(recs_run2["note_id"]), "Ranked note ID mismatch between runs"
    assert np.allclose(recs_run1["engagement_score"].values, recs_run2["engagement_score"].values), "Score mismatch between runs"
    print("  [PASS] Repeated inference runs produce 100% identical rankings and scores.")


def test_11_zero_eligible_candidates_edge_case():
    """Verify behavior when 0 notes are eligible (returns empty DataFrame with required schema)."""
    print("Test 11: Zero Eligible Candidates Edge Case...")
    data = load_raw_data()
    data_empty = {k: v.copy() for k, v in data.items()}
    # Mark all notes as published=False
    data_empty["notes"]["isPublished"] = False

    recs, diag = recommend_for_user(
        user_id=BOB_USER_ID,
        top_k=5,
        inference_time=TEST_TIMESTAMP,
        raw_data=data_empty,
    )
    assert recs.empty, "Expected empty DataFrame for 0 eligible notes"
    assert "rank" in recs.columns and "engagement_score" in recs.columns
    assert diag["eligible_candidates_count"] == 0
    print("  [PASS] Handled 0 eligible notes gracefully without crashing.")


def test_12_title_deduplication_keeps_highest_score():
    """Verify title-level deduplication retains the highest-scoring candidate per title."""
    print("Test 12: Title Deduplication Keeps Highest-Scoring Candidate...")
    candidates = pd.DataFrame([
        {"id": "note-1", "title": "Operating Systems Paging", "subjectId": "sub-1", "semester": 4, "branchId": "b-1"},
        {"id": "note-2", "title": "Operating Systems Paging", "subjectId": "sub-1", "semester": 4, "branchId": "b-1"},
        {"id": "note-3", "title": "Compiler SSA Form", "subjectId": "sub-2", "semester": 6, "branchId": "b-1"},
    ])
    scores = np.array([0.45, 0.92, 0.70])

    recs = rank_recommendations(candidates, scores, top_k=5, deduplicate_titles=True)

    # Must contain exactly 2 unique titles
    assert len(recs) == 2, f"Expected 2 unique titles, got {len(recs)}"
    # First place must be note-2 (score 0.92)
    assert recs.iloc[0]["note_id"] == "note-2", f"Expected note-2 at rank 1, got {recs.iloc[0]['note_id']}"
    assert recs.iloc[0]["engagement_score"] == 0.92
    assert recs.iloc[0]["rank"] == 1

    # Second place must be note-3 (score 0.70)
    assert recs.iloc[1]["note_id"] == "note-3", f"Expected note-3 at rank 2, got {recs.iloc[1]['note_id']}"
    assert recs.iloc[1]["engagement_score"] == 0.70
    assert recs.iloc[1]["rank"] == 2

    # Lower-scoring duplicate note-1 (0.45) must be eliminated
    assert "note-1" not in recs["note_id"].values, "Lower-scoring duplicate note-1 was not deduplicated!"
    print("  [PASS] Title-level deduplication preserved highest score and dropped lower-scoring duplicate.")


def test_13_note_id_uniqueness():
    """Verify all returned recommendations have strictly unique note_ids."""
    print("Test 13: Note ID Uniqueness...")
    recs, _ = recommend_for_user(BOB_USER_ID, top_k=30, inference_time=TEST_TIMESTAMP)
    assert len(recs["note_id"]) == recs["note_id"].nunique(), "Duplicate note_id found in recommendations"
    print(f"  [PASS] All {len(recs)} returned recommendations have unique note IDs.")


def test_14_strictly_descending_scores_and_sequential_ranks():
    """Verify ranks are sequentially ordered 1..N and scores strictly descend."""
    print("Test 14: Sequential Ranks and Monotonic Decreasing Scores...")
    recs, _ = recommend_for_user(BOB_USER_ID, top_k=15, inference_time=TEST_TIMESTAMP)
    expected_ranks = list(range(1, len(recs) + 1))
    assert list(recs["rank"]) == expected_ranks, f"Ranks mismatch: {list(recs['rank'])} vs {expected_ranks}"
    assert recs["engagement_score"].is_monotonic_decreasing, "Scores are not monotonically decreasing"
    print(f"  [PASS] Sequential ranks 1..{len(recs)} and monotonically decreasing scores verified.")


def test_15_fewer_unique_titles_than_top_k():
    """Verify behavior when number of unique titles is strictly less than requested top_k."""
    print("Test 15: Fewer Unique Titles Than Requested Top-K...")
    candidates = pd.DataFrame([
        {"id": "note-1", "title": "Data Structures Trees", "subjectId": "s-1", "semester": 2, "branchId": "b-1"},
        {"id": "note-2", "title": "Data Structures Trees", "subjectId": "s-1", "semester": 2, "branchId": "b-1"},
        {"id": "note-3", "title": "Data Structures Trees", "subjectId": "s-1", "semester": 2, "branchId": "b-1"},
    ])
    scores = np.array([0.30, 0.85, 0.60])

    recs = rank_recommendations(candidates, scores, top_k=10, deduplicate_titles=True)
    assert len(recs) == 1, f"Expected 1 unique title returned, got {len(recs)}"
    assert recs.iloc[0]["note_id"] == "note-2"
    assert recs.iloc[0]["engagement_score"] == 0.85
    assert recs.iloc[0]["rank"] == 1
    print("  [PASS] Correctly handled fewer unique titles than top_k without padding or errors.")


def test_16_empty_candidate_set():
    """Verify rank_recommendations handles empty candidate DataFrame gracefully."""
    print("Test 16: Empty Candidate Set Handling...")
    empty_df = pd.DataFrame(columns=["id", "title", "subjectId", "semester", "branchId"])
    empty_scores = np.array([])
    recs = rank_recommendations(empty_df, empty_scores, top_k=10, deduplicate_titles=True)
    assert recs.empty, "Expected empty DataFrame output"
    required_cols = ["rank", "note_id", "title", "subject_id", "semester", "branch_id", "engagement_score"]
    assert list(recs.columns) == required_cols, f"Schema mismatch: {list(recs.columns)}"
    print("  [PASS] Empty candidate set returned valid empty schema.")


def test_17_deduplication_toggle_flag():
    """Verify deduplicate_titles flag controls whether duplicate titles are retained."""
    print("Test 17: Deduplication Toggle Flag...")
    candidates = pd.DataFrame([
        {"id": "note-1", "title": "Computer Networks Guide", "subjectId": "s-1", "semester": 4, "branchId": "b-1"},
        {"id": "note-2", "title": "Computer Networks Guide", "subjectId": "s-1", "semester": 4, "branchId": "b-1"},
    ])
    scores = np.array([0.75, 0.65])

    # With deduplicate_titles=True -> 1 result
    recs_dedup = rank_recommendations(candidates, scores, top_k=5, deduplicate_titles=True)
    assert len(recs_dedup) == 1, f"Expected 1 row with dedup, got {len(recs_dedup)}"
    assert recs_dedup.iloc[0]["note_id"] == "note-1"

    # With deduplicate_titles=False -> 2 results
    recs_no_dedup = rank_recommendations(candidates, scores, top_k=5, deduplicate_titles=False)
    assert len(recs_no_dedup) == 2, f"Expected 2 rows without dedup, got {len(recs_no_dedup)}"
    assert list(recs_no_dedup["note_id"]) == ["note-1", "note-2"]
    print("  [PASS] Deduplication toggle flag correctly switches between unique and raw modes.")


def run_all_tests():
    print("=" * 60)
    print("RUNNING INFERENCE TEST SUITE")
    print("=" * 60)
    test_1_model_loading()
    test_2_feature_shape_and_integrity()
    test_3_candidate_exclusion_filtering()
    test_4_self_authored_exclusion()
    test_5_unpublished_exclusion()
    test_6_score_generation()
    test_7_descending_ranking()
    test_8_top_k_behavior()
    test_9_unknown_user_handling()
    test_10_deterministic_reproducibility()
    test_11_zero_eligible_candidates_edge_case()
    test_12_title_deduplication_keeps_highest_score()
    test_13_note_id_uniqueness()
    test_14_strictly_descending_scores_and_sequential_ranks()
    test_15_fewer_unique_titles_than_top_k()
    test_16_empty_candidate_set()
    test_17_deduplication_toggle_flag()
    print("=" * 60)
    print("ALL 17 INFERENCE TESTS PASSED!")
    print("=" * 60)


if __name__ == "__main__":
    run_all_tests()

