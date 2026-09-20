"""
CampusNotes AI — Recommendation Data Repository Abstraction
===========================================================

Module: recommendation/data/repository.py
Purpose: Provides a unified data-provider interface and implementations for:
         - PostgresRepository (Live database access via read-only SQL)
         - CsvRepository (Offline snapshot access via CSV files)

Ensures consistent schema and strict point-in-time filtering across both data sources.
"""

from abc import ABC, abstractmethod
import datetime
import logging
from pathlib import Path
from typing import Any, Dict, List, Optional, Set, Tuple
import pandas as pd

from recommendation.db.postgres import get_db_connection, DatabaseUnavailableError

logger = logging.getLogger("campusnotes.recommendation.repository")

PROJECT_ROOT = Path(__file__).resolve().parent.parent.parent
DEFAULT_CSV_DIR = PROJECT_ROOT / "recommendation" / "data" / "raw"


class BaseRepository(ABC):
    """Abstract interface defining the recommendation data access layer."""

    @abstractmethod
    def get_user(self, user_id: str) -> Optional[pd.Series]:
        """Retrieves user profile Series or None if user does not exist."""
        pass

    @abstractmethod
    def get_eligible_notes(self, user_id: str) -> pd.DataFrame:
        """
        Retrieves published candidate notes excluding notes authored by user_id.
        Requirements:
        - isPublished == True
        - uploaderId != user_id
        - id is not null
        """
        pass

    @abstractmethod
    def get_catalog_notes(self) -> pd.DataFrame:
        """Retrieves all catalog notes (for subject/uploader indexing)."""
        pass

    @abstractmethod
    def get_subjects(self) -> pd.DataFrame:
        """Retrieves all academic subjects for curriculum matching."""
        pass

    @abstractmethod
    def get_historical_interactions(
        self, before_time: datetime.datetime, user_id: Optional[str] = None
    ) -> Dict[str, pd.DataFrame]:
        """
        Retrieves historical interactions strictly prior to before_time (createdAt < before_time).
        Returns dict of DataFrames:
        - note_views
        - downloads
        - likes
        - bookmarks
        - chat_sessions
        """
        pass


class PostgresRepository(BaseRepository):
    """
    Live PostgreSQL/Supabase data repository executing read-only parameterized queries.
    """

    def get_user(self, user_id: str) -> Optional[pd.Series]:
        query = """
            SELECT 
                id, 
                name, 
                role, 
                "collegeId", 
                "branchId", 
                semester, 
                bio, 
                "isActive", 
                "createdAt"
            FROM users
            WHERE id = %s
            LIMIT 1;
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query, (user_id,))
                    row = cur.fetchone()
                    if row is None:
                        return None
                    cols = [desc[0] for desc in cur.description]
                    return pd.Series(row, index=cols)
        except Exception as e:
            logger.error("Error looking up user in PostgreSQL: %s", type(e).__name__)
            raise DatabaseUnavailableError(f"Database error during user lookup: {type(e).__name__}") from e

    def get_eligible_notes(self, user_id: str) -> pd.DataFrame:
        query = """
            SELECT 
                id, 
                title, 
                description, 
                "uploaderId", 
                "collegeId", 
                "branchId", 
                semester, 
                "subjectId", 
                "fileSize", 
                "pageCount", 
                "isPublished", 
                "processingStatus", 
                "createdAt"
            FROM notes
            WHERE "isPublished" = true 
              AND "uploaderId" != %s 
              AND id IS NOT NULL
            ORDER BY "createdAt" ASC;
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query, (user_id,))
                    rows = cur.fetchall()
                    cols = [desc[0] for desc in cur.description]
                    df = pd.DataFrame(rows, columns=cols)
                    if "createdAt" in df.columns and not df.empty:
                        df["createdAt"] = pd.to_datetime(df["createdAt"])
                    return df
        except Exception as e:
            logger.error("Error retrieving eligible notes from PostgreSQL: %s", type(e).__name__)
            raise DatabaseUnavailableError(f"Database error during eligible notes retrieval: {type(e).__name__}") from e

    def get_catalog_notes(self) -> pd.DataFrame:
        query = """
            SELECT 
                id, 
                "uploaderId", 
                "subjectId"
            FROM notes
            ORDER BY "createdAt" ASC;
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query)
                    rows = cur.fetchall()
                    cols = [desc[0] for desc in cur.description]
                    return pd.DataFrame(rows, columns=cols)
        except Exception as e:
            logger.error("Error retrieving catalog notes: %s", type(e).__name__)
            raise DatabaseUnavailableError(f"Database error during catalog notes retrieval: {type(e).__name__}") from e

    def get_subjects(self) -> pd.DataFrame:
        query = """
            SELECT 
                id, 
                name, 
                code, 
                semester, 
                "branchId", 
                description, 
                "createdAt"
            FROM subjects
            ORDER BY semester ASC, name ASC;
        """
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    cur.execute(query)
                    rows = cur.fetchall()
                    cols = [desc[0] for desc in cur.description]
                    return pd.DataFrame(rows, columns=cols)
        except Exception as e:
            logger.error("Error retrieving subjects: %s", type(e).__name__)
            raise DatabaseUnavailableError(f"Database error during subjects retrieval: {type(e).__name__}") from e

    def get_historical_interactions(
        self, before_time: datetime.datetime, user_id: Optional[str] = None
    ) -> Dict[str, pd.DataFrame]:
        # Enforce valid point-in-time timestamp
        t = pd.to_datetime(before_time)

        queries = {
            "note_views": 'SELECT id, "userId", "noteId", "createdAt" FROM note_views WHERE "createdAt" < %s ORDER BY "createdAt" ASC;',
            "downloads": 'SELECT id, "userId", "noteId", "createdAt" FROM downloads WHERE "createdAt" < %s ORDER BY "createdAt" ASC;',
            "likes": 'SELECT id, "userId", "noteId", "createdAt" FROM likes WHERE "createdAt" < %s ORDER BY "createdAt" ASC;',
            "bookmarks": 'SELECT id, "userId", "noteId", "createdAt" FROM bookmarks WHERE "createdAt" < %s ORDER BY "createdAt" ASC;',
            "chat_sessions": 'SELECT id, "userId", title, "noteId", "subjectId", semester, "createdAt" FROM chat_sessions WHERE "createdAt" < %s ORDER BY "createdAt" ASC;',
        }

        results: Dict[str, pd.DataFrame] = {}
        try:
            with get_db_connection() as conn:
                with conn.cursor() as cur:
                    for table_name, sql in queries.items():
                        cur.execute(sql, (t,))
                        rows = cur.fetchall()
                        cols = [desc[0] for desc in cur.description]
                        df = pd.DataFrame(rows, columns=cols)
                        if "createdAt" in df.columns and not df.empty:
                            df["createdAt"] = pd.to_datetime(df["createdAt"])
                        results[table_name] = df
            return results
        except Exception as e:
            logger.error("Error querying historical interactions: %s", type(e).__name__)
            raise DatabaseUnavailableError(f"Database error querying interactions: {type(e).__name__}") from e


class CsvRepository(BaseRepository):
    """
    Offline CSV snapshot repository loading data from recommendation/data/raw/.
    Preserved for offline development and regression testing.
    """

    def __init__(self, data_dir: Optional[Path] = None):
        self.data_dir = Path(data_dir) if data_dir else DEFAULT_CSV_DIR
        self._cache: Dict[str, pd.DataFrame] = {}
        self._load_cache()

    def _load_cache(self):
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
        for table in tables:
            csv_path = self.data_dir / f"{table}.csv"
            if not csv_path.exists():
                raise FileNotFoundError(f"Required CSV file missing: {csv_path}")
            df = pd.read_csv(csv_path)
            if "createdAt" in df.columns and not df.empty:
                df["createdAt"] = pd.to_datetime(df["createdAt"], errors="coerce")
            self._cache[table] = df

    def get_user(self, user_id: str) -> Optional[pd.Series]:
        users_df = self._cache["users"]
        matches = users_df[users_df["id"] == user_id]
        if matches.empty:
            return None
        return matches.iloc[0]

    def get_eligible_notes(self, user_id: str) -> pd.DataFrame:
        notes_df = self._cache["notes"]
        eligible_mask = (
            (notes_df["isPublished"] == True)
            & (notes_df["uploaderId"] != user_id)
            & (notes_df["id"].notnull())
        )
        return notes_df[eligible_mask].copy().reset_index(drop=True)

    def get_catalog_notes(self) -> pd.DataFrame:
        return self._cache["notes"][["id", "uploaderId", "subjectId"]].copy()

    def get_subjects(self) -> pd.DataFrame:
        return self._cache["subjects"].copy()

    def get_historical_interactions(
        self, before_time: datetime.datetime, user_id: Optional[str] = None
    ) -> Dict[str, pd.DataFrame]:
        t = pd.to_datetime(before_time)
        if t.tzinfo is not None:
            t = t.tz_convert("UTC").tz_localize(None)

        results: Dict[str, pd.DataFrame] = {}
        for table in ["note_views", "downloads", "likes", "bookmarks", "chat_sessions"]:
            df = self._cache[table]
            if df.empty or "createdAt" not in df.columns:
                results[table] = df.copy()
            else:
                c_series = pd.to_datetime(df["createdAt"])
                if c_series.dt.tz is not None:
                    c_series = c_series.dt.tz_convert("UTC").dt.tz_localize(None)
                filtered = df[c_series < t].copy()
                results[table] = filtered.reset_index(drop=True)
        return results
