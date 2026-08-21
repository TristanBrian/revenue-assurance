"""
Applies setup_medallion.sql (bronze/silver/gold schema + tables) against
DATABASE_URL. A thin runner rather than a shell `psql < file` step in
start.sh: the backend image has no postgresql-client installed, and this
keeps the same "skip gracefully if no Postgres configured" convention as
load_master_data.py / etl_pipeline.py's DatabaseLoader, instead of adding
an image dependency for one script.

Foundation-only step, run automatically on every startup (see start.sh) —
creates/resets the bronze/silver/gold schemas so they exist and are
queryable. Does NOT populate bronze/silver/gold with data; that's
live_kpc_stream.py's job, run manually/separately for now (not wired into
startup — see PROGRESS.md).

Note: setup_medallion.sql does DROP TABLE ... CASCADE before recreating,
so this is destructive to whatever's in bronze/silver/gold on every
restart. Fine while nothing writes there automatically yet; revisit this
if/when live_kpc_stream.py (or its replacement) becomes a persistent
background service — at that point this script should stop running
unconditionally on every startup.

Run with (from backend/, same as etl_pipeline.py):
    python scripts/setup_medallion.py
"""
import logging
import os

from dotenv import load_dotenv
from sqlalchemy import create_engine, text

load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env'))

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("SetupMedallion")

SQL_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "setup_medallion.sql")


def _statements(sql_text: str) -> list[str]:
    """Splits on ';' — safe here because setup_medallion.sql has no
    function bodies, triggers, or string literals containing ';', just
    CREATE SCHEMA/TABLE and DROP TABLE statements."""
    return [s.strip() for s in sql_text.split(";") if s.strip()]


def setup():
    database_url = os.getenv("DATABASE_URL")
    if not database_url or not database_url.startswith("postgresql"):
        logger.info("⏭️ Skipping medallion schema setup — DATABASE_URL isn't a postgresql:// URI (SQLite-only local dev).")
        return

    with open(SQL_PATH) as f:
        sql_text = f.read()

    engine = create_engine(database_url)
    try:
        with engine.begin() as conn:
            for statement in _statements(sql_text):
                conn.execute(text(statement))
        logger.info("✅ bronze/silver/gold schemas + tables ready.")
    except Exception as e:
        logger.error(f"❌ Medallion schema setup failed: {e}")


if __name__ == "__main__":
    setup()
