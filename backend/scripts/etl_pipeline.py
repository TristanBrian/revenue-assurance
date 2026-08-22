"""
KPC Revenue Assurance - Foundational ETL Pipeline (Stage 1 - CI/CD Dry Run)
---------------------------------------------------------------------------
Extracts messy raw O2C datasets, runs strict data quality gates,
routes corrupted records to an audit quarantine table, and performs
an in-memory validation. 

Generates a temporary SQLite database ONLY when running in a CI/CD 
or Pytest environment to satisfy test assertions.
"""

import os
import sys
import logging
from datetime import datetime, timezone
from typing import Dict
import pandas as pd
from sqlalchemy import create_engine
from dotenv import load_dotenv

# Load root .env file for environment compatibility
load_dotenv(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), '.env'))

# ==========================================
# 1. LOGGING & CONFIGURATION
# ==========================================
RAW_DATA_DIR = "data/raw"
CLEAN_DATA_DIR = "data/clean"
LOG_DIR = "logs"

# Ensure log directory exists before setting up file logging.
# File logging is best-effort: in rootless Podman/Docker the bind-mounted
# host logs/ dir may be owned by root and unwritable. Never crash startup
# over that — stdout still reaches `docker compose logs`.
os.makedirs(LOG_DIR, exist_ok=True)
LOG_FILE_PATH = os.path.join(LOG_DIR, "kpc_etl_execution.log")
_log_handlers = [logging.StreamHandler(sys.stdout)]
try:
    _log_handlers.insert(0, logging.FileHandler(LOG_FILE_PATH, encoding="utf-8"))
except OSError:
    pass

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
    handlers=_log_handlers,
)
logger = logging.getLogger("KPC_ETL")

POSTGRES_URI = os.getenv("DATABASE_URL")
SQLITE_DB_PATH = "kpc.db"

# ==========================================
# 2. AUDIT QUARANTINE MANAGER
# ==========================================
class AuditQuarantineManager:
    """Collects and standardizes rejected records for governance & auditing."""

    def __init__(self):
        self.quarantine_records = []

    def log_quarantine(self, dataset_name: str, failed_gate: str, reason: str, corrupted_df: pd.DataFrame):
        """Appends failed records to the quarantine list."""
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
        """Returns the quarantine log as a DataFrame for DB loading."""
        if not self.quarantine_records:
            return pd.DataFrame(columns=[
                "quarantine_id", "dataset_name", "failed_gate",
                "reason", "quarantined_at", "raw_record_json"
            ])
        return pd.DataFrame(self.quarantine_records)


# ==========================================
# 3. DATA QUALITY SUITE (TRANSFORMATIONS)
# ==========================================
class DataQualitySuite:
    """Modular Data Quality Gates enforcing foundational data hygiene."""

    def __init__(self, quarantine_mgr: AuditQuarantineManager):
        self.qm = quarantine_mgr

    def gate_a_deduplicate(self, df: pd.DataFrame, dataset_name: str) -> pd.DataFrame:
        """Gate A: Identifies, logs, and removes exact duplicate records."""
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
        """Gate B: Standardizes currency text strings (e.g., ' KES 45,000 ') into numeric floats."""
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
        """Gate C: Parses mixed date formats, quarantining unparseable/missing dates."""
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
        """Gate D: Enforces relational constraints and flags orphan records."""
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
# 4. DATABASE LOADER ENGINE (Preserved for Tests)
# ==========================================
class DatabaseLoader:
    """Handles persistence to SQLite and PostgreSQL (Preserved for test coverage)."""

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
        # Accept either postgresql:// or postgres://
        if not uri or not (uri.startswith("postgresql") or uri.startswith("postgres")):
            logger.info("\n--- Skipping PostgreSQL load (DATABASE_URL not set to a postgresql:// URI) ---")
            return
        # Convert postgres:// to postgresql:// for SQLAlchemy
        if uri.startswith("postgres://"):
            uri = uri.replace("postgres://", "postgresql://", 1)
        logger.info("\n--- Loading to PostgreSQL Database ---")
        try:
            engine = create_engine(uri)
            with engine.connect() as conn:
                logger.info(" PostgreSQL connection established successfully.")

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

    # Ensure clean data directory exists
    os.makedirs(CLEAN_DATA_DIR, exist_ok=True)

    qm = AuditQuarantineManager()
    dq = DataQualitySuite(qm)

    # 1. EXTRACT
    file_mapping = {
        "products": "products.csv",
        "depots": "depots.csv",
        "tariffs": "tariffs.csv",
        "omcs": "omcs.csv",
        "depot_loading_logs": "depot_loading_logs.csv",
        "dispatches": "dispatches.csv",
        "invoices": "invoices.csv",
        "payments": "payments.csv",
        "depot_daily_inventory": "depot_daily_inventory.csv",
        # --- Outbound (stipend/disbursement) — Stage 2 ---
        "officers": "officers.csv",
        "beneficiaries": "beneficiaries.csv",
        "attendance": "attendance.csv",
        "stipend_authorizations": "stipend_authorizations.csv",
        "disbursements": "disbursements.csv",
    }

    # Outbound (stipend) CSVs are only produced by generate_kpc_data.py.
    # start.sh skips generation when inbound CSVs already exist, so a
    # Docker first-run often has dispatches/invoices/payments but not
    # officers/beneficiaries/etc. Missing outbound files must not abort
    # the inbound load — that's the data the login dashboard actually reads.
    OPTIONAL_TABLES = {
        "officers",
        "beneficiaries",
        "attendance",
        "stipend_authorizations",
        "disbursements",
    }

    raw_dfs = {}
    for table_name, file_name in file_mapping.items():
        path = os.path.join(RAW_DATA_DIR, file_name)
        if not os.path.exists(path):
            if table_name in OPTIONAL_TABLES:
                logger.warning(f"Optional file missing: '{path}' — skipping {table_name}.")
                continue
            logger.error(f"Required file missing: '{path}'. Pipeline aborted.")
            return
        raw_dfs[table_name] = pd.read_csv(path)
        logger.info(f"Extracted '{file_name}' ({len(raw_dfs[table_name])} rows).")

    # 2. TRANSFORM & CLEAN
    logger.info("\n--- Applying Data Quality Suite ---")

    # A. Clean Master Tables
    products_clean = dq.gate_a_deduplicate(raw_dfs["products"], "products")
    products_clean = dq.gate_b_clean_currency(products_clean, "products", ["unit_price_kes"])

    depots_clean = dq.gate_a_deduplicate(raw_dfs["depots"], "depots")

    omcs_clean = dq.gate_a_deduplicate(raw_dfs["omcs"], "omcs")
    omcs_clean = dq.gate_b_clean_currency(omcs_clean, "omcs", ["credit_limit_kes"])

    tariffs_clean = dq.gate_a_deduplicate(raw_dfs["tariffs"], "tariffs")
    tariffs_clean = dq.gate_c_standardize_dates(tariffs_clean, "tariffs", ["effective_start", "effective_end"])

    # B. Clean Transactional Tables
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

    # C. Clean Outbound Tables (Stage 2 — same 4 gates, no new gate logic)
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
    }

    if "officers" in raw_dfs:
        officers_clean = dq.gate_a_deduplicate(raw_dfs["officers"], "officers")
        datasets_clean["officers"] = officers_clean

        beneficiaries_clean = dq.gate_a_deduplicate(raw_dfs["beneficiaries"], "beneficiaries")
        beneficiaries_clean = dq.gate_c_standardize_dates(beneficiaries_clean, "beneficiaries", ["enrollment_date"])
        beneficiaries_clean = dq.gate_d_referential_integrity(beneficiaries_clean, "beneficiaries", "officer_id", officers_clean, "officer_id")
        datasets_clean["beneficiaries"] = beneficiaries_clean

        attendance_clean = dq.gate_a_deduplicate(raw_dfs["attendance"], "attendance")
        attendance_clean = dq.gate_c_standardize_dates(attendance_clean, "attendance", ["attendance_date"])
        attendance_clean = dq.gate_d_referential_integrity(attendance_clean, "attendance", "beneficiary_id", beneficiaries_clean, "beneficiary_id")
        datasets_clean["attendance"] = attendance_clean

        auth_clean = dq.gate_a_deduplicate(raw_dfs["stipend_authorizations"], "stipend_authorizations")
        auth_clean = dq.gate_b_clean_currency(auth_clean, "stipend_authorizations", ["amount_authorized"])
        auth_clean = dq.gate_c_standardize_dates(auth_clean, "stipend_authorizations", ["date"])
        auth_clean = dq.gate_d_referential_integrity(auth_clean, "stipend_authorizations", "attendance_id", attendance_clean, "attendance_id")
        datasets_clean["stipend_authorizations"] = auth_clean

        # disbursements.authorization_id is intentionally left un-checked by
        # Gate D here — ghost payments (authorization_id = NULL, injected by
        # generate_disbursements()) must NOT be quarantined as a data-quality
        # defect; they're a real anomaly the reconciliation service is meant
        # to detect and flag critical. Gate D's own orphan_mask already skips
        # null FKs (`& child_df[fk].notna()`), so this call is safe to make —
        # only a disbursement with a NON-null, NON-existent authorization_id
        # would be quarantined, which is a genuine data-quality defect, not a
        # ghost payment.
        disb_clean = dq.gate_a_deduplicate(raw_dfs["disbursements"], "disbursements")
        disb_clean = dq.gate_b_clean_currency(disb_clean, "disbursements", ["amount_paid"])
        disb_clean = dq.gate_c_standardize_dates(disb_clean, "disbursements", ["date"])
        disb_clean = dq.gate_d_referential_integrity(disb_clean, "disbursements", "authorization_id", auth_clean, "authorization_id")
        datasets_clean["disbursements"] = disb_clean

    datasets_clean["quarantine_audit_log"] = qm.get_quarantine_dataframe()
    logger.info(f"\n Total quarantined records captured for governance audit: {len(datasets_clean['quarantine_audit_log'])}")

    # 4. DATABASE LOAD
    #
    # Unconditional, not gated on CI/pytest: this is the only thing that
    # actually gets clean data into the database the running app queries
    # (services/reconciliation/reconciliation.py reads these tables directly
    # via pd.read_sql — nothing else populates them). A CI-only gate here
    # previously meant a normal run (start.sh, or a developer running this
    # by hand) did all the extract/clean/quarantine work and then discarded
    # it, leaving Postgres empty. SQLite is always written too (cheap, and
    # is what the test suite reads); the Postgres branch already no-ops
    # gracefully via DatabaseLoader.load_to_postgres's own guard when
    # DATABASE_URL isn't a postgresql:// URI, so there's no environment
    # check needed here — the two loaders already know when to skip themselves.
    DatabaseLoader.load_to_sqlite(datasets_clean)
    DatabaseLoader.load_to_postgres(datasets_clean)

    # 5. IMMUTABLE AUDIT TRAIL — chain one row per ingested record that
    # passed Gate D, attributed to whoever the source record names (see
    # _AUDITED_TABLES above). Only meaningful against Postgres (audit_logs
    # is a real ORM table with a UUID PK, same reason auth requires
    # Postgres — see README's Local development section); no-ops
    # gracefully if DATABASE_URL isn't a postgresql:// URI or the table/
    # columns don't exist yet, same as DatabaseLoader.load_to_postgres.
    _write_ingestion_audit_trail(datasets_clean)

    logger.info("==================================================")
    logger.info(" KPC REVENUE ETL PIPELINE EXECUTION COMPLETE")
    logger.info("==================================================")

# Ingestion-path actor attribution (immutable audit trail extension) —
# for each audited table, which column names the actor and which names
# the record's own business timestamp. None for the actor column means
# "genuinely no natural human actor" (payments — a bank-to-bank
# remittance, see generate_kpc_data.py's comment above KPC_FINANCE_STAFF),
# not a missed lookup. depot_ledger/quota_ledger/stipend_ledger aren't
# audited here because nothing populates them yet (see their model
# docstrings) — there's nothing to ingest.
_AUDITED_TABLES = [
    # (dataset key in datasets_clean, target_type, id_col, actor_col, event_timestamp_col)
    ("dispatches", "dispatch", "dispatch_id", "dispatched_by", "date"),
    ("invoices", "invoice", "invoice_id", "prepared_by", "date"),
    ("payments", "payment", "payment_id", None, "date"),
    ("attendance", "attendance", "attendance_id", "officer_id", "attendance_date"),
    ("stipend_authorizations", "stipend_authorization", "authorization_id", "authorized_by", "date"),
    ("disbursements", "disbursement", "disbursement_id", "processed_by", "date"),
]


def _row_event_timestamp(row: dict, event_ts_col: str) -> datetime:
    """Gate C leaves date columns as plain 'YYYY-MM-DD' strings (see
    DataQualitySuite.gate_c_standardize_dates), not datetime objects —
    parse back into a real datetime for event_timestamp. Falls back to
    "now" for the rare row where the date column is missing/unparseable
    (shouldn't happen post-Gate-C, but a fallback here is cheaper than
    letting one bad row abort the whole audit backfill)."""
    raw = row.get(event_ts_col)
    parsed = pd.to_datetime(raw, errors="coerce") if raw is not None else None
    if parsed is None or pd.isna(parsed):
        return datetime.now(timezone.utc)
    dt = parsed.to_pydatetime() if hasattr(parsed, "to_pydatetime") else parsed
    return dt.replace(tzinfo=timezone.utc) if dt.tzinfo is None else dt


def _write_ingestion_audit_trail(datasets_clean: Dict[str, pd.DataFrame]) -> None:
    """
    Chains one AuditLog row per ingested record that passed Gate D, for
    every table in _AUDITED_TABLES — the "ETL is the boundary where
    real-world, actor-attributed events enter this platform" model (see
    the immutable-audit-trail extension prompt's Section 1). Uses ONE
    ChainWriter across all 6 tables so they land in a single sequence in
    a natural reading order (inbound dispatch->invoice->payment, then
    outbound attendance->authorization->disbursement), not six separate
    per-table sequences.

    Best-effort and non-fatal, same convention as _alert_etl_failure():
    start.sh runs this script *before* `alembic upgrade head`, so on a
    fresh install audit_logs may not have the hash-chain columns yet (or
    may not exist at all). A failure here must never block or roll back
    the actual data load that already succeeded above.
    """
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from app.services.audit.audit_service import ChainWriter  # noqa: E402
        from app.utils.db_connection import SessionLocal  # noqa: E402

        db = SessionLocal()
        try:
            writer = ChainWriter(db)
            total_rows = 0
            for dataset_key, target_type, id_col, actor_col, event_ts_col in _AUDITED_TABLES:
                df = datasets_clean.get(dataset_key)
                if df is None or df.empty:
                    continue
                for row in df.to_dict(orient="records"):
                    writer.write_ingested(
                        external_actor=(row.get(actor_col) if actor_col else None),
                        target_type=target_type,
                        target_id=row.get(id_col),
                        record=row,
                        event_timestamp=_row_event_timestamp(row, event_ts_col),
                    )
                    total_rows += 1
            writer.finalize()
            db.commit()
            logger.info(f" [Audit] Chained {total_rows} ingestion-path audit rows across {len(_AUDITED_TABLES)} tables.")
        finally:
            db.close()
    except Exception as audit_err:
        logger.error(f" [Audit] Ingestion audit trail could not be written (non-fatal, e.g. pre-migration): {audit_err}")


def _alert_etl_failure(error: str) -> None:
    """Best-effort — this script runs standalone and start.sh runs it
    *before* `alembic upgrade head`, so on a fresh install the alerts
    table may not exist yet. A failure here must never mask or replace
    the real ETL failure being reported, just supplement it when possible."""
    try:
        sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
        from app.services.alerts.alert_service import notify_etl_failed  # noqa: E402
        from app.utils.db_connection import SessionLocal  # noqa: E402

        db = SessionLocal()
        try:
            notify_etl_failed(db, error)
            db.commit()
        finally:
            db.close()
    except Exception as alert_err:
        logger.error(f"ETL-failure alert could not be created (non-fatal, e.g. pre-migration): {alert_err}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        logger.error(f"ETL pipeline failed: {e}")
        _alert_etl_failure(str(e))
        raise