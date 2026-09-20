"""
CampusNotes AI — API Integration & Unit Test Suite
==================================================

Module: recommendation/tests/test_api.py
Purpose: Tests FastAPI recommendation microservice endpoints (/health, /, /recommendations/{user_id}, /docs),
         verifying model lifecycle, schema compliance, ranking, input validation, and security.
"""

from pathlib import Path
import sys
import pytest
from fastapi.testclient import TestClient

# Add project root to sys.path
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.api.main import (
    app,
    HealthResponse,
    RootResponse,
    RecommendationResponse,
)

BOB_USER_ID = "da3250c0-80b1-46ca-b682-a94b5c5132f3"   # Real student in DB / users.csv


@pytest.fixture(scope="module")
def client():
    """TestClient fixture with application lifespan context enabled."""
    with TestClient(app) as c:
        yield c


def test_1_app_imports():
    """1. Verify FastAPI application imports successfully."""
    assert app is not None
    assert app.title == "CampusNotes AI - Recommendation Microservice"


def test_2_health_endpoint(client):
    """2. Verify /health returns 200 and valid health payload."""
    res = client.get("/health")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "ok"
    assert data["service"] == "campusnotes-recommendation"
    assert data["model_loaded"] is True
    assert data["model_version"] == "1.0.0"
    # Validate via Pydantic model
    HealthResponse(**data)


def test_3_root_endpoint(client):
    """3. Verify / returns 200 and valid service description."""
    res = client.get("/")
    assert res.status_code == 200
    data = res.json()
    assert data["status"] == "running"
    assert data["model"] == "LightGBM"
    assert data["model_version"] == "1.0.0"
    RootResponse(**data)


def test_4_valid_user_recommendations(client):
    """4. Verify /recommendations/{user_id} returns 200 for a valid user."""
    res = client.get(f"/recommendations/{BOB_USER_ID}")
    assert res.status_code == 200
    data = res.json()
    assert data["user_id"] == BOB_USER_ID


def test_5_response_contains_recommendations(client):
    """5. Verify response contains recommendations with all required fields."""
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=5")
    assert res.status_code == 200
    data = res.json()
    recs = data["recommendations"]
    assert len(recs) == 5
    assert data["recommendation_count"] == 5
    assert data["candidate_count"] == 30

    item = recs[0]
    required_keys = ["rank", "note_id", "title", "subject_id", "semester", "branch_id", "engagement_score"]
    for key in required_keys:
        assert key in item, f"Missing key '{key}' in recommendation item"
    assert item["rank"] == 1
    assert item["engagement_score"] >= 0.0


def test_6_top_k_respected(client):
    """6. Verify top_k query parameter is respected."""
    # top_k = 3
    res3 = client.get(f"/recommendations/{BOB_USER_ID}?top_k=3")
    assert res3.status_code == 200
    assert len(res3.json()["recommendations"]) == 3

    # top_k = 7
    res7 = client.get(f"/recommendations/{BOB_USER_ID}?top_k=7")
    assert res7.status_code == 200
    assert len(res7.json()["recommendations"]) == 7


def test_7_recommendations_sorted_descending(client):
    """7. Verify recommendations are ranked by engagement score descending."""
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=10")
    assert res.status_code == 200
    recs = res.json()["recommendations"]
    scores = [r["engagement_score"] for r in recs]
    assert scores == sorted(scores, reverse=True), "Recommendations are not monotonically descending."


def test_8_scores_between_zero_and_one(client):
    """8. Verify all predicted engagement scores are probabilities in [0.0, 1.0]."""
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=10")
    assert res.status_code == 200
    for item in res.json()["recommendations"]:
        score = item["engagement_score"]
        assert 0.0 <= score <= 1.0, f"Score {score} out of probability bounds [0, 1]."


def test_9_unknown_user_returns_404(client):
    """9. Verify unknown user ID produces HTTP 404."""
    unknown_id = "00000000-0000-0000-0000-000000000000"
    res = client.get(f"/recommendations/{unknown_id}")
    assert res.status_code == 404
    assert res.json()["detail"] == "User not found"


def test_10_top_k_validation(client):
    """10. Verify validation rejects invalid top_k bounds (< 1 or > 100)."""
    # top_k = 0 -> 400 Bad Request
    res0 = client.get(f"/recommendations/{BOB_USER_ID}?top_k=0")
    assert res0.status_code == 400

    # top_k = -5 -> 400 Bad Request
    res_neg = client.get(f"/recommendations/{BOB_USER_ID}?top_k=-5")
    assert res_neg.status_code == 400

    # top_k = 101 -> 400 Bad Request
    res101 = client.get(f"/recommendations/{BOB_USER_ID}?top_k=101")
    assert res101.status_code == 400


def test_11_response_pydantic_schema(client):
    """11. Verify response conforms completely to RecommendationResponse schema."""
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=10")
    assert res.status_code == 200
    # Will raise ValidationError if any field fails validation
    RecommendationResponse(**res.json())


def test_12_swagger_docs_accessible(client):
    """12. Verify OpenAPI /docs and /openapi.json are accessible."""
    res_docs = client.get("/docs")
    assert res_docs.status_code == 200

    res_openapi = client.get("/openapi.json")
    assert res_openapi.status_code == 200
    assert "paths" in res_openapi.json()


def test_13_security_no_credentials_leak(client):
    """13. Verify no private database credentials or API keys leaked in responses."""
    endpoints = ["/health", "/", f"/recommendations/{BOB_USER_ID}"]
    for ep in endpoints:
        res = client.get(ep)
        body_text = res.text.lower()
        assert "password" not in body_text
        assert "secret" not in body_text
        assert "postgresql://" not in body_text
        assert "gemini_api_key" not in body_text


def test_14_fast_inference_response_time(client):
    """14. Verify API response latency is under 1000ms SLA budget for live database inference."""
    import time
    start = time.time()
    res = client.get(f"/recommendations/{BOB_USER_ID}?top_k=10")
    elapsed_ms = (time.time() - start) * 1000.0
    assert res.status_code == 200
    assert elapsed_ms < 1000.0, f"Recommendation latency too high: {elapsed_ms:.2f} ms"

