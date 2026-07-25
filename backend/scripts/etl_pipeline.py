"""
KPC Revenue Assurance - Foundational ETL Pipeline (Stage 1)
---------------------------------------------------------------
Extracts messy raw O2C datasets, runs strict data quality gates,
routes corrupted records to an audit quarantine table, and loads
clean foundational tables into SQLite and/or PostgreSQL.
"""
import os
import sys
import logging
from datetime import datetime
from typing import Dict
import pandas as pd
from sqlalchemy import create_engine, text
from dotenv import load_dotenv

# Load .env from repo root
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env'))

# ==========================================
# 1. LOGGING & CONFIGURATION
# ==========================================
RAW_DATA_DIR = "data/raw"
CLEAN_DATA_DIR = "data/clean"
LOG_DIR = "logs"

os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE_PATH = os.path.join(LOG_DIR, "kpc_etl_execution.log")

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=[
        logging.FileHandler(LOG_FILE_PATH, encoding="utf-8"),
        logging.StreamHandler(sys.stdout)
    ]
)
logger = logging.getLogger("KPC_ETL")

# Database URIs
POSTGRES_URI = os.getenv("DATABASE_URL")
SQLITE_DB_PATH = "kpc.db"

# ✅ Check if PostgreSQL is enabled
if POSTGRES_URI and POSTGRES_URI.startswith("postgresql"):
    logger.info(f"✅ PostgreSQL mode enabled via DATABASE_URL")
elif POSTGRES_URI and POSTGRES_URI.startswith("postgres://"):
    # Convert to postgresql:// for SQLAlchemy
    POSTGRES_URI = POSTGRES_URI.replace("postgres://", "postgresql://", 1)
    logger.info(f"✅ PostgreSQL mode enabled (converted from postgres://)")
else:
    logger.info("ℹ️  SQLite mode (DATABASE_URL not set to PostgreSQL)")

# ==========================================
# 2. AUDIT QUARANTINE MANAGER
# ==========================================
class AuditQuarantineManager:
    def __init__(self):
        self.quarantine_records = []

    def log_quarantine(self, dataset_name: str, failed_gate: str, reason: str, corrupted_df: pd.DataFrame):
        if corrupted_df.empty:
            return
        for _, row in corrupted_df.iterrows():
            self.quarantine_records.append({
                "quarantine_id": f"QRT-{len(self.quarantine_records)+1:06d}",
                "dataset_name": dataset_name,
                "failed_gate": failed_gate,
                "reason": reason,
                "quarantined_at": datetime.utcnow().strftime("%Y-%m-%d %H:%M:%S"),
                "raw_record_json": row.to_json()
            })

    def get_quarantine_dataframe(self) -> pd.DataFrame:
        if not self.quarantine_records:
            return pd.DataFrame(columns=[
                "quarantine_id", "dataset_name", "failed_gate",
                "reason", "quarantined_at", "raw_record_json"
            ])
        return pd.DataFrame(self.quarantine_records)


# ==========================================
# 3. DATA QUALITY SUITE
# ==========================================
class DataQualitySuite:
    def __init__(self, quarantine_mgr: AuditQuarantineManager):
        self.qm = quarantine_mgr

    def gate_a_deduplicate(self, df: pd.DataFrame, dataset_name: str) -> pd.DataFrame:
        dupes_mask = df.duplicated()
        dupes_count = dupes_mask.sum()
        if dupes_count > 0:
            corrupted = df[dupes_mask].copy()
            self.qm.log_quarantine(dataset_name, "Gate A (Deduplication)", "Duplicate record detected", corrupted)
            df_clean = df.drop_duplicates().copy()
            logger.warning(f"[{dataset_name}] Gate A: Quarantined & removed {dupes_count} duplicate rows.")
            return df_clean
        logger.info(f"[{dataset_name}] Gate A: Passed (0 duplicates).")
        return df

    def gate_b_clean_currency(self, df: pd.DataFrame, dataset_name: str, numeric_cols: list) -> pd.DataFrame:
        df_clean = df.copy()
        for col in numeric_cols:
            if col in df_clean.columns:
                str_mask = df_clean[col].apply(lambda x: isinstance(x, str))
                corrupted_count = str_mask.sum()
                if corrupted_count > 0:
                    df_clean[col] = df_clean[col].astype(str).str.replace(r'[^\d.]', '', regex=True)
                    df_clean[col] = pd.to_numeric(df_clean[col], errors='coerce')
                    logger.warning(f"[{dataset_name}] Gate B: Cleaned {corrupted_count} formatted currency strings in '{col}'.")
                else:
                    df_clean[col] = pd.to_numeric(df_clean[col], errors='coerce')
                    logger.info(f"[{dataset_name}] Gate B: Passed numeric formatting for '{col}'.")
        return df_clean

    def gate_c_standardize_dates(self, df: pd.DataFrame, dataset_name: str, date_cols: list) -> pd.DataFrame:
        df_clean = df.copy()
        for date_col in date_cols:
            if date_col in df_clean.columns:
                parsed_dates = pd.to_datetime(df_clean[date_col], format='mixed', errors='coerce')
                missing_mask = parsed_dates.isna()
                if missing_mask.sum() > 0:
                    corrupted = df_clean[missing_mask].copy()
                    self.qm.log_quarantine(dataset_name, "Gate C (Date Standardizer)", f"Missing/Unparseable date in '{date_col}'", corrupted)
                    df_clean[date_col] = parsed_dates
                    df_clean = df_clean.dropna(subset=[date_col]).copy()
                    df_clean[date_col] = df_clean[date_col].dt.strftime('%Y-%m-%d')
                    logger.warning(f"[{dataset_name}] Gate C: Quarantined {missing_mask.sum()} rows with invalid dates in '{date_col}'.")
                else:
                    df_clean[date_col] = parsed_dates.dt.strftime('%Y-%m-%d')
                    logger.info(f"[{dataset_name}] Gate C: Standardized dates for '{date_col}'.")
        return df_clean

    def gate_d_referential_integrity(self, child_df: pd.DataFrame, child_name: str, fk: str, parent_df: pd.DataFrame, pk: str) -> pd.DataFrame:
        valid_keys = set(parent_df[pk].dropna().unique())
        orphan_mask = ~child_df[fk].isin(valid_keys) & child_df[fk].notna()
        orphan_count = orphan_mask.sum()
        if orphan_count > 0:
            corrupted = child_df[orphan_mask].copy()
            self.qm.log_quarantine(child_name, "Gate D (Referential Integrity)", f"Orphan key '{fk}' not found in parent", corrupted)
            logger.warning(f"[{child_name}] Gate D: Quarantined {orphan_count} orphan records matching '{fk}'.")
            return child_df[~orphan_mask].copy()
        logger.info(f"[{child_name}] Gate D: Passed referential integrity check on '{fk}'.")
        return child_df


# ==========================================
# 4. DATABASE LOADER ENGINE (UPDATED)
# ==========================================
class DatabaseLoader:
    @staticmethod
    def load_to_sqlite(dataframes: Dict[str, pd.DataFrame], db_path: str = SQLITE_DB_PATH):
        import sqlite3
        logger.info(f"\n--- Loading to SQLite Database ('{db_path}') ---")
        try:
            conn = sqlite3.connect(db_path)
            for table_name, df in dataframes.items():
                df.to_sql(table_name, conn, if_exists='replace', index=False)
                logger.info(f" [SQLite] Table '{table_name}' loaded ({len(df)} rows).")
            conn.close()
        except Exception as e:
            logger.error(f" [SQLite] Failed to load data: {e}")

    @staticmethod
    def load_to_postgres(dataframes: Dict[str, pd.DataFrame], uri: str = POSTGRES_URI):
        if not uri:
            logger.info("\n--- Skipping PostgreSQL load (DATABASE_URL not set) ---")
            return
        
        # Ensure correct protocol
        if uri.startswith("postgres://"):
            uri = uri.replace("postgres://", "postgresql://", 1)
        
        logger.info("\n--- Loading to PostgreSQL Database ---")
        try:
            # ✅ Add connection pooling settings for Render
            engine = create_engine(uri, pool_pre_ping=True, pool_recycle=3600)
            with engine.connect() as conn:
                logger.info("✅ PostgreSQL connection established successfully.")
            
            for table_name, df in dataframes.items():
                df.to_sql(table_name, engine, if_exists='replace', index=False)
                logger.info(f" [PostgreSQL] Table '{table_name}' loaded ({len(df)} rows).")
        except Exception as e:
            logger.warning(f" [PostgreSQL] Could not load to PostgreSQL: {e}")


# ==========================================
# 5. PIPELINE ORCHESTRATION
# ==========================================
def main():
    logger.info("==================================================")
    logger.info(" STARTING KPC REVENUE ASSURANCE ETL PIPELINE")
    logger.info("==================================================")

    os.makedirs(CLEAN_DATA_DIR, exist_ok=True)

    qm = AuditQuarantineManager()
    dq = DataQualitySuite(qm)

    file_mapping = {
        "products": "products.csv",
        "depots": "depots.csv",
        "tariffs": "tariffs.csv",
        "omcs": "omcs.csv",
        "depot_loading_logs": "depot_loading_logs.csv",
        "dispatches": "dispatches.csv",
        "invoices": "invoices.csv",
        "payments": "payments.csv",
        "depot_daily_inventory": "depot_daily_inventory.csv"
    }

    raw_dfs = {}
    for table_name, file_name in file_mapping.items():
        path = os.path.join(RAW_DATA_DIR, file_name)
        if not os.path.exists(path):
            logger.error(f"Required file missing: '{path}'. Pipeline aborted.")
            return
        raw_dfs[table_name] = pd.read_csv(path)
        logger.info(f"Extracted '{file_name}' ({len(raw_dfs[table_name])} rows).")

    logger.info("\n--- Applying Data Quality Suite ---")

    products_clean = dq.gate_a_deduplicate(raw_dfs["products"], "products")
    products_clean = dq.gate_b_clean_currency(products_clean, "products", ["unit_price_kes"])
    depots_clean = dq.gate_a_deduplicate(raw_dfs["depots"], "depots")
    omcs_clean = dq.gate_a_deduplicate(raw_dfs["omcs"], "omcs")
    omcs_clean = dq.gate_b_clean_currency(omcs_clean, "omcs", ["credit_limit_kes"])
    tariffs_clean = dq.gate_a_deduplicate(raw_dfs["tariffs"], "tariffs")
    tariffs_clean = dq.gate_c_standardize_dates(tariffs_clean, "tariffs", ["effective_start", "effective_end"])

    loading_clean = dq.gate_a_deduplicate(raw_dfs["depot_loading_logs"], "depot_loading_logs")
    loading_clean = dq.gate_c_standardize_dates(loading_clean, "depot_loading_logs", ["loading_timestamp"])
    loading_clean = dq.gate_d_referential_integrity(loading_clean, "depot_loading_logs", "omc_id", omcs_clean, "omc_id")

    disp_clean = dq.gate_a_deduplicate(raw_dfs["dispatches"], "dispatches")
    disp_clean = dq.gate_b_clean_currency(disp_clean, "dispatches", ["transport_tariff_kes", "storage_tariff_kes", "value_kes"])
    disp_clean = dq.gate_c_standardize_dates(disp_clean, "dispatches", ["date"])
    disp_clean = dq.gate_d_referential_integrity(disp_clean, "dispatches", "omc_id", omcs_clean, "omc_id")

    inv_clean = dq.gate_a_deduplicate(raw_dfs["invoices"], "invoices")
    inv_clean = dq.gate_b_clean_currency(inv_clean, "invoices", ["value_kes"])
    inv_clean = dq.gate_c_standardize_dates(inv_clean, "invoices", ["date"])
    inv_clean = dq.gate_d_referential_integrity(inv_clean, "invoices", "omc_id", omcs_clean, "omc_id")
    inv_clean = dq.gate_d_referential_integrity(inv_clean, "invoices", "dispatch_id", disp_clean, "dispatch_id")

    pay_clean = dq.gate_a_deduplicate(raw_dfs["payments"], "payments")
    pay_clean = dq.gate_b_clean_currency(pay_clean, "payments", ["value_kes"])
    pay_clean = dq.gate_c_standardize_dates(pay_clean, "payments", ["date"])
    pay_clean = dq.gate_d_referential_integrity(pay_clean, "payments", "omc_id", omcs_clean, "omc_id")
    pay_clean = dq.gate_d_referential_integrity(pay_clean, "payments", "invoice_id", inv_clean, "invoice_id")

    inv_ledger_clean = dq.gate_a_deduplicate(raw_dfs["depot_daily_inventory"], "depot_daily_inventory")
    inv_ledger_clean = dq.gate_c_standardize_dates(inv_ledger_clean, "depot_daily_inventory", ["date"])

    datasets_clean = {
        "products": products_clean,
        "depots": depots_clean,
        "tariffs": tariffs_clean,
        "omcs": omcs_clean,
        "depot_loading_logs": loading_clean,
        "dispatches": disp_clean,
        "invoices": inv_clean,
        "payments": pay_clean,
        "depot_daily_inventory": inv_ledger_clean,
        "quarantine_audit_log": qm.get_quarantine_dataframe()
    }

    logger.info(f"\n Total quarantined records captured for governance audit: {len(datasets_clean['quarantine_audit_log'])}")

    TARGET_ENV = "both"

    if TARGET_ENV in ["sqlite", "both"]:
        DatabaseLoader.load_to_sqlite(datasets_clean)

    if TARGET_ENV in ["postgres", "both"]:
        DatabaseLoader.load_to_postgres(datasets_clean)

    logger.info("==================================================")
    logger.info(" KPC REVENUE ETL PIPELINE EXECUTION COMPLETE")
    logger.info("==================================================")

if __name__ == "__main__":
    main()