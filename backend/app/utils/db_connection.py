"""
Database Utility - Shared SQLAlchemy engine for all backend services.
Works against SQLite (dev) or PostgreSQL (prod) depending on DATABASE_URL.
"""
# --- Old SQLite-only connection helper (kept for reference) ---
# import sqlite3
# import pandas as pd
# import os
#
# DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')
#
# def get_connection():
#     """Returns a SQLite connection object."""
#     if not os.path.exists(DB_PATH):
#         raise FileNotFoundError(f"Database not found at {DB_PATH}. Run ETL pipeline first.")
#     return sqlite3.connect(DB_PATH)
#
# def load_table(table_name):
#     """Loads an entire table as a Pandas DataFrame."""
#     conn = get_connection()
#     df = pd.read_sql(f"SELECT * FROM {table_name}", conn)
#     conn.close()
#     return df
#
# def execute_query(query, params=None):
#     """Executes a raw SQL query (for custom joins)."""
#     conn = get_connection()
#     if params:
#         df = pd.read_sql(query, conn, params=params)
#     else:
#         df = pd.read_sql(query, conn)
#     conn.close()
#     return df

from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, declarative_base
import pandas as pd

from app.config import settings

_engine: Engine = create_engine(settings.database_url, pool_pre_ping=True)

# ORM plumbing for auth/RBAC models (app/models/user.py) — the rest of the
# app talks to the DB via get_engine()/pd.read_sql directly and doesn't use these.
Base = declarative_base()
SessionLocal = sessionmaker(autocommit=False, autoflush=False, bind=_engine)


def get_engine() -> Engine:
    """Returns the shared SQLAlchemy engine."""
    return _engine


def load_table(table_name: str) -> pd.DataFrame:
    """Loads an entire table as a Pandas DataFrame."""
    return pd.read_sql(f"SELECT * FROM {table_name}", _engine)


def execute_query(query: str, params: dict = None) -> pd.DataFrame:
    """Executes a raw SQL query (for custom joins)."""
    return pd.read_sql(query, _engine, params=params)


# Quick test if run directly
if __name__ == "__main__":
    try:
        df = load_table("dispatches")
        print(f"✅ DB Connection successful. Loaded {len(df)} dispatches.")
    except Exception as e:
        print(f"❌ DB Error: {e}")