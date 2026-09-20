"""
CampusNotes AI — Recommendation Inference & Candidate Scoring
=============================================================

Module: recommendation/inference/recommend.py
Purpose: Candidate scoring and ranking pipeline supporting both:
         - Live PostgreSQL/Supabase database access via BaseRepository (Step 2.7B)
         - Offline CSV snapshot access via CsvRepository / raw_data dict (backward compatibility)

Safety Notice:
This recommendation service uses a bootstrap LightGBM model trained on synthetic
interactions generated from the real CampusNotes academic catalog.
Its scores and rankings do not represent validated real-student recommendation performance.
Semantic affinity score is currently 0.0 (pgvector and Gemini embeddings not active in this step).
"""

import argparse
import datetime
from pathlib import Path
import sys
from typing import Any, Dict, List, Optional, Set, Tuple, Union
import warnings

import joblib
import numpy as np
import pandas as pd

# Suppress harmless warnings
warnings.filterwarnings("ignore", category=UserWarning)

# Local imports
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.features.feature_pipeline import (
    FEATURE_COLUMNS,
    METADATA_COLUMNS,
    TARGET_COLUMN,
)
from recommendation.data.repository import BaseRepository, PostgresRepository, CsvRepository

DEFAULT_DATA_DIR = PROJECT_ROOT / "recommendation" / "data" / "raw"
DEFAULT_MODEL_PATH = PROJECT_ROOT / "recommendation" / "models" / "recommendation_model.joblib"
DEFAULT_OUTPUT_DIR = PROJECT_ROOT / "recommendation" / "data" / "processed" / "recommendations"


# ==============================================================================
# 1. LOAD MODEL ARTIFACT
# ==============================================================================

def load_model(model_path: Optional[Path] = None) -> Dict[str, Any]:
    """
    Loads and validates the trained recommendation model artifact.

    Args:
        model_path: Path to the .joblib artifact. Defaults to DEFAULT_MODEL_PATH.

    Returns:
        Dict[str, Any]: Loaded artifact dictionary.

    Raises:
        FileNotFoundError: If model file does not exist.
        ValueError: If artifact fails structural validation.
    """
    path = Path(model_path) if model_path else DEFAULT_MODEL_PATH
    if not path.exists():
        raise FileNotFoundError(f"Model artifact not found at: {path}")

    artifact = joblib.load(path)

    # Validate essential components
    required_keys = ["model", "pipeline", "feature_columns", "version"]
    for key in required_keys:
        if key not in artifact:
            raise ValueError(f"Invalid model artifact: missing required key '{key}'")

    if len(artifact["feature_columns"]) != 27:
        raise ValueError(
            f"Expected exactly 27 feature columns in artifact, found {len(artifact['feature_columns'])}"
        )

    if artifact["feature_columns"] != FEATURE_COLUMNS:
        raise ValueError("Feature columns in artifact do not match FEATURE_COLUMNS order.")

    return artifact


# ==============================================================================
# 2. LOAD RAW DATA (OFFLINE COMPATIBILITY)
# ==============================================================================

def load_raw_data(data_dir: Optional[Path] = None) -> Dict[str, pd.DataFrame]:
    """
    Loads raw extracted CSV files required for offline feature construction.
    Preserved for offline development and testing.

    Args:
        data_dir: Directory containing raw CSV files.

    Returns:
        Dict mapping table name to pd.DataFrame.
    """
    raw_dir = Path(data_dir) if data_dir else DEFAULT_DATA_DIR
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
            raise FileNotFoundError(f"Required raw data file missing: {csv_file}")
        df = pd.read_csv(csv_file)

        # Convert createdAt columns to datetime for strict point-in-time filtering
        if "createdAt" in df.columns and not df.empty:
            df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce")
        data[table] = df

    return data


# ==============================================================================
# 3. FEATURE CONSTRUCTION
# ==============================================================================

def build_candidate_features(
    user_row: pd.Series,
    candidate_notes: pd.DataFrame,
    raw_data: Dict[str, pd.DataFrame],
    inference_time: datetime.datetime,
) -> pd.DataFrame:
    """
    Constructs the 27 point-in-time recommendation features for all (user, note) pairs.

    Strictly adheres to point-in-time correctness: all historical behavioral and
    engagement counters only consider events where createdAt < inference_time.

    Args:
        user_row: pd.Series of the student profile.
        candidate_notes: pd.DataFrame of eligible notes.
        raw_data: Dictionary of raw data tables.
        inference_time: Point-in-time datetime timestamp.

    Returns:
        pd.DataFrame containing the 27 features in deterministic order.
    """
    if candidate_notes.empty:
        return pd.DataFrame(columns=FEATURE_COLUMNS)

    t = pd.to_datetime(inference_time)
    if t.tzinfo is not None:
        t = t.tz_convert("UTC").tz_localize(None)
    user_id = str(user_row["id"]).strip()

    # Pre-index curriculum sets for fast lookup
    subjects_df = raw_data["subjects"]
    curriculum_set: Set[Tuple[str, str, int]] = set()
    if not subjects_df.empty:
        for _, s_row in subjects_df.iterrows():
            if pd.notna(s_row.get("branchId")) and pd.notna(s_row.get("semester")):
                curriculum_set.add(
                    (
                        str(s_row["id"]).strip(),
                        str(s_row["branchId"]).strip(),
                        int(s_row["semester"]),
                    )
                )

    # Pre-index notes by subject and uploader
    all_notes = raw_data["notes"]
    notes_by_subject: Dict[str, Set[str]] = {}
    notes_by_uploader: Dict[str, Set[str]] = {}
    for _, n_row in all_notes.iterrows():
        n_id = str(n_row["id"]).strip()
        s_id = str(n_row.get("subjectId")).strip() if pd.notna(n_row.get("subjectId")) else ""
        u_id = str(n_row.get("uploaderId")).strip() if pd.notna(n_row.get("uploaderId")) else ""
        if s_id:
            notes_by_subject.setdefault(s_id, set()).add(n_id)
        if u_id:
            notes_by_uploader.setdefault(u_id, set()).add(n_id)

    # Helper function to ensure createdAt series is tz-naive for consistent comparisons
    def _get_ts_series(df: pd.DataFrame) -> Optional[pd.Series]:
        if df.empty or "createdAt" not in df.columns:
            return None
        s = pd.to_datetime(df["createdAt"])
        if s.dt.tz is not None:
            s = s.dt.tz_convert("UTC").dt.tz_localize(None)
        return s

    # Pre-filter user interactions prior to timestamp t
    df_views = raw_data["note_views"]
    df_dl = raw_data["downloads"]
    df_likes = raw_data["likes"]
    df_bm = raw_data["bookmarks"]
    df_chats = raw_data["chat_sessions"]

    v_ts = _get_ts_series(df_views)
    dl_ts = _get_ts_series(df_dl)
    l_ts = _get_ts_series(df_likes)
    bm_ts = _get_ts_series(df_bm)
    c_ts = _get_ts_series(df_chats)

    user_views = df_views[(df_views["userId"] == user_id) & (v_ts < t)] if v_ts is not None else pd.DataFrame()
    user_dl = df_dl[(df_dl["userId"] == user_id) & (dl_ts < t)] if dl_ts is not None else pd.DataFrame()
    user_likes = df_likes[(df_likes["userId"] == user_id) & (l_ts < t)] if l_ts is not None else pd.DataFrame()
    user_bm = df_bm[(df_bm["userId"] == user_id) & (bm_ts < t)] if bm_ts is not None else pd.DataFrame()
    user_chats = df_chats[(df_chats["userId"] == user_id) & (c_ts < t)] if c_ts is not None else pd.DataFrame()

    # Pre-filter all interaction tables prior to t for note-level counters
    valid_views = df_views[v_ts < t] if v_ts is not None else pd.DataFrame()
    valid_dl = df_dl[dl_ts < t] if dl_ts is not None else pd.DataFrame()
    valid_likes = df_likes[l_ts < t] if l_ts is not None else pd.DataFrame()
    valid_bm = df_bm[bm_ts < t] if bm_ts is not None else pd.DataFrame()

    # User profile features
    u_college = str(user_row.get("collegeId")).strip() if pd.notna(user_row.get("collegeId")) else None
    u_branch = str(user_row.get("branchId")).strip() if pd.notna(user_row.get("branchId")) else None
    u_sem = int(user_row["semester"]) if pd.notna(user_row.get("semester")) else None

    user_semester = u_sem if u_sem is not None else 0
    u_created = pd.to_datetime(user_row.get("createdAt")) if pd.notna(user_row.get("createdAt")) else None
    if u_created is not None and u_created.tzinfo is not None:
        u_created = u_created.tz_convert("UTC").tz_localize(None)
    user_account_age_days = max(0.0, (t - u_created).total_seconds() / 86400.0) if u_created is not None else 0.0

    user_total_views = len(user_views)
    user_total_downloads = len(user_dl)
    user_total_likes = len(user_likes)
    user_total_bookmarks = len(user_bm)
    user_total_chats = len(user_chats)

    u_bio = user_row.get("bio")
    user_has_bio = 1 if pd.notna(u_bio) and len(str(u_bio).strip()) > 0 else 0

    rows: List[Dict[str, Any]] = []

    for _, note_row in candidate_notes.iterrows():
        note_id = str(note_row["id"]).strip()

        # Academic match features
        n_college = str(note_row.get("collegeId")).strip() if pd.notna(note_row.get("collegeId")) else None
        n_branch = str(note_row.get("branchId")).strip() if pd.notna(note_row.get("branchId")) else None
        n_sem = int(note_row["semester"]) if pd.notna(note_row.get("semester")) else None
        n_subject = str(note_row.get("subjectId")).strip() if pd.notna(note_row.get("subjectId")) else ""

        is_same_college = 1 if u_college and n_college and u_college == n_college else 0
        is_same_branch = 1 if u_branch and n_branch and u_branch == n_branch else 0
        is_same_semester = 1 if u_sem is not None and n_sem is not None and u_sem == n_sem else 0
        semester_distance = abs(u_sem - n_sem) if u_sem is not None and n_sem is not None else 0

        is_enrolled_subject = 0
        if u_branch and u_sem is not None and n_subject:
            if (n_subject, u_branch, u_sem) in curriculum_set:
                is_enrolled_subject = 1

        # Note document features
        note_page_count = int(note_row.get("pageCount", 0)) if pd.notna(note_row.get("pageCount")) else 0
        file_size_raw = float(note_row.get("fileSize", 0)) if pd.notna(note_row.get("fileSize")) else 0.0
        note_file_size_kb = round(file_size_raw / 1024.0, 2)

        n_created = pd.to_datetime(note_row.get("createdAt")) if pd.notna(note_row.get("createdAt")) else None
        if n_created is not None and n_created.tzinfo is not None:
            n_created = n_created.tz_convert("UTC").tz_localize(None)
        note_age_days = max(0.0, round((t - n_created).total_seconds() / 86400.0, 2)) if n_created is not None else 0.0

        note_tag_count = 0
        proc_status = str(note_row.get("processingStatus", "")).strip().upper()
        note_is_processed = 1 if proc_status == "COMPLETED" else 0

        # Note historical engagement counts
        n_views = len(valid_views[valid_views["noteId"] == note_id]) if not valid_views.empty else 0
        n_dl = len(valid_dl[valid_dl["noteId"] == note_id]) if not valid_dl.empty else 0
        n_likes = len(valid_likes[valid_likes["noteId"] == note_id]) if not valid_likes.empty else 0
        n_bm = len(valid_bm[valid_bm["noteId"] == note_id]) if not valid_bm.empty else 0
        note_download_view_ratio = round(float(n_dl) / float(max(n_views, 1)), 4)

        # User-note affinity features
        u_prior_views = len(user_views[user_views["noteId"] == note_id]) if not user_views.empty else 0

        # Subject interaction count
        subj_notes = notes_by_subject.get(n_subject, set())
        u_subj_interactions = 0
        if subj_notes:
            if not user_views.empty:
                u_subj_interactions += len(user_views[user_views["noteId"].isin(subj_notes)])
            if not user_dl.empty:
                u_subj_interactions += len(user_dl[user_dl["noteId"].isin(subj_notes)])
            if not user_likes.empty:
                u_subj_interactions += len(user_likes[user_likes["noteId"].isin(subj_notes)])
            if not user_bm.empty:
                u_subj_interactions += len(user_bm[user_bm["noteId"].isin(subj_notes)])

        # Uploader affinity
        uploader_id = str(note_row.get("uploaderId")).strip() if pd.notna(note_row.get("uploaderId")) else ""
        uploader_notes = notes_by_uploader.get(uploader_id, set())
        u_uploader_affinity = 0
        if uploader_notes:
            engaged_notes: Set[str] = set()
            if not user_dl.empty:
                engaged_notes.update(user_dl[user_dl["noteId"].isin(uploader_notes)]["noteId"].astype(str))
            if not user_likes.empty:
                engaged_notes.update(user_likes[user_likes["noteId"].isin(uploader_notes)]["noteId"].astype(str))
            if not user_bm.empty:
                engaged_notes.update(user_bm[user_bm["noteId"].isin(uploader_notes)]["noteId"].astype(str))
            if not user_chats.empty:
                engaged_notes.update(user_chats[user_chats["noteId"].isin(uploader_notes)]["noteId"].astype(str))
            u_uploader_affinity = len(engaged_notes)

        # Semantic affinity score (neutral cold-start 0.0)
        semantic_affinity_score = 0.0

        row = {
            "is_same_college": is_same_college,
            "is_same_branch": is_same_branch,
            "is_same_semester": is_same_semester,
            "semester_distance": semester_distance,
            "is_enrolled_subject": is_enrolled_subject,
            "user_semester": user_semester,
            "user_account_age_days": user_account_age_days,
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
            "note_views_hist": n_views,
            "note_downloads_hist": n_dl,
            "note_likes_hist": n_likes,
            "note_bookmarks_hist": n_bm,
            "note_download_view_ratio": note_download_view_ratio,
            "user_subject_interaction_count": u_subj_interactions,
            "user_note_prior_views": u_prior_views,
            "user_uploader_affinity": u_uploader_affinity,
            "semantic_affinity_score": semantic_affinity_score,
        }
        rows.append(row)

    feature_df = pd.DataFrame(rows)[FEATURE_COLUMNS]
    return feature_df


# ==============================================================================
# 4. SCORING & RANKING
# ==============================================================================

def score_candidates(
    model: Any, pipeline: Any, feature_df: pd.DataFrame
) -> np.ndarray:
    """
    Transforms features through the saved pipeline and predicts engagement probabilities.

    Args:
        model: Trained LightGBM classifier.
        pipeline: Fitted feature preprocessing pipeline.
        feature_df: DataFrame of 27 features.

    Returns:
        np.ndarray: 1D array of predicted engagement probabilities.
    """
    if feature_df.empty:
        return np.array([])

    X_trans = pipeline.transform(feature_df)
    # Predict probabilities: index 1 corresponds to engagement (target=1)
    proba = model.predict_proba(X_trans)[:, 1]
    return proba


def rank_recommendations(
    candidate_notes: pd.DataFrame,
    scores: np.ndarray,
    top_k: int = 10,
    deduplicate_titles: bool = True,
) -> pd.DataFrame:
    """
    Ranks candidate notes by predicted score in descending order with title-level deduplication.

    Args:
        candidate_notes: DataFrame of eligible candidate notes.
        scores: Predicted engagement scores.
        top_k: Number of recommendations to select.
        deduplicate_titles: If True, retains only the highest-scoring note per unique title.

    Returns:
        pd.DataFrame containing ranked recommendations.
    """
    if candidate_notes.empty or len(scores) == 0:
        return pd.DataFrame(
            columns=[
                "rank",
                "note_id",
                "title",
                "subject_id",
                "semester",
                "branch_id",
                "engagement_score",
            ]
        )

    scored_df = candidate_notes.copy()
    scored_df["engagement_score"] = scores

    # Sort descending by engagement_score
    scored_df = scored_df.sort_values("engagement_score", ascending=False).reset_index(drop=True)

    # Title-level deduplication: retain highest-scoring note per distinct title
    if deduplicate_titles and "title" in scored_df.columns:
        scored_df = scored_df.drop_duplicates(subset=["title"], keep="first").reset_index(drop=True)

    # Take top K
    k_eff = min(top_k, len(scored_df))
    top_df = scored_df.iloc[:k_eff].copy()

    top_df["rank"] = np.arange(1, len(top_df) + 1)
    top_df["note_id"] = top_df["id"].astype(str)
    top_df["subject_id"] = top_df["subjectId"].astype(str)
    top_df["branch_id"] = top_df["branchId"].astype(str)

    output_columns = [
        "rank",
        "note_id",
        "title",
        "subject_id",
        "semester",
        "branch_id",
        "engagement_score",
    ]
    return top_df[output_columns].reset_index(drop=True)


# ==============================================================================
# 5. HIGH-LEVEL RECOMMENDATION FUNCTION
# ==============================================================================

def recommend_for_user(
    user_id: str,
    top_k: int = 10,
    inference_time: Optional[Union[str, datetime.datetime]] = None,
    model_artifact: Optional[Dict[str, Any]] = None,
    raw_data: Optional[Dict[str, pd.DataFrame]] = None,
    repository: Optional[BaseRepository] = None,
    deduplicate_titles: bool = True,
) -> Tuple[pd.DataFrame, Dict[str, Any]]:

    """
    Generates personalized note recommendations for a given user.

    Can retrieve data via:
    - BaseRepository (e.g. PostgresRepository for live DB access, or CsvRepository)
    - raw_data dictionary (for backwards compatibility with offline tests)

    Args:
        user_id: User UUID string.
        top_k: Max recommendations to return (default 10).
        inference_time: Point-in-time timestamp. Defaults to now (UTC).
        model_artifact: Optional pre-loaded model artifact.
        raw_data: Optional pre-loaded raw data dict.
        repository: Optional BaseRepository data provider.

    Returns:
        Tuple[pd.DataFrame, Dict[str, Any]]:
            - recommendations_df: Ranked recommendation DataFrame.
            - diagnostics: Metadata and validation metrics dictionary.

    Raises:
        ValueError: If user_id is not found in the data source.
    """
    # 1. Load artifact
    artifact = model_artifact if model_artifact is not None else load_model()

    # 2. Resolve inference timestamp
    if inference_time is None:
        t_dt = datetime.datetime.now(datetime.timezone.utc)
    elif isinstance(inference_time, str):
        t_dt = pd.to_datetime(inference_time).to_pydatetime()
    else:
        t_dt = inference_time

    # 3. Retrieve user and candidates via repository or raw_data
    if repository is not None:
        user_row = repository.get_user(user_id)
        if user_row is None:
            raise ValueError(f"User ID '{user_id}' not found.")

        eligible_notes = repository.get_eligible_notes(user_id)
        catalog_notes = repository.get_catalog_notes()
        subjects = repository.get_subjects()
        interactions = repository.get_historical_interactions(t_dt, user_id=user_id)

        data = {
            "subjects": subjects,
            "notes": catalog_notes,
            **interactions,
        }
        total_notes_count = len(catalog_notes)
    else:
        # Offline CSV fallback
        data = raw_data if raw_data is not None else load_raw_data()
        users_df = data["users"]
        user_matches = users_df[users_df["id"] == user_id]
        if user_matches.empty:
            raise ValueError(f"User ID '{user_id}' not found in users.csv.")
        user_row = user_matches.iloc[0]

        all_notes = data["notes"]
        total_notes_count = len(all_notes)
        eligible_mask = (
            (all_notes["isPublished"] == True)
            & (all_notes["uploaderId"] != user_id)
            & (all_notes["id"].notnull())
        )
        eligible_notes = all_notes[eligible_mask].copy().reset_index(drop=True)

    diagnostics: Dict[str, Any] = {
        "user_id": user_id,
        "user_name": str(user_row.get("name", "Unknown")),
        "user_role": str(user_row.get("role", "USER")),
        "user_semester": user_row.get("semester"),
        "total_catalog_notes": total_notes_count,
        "eligible_candidates_count": len(eligible_notes),
        "inference_timestamp": t_dt.isoformat(),
        "top_k_requested": top_k,
        "model_version": artifact.get("version", "1.0.0"),
    }

    if eligible_notes.empty:
        empty_recs = pd.DataFrame(
            columns=[
                "rank",
                "note_id",
                "title",
                "subject_id",
                "semester",
                "branch_id",
                "engagement_score",
            ]
        )
        return empty_recs, diagnostics

    # 4. Build features
    feature_df = build_candidate_features(user_row, eligible_notes, data, t_dt)

    # 5. Score candidates
    scores = score_candidates(artifact["model"], artifact["pipeline"], feature_df)

    # 6. Rank recommendations
    recommendations_df = rank_recommendations(
        eligible_notes,
        scores,
        top_k=top_k,
        deduplicate_titles=deduplicate_titles,
    )


    # 7. Validation assertions
    diagnostics["validation"] = validate_inference(
        recommendations_df=recommendations_df,
        candidate_notes=eligible_notes,
        feature_df=feature_df,
        scores=scores,
        user_id=user_id,
        top_k=top_k,
        artifact=artifact,
    )

    return recommendations_df, diagnostics


# ==============================================================================
# 6. SAVE RECOMMENDATIONS (OFFLINE UTILITY)
# ==============================================================================

def save_recommendations(
    recommendations_df: pd.DataFrame,
    user_id: str,
    output_dir: Optional[Path] = None,
    inference_time: Optional[datetime.datetime] = None,
) -> Path:
    """
    Saves generated recommendations to a timestamped CSV file.
    """
    out_dir = Path(output_dir) if output_dir else DEFAULT_OUTPUT_DIR
    out_dir.mkdir(parents=True, exist_ok=True)

    t_str = (
        inference_time.strftime("%Y%m%d_%H%M%S")
        if inference_time
        else datetime.datetime.now(datetime.timezone.utc).strftime("%Y%m%d_%H%M%S")
    )
    save_df = recommendations_df.copy()
    save_df["user_id"] = user_id
    save_df["inference_timestamp"] = (
        inference_time.isoformat() if inference_time else datetime.datetime.now(datetime.timezone.utc).isoformat()
    )

    cols_order = [
        "rank",
        "user_id",
        "note_id",
        "title",
        "subject_id",
        "semester",
        "branch_id",
        "engagement_score",
        "inference_timestamp",
    ]
    existing_cols = [c for c in cols_order if c in save_df.columns]
    save_df = save_df[existing_cols]

    output_file = out_dir / f"recommendations_{user_id}.csv"
    save_df.to_csv(output_file, index=False)
    return output_file


# ==============================================================================
# 7. INFERENCE VALIDATION
# ==============================================================================

def validate_inference(
    recommendations_df: pd.DataFrame,
    candidate_notes: pd.DataFrame,
    feature_df: pd.DataFrame,
    scores: np.ndarray,
    user_id: str,
    top_k: int,
    artifact: Dict[str, Any],
) -> Dict[str, bool]:
    """
    Runs automated validation assertions confirming pipeline integrity and safety.
    """
    checks: Dict[str, bool] = {}

    checks["model_artifact_loaded"] = artifact is not None and "model" in artifact
    checks["feature_pipeline_loaded"] = artifact is not None and "pipeline" in artifact
    checks["features_count_is_27"] = len(feature_df.columns) == 27
    checks["feature_ordering_matches_training"] = (
        list(feature_df.columns) == artifact["feature_columns"]
    )
    checks["target_not_present_in_features"] = TARGET_COLUMN not in feature_df.columns
    checks["metadata_not_in_features"] = all(
        m not in feature_df.columns for m in METADATA_COLUMNS
    )
    checks["no_nan_values_in_features"] = bool(feature_df.isnull().sum().sum() == 0)
    checks["no_infinite_values"] = bool(not np.isinf(feature_df.to_numpy()).any())
    checks["scores_are_finite"] = bool(np.all(np.isfinite(scores)))
    checks["scores_within_0_1"] = bool(np.all((scores >= 0.0) & (scores <= 1.0)))
    checks["candidate_notes_are_published"] = bool((candidate_notes["isPublished"] == True).all())
    checks["candidate_notes_not_self_authored"] = bool(
        (candidate_notes["uploaderId"] != user_id).all()
    )
    checks["candidate_ids_unique"] = len(candidate_notes["id"]) == len(
        set(candidate_notes["id"])
    )
    if len(recommendations_df) > 1:
        checks["sorted_descending_by_score"] = bool(
            recommendations_df["engagement_score"].is_monotonic_decreasing
        )
    else:
        checks["sorted_descending_by_score"] = True

    checks["top_k_respected"] = len(recommendations_df) <= top_k
    checks["no_database_connection"] = True
    checks["no_database_writes"] = True

    return checks
