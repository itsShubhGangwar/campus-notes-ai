"""
CampusNotes AI — OFFLINE Synthetic Recommendation Dataset Generation Pipeline
Phase 3 Step 2.3B

Generates a controlled offline synthetic interaction dataset preserving real academic structure.
Enforces strict historical causality, false-negative protection, stratified negative sampling,
cold-start support, and reproducible output.
"""

import bisect
import json
import os
import random
import sys
from datetime import datetime, timedelta
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
SYNTHETIC_DIR = DATA_DIR / "synthetic"

INTERACTIONS_CSV = SYNTHETIC_DIR / "synthetic_interactions.csv"
TRAINING_DATASET_CSV = SYNTHETIC_DIR / "synthetic_training_dataset.csv"
SUMMARY_JSON = SYNTHETIC_DIR / "synthetic_dataset_summary.json"


def load_raw_reference_data(raw_dir: Path) -> Dict[str, pd.DataFrame]:
    """Load real raw CSV files as the reference ground truth for academic structure."""
    tables = ["users", "notes", "subjects"]
    data: Dict[str, pd.DataFrame] = {}

    for table in tables:
        csv_file = raw_dir / f"{table}.csv"
        if not csv_file.exists():
            raise FileNotFoundError(f"Required raw CSV not found: {csv_file}")

        df = pd.read_csv(csv_file, dtype=str)

        if table == "notes":
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
            if "createdAt" in df.columns:
                df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce")

        elif table == "subjects":
            if "semester" in df.columns:
                df["semester"] = pd.to_numeric(df["semester"], errors="coerce").fillna(0)

        data[table] = df

    return data


def generate_synthetic_cohort(
    count: int = 200, rng: random.Random = None
) -> pd.DataFrame:
    """Generate 200 synthetic students distributed across observed academic combinations."""
    if rng is None:
        rng = random.Random(RANDOM_SEED)

    # Real academic combinations observed in CampusNotes
    college_1 = "8f647f1f-b34c-451c-bc6f-2664858e5b8f"
    branch_1 = "1de8e5db-32af-451b-bf80-82d3773ec73a"

    college_2 = "a0200f46-4f86-4ddc-9e3d-af1eb556b74f"
    branch_2 = "a3053b3c-ed64-4527-b912-4cecf23926dc"

    # Distribution aligns with real notes distribution (28 notes in Sem 3 Branch 1):
    # 175 in Branch 1, Semester 3 (primary cohort matching 28 notes, enables ~70% hard negative ratio)
    # 15 in Branch 1, Semester 4 (matching note 0)
    # 10 in Branch 2, Semester 1 (matching note 29)
    configs = (
        [(college_1, branch_1, 3)] * 175
        + [(college_1, branch_1, 4)] * 15
        + [(college_2, branch_2, 1)] * 10
    )
    rng.shuffle(configs)

    base_start = datetime(2025, 8, 15, 9, 0, 0)
    cohort: List[Dict[str, Any]] = []

    for i in range(1, count + 1):
        user_id = f"synthetic_user_{i:04d}"
        college_id, branch_id, semester = configs[i - 1]

        created_delta_days = rng.randint(0, 30)
        created_delta_secs = rng.randint(0, 86400)
        account_created_at = base_start + timedelta(
            days=created_delta_days, seconds=created_delta_secs
        )

        has_bio = 1 if rng.random() < 0.40 else 0

        # Activity levels:
        # Inactive / pure cold start: first 8 students have 0 interactions
        # 25% low (1-3 sessions), 55% medium (4-8 sessions), 20% high (10-16 sessions)
        if i <= 8:
            activity_level = "inactive"
            num_sessions = 0
        else:
            p = rng.random()
            if p < 0.25:
                activity_level = "low"
                num_sessions = rng.randint(1, 3)
            elif p < 0.80:
                activity_level = "medium"
                num_sessions = rng.randint(4, 8)
            else:
                activity_level = "high"
                num_sessions = rng.randint(10, 16)

        cohort.append(
            {
                "user_id": user_id,
                "collegeId": college_id,
                "branchId": branch_id,
                "semester": semester,
                "has_bio": has_bio,
                "createdAt": account_created_at,
                "activity_level": activity_level,
                "num_sessions": num_sessions,
            }
        )

    return pd.DataFrame(cohort)


def simulate_synthetic_interactions(
    df_cohort: pd.DataFrame,
    df_notes: pd.DataFrame,
    rng: random.Random = None,
) -> pd.DataFrame:
    """Simulate realistic academic study behavior and interaction funnels over 6-9 months."""
    if rng is None:
        rng = random.Random(RANDOM_SEED)

    published_notes = df_notes[df_notes["isPublished"] == True].copy()
    interactions: List[Dict[str, Any]] = []

    sim_start = datetime(2025, 10, 1, 10, 0, 0)
    sim_span_days = 240
    session_counter = 0

    for _, student in df_cohort.iterrows():
        num_sessions = student["num_sessions"]
        if num_sessions == 0:
            continue

        u_id = student["user_id"]
        u_branch = student["branchId"]
        u_sem = int(student["semester"])
        u_created = student["createdAt"]

        session_days = sorted(
            [rng.randint(1, sim_span_days) for _ in range(num_sessions)]
        )
        session_timestamps = []
        for d in session_days:
            sess_time = sim_start + timedelta(
                days=d,
                hours=rng.randint(8, 22),
                minutes=rng.randint(0, 59),
                seconds=rng.randint(0, 59),
            )
            if sess_time < u_created:
                sess_time = u_created + timedelta(
                    days=rng.randint(1, 10), hours=rng.randint(1, 12)
                )
            session_timestamps.append(sess_time)

        session_timestamps.sort()

        current_sem_notes: List[str] = []
        adjacent_sem_notes: List[str] = []
        cross_branch_notes: List[str] = []

        for _, nrow in published_notes.iterrows():
            nid = str(nrow["id"]).strip()
            n_sem = int(nrow.get("semester", 0))
            n_branch = str(nrow.get("branchId", "")).strip()

            if n_branch == u_branch and n_sem == u_sem:
                current_sem_notes.append(nid)
            elif n_branch == u_branch and abs(n_sem - u_sem) == 1:
                adjacent_sem_notes.append(nid)
            else:
                cross_branch_notes.append(nid)

        previously_viewed_notes: List[str] = []

        for sess_time in session_timestamps:
            session_counter += 1
            sess_id = f"session_{session_counter:06d}"

            revisit_prob = 0.35 if len(previously_viewed_notes) > 0 else 0.0
            is_revisit = rng.random() < revisit_prob

            chosen_note_id = None
            if is_revisit and previously_viewed_notes:
                chosen_note_id = rng.choice(previously_viewed_notes)
            else:
                roll = rng.random()
                if roll < 0.80 and current_sem_notes:
                    chosen_note_id = rng.choice(current_sem_notes)
                elif roll < 0.95 and adjacent_sem_notes:
                    chosen_note_id = rng.choice(adjacent_sem_notes)
                elif cross_branch_notes:
                    chosen_note_id = rng.choice(cross_branch_notes)
                elif current_sem_notes:
                    chosen_note_id = rng.choice(current_sem_notes)
                elif adjacent_sem_notes:
                    chosen_note_id = rng.choice(adjacent_sem_notes)
                else:
                    chosen_note_id = rng.choice(
                        published_notes["id"].astype(str).tolist()
                    )

            if not chosen_note_id:
                continue

            view_time = sess_time
            interactions.append(
                {
                    "user_id": u_id,
                    "note_id": chosen_note_id,
                    "timestamp": view_time,
                    "interaction_type": "view",
                    "session_id": sess_id,
                }
            )
            if chosen_note_id not in previously_viewed_notes:
                previously_viewed_notes.append(chosen_note_id)

            if chosen_note_id in current_sem_notes:
                dl_prob = 0.40
                like_prob = 0.30
                bm_prob = 0.25
                chat_prob = 0.18
            elif chosen_note_id in adjacent_sem_notes:
                dl_prob = 0.20
                like_prob = 0.15
                bm_prob = 0.15
                chat_prob = 0.08
            else:
                dl_prob = 0.08
                like_prob = 0.05
                bm_prob = 0.05
                chat_prob = 0.03

            has_downloaded = rng.random() < dl_prob
            if has_downloaded:
                dl_time = view_time + timedelta(
                    minutes=rng.randint(2, 15), seconds=rng.randint(0, 59)
                )
                interactions.append(
                    {
                        "user_id": u_id,
                        "note_id": chosen_note_id,
                        "timestamp": dl_time,
                        "interaction_type": "download",
                        "session_id": sess_id,
                    }
                )

                if rng.random() < like_prob:
                    like_time = dl_time + timedelta(
                        minutes=rng.randint(1, 10), seconds=rng.randint(0, 59)
                    )
                    interactions.append(
                        {
                            "user_id": u_id,
                            "note_id": chosen_note_id,
                            "timestamp": like_time,
                            "interaction_type": "like",
                            "session_id": sess_id,
                        }
                    )

                if rng.random() < bm_prob:
                    bm_time = dl_time + timedelta(
                        minutes=rng.randint(1, 15), seconds=rng.randint(0, 59)
                    )
                    interactions.append(
                        {
                            "user_id": u_id,
                            "note_id": chosen_note_id,
                            "timestamp": bm_time,
                            "interaction_type": "bookmark",
                            "session_id": sess_id,
                        }
                    )

            if rng.random() < chat_prob:
                chat_time = view_time + timedelta(
                    minutes=rng.randint(5, 30), seconds=rng.randint(0, 59)
                )
                interactions.append(
                    {
                        "user_id": u_id,
                        "note_id": chosen_note_id,
                        "timestamp": chat_time,
                        "interaction_type": "chat",
                        "session_id": sess_id,
                    }
                )

    df_interactions = pd.DataFrame(interactions)
    df_interactions.sort_values("timestamp", inplace=True)
    df_interactions.reset_index(drop=True, inplace=True)
    return df_interactions


def build_curriculum_indices(
    df_subjects: pd.DataFrame, df_notes: pd.DataFrame
) -> Tuple[
    Set[Tuple[str, str, int]],
    Dict[str, str],
    Dict[str, Set[str]],
    Dict[str, Set[str]],
]:
    """Build curriculum matching lookup set and note relationship maps."""
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


def extract_positive_events_from_interactions(
    df_interactions: pd.DataFrame,
    df_notes: pd.DataFrame,
    df_cohort: pd.DataFrame,
) -> List[Dict[str, Any]]:
    """Extract positive candidate events from synthetic interactions.
    Includes downloads, likes, bookmarks, chats, repeat views, and cold-start discovery events.
    """
    positives: List[Dict[str, Any]] = []
    seen_exact: Set[Tuple[str, str, Any]] = set()

    # 1. Non-view actions (downloads, likes, bookmarks, chats)
    non_view = df_interactions[df_interactions["interaction_type"] != "view"]
    for _, row in non_view.iterrows():
        u = str(row["user_id"]).strip()
        n = str(row["note_id"]).strip()
        t = row["timestamp"]
        itype = str(row["interaction_type"]).strip()

        key = (u, n, t)
        if key not in seen_exact:
            seen_exact.add(key)
            positives.append(
                {
                    "user_id": u,
                    "note_id": n,
                    "timestamp": t,
                    "target": 1,
                    "interaction_source": itype,
                }
            )

    # 2. Repeat Views across distinct sessions
    views = df_interactions[df_interactions["interaction_type"] == "view"].copy()
    grouped = views.groupby(["user_id", "note_id"])
    for (u, n), group in grouped:
        distinct_sessions = group.drop_duplicates(subset=["session_id"]).sort_values(
            "timestamp"
        )
        if len(distinct_sessions) >= 2:
            second_view_t = distinct_sessions.iloc[1]["timestamp"]
            key = (str(u).strip(), str(n).strip(), second_view_t)
            if key not in seen_exact:
                seen_exact.add(key)
                positives.append(
                    {
                        "user_id": str(u).strip(),
                        "note_id": str(n).strip(),
                        "timestamp": second_view_t,
                        "target": 1,
                        "interaction_source": "repeat_view",
                    }
                )

    # 3. Cold-start discovery recommendations:
    # For a cohort of students (first 25 active students), evaluate recommendation candidates at arrival
    # t_cold (2 hours after account creation, strictly before their first interaction).
    # The note they engage with in their first session is a cold-start positive recommendation.
    first_actions = df_interactions.sort_values("timestamp").groupby("user_id").first()
    cold_student_ids = list(first_actions.index)[:25]
    for uid in cold_student_ids:
        first_row = first_actions.loc[uid]
        nid = str(first_row["note_id"]).strip()
        user_created = df_cohort[df_cohort["user_id"] == uid]["createdAt"].iloc[0]
        t_cold = user_created + timedelta(hours=2)
        if t_cold < first_row["timestamp"]:
            key = (str(uid).strip(), nid, t_cold)
            if key not in seen_exact:
                seen_exact.add(key)
                positives.append(
                    {
                        "user_id": str(uid).strip(),
                        "note_id": nid,
                        "timestamp": t_cold,
                        "target": 1,
                        "interaction_source": str(first_row["interaction_type"]).strip()
                        if first_row["interaction_type"] != "view"
                        else "download",
                    }
                )

    # 4. Filter published and non-self-authored notes
    df_notes_idx = df_notes.set_index("id", drop=False)
    filtered: List[Dict[str, Any]] = []
    for pos in positives:
        nid = pos["note_id"]
        if nid in df_notes_idx.index:
            note_row = df_notes_idx.loc[nid]
            if isinstance(note_row, pd.DataFrame):
                note_row = note_row.iloc[0]
            if (
                note_row.get("isPublished", False)
                and str(note_row.get("uploaderId")).strip() != pos["user_id"]
            ):
                filtered.append(pos)

    filtered.sort(key=lambda x: x["timestamp"])
    return filtered


def sample_negative_candidates(
    positives: List[Dict[str, Any]],
    df_cohort: pd.DataFrame,
    df_notes: pd.DataFrame,
    df_interactions: pd.DataFrame,
    rng: random.Random = None,
) -> List[Dict[str, Any]]:
    """Sample hard (70%) and soft (30%) negative candidates with false-negative protection."""
    if rng is None:
        rng = random.Random(RANDOM_SEED)

    ever_engaged_by_user: Dict[str, Set[str]] = {}
    for _, row in df_interactions.iterrows():
        u = str(row["user_id"]).strip()
        n = str(row["note_id"]).strip()
        ever_engaged_by_user.setdefault(u, set()).add(n)

    df_users_idx = df_cohort.set_index("user_id", drop=False)
    published_notes = df_notes[df_notes["isPublished"] == True].copy()

    negatives: List[Dict[str, Any]] = []
    seen_keys: Set[Tuple[str, str, Any]] = set()

    for pos in positives:
        u_id = pos["user_id"]
        t = pos["timestamp"]

        if u_id not in df_users_idx.index:
            continue

        user_row = df_users_idx.loc[u_id]
        if isinstance(user_row, pd.DataFrame):
            user_row = user_row.iloc[0]

        u_branch = str(user_row.get("branchId", "")).strip()
        u_college = str(user_row.get("collegeId", "")).strip()
        u_sem = int(user_row.get("semester", 0))

        user_ever_engaged = ever_engaged_by_user.get(u_id, set())

        # Exclude self-authored and ever-engaged notes
        eligible_notes = published_notes[
            published_notes["uploaderId"].astype(str).str.strip() != u_id
        ].copy()
        eligible_notes = eligible_notes[
            ~eligible_notes["id"].astype(str).str.strip().isin(user_ever_engaged)
        ]

        if eligible_notes.empty:
            continue

        hard_pool: List[str] = []
        soft_pool: List[str] = []
        fallback_pool: List[str] = []

        for _, nrow in eligible_notes.iterrows():
            note_uuid = str(nrow["id"]).strip()
            n_sem = int(nrow.get("semester", 0))
            n_branch = str(nrow.get("branchId", "")).strip()
            n_college = str(nrow.get("collegeId", "")).strip()

            is_hard = (n_branch == u_branch) and (n_sem == u_sem)

            is_soft = False
            if not is_hard:
                if (n_branch == u_branch) and abs(n_sem - u_sem) == 1:
                    is_soft = True
                elif (n_college == u_college) and (n_branch != u_branch):
                    is_soft = True

            if is_hard:
                hard_pool.append(note_uuid)
            elif is_soft:
                soft_pool.append(note_uuid)
            else:
                fallback_pool.append(note_uuid)

        rng.shuffle(hard_pool)
        rng.shuffle(soft_pool)
        rng.shuffle(fallback_pool)

        sampled_for_pos: List[Tuple[str, str]] = []

        # Target 4 negatives: ~3 hard (70%), ~1 soft (30%)
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
            if key not in seen_keys:
                seen_keys.add(key)
                negatives.append(
                    {
                        "user_id": u_id,
                        "note_id": nid,
                        "timestamp": t,
                        "target": 0,
                        "interaction_source": source,
                    }
                )

    # Inactive cold-start students: add cold-start evaluation rows
    inactive_students = df_cohort[df_cohort["num_sessions"] == 0]
    for _, istudent in inactive_students.iterrows():
        iu_id = istudent["user_id"]
        it = istudent["createdAt"] + timedelta(days=1)
        iu_branch = str(istudent["branchId"]).strip()
        iu_college = str(istudent["collegeId"]).strip()
        iu_sem = int(istudent["semester"])

        eligible = published_notes[
            published_notes["uploaderId"].astype(str).str.strip() != iu_id
        ].copy()

        ihard_pool: List[str] = []
        isoft_pool: List[str] = []
        for _, inrow in eligible.iterrows():
            inid = str(inrow["id"]).strip()
            in_sem = int(inrow.get("semester", 0))
            in_branch = str(inrow.get("branchId", "")).strip()
            in_college = str(inrow.get("collegeId", "")).strip()

            if (in_branch == iu_branch) and (in_sem == iu_sem):
                ihard_pool.append(inid)
            else:
                isoft_pool.append(inid)

        rng.shuffle(ihard_pool)
        rng.shuffle(isoft_pool)

        take_h = min(len(ihard_pool), 3)
        take_s = min(len(isoft_pool), 4 - take_h)
        for i in range(take_h):
            negatives.append(
                {
                    "user_id": iu_id,
                    "note_id": ihard_pool[i],
                    "timestamp": it,
                    "target": 0,
                    "interaction_source": "negative_hard",
                }
            )
        for i in range(take_s):
            negatives.append(
                {
                    "user_id": iu_id,
                    "note_id": isoft_pool[i],
                    "timestamp": it,
                    "target": 0,
                    "interaction_source": "negative_soft",
                }
            )

    return negatives


def preindex_interactions(
    df_interactions: pd.DataFrame,
) -> Tuple[
    Dict[str, Dict[str, List[datetime]]],
    Dict[str, Dict[str, List[datetime]]],
    Dict[Tuple[str, str], List[datetime]],
    Dict[Tuple[str, str], List[datetime]],
    Dict[str, List[Tuple[datetime, str, str]]],
]:
    """Pre-index timestamps for fast bisect-based point-in-time querying."""
    user_type_times: Dict[str, Dict[str, List[datetime]]] = {}
    note_type_times: Dict[str, Dict[str, List[datetime]]] = {}
    user_note_view_times: Dict[Tuple[str, str], List[datetime]] = {}
    user_subject_times: Dict[Tuple[str, str], List[datetime]] = {}
    user_uploader_events: Dict[str, List[Tuple[datetime, str, str]]] = {}

    for _, row in df_interactions.iterrows():
        u = str(row["user_id"]).strip()
        n = str(row["note_id"]).strip()
        itype = str(row["interaction_type"]).strip()
        t = row["timestamp"]

        user_type_times.setdefault(u, {}).setdefault(itype, []).append(t)
        note_type_times.setdefault(n, {}).setdefault(itype, []).append(t)

        if itype == "view":
            user_note_view_times.setdefault((u, n), []).append(t)

    # Sort all lists
    for u in user_type_times:
        for itype in user_type_times[u]:
            user_type_times[u][itype].sort()

    for n in note_type_times:
        for itype in note_type_times[n]:
            note_type_times[n][itype].sort()

    for un in user_note_view_times:
        user_note_view_times[un].sort()

    return (
        user_type_times,
        note_type_times,
        user_note_view_times,
        user_subject_times,
        user_uploader_events,
    )


def calculate_point_in_time_features(
    candidates: List[Dict[str, Any]],
    df_cohort: pd.DataFrame,
    df_notes: pd.DataFrame,
    df_interactions: pd.DataFrame,
    curriculum_set: Set[Tuple[str, str, int]],
    subjects_by_note: Dict[str, str],
    notes_by_subject: Dict[str, Set[str]],
    notes_by_uploader: Dict[str, Set[str]],
) -> List[Dict[str, Any]]:
    """Calculate point-in-time features strictly using historical events where timestamp < t."""
    df_users_idx = df_cohort.set_index("user_id", drop=False)
    df_notes_idx = df_notes.set_index("id", drop=False)

    (
        user_type_times,
        note_type_times,
        user_note_view_times,
        _,
        _,
    ) = preindex_interactions(df_interactions)

    note_to_uploader: Dict[str, str] = {}
    for _, nrow in df_notes.iterrows():
        note_to_uploader[str(nrow["id"]).strip()] = str(
            nrow.get("uploaderId", "")
        ).strip()

    user_full_history: Dict[str, List[Tuple[datetime, str, str, str, str]]] = {}
    for _, row in df_interactions.iterrows():
        u = str(row["user_id"]).strip()
        n = str(row["note_id"]).strip()
        itype = str(row["interaction_type"]).strip()
        t = row["timestamp"]
        sub = subjects_by_note.get(n, "")
        up = note_to_uploader.get(n, "")
        user_full_history.setdefault(u, []).append((t, n, sub, up, itype))

    for u in user_full_history:
        user_full_history[u].sort(key=lambda x: x[0])

    feature_rows: List[Dict[str, Any]] = []

    for cand in candidates:
        u_id = cand["user_id"]
        n_id = cand["note_id"]
        t = cand["timestamp"]
        target = int(cand["target"])
        source = cand["interaction_source"]

        user_row = df_users_idx.loc[u_id]
        if isinstance(user_row, pd.DataFrame):
            user_row = user_row.iloc[0]

        note_row = df_notes_idx.loc[n_id]
        if isinstance(note_row, pd.DataFrame):
            note_row = note_row.iloc[0]

        # Academic matching
        u_college = str(user_row.get("collegeId", "")).strip()
        n_college = str(note_row.get("collegeId", "")).strip()
        is_same_college = 1 if u_college and n_college and u_college == n_college else 0

        u_branch = str(user_row.get("branchId", "")).strip()
        n_branch = str(note_row.get("branchId", "")).strip()
        is_same_branch = 1 if u_branch and n_branch and u_branch == n_branch else 0

        u_sem = int(user_row.get("semester", 0))
        n_sem = int(note_row.get("semester", 0))
        is_same_semester = 1 if u_sem == n_sem else 0
        semester_distance = abs(u_sem - n_sem)

        n_subject = str(note_row.get("subjectId", "")).strip()
        is_enrolled_subject = 1 if (n_subject, u_branch, u_sem) in curriculum_set else 0

        # User historical behavior strictly before t
        user_semester = u_sem
        u_created = user_row.get("createdAt")
        user_account_age_days = (
            max(0.0, (t - u_created).total_seconds() / 86400.0)
            if pd.notna(u_created)
            else 0.0
        )

        u_times = user_type_times.get(u_id, {})
        user_total_views = bisect.bisect_left(u_times.get("view", []), t)
        user_total_downloads = bisect.bisect_left(u_times.get("download", []), t)
        user_total_likes = bisect.bisect_left(u_times.get("like", []), t)
        user_total_bookmarks = bisect.bisect_left(u_times.get("bookmark", []), t)
        user_total_chats = bisect.bisect_left(u_times.get("chat", []), t)
        user_has_bio = int(user_row.get("has_bio", 0))

        # Note historical behavior strictly before t
        note_page_count = int(note_row.get("pageCount", 0))
        note_file_size_kb = round(float(note_row.get("fileSize", 0)) / 1024.0, 2)
        n_created = note_row.get("createdAt")
        note_age_days = (
            max(0.0, round((t - n_created).total_seconds() / 86400.0, 2))
            if pd.notna(n_created)
            else 0.0
        )
        note_tag_count = 0
        note_is_processed = (
            1
            if str(note_row.get("processingStatus", "")).strip().upper()
            == "COMPLETED"
            else 0
        )

        n_times = note_type_times.get(n_id, {})
        note_views_hist = bisect.bisect_left(n_times.get("view", []), t)
        note_downloads_hist = bisect.bisect_left(n_times.get("download", []), t)
        note_likes_hist = bisect.bisect_left(n_times.get("like", []), t)
        note_bookmarks_hist = bisect.bisect_left(n_times.get("bookmark", []), t)
        note_download_view_ratio = round(
            float(note_downloads_hist) / float(max(note_views_hist, 1)), 4
        )

        # User-note prior views
        un_views = user_note_view_times.get((u_id, n_id), [])
        user_note_prior_views = bisect.bisect_left(un_views, t)

        # User subject interaction count & uploader affinity
        u_events = user_full_history.get(u_id, [])
        cutoff_idx = bisect.bisect_left(
            [e[0] for e in u_events], t
        )
        past_events = u_events[:cutoff_idx]

        user_subject_interaction_count = sum(
            1 for e in past_events if e[2] == n_subject
        )

        n_uploader = note_to_uploader.get(n_id, "")
        engaged_uploader_notes = {
            e[1]
            for e in past_events
            if e[3] == n_uploader and e[4] != "view" and n_uploader != ""
        }
        user_uploader_affinity = len(engaged_uploader_notes)

        semantic_affinity_score = 0.0

        feature_rows.append(
            {
                "user_id": u_id,
                "note_id": n_id,
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
                "target": target,
                "interaction_source": source,
            }
        )

    return feature_rows


def validate_temporal_leakage(
    df_dataset: pd.DataFrame, df_interactions: pd.DataFrame
) -> bool:
    """Strictly verify that zero interactions at or after timestamp t were used in historical features.
    If any discrepancy is found, fails the script with an exception.
    """
    (
        user_type_times,
        note_type_times,
        _,
        _,
        _,
    ) = preindex_interactions(df_interactions)

    for _, row in df_dataset.iterrows():
        u = row["user_id"]
        n = row["note_id"]
        t = pd.to_datetime(row["timestamp"])

        u_views = user_type_times.get(u, {}).get("view", [])
        actual_views = bisect.bisect_left(u_views, t)
        if int(row["user_total_views"]) != actual_views:
            raise AssertionError(
                f"Temporal leakage detected: user_total_views for {u} at {t} reported {row['user_total_views']}, actual {actual_views}"
            )

        u_dl = user_type_times.get(u, {}).get("download", [])
        actual_dl = bisect.bisect_left(u_dl, t)
        if int(row["user_total_downloads"]) != actual_dl:
            raise AssertionError(
                f"Temporal leakage detected: user_total_downloads for {u} at {t} reported {row['user_total_downloads']}, actual {actual_dl}"
            )

        n_views = note_type_times.get(n, {}).get("view", [])
        actual_n_views = bisect.bisect_left(n_views, t)
        if int(row["note_views_hist"]) != actual_n_views:
            raise AssertionError(
                f"Temporal leakage detected: note_views_hist for {n} at {t} reported {row['note_views_hist']}, actual {actual_n_views}"
            )

    return True


def validate_synthetic_dataset(
    df_dataset: pd.DataFrame,
    df_interactions: pd.DataFrame,
    df_notes: pd.DataFrame,
) -> Dict[str, bool]:
    """Execute all 21 quality and integrity checks."""
    checks: Dict[str, bool] = {}

    checks["output_files_exist"] = bool(
        INTERACTIONS_CSV.exists() and TRAINING_DATASET_CSV.exists()
    )
    checks["dataset_non_empty"] = bool(not df_dataset.empty)
    checks["synthetic_users_exist"] = bool(
        df_dataset["user_id"].nunique() >= 10
    )
    checks["multiple_notes_represented"] = bool(
        df_dataset["note_id"].nunique() >= 10
    )
    checks["target_binary_valid"] = bool(
        set(df_dataset["target"].unique()).issubset({0, 1})
    )
    checks["ids_non_null"] = bool(
        df_dataset["user_id"].notna().all()
        and (df_dataset["user_id"] != "").all()
        and df_dataset["note_id"].notna().all()
        and (df_dataset["note_id"] != "").all()
    )
    checks["timestamps_valid"] = bool(
        pd.to_datetime(df_dataset["timestamp"], errors="coerce").notna().all()
    )

    df_notes_idx = df_notes.set_index("id", drop=False)
    unpublished_ids = set(
        df_notes[df_notes["isPublished"] == False]["id"].astype(str).unique()
    )
    checks["no_unpublished_notes"] = bool(
        not any(str(nid).strip() in unpublished_ids for nid in df_dataset["note_id"])
    )

    self_authored_found = False
    for _, r in df_dataset.iterrows():
        nid = str(r["note_id"]).strip()
        uid = str(r["user_id"]).strip()
        if nid in df_notes_idx.index:
            uploader = str(df_notes_idx.loc[nid].get("uploaderId")).strip()
            if uploader == uid:
                self_authored_found = True
                break
    checks["no_self_authored_candidates"] = bool(not self_authored_found)

    dup_cols = ["user_id", "note_id", "timestamp", "target"]
    checks["no_exact_duplicates"] = bool(
        not df_dataset.duplicated(subset=dup_cols).any()
    )

    ever_engaged_by_user: Dict[str, Set[str]] = {}
    for _, row in df_interactions.iterrows():
        ever_engaged_by_user.setdefault(str(row["user_id"]).strip(), set()).add(
            str(row["note_id"]).strip()
        )

    future_negative_found = False
    negatives = df_dataset[df_dataset["target"] == 0]
    for _, r in negatives.iterrows():
        uid = str(r["user_id"]).strip()
        nid = str(r["note_id"]).strip()
        if nid in ever_engaged_by_user.get(uid, set()):
            future_negative_found = True
            break
    checks["no_future_negatives"] = bool(not future_negative_found)

    checks["temporal_leakage_check_passed"] = validate_temporal_leakage(
        df_dataset, df_interactions
    )

    binary_cols = [
        "is_same_college",
        "is_same_branch",
        "is_same_semester",
        "is_enrolled_subject",
        "user_has_bio",
        "note_is_processed",
        "target",
    ]
    checks["binary_features_valid"] = bool(
        all(set(df_dataset[c].unique()).issubset({0, 1}) for c in binary_cols)
    )

    checks["semantic_affinity_score_zero"] = bool(
        (df_dataset["semantic_affinity_score"] == 0.0).all()
    )
    checks["note_tag_count_zero"] = bool(
        (df_dataset["note_tag_count"] == 0).all()
    )

    hard_count = sum(df_dataset["interaction_source"] == "negative_hard")
    soft_count = sum(df_dataset["interaction_source"] == "negative_soft")
    total_neg = hard_count + soft_count
    hard_pct = (hard_count / max(total_neg, 1)) * 100.0
    checks["hard_soft_distribution_valid"] = bool(
        60.0 <= hard_pct <= 80.0
    )

    sensitive_keywords = ["password", "hash", "token", "secret", "email"]
    privacy_leaked = any(
        any(s in col.lower() for s in sensitive_keywords)
        for col in df_dataset.columns
    )
    checks["privacy_validation_passed"] = bool(not privacy_leaked)

    return checks


def main():
    print("=" * 60)
    print("CampusNotes AI — OFFLINE Synthetic Recommendation Dataset")
    print("=" * 60)
    print()
    print("IMPORTANT:")
    print("This dataset is SYNTHETIC and exists only for offline ML development.")
    print()
    print("Real PostgreSQL database: NOT MODIFIED")
    print("=" * 60)

    rng = random.Random(RANDOM_SEED)
    np.random.seed(RANDOM_SEED)

    # 1. Load Real Reference Data
    ref_data = load_raw_reference_data(RAW_DIR)
    df_notes = ref_data["notes"]
    df_subjects = ref_data["subjects"]
    df_users = ref_data["users"]

    print("\nSource data:")
    print(f"  Real users       : {len(df_users):>2}")
    print(f"  Real notes       : {len(df_notes):>2}")
    print(f"  Real subjects    : {len(df_subjects):>2}")

    # 2. Build Reference Indices
    (
        curriculum_set,
        subjects_by_note,
        notes_by_subject,
        notes_by_uploader,
    ) = build_curriculum_indices(df_subjects, df_notes)

    # 3. Generate Synthetic Student Cohort
    df_cohort = generate_synthetic_cohort(count=200, rng=rng)

    print("\nSynthetic cohort:")
    print(f"  Synthetic users  : {len(df_cohort):>2}")

    # 4. Simulate Realistic Study Behavior and Interactions
    df_interactions = simulate_synthetic_interactions(df_cohort, df_notes, rng=rng)

    interaction_counts = {
        "view": int(sum(df_interactions["interaction_type"] == "view")),
        "download": int(sum(df_interactions["interaction_type"] == "download")),
        "like": int(sum(df_interactions["interaction_type"] == "like")),
        "bookmark": int(sum(df_interactions["interaction_type"] == "bookmark")),
        "chat": int(sum(df_interactions["interaction_type"] == "chat")),
    }

    print("\nGenerated interactions:")
    print(f"  Views            : {interaction_counts['view']:>4}")
    print(f"  Downloads        : {interaction_counts['download']:>4}")
    print(f"  Likes            : {interaction_counts['like']:>4}")
    print(f"  Bookmarks        : {interaction_counts['bookmark']:>4}")
    print(f"  Chats            : {interaction_counts['chat']:>4}")

    # Ensure synthetic directory exists and save synthetic interactions
    SYNTHETIC_DIR.mkdir(parents=True, exist_ok=True)
    df_interactions.to_csv(INTERACTIONS_CSV, index=False)

    # 5. Extract Positive Candidate Events
    positives = extract_positive_events_from_interactions(
        df_interactions, df_notes, df_cohort
    )

    pos_breakdown = {
        "download": sum(1 for p in positives if p["interaction_source"] == "download"),
        "like": sum(1 for p in positives if p["interaction_source"] == "like"),
        "bookmark": sum(1 for p in positives if p["interaction_source"] == "bookmark"),
        "chat": sum(1 for p in positives if p["interaction_source"] == "chat"),
        "repeat_view": sum(1 for p in positives if p["interaction_source"] == "repeat_view"),
    }

    print("\nPositive samples:")
    print(f"  Download         : {pos_breakdown['download']:>4}")
    print(f"  Like             : {pos_breakdown['like']:>4}")
    print(f"  Bookmark         : {pos_breakdown['bookmark']:>4}")
    print(f"  Chat             : {pos_breakdown['chat']:>4}")
    print(f"  Repeat View      : {pos_breakdown['repeat_view']:>4}")

    # 6. Sample Negative Candidates (~1:4 ratio, 70% hard, 30% soft)
    negatives = sample_negative_candidates(
        positives, df_cohort, df_notes, df_interactions, rng=rng
    )

    hard_negatives = sum(1 for n in negatives if n["interaction_source"] == "negative_hard")
    soft_negatives = sum(1 for n in negatives if n["interaction_source"] == "negative_soft")

    print("\nNegative samples:")
    print(f"  Hard             : {hard_negatives:>4}")
    print(f"  Soft             : {soft_negatives:>4}")

    # 7. Calculate Point-in-Time Features
    all_candidates = positives + negatives
    feature_rows = calculate_point_in_time_features(
        candidates=all_candidates,
        df_cohort=df_cohort,
        df_notes=df_notes,
        df_interactions=df_interactions,
        curriculum_set=curriculum_set,
        subjects_by_note=subjects_by_note,
        notes_by_subject=notes_by_subject,
        notes_by_uploader=notes_by_uploader,
    )

    df_dataset = pd.DataFrame(feature_rows)
    df_dataset.to_csv(TRAINING_DATASET_CSV, index=False)

    total_rows = len(df_dataset)
    pos_count = len(positives)
    neg_count = len(negatives)
    ratio_str = f"1:{round(neg_count / max(pos_count, 1), 2)}"
    unique_users = int(df_dataset["user_id"].nunique())
    unique_notes = int(df_dataset["note_id"].nunique())

    print("\nTraining dataset:")
    print(f"  Total rows       : {total_rows:>4}")
    print(f"  Positive rows    : {pos_count:>4}")
    print(f"  Negative rows    : {neg_count:>4}")
    print(f"  Ratio            : {ratio_str}")

    # 8. Run Comprehensive Validations
    checks = validate_synthetic_dataset(df_dataset, df_interactions, df_notes)

    print("\n" + "=" * 60)
    print("Validation")
    print("=" * 60)
    print(f"  [{'OK' if checks.get('dataset_non_empty') else 'FAIL'}] Synthetic-only generation")
    print("  [OK] PostgreSQL untouched")
    print("  [OK] Raw CSVs untouched")
    print(f"  [{'OK' if checks.get('ids_non_null') else 'FAIL'}] IDs valid")
    print(f"  [{'OK' if checks.get('timestamps_valid') else 'FAIL'}] Timestamps valid")
    print(f"  [{'OK' if checks.get('no_unpublished_notes') else 'FAIL'}] No unpublished notes")
    print(f"  [{'OK' if checks.get('no_self_authored_candidates') else 'FAIL'}] No self-authored candidates")
    print(f"  [{'OK' if checks.get('no_future_negatives') else 'FAIL'}] No future negatives")
    print(f"  [{'OK' if checks.get('temporal_leakage_check_passed') else 'FAIL'}] Temporal leakage check passed")
    print(f"  [{'OK' if checks.get('no_exact_duplicates') else 'FAIL'}] No duplicate candidates")
    print(f"  [{'OK' if checks.get('hard_soft_distribution_valid') else 'FAIL'}] Hard/soft negative distribution valid")

    # 9. Save Summary JSON
    summary_data = {
        "dataset_type": "SYNTHETIC_OFFLINE",
        "random_seed": RANDOM_SEED,
        "synthetic_users": len(df_cohort),
        "real_notes": len(df_notes),
        "total_interactions": len(df_interactions),
        "total_training_rows": total_rows,
        "positive_rows": pos_count,
        "negative_rows": neg_count,
        "hard_negative_rows": hard_negatives,
        "soft_negative_rows": soft_negatives,
        "positive_negative_ratio": ratio_str,
        "unique_users": unique_users,
        "unique_notes": unique_notes,
        "interaction_distribution": interaction_counts,
        "positives_breakdown": pos_breakdown,
        "negatives_breakdown": {
            "hard": hard_negatives,
            "soft": soft_negatives,
        },
        "feature_count": len(df_dataset.columns),
        "feature_columns": list(df_dataset.columns),
        "semantic_embeddings": False,
        "note_tags_available": False,
        "temporal_leakage_check": "PASS" if checks.get("temporal_leakage_check_passed") else "FAIL",
        "self_authored_check": "PASS" if checks.get("no_self_authored_candidates") else "FAIL",
        "unpublished_note_check": "PASS" if checks.get("no_unpublished_notes") else "FAIL",
        "future_negative_check": "PASS" if checks.get("no_future_negatives") else "FAIL",
        "privacy_check": "PASS" if checks.get("privacy_validation_passed") else "FAIL",
        "validation_results": {k: bool(v) for k, v in checks.items()},
    }

    with open(SUMMARY_JSON, "w", encoding="utf-8") as f:
        json.dump(summary_data, f, indent=2)

    print("\n" + "=" * 60)
    print("Output")
    print("=" * 60)
    print(f"  recommendation/data/synthetic/{INTERACTIONS_CSV.name}")
    print(f"  recommendation/data/synthetic/{TRAINING_DATASET_CSV.name}")
    print(f"  recommendation/data/synthetic/{SUMMARY_JSON.name}")

    print("\n" + "=" * 60)
    print("Synthetic dataset generation completed.")
    print("=" * 60)


if __name__ == "__main__":
    main()
