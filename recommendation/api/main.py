"""
CampusNotes AI — FastAPI Recommendation Microservice
====================================================

Module: recommendation/api/main.py
Purpose: Exposes recommendation inference via a REST API.
         Serves live recommendations from PostgreSQL/Supabase (or offline CSV fallback).
         Loads the trained LightGBM model once during startup.

Configuration:
- DATA_SOURCE: "postgres" (default) or "csv"

Safety Notice:
This recommendation service uses a bootstrap LightGBM model trained on synthetic
interactions generated from the real CampusNotes academic catalog.
Its scores and rankings do not represent validated real-student recommendation performance.
Semantic affinity score is currently 0.0 (pgvector and Gemini embeddings not active in this step).
"""

from contextlib import asynccontextmanager
import datetime
import logging
import os
from pathlib import Path
import time
from typing import Any, Dict, List, Optional

from fastapi import FastAPI, HTTPException, Path as FPath, Query, Request, status
from fastapi.responses import JSONResponse
import numpy as np
import pandas as pd
from pydantic import BaseModel, Field

# Local imports
import sys
PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
sys.path.insert(0, str(PROJECT_ROOT))

from recommendation.inference.recommend import (
    load_model,
    recommend_for_user,
)
from recommendation.data.repository import (
    BaseRepository,
    PostgresRepository,
    CsvRepository,
)
from recommendation.db.postgres import (
    DatabaseUnavailableError,
    check_database_health,
    close_connection_pool,
)

# Setup structured logger
logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
)
logger = logging.getLogger("campusnotes.recommendation.api")


# ==============================================================================
# 1. PYDANTIC SCHEMAS
# ==============================================================================

class RecommendationItem(BaseModel):
    rank: int = Field(..., description="1-based recommendation rank")
    note_id: str = Field(..., description="Unique Note UUID")
    title: str = Field(..., description="Note title")
    subject_id: str = Field(..., description="Subject UUID")
    semester: Optional[int] = Field(None, description="Note target semester")
    branch_id: Optional[str] = Field(None, description="Branch UUID or code")
    engagement_score: float = Field(..., description="Predicted engagement probability score")


class RecommendationResponse(BaseModel):
    user_id: str = Field(..., description="Student User UUID")
    model_version: str = Field(..., description="Recommendation model version")
    inference_timestamp: str = Field(..., description="ISO timestamp of inference execution")
    candidate_count: int = Field(..., description="Total eligible candidate notes scored")
    recommendation_count: int = Field(..., description="Number of recommendations returned")
    recommendations: List[RecommendationItem] = Field(..., description="Ranked list of recommendations")


class HealthResponse(BaseModel):
    status: str = Field(..., description="Service health status")
    service: str = Field(..., description="Service identifier")
    model_loaded: bool = Field(..., description="Whether the model artifact is loaded")
    database_connected: Optional[bool] = Field(None, description="Whether PostgreSQL is connected")
    model_version: str = Field(..., description="Loaded model version")
    data_source: str = Field(..., description="Active data source (postgres or csv)")


class RootResponse(BaseModel):
    service: str = Field(..., description="Service title")
    status: str = Field(..., description="Operating status")
    model: str = Field(..., description="Model architecture")
    model_version: str = Field(..., description="Model version")
    data_source: str = Field(..., description="Active data provider")


# ==============================================================================
# 2. APPLICATION LIFESPAN (MODEL & DATA REPOSITORY INITIALIZATION)
# ==============================================================================

@asynccontextmanager
async def lifespan(app: FastAPI):
    """
    Manages application startup and shutdown.
    Loads model artifact and initializes data repository once on startup.
    """
    logger.info("Initializing CampusNotes Recommendation Service...")

    try:
        # Load model artifact once
        app.state.model_artifact = load_model()
        model_version = app.state.model_artifact.get("version", "1.0.0")
        logger.info("Successfully loaded recommendation model (v%s).", model_version)

        # Configure data source (default to postgres)
        data_source_mode = os.getenv("DATA_SOURCE", "postgres").strip().lower()
        app.state.data_source_mode = data_source_mode

        if data_source_mode == "csv":
            logger.info("Using offline CsvRepository as data source.")
            app.state.repository = CsvRepository()
            app.state.db_healthy = False
        else:
            logger.info("Using live PostgresRepository as data source.")
            app.state.repository = PostgresRepository()
            # Perform initial health check
            app.state.db_healthy = check_database_health()
            if app.state.db_healthy:
                logger.info("PostgreSQL database connection verified successfully.")
            else:
                logger.warning("PostgreSQL database connection check failed during startup.")

    except Exception as e:
        logger.critical("Fatal: Failed to load model or repository during startup: %s", str(e), exc_info=True)
        raise RuntimeError(f"Startup failure: {e}") from e

    yield

    logger.info("Shutting down CampusNotes Recommendation Service.")
    close_connection_pool()


# ==============================================================================
# 3. FASTAPI APPLICATION SETUP
# ==============================================================================

app = FastAPI(
    title="CampusNotes AI - Recommendation Microservice",
    description=(
        "Live-serving recommendation service for CampusNotes AI. "
        "Scores candidate notes using a LightGBM model over live PostgreSQL data."
    ),
    version="1.0.0",
    lifespan=lifespan,
)


# ==============================================================================
# 4. ENDPOINTS
# ==============================================================================

@app.get(
    "/",
    response_model=RootResponse,
    summary="Service description and status",
    tags=["General"],
)
async def root() -> RootResponse:
    """Returns basic service metadata and current operating status."""
    artifact = getattr(app.state, "model_artifact", {})
    data_source = getattr(app.state, "data_source_mode", "postgres")
    return RootResponse(
        service="CampusNotes AI Recommendation Service",
        status="running",
        model="LightGBM",
        model_version=artifact.get("version", "1.0.0"),
        data_source=data_source,
    )


@app.get(
    "/health",
    response_model=HealthResponse,
    summary="Service health check",
    tags=["General"],
)
async def health_check() -> HealthResponse:
    """Verifies service activity, model loading, and database connectivity."""
    artifact = getattr(app.state, "model_artifact", None)
    is_loaded = artifact is not None and "model" in artifact and "pipeline" in artifact
    data_source = getattr(app.state, "data_source_mode", "postgres")

    db_connected = None
    if data_source == "postgres":
        db_connected = check_database_health()
        app.state.db_healthy = db_connected

    status_str = "ok"
    if not is_loaded:
        status_str = "degraded"
    elif data_source == "postgres" and not db_connected:
        status_str = "degraded"

    return HealthResponse(
        status=status_str,
        service="campusnotes-recommendation",
        model_loaded=is_loaded,
        database_connected=db_connected,
        model_version=artifact.get("version", "unknown") if artifact else "unknown",
        data_source=data_source,
    )


@app.get(
    "/recommendations/{user_id}",
    response_model=RecommendationResponse,
    summary="Get personalized note recommendations for a student",
    tags=["Recommendations"],
    responses={
        200: {"description": "Ranked note recommendations returned successfully"},
        400: {"description": "Invalid parameter (e.g. top_k < 1 or top_k > 100)"},
        404: {"description": "User not found in student directory"},
        503: {"description": "Recommendation database temporarily unavailable"},
        500: {"description": "Internal recommendation engine error"},
    },
)
async def get_recommendations(
    user_id: str = FPath(..., min_length=1, description="Student User UUID"),
    top_k: int = Query(default=10, description="Number of recommendations to return (1-100)"),
) -> RecommendationResponse:
    """
    Computes personalized note recommendations for an authenticated student.

    - Live database candidate retrieval from PostgreSQL.
    - Excludes self-authored notes.
    - Excludes unpublished notes.
    - Generates 27 point-in-time features.
    - Scores candidate notes via LightGBM model.
    - Returns top K ranked results.
    """
    start_time = time.time()

    # Parameter validation
    if top_k < 1 or top_k > 100:
        logger.warning("Rejected invalid top_k: %d (must be between 1 and 100)", top_k)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid top_k parameter: {top_k}. Must be between 1 and 100.",
        )

    logger.info("Recommendation request received for user_id=%s, top_k=%d", user_id, top_k)

    artifact = getattr(app.state, "model_artifact", None)
    repository = getattr(app.state, "repository", None)

    if artifact is None or repository is None:
        logger.error("Model artifact or repository not initialized on app.state")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="Recommendation engine is not properly initialized.",
        )

    try:
        recs_df, diag = recommend_for_user(
            user_id=user_id,
            top_k=top_k,
            model_artifact=artifact,
            repository=repository,
        )
    except DatabaseUnavailableError as e:
        logger.error("Database unavailable during recommendation for user_id=%s: %s", user_id, type(e).__name__)
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Recommendation database temporarily unavailable",
        )
    except ValueError as e:
        err_msg = str(e)
        if "not found" in err_msg.lower():
            logger.warning("User not found: %s", user_id)
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="User not found",
            )
        logger.error("Value error during recommendation for user_id=%s: %s", user_id, err_msg)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Invalid recommendation request parameters.",
        )
    except Exception as e:
        logger.error("Unexpected error during recommendation generation: %s", str(e), exc_info=True)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail="An error occurred while generating recommendations.",
        )

    duration_ms = (time.time() - start_time) * 1000.0
    logger.info(
        "Recommendation complete for user_id=%s: %d candidates, %d returned, %.2f ms",
        user_id,
        diag.get("eligible_candidates_count", 0),
        len(recs_df),
        duration_ms,
    )

    # Construct response items
    items: List[RecommendationItem] = []
    for _, row in recs_df.iterrows():
        items.append(
            RecommendationItem(
                rank=int(row["rank"]),
                note_id=str(row["note_id"]),
                title=str(row["title"]),
                subject_id=str(row["subject_id"]),
                semester=int(row["semester"]) if pd.notna(row.get("semester")) else None,
                branch_id=str(row["branch_id"]) if pd.notna(row.get("branch_id")) else None,
                engagement_score=round(float(row["engagement_score"]), 6),
            )
        )

    return RecommendationResponse(
        user_id=user_id,
        model_version=diag.get("model_version", "1.0.0"),
        inference_timestamp=diag.get("inference_timestamp", datetime.datetime.now(datetime.timezone.utc).isoformat()),
        candidate_count=diag.get("eligible_candidates_count", 0),
        recommendation_count=len(items),
        recommendations=items,
    )
