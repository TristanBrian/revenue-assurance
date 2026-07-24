"""
Enhanced E-Billing Integration Service (Problem #8)
Enterprise-grade features:
- Retry with exponential backoff
- Dead Letter Queue (DLQ)
- Webhook callbacks
- Reconciliation dashboard
- Monitoring & alerting
- Async background task support
- Optimized pagination with caching
- Granular progress tracking for frontend
- Production-ready for 40,000+ rows
"""
import pandas as pd
import random
import time
from datetime import datetime
import os
import json
import logging
from functools import wraps
import uuid
from typing import Dict, Any, Optional, List
from sqlalchemy import text
from sqlalchemy.orm import Session
from app.utils.db_connection import get_engine, SessionLocal
from app.models.anomaly_resolution import AnomalyResolution
from app.services.audit_service import log_action

logger = logging.getLogger(__name__)

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
# CACHED TOTAL COUNT (Performance Optimization)
# ============================================================================

_cached_total_count = None
_cached_total_count_time = None
CACHE_TTL_SECONDS = 60  # Refresh every 60 seconds

def get_cached_total_count() -> int:
    """Get cached total count of ebilling_sync records."""
    global _cached_total_count, _cached_total_count_time
    
    now = time.time()
    if (_cached_total_count is not None and 
        _cached_total_count_time is not None and 
        now - _cached_total_count_time < CACHE_TTL_SECONDS):
        return _cached_total_count
    
    # Cache miss – run the query
    engine = get_engine()
    try:
        # Fast count using index
        query = text("SELECT COUNT(*) as count FROM ebilling_sync")
        with engine.connect() as conn:
            result = conn.execute(query).fetchone()
            _cached_total_count = int(result[0])
            _cached_total_count_time = now
            return _cached_total_count
    except Exception as e:
        logger.warning(f"Failed to get total count: {e}")
        # Fallback: try a simpler count
        query = text("SELECT COUNT(invoice_id) as count FROM ebilling_sync")
        with engine.connect() as conn:
            result = conn.execute(query).fetchone()
            _cached_total_count = int(result[0])
            _cached_total_count_time = now
            return _cached_total_count


def invalidate_total_count_cache():
    """Force cache refresh (call after sync operations)."""
    global _cached_total_count, _cached_total_count_time
    _cached_total_count = None
    _cached_total_count_time = None


# ============================================================================
# DATABASE INITIALIZATION
# ============================================================================

def init_ebilling_tables():
    """Create e-billing tables if they don't exist."""
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

def sync_invoices_to_ebilling(invoice_ids: Optional[List[str]] = None) -> dict:
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
    engine = get_engine()

    for inv_id in invoice_ids:
        payload = {"invoice_id": inv_id, "api_key": KRA_API_KEY}

        try:
            call_kra_api(inv_id, payload)
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

    # Invalidate cache after sync
    invalidate_total_count_cache()

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
# ASYNC TASK WRAPPER (with Granular Progress)
# ============================================================================

def run_sync_task(task_id: str, invoice_ids: Optional[List[str]] = None):
    """
    Background task wrapper for sync_invoices_to_ebilling.
    Updates task_status with granular progress for frontend.
    """
    # Get all pending invoices if none provided
    if invoice_ids is None:
        invoice_ids = get_pending_invoices()
    
    total = len(invoice_ids)
    
    task_status[task_id] = {
        "status": "running",
        "progress": 0,
        "result": None,
        "error": None,
        "started_at": datetime.now().isoformat(),
        "total": total,
        "synced_so_far": 0,
        "failed_so_far": 0
    }

    if total == 0:
        task_status[task_id].update({
            "status": "completed",
            "progress": 100,
            "result": {
                'status': 'warning',
                'message': 'No pending invoices to sync.',
                'synced': 0,
                'failed': 0,
                'total_processed': 0,
                'failed_ids': [],
                'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
            },
            "completed_at": datetime.now().isoformat()
        })
        return

    try:
        # Process in batches for progress updates
        batch_size = 50
        all_synced = []
        all_failed = []
        
        for i in range(0, total, batch_size):
            batch = invoice_ids[i:i+batch_size]
            result = sync_invoices_to_ebilling(batch)
            
            # Track progress
            batch_failed = result.get('failed_ids', [])
            batch_synced = [inv for inv in batch if inv not in batch_failed]
            
            all_synced.extend(batch_synced)
            all_failed.extend(batch_failed)
            
            # Update progress
            processed = min(total, i + len(batch))
            progress = int((processed / total) * 100)
            
            task_status[task_id].update({
                "progress": progress,
                "synced_so_far": len(all_synced),
                "failed_so_far": len(all_failed)
            })
            
            logger.info(f"Task {task_id}: {progress}% complete ({len(all_synced)} synced, {len(all_failed)} failed)")
        
        # Final result
        final_result = {
            'status': 'success' if all_synced else 'error' if all_failed else 'warning',
            'message': f'Successfully synced {len(all_synced)} invoices, {len(all_failed)} failed.',
            'synced': len(all_synced),
            'failed': len(all_failed),
            'total_processed': total,
            'failed_ids': all_failed,
            'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        }
        
        task_status[task_id].update({
            "status": "completed",
            "progress": 100,
            "result": final_result,
            "completed_at": datetime.now().isoformat()
        })
        
    except Exception as e:
        logger.error(f"Task {task_id} failed: {e}")
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


def update_anomaly_status(db: Session, dispatch_id: str, status: str, notes: str = '', actor_user_id=None) -> dict:
    """
    Persists resolution status via the ORM, unlike the rest of this file's
    raw engine/text() upserts — this is a single-record CRUD by primary
    key, not a bulk sync operation, so the ORM is a more natural fit here.

    Takes the caller's request-scoped session (routes/reconcile.py's
    Depends(get_db)) instead of opening its own SessionLocal(), and a
    single db.commit() covers both the AnomalyResolution write and the
    audit_service.log_action() call below — so the audit entry is atomic
    with the resolution it's recording, not a separate transaction that
    could persist (or vanish) independently of it.
    """
    resolution = db.query(AnomalyResolution).filter(AnomalyResolution.dispatch_id == dispatch_id).first()
    if resolution:
        before_status = resolution.status
        resolution.status = status
        resolution.notes = notes
    else:
        before_status = None
        resolution = AnomalyResolution(dispatch_id=dispatch_id, status=status, notes=notes)
        db.add(resolution)

    log_action(
        db,
        actor_user_id=actor_user_id,
        action="anomaly.resolve",
        target_type="dispatch",
        target_id=dispatch_id,
        before={"status": before_status},
        after={"status": status, "notes": notes},
    )
    db.commit()

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

def get_pending_invoices() -> List[str]:
    """Get list of pending invoice IDs (capped at 1000 for performance)."""
    engine = get_engine()
    query = text("""
        SELECT i.invoice_id
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
        LIMIT 1000
    """)
    with engine.connect() as conn:
        result = conn.execute(query)
        return [row[0] for row in result]


def get_pending_invoices_count() -> int:
    """Get total count of pending invoices."""
    engine = get_engine()
    query = text("""
        SELECT COUNT(*) as count
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
    """)
    with engine.connect() as conn:
        return int(conn.execute(query).fetchone()[0])


def get_ebilling_status() -> dict:
    """Get integration status and sync metrics."""
    init_ebilling_tables()
    engine = get_engine()
    
    with engine.connect() as conn:
        total_invoices = int(conn.execute(text("SELECT COUNT(*) as count FROM invoices")).fetchone()[0])
        
        # Get sync status counts
        status_query = text("SELECT status, COUNT(*) as count FROM ebilling_sync GROUP BY status")
        status_rows = conn.execute(status_query).fetchall()
        status_counts = {row[0]: int(row[1]) for row in status_rows}

        pending = int(status_counts.get('pending', 0))
        synced = int(status_counts.get('synced', 0))
        failed = int(status_counts.get('failed', 0))

        last_sync = conn.execute(
            text("SELECT MAX(sync_date) as last_sync FROM ebilling_sync WHERE status = 'synced'")
        ).fetchone()[0]

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


def get_ebilling_sync_logs(limit: int = 50) -> List[dict]:
    """Get recent sync logs (capped at 100)."""
    init_ebilling_tables()
    engine = get_engine()
    
    if limit > 100:
        limit = 100  # Cap for performance
    
    query = text("""
        SELECT e.*, i.customer_name, i.value_kes
        FROM ebilling_sync e
        LEFT JOIN invoices i ON e.invoice_id = i.invoice_id
        ORDER BY e.last_attempt DESC
        LIMIT :limit
    """)
    
    with engine.connect() as conn:
        result = conn.execute(query, {"limit": limit})
        records = []
        for row in result:
            rec = dict(row._mapping)
            # Convert any pandas/numpy types
            for key, val in rec.items():
                if isinstance(val, (pd.Int64Dtype, int)):
                    rec[key] = int(val)
            records.append(rec)
        return records


# ============================================================================
# PAGINATED FUNCTIONS (OPTIMIZED FOR PRODUCTION)
# ============================================================================

def get_ebilling_sync_logs_paginated(page: int = 1, page_size: int = 20) -> dict:
    """
    Get paginated sync logs – FAST VERSION with cached total count.
    Production-ready for 40,000+ rows.
    """
    init_ebilling_tables()
    offset = (page - 1) * page_size
    engine = get_engine()

    # Use cached total count
    try:
        total = get_cached_total_count()
    except Exception as e:
        logger.error(f"Failed to get total count: {e}")
        total = 0

    # Optimized query with LIMIT/OFFSET
    query = text("""
        SELECT 
            e.invoice_id,
            e.status,
            e.sync_date,
            e.error_message,
            e.retry_count,
            e.last_attempt,
            i.customer_name,
            i.value_kes
        FROM ebilling_sync e
        LEFT JOIN invoices i ON e.invoice_id = i.invoice_id
        ORDER BY e.last_attempt DESC
        LIMIT :page_size OFFSET :offset
    """)
    
    try:
        with engine.connect() as conn:
            result = conn.execute(query, {"page_size": page_size, "offset": offset})
            records = []
            for row in result:
                rec = dict(row._mapping)
                # Convert numpy types to Python native
                for key, val in rec.items():
                    if isinstance(val, (pd.Int64Dtype, int, float)):
                        rec[key] = int(val) if isinstance(val, (int, float)) else val
                records.append(rec)
    except Exception as e:
        logger.error(f"Failed to get paginated logs: {e}")
        records = []

    # Pagination metadata
    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    
    return {
        'data': records,
        'pagination': {
            'page': page,
            'page_size': page_size,
            'total': total,
            'total_pages': total_pages,
            'has_next': page * page_size < total,
            'has_prev': page > 1
        }
    }


def get_pending_invoices_paginated(page: int = 1, page_size: int = 20) -> dict:
    """
    Get paginated list of pending invoices with details – FAST VERSION.
    Production-ready for 40,000+ rows.
    """
    init_ebilling_tables()
    offset = (page - 1) * page_size
    engine = get_engine()

    # Fast count query
    query_count = text("""
        SELECT COUNT(*) as count
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
    """)
    
    try:
        with engine.connect() as conn:
            total = int(conn.execute(query_count).fetchone()[0])
    except Exception as e:
        logger.error(f"Failed to get pending count: {e}")
        total = 0

    # Fast paginated query
    query = text("""
        SELECT 
            i.invoice_id, 
            i.customer_name, 
            i.value_kes, 
            i.date,
            e.status,
            e.retry_count
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
        ORDER BY i.date DESC
        LIMIT :page_size OFFSET :offset
    """)
    
    try:
        with engine.connect() as conn:
            result = conn.execute(query, {"page_size": page_size, "offset": offset})
            records = []
            for row in result:
                rec = dict(row._mapping)
                for key, val in rec.items():
                    if isinstance(val, (pd.Int64Dtype, int, float)):
                        rec[key] = int(val) if isinstance(val, (int, float)) else val
                records.append(rec)
    except Exception as e:
        logger.error(f"Failed to get pending invoices: {e}")
        records = []

    total_pages = (total + page_size - 1) // page_size if total > 0 else 1
    
    return {
        'data': records,
        'pagination': {
            'page': page,
            'page_size': page_size,
            'total': total,
            'total_pages': total_pages,
            'has_next': page * page_size < total,
            'has_prev': page > 1
        }
    }


# ============================================================================
# RETRY FAILED SYNC
# ============================================================================

def retry_failed_sync(invoice_id: str) -> dict:
    """Retry a specific failed invoice sync."""
    init_ebilling_tables()
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


# ============================================================================
# WEBHOOK HANDLER
# ============================================================================

def handle_webhook(payload: dict) -> dict:
    """Process webhook from KRA."""
    init_ebilling_tables()
    invoice_id = payload.get('invoice_id')
    status = payload.get('status')
    message = payload.get('message', '')

    if not invoice_id:
        return {'status': 'error', 'message': 'Missing invoice_id in webhook payload'}

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


# ============================================================================
# RECONCILIATION DASHBOARD & MONITORING
# ============================================================================

def get_ebilling_reconciliation() -> dict:
    """Get reconciliation dashboard data."""
    init_ebilling_tables()
    engine = get_engine()
    
    with engine.connect() as conn:
        total_invoices = int(conn.execute(text("SELECT COUNT(*) as count FROM invoices")).fetchone()[0])
        synced = int(conn.execute(text("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'synced'")).fetchone()[0])
        
        pending_query = text("""
            SELECT COUNT(*) as count FROM invoices i
            LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
            WHERE e.status IS NULL OR e.status != 'synced'
        """)
        pending = int(conn.execute(pending_query).fetchone()[0])
        
        failed = int(conn.execute(text("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'failed'")).fetchone()[0])
        dlq = int(conn.execute(text("SELECT COUNT(*) as count FROM ebilling_dlq")).fetchone()[0])
    
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
    """Check failure rate and trigger alert if above threshold."""
    init_ebilling_tables()
    engine = get_engine()
    
    with engine.connect() as conn:
        total = int(conn.execute(text("SELECT COUNT(*) as count FROM ebilling_sync")).fetchone()[0])
        failed = int(conn.execute(text("SELECT COUNT(*) as count FROM ebilling_sync WHERE status = 'failed'")).fetchone()[0])
    
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