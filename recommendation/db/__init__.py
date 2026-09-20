"""
CampusNotes AI — Database Module
================================

Provides database connection pooling, health checks, and read-only query utilities.
"""

from recommendation.db.postgres import (
    DatabaseUnavailableError,
    check_database_health,
    get_db_connection,
    get_connection_pool,
    close_connection_pool,
)

__all__ = [
    "DatabaseUnavailableError",
    "check_database_health",
    "get_db_connection",
    "get_connection_pool",
    "close_connection_pool",
]
