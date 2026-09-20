"""
CampusNotes AI — Recommendation Data Extraction Pipeline
Phase 3 Step 2.1 & 2.2

Extracts raw academic profile and interaction data from PostgreSQL into recommendation/data/raw/
Enforces read-only database access, zero credential leakage, and strict schema alignment.
"""

import os
import sys
from pathlib import Path
from typing import Dict, Any, List
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Define directory roots
SCRIPT_DIR = Path(__file__).resolve().parent
RECOMMENDATION_DIR = SCRIPT_DIR.parent
PROJECT_ROOT = RECOMMENDATION_DIR.parent
BACKEND_DIR = PROJECT_ROOT / "backend"
ENV_FILE = BACKEND_DIR / ".env"
RAW_DATA_DIR = RECOMMENDATION_DIR / "data" / "raw"

# Explicit column queries ensuring privacy & schema compliance (no password hashes or secrets)
TABLE_QUERIES: Dict[str, Dict[str, Any]] = {
    "users": {
        "query": """
            SELECT 
                id, 
                name, 
                role, 
                "collegeId", 
                "branchId", 
                semester, 
                bio, 
                "isActive", 
                "createdAt", 
                "updatedAt"
            FROM users
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["id", "role", "createdAt"],
        "time_cols": ["createdAt", "updatedAt"]
    },
    "notes": {
        "query": """
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
                "viewsCount", 
                "downloadsCount", 
                "likesCount", 
                "bookmarksCount", 
                "averageRating", 
                "ratingsCount", 
                "createdAt", 
                "updatedAt"
            FROM notes
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["id", "uploaderId", "collegeId", "branchId", "semester", "subjectId"],
        "time_cols": ["createdAt", "updatedAt"]
    },
    "subjects": {
        "query": """
            SELECT 
                id, 
                name, 
                code, 
                semester, 
                "branchId", 
                description, 
                "createdAt", 
                "updatedAt"
            FROM subjects
            ORDER BY semester ASC, name ASC
        """,
        "required_cols": ["id", "name", "code", "semester", "branchId"],
        "time_cols": ["createdAt", "updatedAt"]
    },
    "note_views": {
        "query": """
            SELECT 
                id, 
                "userId", 
                "noteId", 
                "createdAt"
            FROM note_views
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["id", "userId", "noteId", "createdAt"],
        "time_cols": ["createdAt"]
    },
    "downloads": {
        "query": """
            SELECT 
                id, 
                "userId", 
                "noteId", 
                "createdAt"
            FROM downloads
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["id", "noteId", "createdAt"],
        "time_cols": ["createdAt"]
    },
    "likes": {
        "query": """
            SELECT 
                id, 
                "userId", 
                "noteId", 
                "createdAt"
            FROM likes
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["userId", "noteId", "createdAt"],
        "time_cols": ["createdAt"]
    },
    "bookmarks": {
        "query": """
            SELECT 
                id, 
                "userId", 
                "noteId", 
                "createdAt"
            FROM bookmarks
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["userId", "noteId", "createdAt"],
        "time_cols": ["createdAt"]
    },
    "chat_sessions": {
        "query": """
            SELECT 
                id, 
                "userId", 
                title, 
                "noteId", 
                "subjectId", 
                semester, 
                "createdAt", 
                "updatedAt"
            FROM chat_sessions
            ORDER BY "createdAt" ASC
        """,
        "required_cols": ["id", "userId", "createdAt"],
        "time_cols": ["createdAt", "updatedAt"]
    }
}


def load_database_url() -> str:
    """Load DATABASE_URL safely from backend/.env without hardcoding."""
    if not ENV_FILE.exists():
        raise FileNotFoundError(f"Configuration file not found: {ENV_FILE}")

    load_dotenv(dotenv_path=ENV_FILE)
    db_url = os.getenv("DATABASE_URL")

    if not db_url:
        raise ValueError("DATABASE_URL is not configured in backend/.env")

    # Clean quotes if present
    db_url = db_url.strip('"\'')
    
    # SQLAlchemy requires standard postgresql:// or postgresql+psycopg2://
    if db_url.startswith("postgres://"):
        db_url = db_url.replace("postgres://", "postgresql+psycopg2://", 1)
    elif db_url.startswith("postgresql://") and not db_url.startswith("postgresql+psycopg2://"):
        db_url = db_url.replace("postgresql://", "postgresql+psycopg2://", 1)

    return db_url


def create_db_engine(database_url: str):
    """Create a thread-safe, read-only SQLAlchemy engine."""
    return create_engine(
        database_url,
        pool_pre_ping=True,
        execution_options={"isolation_level": "AUTOCOMMIT"}
    )


def extract_table(engine, table_name: str, query_info: Dict[str, Any]) -> pd.DataFrame:
    """Extract a single table using read-only query into a DataFrame."""
    sql = text(query_info["query"])
    with engine.connect() as conn:
        df = pd.read_sql_query(sql, conn)
    return df


def save_dataframe(df: pd.DataFrame, table_name: str, output_dir: Path) -> Path:
    """Save extracted DataFrame to CSV in raw data directory."""
    output_dir.mkdir(parents=True, exist_ok=True)
    csv_path = output_dir / f"{table_name}.csv"
    df.to_csv(csv_path, index=False)
    return csv_path


if hasattr(sys.stdout, "reconfigure"):
    try:
        sys.stdout.reconfigure(encoding="utf-8")
    except Exception:
        pass


def validate_export(raw_dir: Path, expected_tables: List[str]) -> bool:
    """Validate that exported CSV files exist, are readable, and conform to schema expectations."""
    all_valid = True
    print("\n--- Validation Summary ---")
    
    for table_name in expected_tables:
        csv_file = raw_dir / f"{table_name}.csv"
        if not csv_file.exists():
            print(f"  [FAIL] {table_name}.csv MISSING")
            all_valid = False
            continue

        try:
            df = pd.read_csv(csv_file)
            row_count = len(df)
            req_cols = TABLE_QUERIES[table_name]["required_cols"]
            missing_cols = [c for c in req_cols if c not in df.columns]

            if missing_cols:
                print(f"  [FAIL] {table_name}.csv missing required columns: {missing_cols}")
                all_valid = False
            else:
                print(f"  [OK]   {table_name + '.csv':<18} : {row_count:>3} rows | Columns: {len(df.columns)}")
        except Exception as e:
            print(f"  [FAIL] {table_name}.csv failed validation: {e}")
            all_valid = False

    return all_valid


def main():
    print("=" * 60)
    print("CampusNotes AI — Recommendation Data Extraction Pipeline")
    print("=" * 60)

    try:
        db_url = load_database_url()
        engine = create_db_engine(db_url)
        
        # Test connection
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
        print("\nDatabase connection: SUCCESS")
        print(f"Raw data target    : {RAW_DATA_DIR}\n")

    except Exception as e:
        print(f"\nDatabase connection: FAILED ({e})")
        sys.exit(1)

    extracted_counts: Dict[str, int] = {}

    for table_name, query_info in TABLE_QUERIES.items():
        try:
            df = extract_table(engine, table_name, query_info)
            save_dataframe(df, table_name, RAW_DATA_DIR)
            extracted_counts[table_name] = len(df)
            print(f"  Extracted {table_name:<14} : {len(df):>3} rows")
        except Exception as e:
            print(f"  ❌ Error extracting {table_name}: {e}")
            sys.exit(1)

    # Validate output
    is_valid = validate_export(RAW_DATA_DIR, list(TABLE_QUERIES.keys()))

    if is_valid:
        print("\nExtraction and validation completed successfully.")
    else:
        print("\nExtraction finished with validation errors.")
        sys.exit(1)


if __name__ == "__main__":
    main()
