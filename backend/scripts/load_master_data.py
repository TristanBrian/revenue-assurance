"""
KPC Revenue Assurance - Master Data Loader
---------------------------------------------------------------
Reads static dimension and historical fact CSVs from data/raw/
and loads them into a 'master' schema in the PostgreSQL database.
"""
import os
import pandas as pd
import logging
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# ==========================================
# 1. LOGGING & CONFIGURATION
# ==========================================
load_dotenv()

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s"
)
logger = logging.getLogger("MasterDataLoader")

POSTGRES_URI = os.getenv("DATABASE_URL")
if POSTGRES_URI and POSTGRES_URI.startswith("postgres://"):
    POSTGRES_URI = POSTGRES_URI.replace("postgres://", "postgresql://", 1)

# Deliberately NOT create_engine(POSTGRES_URI) at import time: this script
# runs from start.sh in every environment, including plain SQLite-only
# local dev where DATABASE_URL is unset — create_engine(None) raises
# immediately, which would crash the whole startup script over an
# optional step. load_data() below checks POSTGRES_URI itself and skips
# gracefully, same pattern as etl_pipeline.py's DatabaseLoader.load_to_postgres.
engine = create_engine(POSTGRES_URI) if POSTGRES_URI and POSTGRES_URI.startswith("postgresql") else None

RAW_DATA_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), 'data', 'raw')

# Map the CSV filenames to the table names we want in the database
FILES_TO_LOAD = {
    "omcs.csv": "omcs",                               # Contains Director Details & Incorporation Dates
    "products.csv": "products",
    "depots.csv": "depots",
    "tariffs.csv": "tariffs",
    "depot_loading_logs.csv": "depot_loading_logs",   # Physical loading logs (Historical)
    "depot_daily_inventory.csv": "depot_daily_inventory" # Physical tank dips (Historical)
}

# ==========================================
# 2. LOAD PROCESS
# ==========================================
def load_data():
    if engine is None:
        logger.info("⏭️ Skipping master data load — DATABASE_URL isn't a postgresql:// URI (SQLite-only local dev).")
        return

    logger.info("🚀 Starting Master Data Load...")

    try:
        # Create the new 'master' schema if it doesn't exist
        with engine.begin() as conn:
            conn.execute(text("CREATE SCHEMA IF NOT EXISTS master;"))
            logger.info("✅ 'master' schema ensured in database.")

        # Loop through the files and load them using pandas
        for file_name, table_name in FILES_TO_LOAD.items():
            file_path = os.path.join(RAW_DATA_DIR, file_name)
            
            if not os.path.exists(file_path):
                logger.warning(f"⚠️ File not found: {file_path}. Skipping...")
                continue
                
            logger.info(f"⏳ Reading {file_name}...")
            df = pd.read_csv(file_path)
            
            logger.info(f"💾 Writing to master.{table_name}...")
            # to_sql automatically creates the table structures based on the CSV data types!
            df.to_sql(
                name=table_name,
                con=engine,
                schema='master',
                if_exists='replace', # Replaces the table if it already exists
                index=False
            )
            logger.info(f"✅ Successfully loaded {len(df)} rows into master.{table_name}")

        logger.info("🎉 All master data successfully loaded into PostgreSQL!")
        
    except Exception as e:
        logger.error(f"❌ Load failed: {e}")

if __name__ == "__main__":
    load_data()