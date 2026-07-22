"""
Enhanced E-Billing Integration Service (Problem #8)
Includes legacy functions for reconcile.py compatibility.
"""
import sqlite3
import pandas as pd
import random
import time
from datetime import datetime
import os
import json
import logging

logger = logging.getLogger(__name__)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(__file__))), 'kpc.db')
KRA_API_ENDPOINT = "https://api.kra.go.ke/icms/v2/invoices"
KRA_API_KEY = "test-api-key-12345"


# ============================================================================
# LEGACY FUNCTIONS (for reconcile.py compatibility)
# ============================================================================

def sync_anomalies_to_ebilling(anomalies: list) -> dict:
    """Legacy: sync anomalies (list of dicts) to E-Billing."""
    if not anomalies:
        return {
            'status': 'warning',
            'message': 'No anomalies to sync',
            'synced_count': 0,
            'failed_count': 0,
            'total_processed': 0,
            'failed_ids': []
        }

    synced = []
    failed = []
    for anomaly in anomalies:
        if random.random() < 0.05:
            failed.append(anomaly['dispatch_id'])
            anomaly['ebilling_status'] = 'Failed'
        else:
            synced.append(anomaly['dispatch_id'])
            anomaly['ebilling_status'] = 'Synced'
            anomaly['ebilling_sync_date'] = datetime.now().strftime('%Y-%m-%d %H:%M:%S')

    return {
        'status': 'success' if synced else 'error',
        'message': f'Successfully synced {len(synced)} anomalies to E-Billing system',
        'synced_count': len(synced),
        'failed_count': len(failed),
        'total_processed': len(anomalies),
        'failed_ids': failed,
        'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def update_anomaly_status(dispatch_id: str, status: str, notes: str = '') -> dict:
    """Legacy: update anomaly status."""
    return {
        'status': 'success',
        'message': f'Anomaly {dispatch_id} updated to {status}',
        'dispatch_id': dispatch_id,
        'new_status': status,
        'timestamp': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


# ============================================================================
# NEW ENHANCED E-BILLING FUNCTIONS
# ============================================================================

def init_ebilling_table():
    """Create e-billing sync status table if it doesn't exist."""
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("""
        CREATE TABLE IF NOT EXISTS ebilling_sync (
            invoice_id TEXT PRIMARY KEY,
            status TEXT DEFAULT 'pending',
            sync_date TEXT,
            error_message TEXT,
            retry_count INTEGER DEFAULT 0,
            last_attempt TEXT
        )
    """)
    conn.commit()
    conn.close()


def get_pending_invoices() -> list:
    """Return list of invoice IDs that haven't been synced successfully."""
    conn = sqlite3.connect(DB_PATH)
    query = """
        SELECT i.invoice_id 
        FROM invoices i
        LEFT JOIN ebilling_sync e ON i.invoice_id = e.invoice_id
        WHERE e.status IS NULL OR e.status != 'synced'
    """
    df = pd.read_sql(query, conn)
    conn.close()
    return df['invoice_id'].tolist() if not df.empty else []


def sync_invoices_to_ebilling(invoice_ids: list = None) -> dict:
    """Simulate syncing invoices to KRA iCMS."""
    init_ebilling_table()
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
    conn = sqlite3.connect(DB_PATH)
    for inv_id in invoice_ids:
        time.sleep(random.uniform(0.1, 0.5))
        rand = random.random()
        if rand < 0.05:
            error = "Connection timeout"
            status = 'failed'
            failed.append(inv_id)
        elif rand < 0.10:
            error = "Invalid invoice data (missing KRA PIN)"
            status = 'failed'
            failed.append(inv_id)
        else:
            error = None
            status = 'synced'
            synced.append(inv_id)
        now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
        cursor = conn.cursor()
        cursor.execute("""
            INSERT OR REPLACE INTO ebilling_sync 
            (invoice_id, status, sync_date, error_message, last_attempt)
            VALUES (?, ?, ?, ?, ?)
        """, (inv_id, status, now, error, now))
        conn.commit()
    conn.close()
    return {
        'status': 'success' if synced else 'error' if failed else 'warning',
        'message': f'Successfully synced {len(synced)} invoices, {len(failed)} failed.',
        'synced': len(synced),
        'failed': len(failed),
        'total_processed': len(invoice_ids),
        'failed_ids': failed,
        'sync_time': datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    }


def get_ebilling_status() -> dict:
    """Get integration status and sync metrics."""
    init_ebilling_table()
    conn = sqlite3.connect(DB_PATH)
    
    # ✅ Convert numpy.int64 to Python int explicitly
    total_invoices = int(pd.read_sql("SELECT COUNT(*) as count FROM invoices", conn).iloc[0]['count'])
    
    query = "SELECT status, COUNT(*) as count FROM ebilling_sync GROUP BY status"
    df = pd.read_sql(query, conn)
    status_counts = {row['status']: int(row['count']) for _, row in df.iterrows()}
    
    pending = int(status_counts.get('pending', 0))
    synced = int(status_counts.get('synced', 0))
    failed = int(status_counts.get('failed', 0))
    
    last_sync_query = "SELECT MAX(sync_date) as last_sync FROM ebilling_sync WHERE status = 'synced'"
    last_sync_df = pd.read_sql(last_sync_query, conn)
    last_sync = last_sync_df.iloc[0]['last_sync'] if not last_sync_df.empty else None
    
    not_attempted = int(total_invoices - (pending + synced + failed))
    conn.close()
    
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
    """Return recent e-billing sync logs."""
    init_ebilling_table()
    conn = sqlite3.connect(DB_PATH)
    query = """
        SELECT e.*, i.customer_name, i.value_kes
        FROM ebilling_sync e
        LEFT JOIN invoices i ON e.invoice_id = i.invoice_id
        ORDER BY e.last_attempt DESC
        LIMIT ?
    """
    df = pd.read_sql(query, conn, params=(limit,))
    conn.close()
    if df.empty:
        return []
    # Convert all numpy types to Python native types
    records = df.to_dict(orient='records')
    for rec in records:
        for key, val in rec.items():
            if isinstance(val, (np.int64, np.int32)):
                rec[key] = int(val)
            elif isinstance(val, (np.float64, np.float32)):
                rec[key] = float(val)
    return records


def retry_failed_sync(invoice_id: str) -> dict:
    """Retry a specific failed invoice sync."""
    init_ebilling_table()
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT status, retry_count FROM ebilling_sync WHERE invoice_id = ?", (invoice_id,))
    row = cursor.fetchone()
    if not row:
        conn.close()
        return {'status': 'error', 'message': f'Invoice {invoice_id} not found in sync table.'}
    status, retry_count = row
    if status != 'failed':
        conn.close()
        return {'status': 'warning', 'message': f'Invoice {invoice_id} is not in failed state (current: {status}).'}
    time.sleep(0.3)
    rand = random.random()
    if rand < 0.08:
        new_status = 'failed'
        error = "Retry failed: KRA system temporarily unavailable"
    else:
        new_status = 'synced'
        error = None
    now = datetime.now().strftime('%Y-%m-%d %H:%M:%S')
    cursor.execute("""
        UPDATE ebilling_sync 
        SET status = ?, sync_date = ?, error_message = ?, retry_count = retry_count + 1, last_attempt = ?
        WHERE invoice_id = ?
    """, (new_status, now if new_status == 'synced' else None, error, now, invoice_id))
    conn.commit()
    conn.close()
    return {
        'status': 'success' if new_status == 'synced' else 'failed',
        'message': f'Retry for {invoice_id}: {new_status}.',
        'invoice_id': invoice_id,
        'new_status': new_status,
        'retry_count': int(retry_count) + 1,
        'timestamp': now
    }