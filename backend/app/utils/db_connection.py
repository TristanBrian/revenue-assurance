from sqlalchemy import create_engine
from sqlalchemy.engine import Engine
from sqlalchemy.orm import sessionmaker, declarative_base
import pandas as pd

from app.config import settings

# ============================================================================
# SQLALCHEMY ENGINE – with Render/PostgreSQL compatibility
# ============================================================================

_engine: Engine = create_engine(
    settings.database_url,
    pool_pre_ping=True,      
    pool_recycle=3600,       
    echo=False               
)

# ORM plumbing for auth/RBAC models
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
        print(f"   Database URL: {settings.database_url}")
    except Exception as e:
        print(f"❌ DB Error: {e}")