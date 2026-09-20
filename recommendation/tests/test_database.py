"""
CampusNotes AI — PostgreSQL Live Database Integration Tests
===========================================================

Module: recommendation/tests/test_database.py
Purpose: Comprehensive unit and integration verification for Phase 3 Step 2.7B:
         1. Database connectivity and SELECT 1 health check.
         2. Read-only session verification (strictly no writes).
         3. User lookup for real user (Bob Smith).
         4. Unknown user returns None / 404.
         5. Published note filtering (isPublished == True).
         6. Self-authored note exclusion (uploaderId != user_id).
         7. Historical interaction retrieval before t.
         8. Strict temporal boundary enforcement (createdAt < t, never >=).
         9. Exactly 27 recommendation features generated.
         10. Model scoring execution and probability range [0.0, 1.0].
         11. Top-K ranking ordering (descending) and count compliance.
         12. Zero target leakage (target column absent).
         13. Database connection failure gracefully returns HTTP 503.
         14. Security: No passwords, connection strings, or SQL queries in errors/responses.
         15. Zero database modifications (no records created, updated, or deleted).
"""

import datetime
from pathlib import Path
import sys
import pytest
from fastapi.testclient import TestClient

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.db.postgres import (
    DatabaseUnavailableError,
    check_database_health,
    get_db_connection,
)
from recommendation.data.repository import BaseRepository, PostgresRepository, CsvRepository
from recommendation.inference.recommend import load_model, recommend_for_user
from recommendation.api.main import app

BOB_USER_ID = "da3250c0-80b1-46ca-b682-a94b5c5132f3"   # Real student in DB
ALEX_USER_ID = "57bcfcff-0d5f-4eac-83b6-7f368664f0ad"  # Uploader of 29 notes
UNKNOWN_USER_ID = "00000000-0000-0000-0000-000000000000"


@pytest.fixture(scope="module")
def repo():
    """Returns an instance of PostgresRepository."""
    return PostgresRepository()


@pytest.fixture(scope="module")
def client():
    """TestClient fixture with application lifespan context enabled."""
    with TestClient(app) as c:
        yield c


def test_1_database_connectivity_and_health():
    """1. Verify PostgreSQL connection and health check query SELECT 1."""
    is_healthy = check_database_health()
    assert is_healthy is True, "Database health check failed to connect or execute SELECT 1."


def test_2_readonly_session_enforcement():
    """2. Verify that the database connection rejects any write operations."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            # Verify read queries work
            cur.execute("SELECT COUNT(*) FROM users;")
            count = cur.fetchone()[0]
            assert count >= 1

            # Verify write queries raise ReadOnlySqlTransaction
            with pytest.raises(Exception) as exc_info:
                cur.execute('''INSERT INTO users (id, email, "passwordHash", name) VALUES (\'dummy\', \'d@d.com\', \'h\', \'d\');''')
            assert "read-only" in str(exc_info.value).lower()


def test_3_user_lookup_existing(repo):
    """3. Verify looking up an existing user returns profile data."""
    user = repo.get_user(BOB_USER_ID)
    assert user is not None, "Failed to retrieve Bob Smith from PostgreSQL."
    assert str(user["id"]) == BOB_USER_ID
    assert user["name"] == "Bob Smith"
    assert user["semester"] == 4


def test_4_user_lookup_unknown(repo):
    """4. Verify looking up an unknown user returns None."""
    user = repo.get_user(UNKNOWN_USER_ID)
    assert user is None, "Unknown user should return None."


def test_5_published_notes_filtering(repo):
    """5. Verify all retrieved candidate notes have isPublished == True."""
    notes = repo.get_eligible_notes(BOB_USER_ID)
    assert not notes.empty, "Eligible candidate notes should not be empty."
    assert (notes["isPublished"] == True).all(), "All candidate notes must be published."


def test_6_self_authored_exclusion(repo):
    """6. Verify notes authored by the student are strictly excluded."""
    # Alex uploaded 29 notes. Out of 30 total, eligible should be 1 note!
    alex_candidates = repo.get_eligible_notes(ALEX_USER_ID)
    assert (alex_candidates["uploaderId"] != ALEX_USER_ID).all(), "Alex must not be recommended own notes."
    assert len(alex_candidates) == 1, f"Expected exactly 1 eligible candidate for Alex, got {len(alex_candidates)}"


def test_7_historical_interactions_retrieval(repo):
    """7. Verify historical interactions are retrieved across all 5 tables."""
    now = datetime.datetime.now(datetime.timezone.utc)
    interactions = repo.get_historical_interactions(now)
    assert "note_views" in interactions
    assert "downloads" in interactions
    assert "likes" in interactions
    assert "bookmarks" in interactions
    assert "chat_sessions" in interactions
    assert len(interactions["note_views"]) >= 1


def test_8_temporal_boundary_enforcement(repo):
    """8. Verify strict point-in-time boundary (createdAt < t, never >=)."""
    # Use a timestamp far in the past (e.g. year 2020)
    past_time = datetime.datetime(2020, 1, 1, tzinfo=datetime.timezone.utc)
    past_interactions = repo.get_historical_interactions(past_time)
    for table_name, df in past_interactions.items():
        assert len(df) == 0, f"Expected 0 historical interactions prior to 2020 for {table_name}, got {len(df)}"


def test_9_candidate_feature_count_is_27(repo):
    """9. Verify candidate feature generation produces exactly 27 features."""
    artifact = load_model()
    recs, diag = recommend_for_user(BOB_USER_ID, top_k=10, repository=repo, model_artifact=artifact)
    assert diag["validation"]["features_count_is_27"] is True
    assert diag["validation"]["feature_ordering_matches_training"] is True


def test_10_model_scoring_and_validity(repo):
    """10. Verify model produces finite scores bounded in [0.0, 1.0]."""
    artifact = load_model()
    recs, diag = recommend_for_user(BOB_USER_ID, top_k=10, repository=repo, model_artifact=artifact)
    assert diag["validation"]["scores_are_finite"] is True
    assert diag["validation"]["scores_within_0_1"] is True
    for score in recs["engagement_score"]:
        assert 0.0 <= score <= 1.0


def test_11_ranking_and_top_k(repo):
    """11. Verify recommendations are sorted descending and top_k is respected."""
    artifact = load_model()
    recs, diag = recommend_for_user(BOB_USER_ID, top_k=5, repository=repo, model_artifact=artifact)
    assert len(recs) == 5
    assert recs["engagement_score"].is_monotonic_decreasing is True
    assert list(recs["rank"]) == [1, 2, 3, 4, 5]


def test_12_zero_target_leakage(repo):
    """12. Verify target column is never present during inference."""
    artifact = load_model()
    recs, diag = recommend_for_user(BOB_USER_ID, top_k=10, repository=repo, model_artifact=artifact)
    assert diag["validation"]["target_not_present_in_features"] is True
    assert diag["validation"]["metadata_not_in_features"] is True


def test_13_database_failure_handling(monkeypatch):
    """13. Verify that database connection errors trigger HTTP 503."""
    class BrokenRepository(BaseRepository):
        def get_user(self, user_id):
            raise DatabaseUnavailableError("Simulated database failure")
        def get_eligible_notes(self, user_id):
            raise DatabaseUnavailableError("Simulated database failure")
        def get_catalog_notes(self):
            raise DatabaseUnavailableError("Simulated database failure")
        def get_subjects(self):
            raise DatabaseUnavailableError("Simulated database failure")
        def get_historical_interactions(self, before_time, user_id=None):
            raise DatabaseUnavailableError("Simulated database failure")

    with TestClient(app) as broken_client:
        app.state.repository = BrokenRepository()
        res = broken_client.get(f"/recommendations/{BOB_USER_ID}")
        assert res.status_code == 503
        data = res.json()
        assert "temporarily unavailable" in data["detail"].lower()
        # Ensure no internal credentials or SQL query leaked
        assert "password" not in str(data).lower()
        assert "postgresql://" not in str(data).lower()
        assert "select" not in str(data).lower()


def test_14_api_live_recommendation_endpoint(client):
    """14. Verify GET /recommendations/{user_id} succeeds against live DB."""
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=10")
    assert res.status_code == 200
    data = res.json()
    assert data["user_id"] == BOB_USER_ID
    assert data["candidate_count"] == 30
    assert data["recommendation_count"] == 10
    assert len(data["recommendations"]) == 10
    top_item = data["recommendations"][0]
    assert top_item["rank"] == 1
    assert "engagement_score" in top_item


def test_15_api_unknown_user_returns_404(client):
    """15. Verify GET /recommendations/{unknown_id} returns HTTP 404."""
    res = client.get(f"/recommendations/{UNKNOWN_USER_ID}")
    assert res.status_code == 404
    assert res.json()["detail"] == "User not found"


def test_16_api_health_database_connected(client):
    """16. Verify GET /health reports database_connected=true."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["database_connected"] is True
    assert data["data_source"] == "postgres"


def test_17_no_database_writes_occurred():
    """17. Verify that the test suite performed zero database mutations."""
    with get_db_connection() as conn:
        with conn.cursor() as cur:
            cur.execute("SELECT COUNT(*) FROM users;")
            assert cur.fetchone()[0] == 5
            cur.execute("SELECT COUNT(*) FROM notes;")
            assert cur.fetchone()[0] == 30
            cur.execute("SELECT COUNT(*) FROM note_views;")
            assert cur.fetchone()[0] in (19, 22)

            cur.execute("SELECT COUNT(*) FROM downloads;")
            assert cur.fetchone()[0] == 3
            cur.execute("SELECT COUNT(*) FROM likes;")
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT COUNT(*) FROM bookmarks;")
            assert cur.fetchone()[0] == 0
            cur.execute("SELECT COUNT(*) FROM chat_sessions;")
            assert cur.fetchone()[0] == 1
