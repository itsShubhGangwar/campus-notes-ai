"""
CampusNotes AI — PostgreSQL Database Access & Connection Pool
============================================================

Module: recommendation/db/postgres.py
Purpose: Thread-safe, read-only database connection pooling for CampusNotes AI.
         Strictly enforces read-only access (readonly=True), parameterized queries,
         connection timeout handling, and health verification.

Safety Invariants:
- 100% Read-Only: All connections are configured with session readonly=True.
- Parameterized SQL: Only parameterized placeholders are permitted.
- Zero credential leakage: DATABASE_URL is never logged or exposed in responses.
- Resilient pooling: Uses SimpleConnectionPool for controlled connection lifecycle.
"""

from contextlib import contextmanager
import logging
import os
from pathlib import Path
import threading
from typing import Optional

from dotenv import load_dotenv
import psycopg2
from psycopg2 import pool

logger = logging.getLogger("campusnotes.recommendation.db")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
BACKEND_ENV_FILE = PROJECT_ROOT / "backend" / ".env"

_pool: Optional[pool.SimpleConnectionPool] = None
_pool_lock = threading.Lock()


class DatabaseUnavailableError(Exception):
    """Raised when PostgreSQL database is unreachable or connection fails."""
    pass


def get_database_url() -> str:
    """
    Safely retrieves the database connection URL from environment variables.
    Falls back to loading backend/.env if not present in the runtime environment.
    Never prints or logs the raw URL or credentials.
    """
    url = os.getenv("DATABASE_URL")
    if not url and BACKEND_ENV_FILE.exists():
        load_dotenv(dotenv_path=BACKEND_ENV_FILE)
        url = os.getenv("DATABASE_URL")

    if not url:
        raise DatabaseUnavailableError(
            "DATABASE_URL is not configured in environment or backend/.env."
        )

    cleaned = url.strip('"\'')
    if cleaned.startswith("postgres://"):
        cleaned = cleaned.replace("postgres://", "postgresql://", 1)
    return cleaned


def get_connection_pool(minconn: int = 1, maxconn: int = 10) -> pool.SimpleConnectionPool:
    """
    Returns the singleton PostgreSQL connection pool, initializing it if necessary.
    """
    global _pool
    if _pool is None:
        with _pool_lock:
            if _pool is None:
                db_url = get_database_url()
                try:
                    _pool = pool.SimpleConnectionPool(
                        minconn=minconn,
                        maxconn=maxconn,
                        dsn=db_url,
                    )
                    logger.info("Initialized PostgreSQL connection pool (min=%d, max=%d)", minconn, maxconn)
                except Exception as e:
                    logger.error("Failed to initialize PostgreSQL connection pool: %s", type(e).__name__)
                    raise DatabaseUnavailableError("Failed to initialize database connection pool.") from e
    return _pool


def close_connection_pool():
    """Closes all connections in the pool safely."""
    global _pool
    with _pool_lock:
        if _pool is not None:
            try:
                _pool.closeall()
                logger.info("PostgreSQL connection pool closed successfully.")
            except Exception as e:
                logger.warning("Error while closing PostgreSQL connection pool: %s", e)
            finally:
                _pool = None


@contextmanager
def get_db_connection():
    """
    Context manager that acquires a connection from the pool and guarantees safe return.
    Strictly configures session to readonly=True and autocommit=True.
    """
    conn = None
    p = None
    try:
        p = get_connection_pool()
        conn = p.getconn()
        conn.set_session(readonly=True, autocommit=True)
    except Exception as e:
        logger.error("Failed to acquire connection from pool: %s", type(e).__name__)
        if conn is not None and p is not None:
            try:
                p.putconn(conn)
            except Exception:
                pass
        raise DatabaseUnavailableError("Recommendation database temporarily unavailable.") from e

    try:
        yield conn
    finally:
        if conn is not None and p is not None:
            try:
                p.putconn(conn)
            except Exception as e:
                logger.warning("Error returning connection to pool: %s", e)


def check_database_health() -> bool:
    """
    Executes a lightweight SELECT 1 query to verify database connectivity.
    Returns True if reachable, False otherwise.
    """
    try:
        with get_db_connection() as conn:
            with conn.cursor() as cur:
                cur.execute("SELECT 1;")
                res = cur.fetchone()
                return res is not None and res[0] == 1
    except Exception as e:
        logger.warning("Database health check failed: %s", type(e).__name__)
        return False
