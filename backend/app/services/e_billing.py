"""
Features:
- Retry with exponential backoff
- Dead Letter Queue (DLQ)
- Webhook callbacks
- Reconciliation dashboard
- Monitoring & alerting
- Async background task support
"""
# import sqlite3  # replaced by SQLAlchemy engine (see app.utils.db_connection)
import pandas as pd
import random
import time
from datetime import datetime
import os
import json
import logging
from functools import wraps
import uuid
from typing import Dict, Any

from sqlalchemy import text
from app.utils.db_connection import get_engine

logger = logging.getLogger(__name__)

# DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')  # SQLite-only, no longer used
KRA_API_ENDPOINT = "https://api.kra.go.ke/icms/v2/invoices"
KRA_API_KEY = "test-api-key-12345"
MAX_RETRIES = 3
BACKOFF_FACTOR = 2
FAILURE_THRESHOLD = 10  # percentage

# ============================================================================
# IN-MEMORY TASK STORE (For Async Demo)
# In production, use Redis or a database table.
# ============================================================================

task_status: Dict[str, Dict[str, Any]] = {}

# ============================================================================
# DATABASE INITIALIZATION (Includes DLQ table)
# ============================================================================

def init_ebilling_tables():
    """Create e-billing tables if they don't exist."""
    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # cursor = conn.cursor()
    #
    # cursor.execute("""
    #     CREATE TABLE IF NOT EXISTS ebilling_sync (
    #         invoice_id TEXT PRIMARY KEY,
    #         status TEXT DEFAULT 'pending',
    #         sync_date TEXT,
    #         error_message TEXT,
    #         retry_count INTEGER DEFAULT 0,
    #         last_attempt TEXT
    #     )
    # """)
    #
    # cursor.execute("""
    #     CREATE TABLE IF NOT EXISTS ebilling_dlq (
    #         invoice_id TEXT PRIMARY KEY,
    #         error_message TEXT,
    #         last_attempt TEXT,
    #         retry_count INTEGER DEFAULT 0,
    #         status TEXT DEFAULT 'pending'
    #     )
    # """)
    #
    # cursor.execute("""
    #     CREATE TABLE IF NOT EXISTS ebilling_webhook_log (
    #         id INTEGER PRIMARY KEY AUTOINCREMENT,
    #         invoice_id TEXT,
    #         payload TEXT,
    #         received_at TEXT
    #     )
    # """)
    #
    # conn.commit()
    # conn.close()

    engine = get_engine()
    is_postgres = engine.dialect.name == "postgresql"
    id_column = "id SERIAL PRIMARY KEY" if is_postgres else "id INTEGER PRIMARY KEY AUTOINCREMENT"

    with engine.begin() as conn:
        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ebilling_sync (
                invoice_id TEXT PRIMARY KEY,
                status TEXT DEFAULT 'pending',
                sync_date TEXT,
                error_message TEXT,
                retry_count INTEGER DEFAULT 0,
                last_attempt TEXT
            )
        """))

        conn.execute(text("""
            CREATE TABLE IF NOT EXISTS ebilling_dlq (
                invoice_id TEXT PRIMARY KEY,
                error_message TEXT,
                last_attempt TEXT,
                retry_count INTEGER DEFAULT 0,
                status TEXT DEFAULT 'pending'
            )
        """))

        conn.execute(text(f"""
            CREATE TABLE IF NOT EXISTS ebilling_webhook_log (
                {id_column},
                invoice_id TEXT,
                payload TEXT,
                received_at TEXT
            )
        """))


# ============================================================================
# RETRY DECORATOR (Circuit Breaker)
# ============================================================================

def retry_on_failure(max_retries=MAX_RETRIES, backoff=BACKOFF_FACTOR):
    def decorator(func):
        @wraps(func)
        def wrapper(*args, **kwargs):
            for attempt in range(max_retries):
                try:
                    return func(*args, **kwargs)
                except Exception as e:
                    if attempt == max_retries - 1:
                        raise
                    wait_time = backoff ** attempt
                    logger.warning(f"Retry {attempt+1}/{max_retries} for {func.__name__} after {wait_time}s")
                    time.sleep(wait_time)
            return None
        return wrapper
    return decorator


# ============================================================================
# KRA API SIMULATION (with retry)
# ============================================================================

@retry_on_failure(max_retries=3, backoff=2)
def call_kra_api(invoice_id: str, payload: dict) -> dict:
    """
    Simulate calling KRA API with retry logic.
    """
    time.sleep(random.uniform(0.2, 0.6))

    rand = random.random()
    if rand < 0.05:  # 5% timeout
        raise TimeoutError("KRA API connection timeout")
    elif rand < 0.08:  # 3% validation error
        raise ValueError("Invalid invoice data: missing KRA PIN")
    elif rand < 0.10:  # 2% internal server error
        raise RuntimeError("KRA internal server error (500)")

    return {
        "status": "success",
        "invoice_id": invoice_id,
        "message": "Invoice successfully synced to KRA iCMS",
        "timestamp": datetime.now().isoformat()
    }


# ============================================================================
# SYNC INVOICES (with DLQ integration)
# ============================================================================

def sync_invoices_to_ebilling(invoice_ids: list = None) -> dict:
    """Sync invoices with retry and DLQ for failures."""
    init_ebilling_tables()
    if invoice_ids is None:
        invoice_ids = get_pending_invoices()

    if not invoice_ids:
        return {
            'status': 'warning',
            'message': 'No pending invoices to sync.',
            'synced': 0,
            'failed': 0,
            'total_processed': 0,
            'failed_ids': [],
            'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }

    synced = []
    failed = []

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # for inv_id in invoice_ids:
    #     payload = {"invoice_id": inv_id, "api_key": KRA_API_KEY}
    #     try:
    #         response = call_kra_api(inv_id, payload)
    #         status = 'synced'
    #         error = None
    #         synced.append(inv_id)
    #     except Exception as e:
    #         status = 'failed'
    #         error = str(e)
    #         failed.append(inv_id)
    #         cursor = conn.cursor()
    #         cursor.execute("""
    #             INSERT OR REPLACE INTO ebilling_dlq (invoice_id, error_message, last_attempt, status)
    #             VALUES (?, ?, ?, ?)
    #         """, (inv_id, error, datetime.now().isoformat(), 'pending'))
    #         conn.commit()
    #     now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    #     cursor = conn.cursor()
    #     cursor.execute("""
    #         INSERT OR REPLACE INTO ebilling_sync
    #         (invoice_id, status, sync_date, error_message, last_attempt)
    #         VALUES (?, ?, ?, ?, ?)
    #     """, (inv_id, status, now if status == 'synced' else None, error, now))
    #     conn.commit()
    # conn.close()

    engine = get_engine()
    for inv_id in invoice_ids:
        payload = {"invoice_id": inv_id, "api_key": KRA_API_KEY}

        try:
            response = call_kra_api(inv_id, payload)
            status = 'synced'
            error = None
            synced.append(inv_id)
        except Exception as e:
            status = 'failed'
            error = str(e)
            failed.append(inv_id)
            with engine.begin() as conn:
                conn.execute(text("""
                    INSERT INTO ebilling_dlq (invoice_id, error_message, last_attempt, status)
                    VALUES (:invoice_id, :error_message, :last_attempt, :status)
                    ON CONFLICT (invoice_id) DO UPDATE SET
                        error_message = EXCLUDED.error_message,
                        last_attempt = EXCLUDED.last_attempt,
                        status = EXCLUDED.status
                """), {
                    "invoice_id": inv_id,
                    "error_message": error,
                    "last_attempt": datetime.now().isoformat(),
                    "status": "pending"
                })

        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        with engine.begin() as conn:
            conn.execute(text("""
                INSERT INTO ebilling_sync (invoice_id, status, sync_date, error_message, last_attempt)
                VALUES (:invoice_id, :status, :sync_date, :error_message, :last_attempt)
                ON CONFLICT (invoice_id) DO UPDATE SET
                    status = EXCLUDED.status,
                    sync_date = EXCLUDED.sync_date,
                    error_message = EXCLUDED.error_message,
                    last_attempt = EXCLUDED.last_attempt
            """), {
                "invoice_id": inv_id,
                "status": status,
                "sync_date": now if status == 'synced' else None,
                "error_message": error,
                "last_attempt": now
            })

    return {
        'status': 'success' if synced else 'error' if failed else 'warning',
        'message': f'Successfully synced {len(synced)} invoices, {len(failed)} failed.',
        'synced': len(synced),
        'failed': len(failed),
        'total_processed': len(invoice_ids),
        'failed_ids': failed,
        'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


# ============================================================================
# ASYNC TASK WRAPPER
# ============================================================================

def run_sync_task(task_id: str, invoice_ids: list = None):
    """
    Background task wrapper for sync_invoices_to_ebilling.
    Updates task_status with progress/result.
    """
    task_status[task_id] = {
        "status": "running",
        "progress": 0,
        "result": None,
        "error": None,
        "started_at": datetime.now().isoformat()
    }

    try:
        result = sync_invoices_to_ebilling(invoice_ids)
        task_status[task_id].update({
            "status": "completed",
            "progress": 100,
            "result": result,
            "completed_at": datetime.now().isoformat()
        })
    except Exception as e:
        task_status[task_id].update({
            "status": "failed",
            "error": str(e),
            "completed_at": datetime.now().isoformat()
        })


def get_task_status(task_id: str) -> dict:
    """Retrieve the status of a background task."""
    return task_status.get(task_id, {"status": "not_found"})


# ============================================================================
# LEGACY FUNCTIONS
# ============================================================================

def sync_anomalies_to_ebilling(anomalies: list) -> dict:
    invoice_ids = [a.get('invoice_id') for a in anomalies if a.get('invoice_id')]
    return sync_invoices_to_ebilling(invoice_ids)


def update_anomaly_status(dispatch_id: str, status: str, notes: str = '') -> dict:
    return {
        'status': 'success',
        'message': f'Anomaly {dispatch_id} updated to {status}',
        'dispatch_id': dispatch_id,
        'new_status': status,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_pending_invoices() -> list:
    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # query = """
    #     SELECT i.invoice_id
    #     FROM invoices i
    #     LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
    #     WHERE e.status IS NULL OR e.status != 'synced'
    # """
    # df = pd.read_sql(query, conn)
    # conn.close()
    # return df['invoice_id'].tolist() if not df.empty else []

    engine = get_engine()
    query = """
        SELECT i.invoice_id
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
    """
    df = pd.read_sql(query, engine)
    return df['invoice_id'].tolist() if not df.empty else []


def get_ebilling_status() -> dict:
    init_ebilling_tables()

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # total_invoices = int(pd.read_sql("SELECT COUNT(*) as count FROM invoices", conn).iloc[0]['count'])
    # ...
    # conn.close()

    engine = get_engine()
    total_invoices = int(pd.read_sql("SELECT COUNT(*) as count FROM invoices", engine).iloc[0]['count'])
    query = "SELECT status, COUNT(*) as count FROM ebilling_sync GROUP BY status"
    df = pd.read_sql(query, engine)
    status_counts = {row['status']: int(row['count']) for _, row in df.iterrows()}

    pending = int(status_counts.get('pending', 0))
    synced = int(status_counts.get('synced', 0))
    failed = int(status_counts.get('failed', 0))

    last_sync_query = "SELECT MAX(sync_date) as last_sync FROM ebilling_sync WHERE status = 'synced'"
    last_sync_df = pd.read_sql(last_sync_query, engine)
    last_sync = last_sync_df.iloc[0]['last_sync'] if not last_sync_df.empty else None

    not_attempted = int(total_invoices - (pending + synced + failed))

    return {
        'system': 'KRA iCMS (Simulated)',
        'connected': True,
        'last_sync': last_sync,
        'total_invoices': total_invoices,
        'synced_count': synced,
        'pending_count': pending,
        'failed_count': failed,
        'not_attempted': not_attempted,
        'api_endpoint': KRA_API_ENDPOINT,
        'response_time_ms': random.randint(120, 800)
    }


def get_ebilling_sync_logs(limit: int = 50) -> list:
    init_ebilling_tables()

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # query = """
    #     SELECT e.*, i.customer_name, i.value_kes
    #     FROM ebilling_sync e
    #     LEFT JOIN invoices i ON e.invoice_id = i.invoice_id
    #     ORDER BY e.last_attempt DESC
    #     LIMIT ?
    # """
    # df = pd.read_sql(query, conn, params=(limit,))
    # conn.close()

    engine = get_engine()
    query = text("""
        SELECT e.*, i.customer_name, i.value_kes
        FROM ebilling_sync e
        LEFT JOIN invoices i ON e.invoice_id = i.invoice_id
        ORDER BY e.last_attempt DESC
        LIMIT :limit
    """)
    df = pd.read_sql(query, engine, params={"limit": limit})
    if df.empty:
        return []
    records = df.to_dict(orient='records')
    for rec in records:
        for key, val in rec.items():
            if isinstance(val, (pd.Int64Dtype, int)):
                rec[key] = int(val)
    return records


def retry_failed_sync(invoice_id: str) -> dict:
    init_ebilling_tables()

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # cursor = conn.cursor()
    # cursor.execute("SELECT status, retry_count FROM ebilling_sync WHERE invoice_id = ?", (invoice_id,))
    # row = cursor.fetchone()
    # conn.close()

    engine = get_engine()
    with engine.connect() as conn:
        row = conn.execute(
            text("SELECT status, retry_count FROM ebilling_sync WHERE invoice_id = :invoice_id"),
            {"invoice_id": invoice_id}
        ).fetchone()

    if not row:
        return {'status': 'error', 'message': f'Invoice {invoice_id} not found in sync table.'}
    status, retry_count = row
    if status != 'failed':
        return {'status': 'warning', 'message': f'Invoice {invoice_id} is not in failed state (current: {status}).'}

    result = sync_invoices_to_ebilling([invoice_id])

    return {
        'status': 'success' if result['synced'] == 1 else 'failed',
        'message': f'Retry for {invoice_id}: {result["message"]}',
        'invoice_id': invoice_id,
        'new_status': 'synced' if result['synced'] == 1 else 'failed',
        'retry_count': retry_count + 1,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def handle_webhook(payload: dict) -> dict:
    init_ebilling_tables()
    invoice_id = payload.get('invoice_id')
    status = payload.get('status')
    message = payload.get('message', '')

    if not invoice_id:
        return {'status': 'error', 'message': 'Missing invoice_id in webhook payload'}

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # cursor = conn.cursor()
    # cursor.execute("""
    #     INSERT INTO ebilling_webhook_log (invoice_id, payload, received_at)
    #     VALUES (?, ?, ?)
    # """, (invoice_id, json.dumps(payload), datetime.now().isoformat()))
    # conn.commit()
    # conn.close()
    # if status in ['synced', 'failed']:
    #     conn = sqlite3.connect(DB_PATH)
    #     cursor = conn.cursor()
    #     cursor.execute("""
    #         UPDATE ebilling_sync
    #         SET status = ?, error_message = ?, sync_date = ?
    #         WHERE invoice_id = ?
    #     """, (status, message, datetime.now().isoformat(), invoice_id))
    #     conn.commit()
    #     conn.close()

    engine = get_engine()
    with engine.begin() as conn:
        conn.execute(text("""
            INSERT INTO ebilling_webhook_log (invoice_id, payload, received_at)
            VALUES (:invoice_id, :payload, :received_at)
        """), {
            "invoice_id": invoice_id,
            "payload": json.dumps(payload),
            "received_at": datetime.now().isoformat()
        })

    if status in ['synced', 'failed']:
        with engine.begin() as conn:
            conn.execute(text("""
                UPDATE ebilling_sync
                SET status = :status, error_message = :error_message, sync_date = :sync_date
                WHERE invoice_id = :invoice_id
            """), {
                "status": status,
                "error_message": message,
                "sync_date": datetime.now().isoformat(),
                "invoice_id": invoice_id
            })

    return {
        'status': 'success',
        'message': f'Webhook processed for invoice {invoice_id}',
        'invoice_id': invoice_id,
        'new_status': status
    }


def get_ebilling_reconciliation() -> dict:
    init_ebilling_tables()

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # total_invoices = int(pd.read_sql("SELECT COUNT(*) as count FROM invoices", conn).iloc[0]['count'])
    # ...
    # conn.close()

    engine = get_engine()
    total_invoices = int(pd.read_sql("SELECT COUNT(*) as count FROM invoices", engine).iloc[0]['count'])
    synced = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'synced'", engine).iloc[0]['count'])
    pending_query = """
        SELECT COUNT(*) as count FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
    """
    pending = int(pd.read_sql(pending_query, engine).iloc[0]['count'])
    failed = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'failed'", engine).iloc[0]['count'])
    dlq = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_dlq", engine).iloc[0]['count'])
    sync_rate = round((synced / total_invoices * 100), 2) if total_invoices > 0 else 0

    return {
        'total_invoices': total_invoices,
        'synced': synced,
        'pending': pending,
        'failed': failed,
        'dlq_count': dlq,
        'reconciliation_rate': sync_rate,
        'status': 'healthy' if sync_rate >= 90 else 'warning' if sync_rate >= 70 else 'critical'
    }


def check_failure_rate() -> dict:
    init_ebilling_tables()

    # --- Old SQLite-only version (kept for reference) ---
    # conn = sqlite3.connect(DB_PATH)
    # total = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync", conn).iloc[0]['count'])
    # failed = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'failed'", conn).iloc[0]['count'])
    # conn.close()

    engine = get_engine()
    total = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync", engine).iloc[0]['count'])
    failed = int(pd.read_sql("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'failed'", engine).iloc[0]['count'])
    if total == 0:
        return {'failure_rate': 0, 'alert': False, 'message': 'No sync attempts recorded'}
    rate = round((failed / total) * 100, 2)
    alert = rate > FAILURE_THRESHOLD
    return {
        'failure_rate': rate,
        'alert': alert,
        'threshold': FAILURE_THRESHOLD,
        'message': f'Failure rate {rate}% - {"⚠️ ALERT" if alert else "✅ Normal"}'
    }
