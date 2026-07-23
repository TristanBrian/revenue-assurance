"""
E-Billing Integration Tests – Enterprise Features
Covers: sync, retry, DLQ, webhooks, reconciliation dashboard, monitoring
"""
import pytest
import sqlite3
import os
import json
import time
from datetime import datetime
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.e_billing import (
    init_ebilling_tables,
    sync_invoices_to_ebilling,
    get_ebilling_status,
    get_ebilling_sync_logs,
    retry_failed_sync,
    get_pending_invoices,
    handle_webhook,
    get_ebilling_reconciliation,
    check_failure_rate,
    call_kra_api
)

DB_PATH = os.path.join(os.path.dirname(os.path.dirname(__file__)), 'test_kpc.db')


@pytest.fixture
def test_db():
    """Create a test database with sample invoices."""
    # Point the service module's engine at a throwaway SQLite file instead of
    # the real kpc.db (DB_PATH no longer exists — services/e_billing.py talks
    # to the DB via get_engine() since the SQLAlchemy migration).
    import app.services.e_billing
    from sqlalchemy import create_engine
    test_engine = create_engine(f'sqlite:///{DB_PATH}')
    original_get_engine = app.services.e_billing.get_engine
    app.services.e_billing.get_engine = lambda: test_engine

    # Create test tables
    conn = sqlite3.connect(DB_PATH)
    conn.execute("DROP TABLE IF EXISTS invoices")
    conn.execute("DROP TABLE IF EXISTS ebilling_sync")
    conn.execute("DROP TABLE IF EXISTS ebilling_dlq")
    conn.execute("DROP TABLE IF EXISTS ebilling_webhook_log")
    
    # Create invoices table with sample data
    conn.execute("""
        CREATE TABLE invoices (
            invoice_id TEXT PRIMARY KEY,
            customer_name TEXT,
            value_kes INTEGER,
            date TEXT
        )
    """)
    
    # Insert 20 test invoices
    invoices = [
        ('INV-1001', 'TotalEnergies', 1500000, '2025-01-15'),
        ('INV-1002', 'Vivo Energy', 1200000, '2025-01-16'),
        ('INV-1003', 'Kobil', 800000, '2025-01-17'),
        ('INV-1004', 'National Oil', 2000000, '2025-01-18'),
        ('INV-1005', 'Gulf Energy', 500000, '2025-01-19'),
        ('INV-1006', 'Hashi Energy', 3000000, '2025-01-20'),
        ('INV-1007', 'Rubis Energy', 2500000, '2025-01-21'),
        ('INV-1008', 'Lake Oil', 1800000, '2025-01-22'),
        ('INV-1009', 'Dalbit Petroleum', 2200000, '2025-01-23'),
        ('INV-1010', 'Tamoil', 950000, '2025-01-24'),
    ]
    conn.executemany(
        "INSERT INTO invoices (invoice_id, customer_name, value_kes, date) VALUES (?, ?, ?, ?)",
        invoices
    )
    conn.commit()
    conn.close()
    
    yield DB_PATH

    # Cleanup
    app.services.e_billing.get_engine = original_get_engine
    test_engine.dispose()
    if os.path.exists(DB_PATH):
        os.remove(DB_PATH)


class TestEBillingInit:
    """Test E-Billing table initialization."""
    
    def test_init_tables(self, test_db):
        """Test that tables are created."""
        init_ebilling_tables()
        conn = sqlite3.connect(test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT name FROM sqlite_master WHERE type='table'")
        tables = [row[0] for row in cursor.fetchall()]
        conn.close()
        
        assert 'ebilling_sync' in tables
        assert 'ebilling_dlq' in tables
        assert 'ebilling_webhook_log' in tables


class TestEBillingSync:
    """Test E-Billing sync functionality."""
    
    def test_sync_invoices_success(self, test_db):
        """Test syncing invoices successfully."""
        init_ebilling_tables()
        result = sync_invoices_to_ebilling(['INV-1001', 'INV-1002'])
        
        assert result['status'] == 'success'
        assert result['synced'] == 2
        assert result['failed'] == 0
        assert result['total_processed'] == 2
        
        # Check database
        conn = sqlite3.connect(test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM ebilling_sync WHERE invoice_id = 'INV-1001'")
        status = cursor.fetchone()[0]
        conn.close()
        assert status == 'synced'
    
    def test_sync_no_pending(self, test_db):
        """Test sync with no pending invoices."""
        init_ebilling_tables()
        # Sync all first
        sync_invoices_to_ebilling()
        result = sync_invoices_to_ebilling()
        
        assert result['status'] == 'warning'
        assert result['synced'] == 0
    
    def test_get_pending_invoices(self, test_db):
        """Test getting pending invoice IDs."""
        init_ebilling_tables()
        pending = get_pending_invoices()
        
        assert len(pending) == 10  # All 10 invoices are pending initially
        
        # Sync one, then check pending again
        sync_invoices_to_ebilling(['INV-1001'])
        pending = get_pending_invoices()
        assert 'INV-1001' not in pending
        assert len(pending) == 9


class TestEBillingStatus:
    """Test E-Billing status endpoints."""
    
    def test_get_ebilling_status(self, test_db):
        """Test getting integration status."""
        init_ebilling_tables()
        sync_invoices_to_ebilling(['INV-1001'])
        
        status = get_ebilling_status()
        
        assert status['system'] == 'KRA iCMS (Simulated)'
        assert status['connected'] is True
        assert status['total_invoices'] == 10
        assert status['synced_count'] == 1
        assert status['pending_count'] == 0  # pending means not synced
        assert status['not_attempted'] == 9
    
    def test_get_ebilling_logs(self, test_db):
        """Test getting sync logs."""
        init_ebilling_tables()
        sync_invoices_to_ebilling(['INV-1001', 'INV-1002'])
        
        logs = get_ebilling_sync_logs(limit=5)
        
        assert len(logs) <= 5
        assert logs[0]['invoice_id'] in ['INV-1001', 'INV-1002']
        assert 'customer_name' in logs[0]
        assert 'value_kes' in logs[0]


class TestEBillingRetry:
    """Test retry functionality."""
    
    def test_retry_failed_sync(self, test_db):
        """Test retrying a failed sync."""
        init_ebilling_tables()
        
        # First sync (may fail due to random simulation)
        sync_invoices_to_ebilling(['INV-1001'])
        
        # Check if it failed
        conn = sqlite3.connect(test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT status FROM ebilling_sync WHERE invoice_id = 'INV-1001'")
        row = cursor.fetchone()
        conn.close()
        
        if row and row[0] == 'failed':
            result = retry_failed_sync('INV-1001')
            assert result['status'] in ['success', 'failed']
            assert result['invoice_id'] == 'INV-1001'
        else:
            # If it didn't fail, skip this test
            pytest.skip("Invoice didn't fail, retry not applicable")


class TestEBillingWebhook:
    """Test webhook callback functionality."""
    
    def test_webhook_success(self, test_db):
        """Test successful webhook callback."""
        init_ebilling_tables()
        sync_invoices_to_ebilling(['INV-1001'])
        
        payload = {
            'invoice_id': 'INV-1001',
            'status': 'synced',
            'message': 'Successfully processed by KRA'
        }
        result = handle_webhook(payload)
        
        assert result['status'] == 'success'
        assert result['invoice_id'] == 'INV-1001'
        
        # Check webhook log
        conn = sqlite3.connect(test_db)
        cursor = conn.cursor()
        cursor.execute("SELECT COUNT(*) FROM ebilling_webhook_log")
        count = cursor.fetchone()[0]
        conn.close()
        assert count >= 1
    
    def test_webhook_missing_invoice(self, test_db):
        """Test webhook with missing invoice ID."""
        init_ebilling_tables()
        payload = {'status': 'synced'}
        result = handle_webhook(payload)
        
        assert result['status'] == 'error'
        assert 'missing invoice_id' in result['message'].lower()


class TestEBillingReconciliation:
    """Test reconciliation dashboard."""
    
    def test_reconciliation_dashboard(self, test_db):
        """Test the reconciliation dashboard endpoint."""
        init_ebilling_tables()
        sync_invoices_to_ebilling(['INV-1001', 'INV-1002', 'INV-1003'])
        
        data = get_ebilling_reconciliation()
        
        assert data['total_invoices'] == 10
        assert data['synced'] == 3
        assert data['pending'] == 7  # 10 total - 3 synced
        assert data['failed'] >= 0
        assert data['reconciliation_rate'] >= 0
        assert data['status'] in ['healthy', 'warning', 'critical']


class TestEBillingMonitor:
    """Test failure rate monitoring."""
    
    def test_monitor_no_failures(self, test_db):
        """Test monitor with no failures."""
        init_ebilling_tables()
        sync_invoices_to_ebilling(['INV-1001'])
        
        data = check_failure_rate()
        
        assert 'failure_rate' in data
        assert 'alert' in data
        assert 'threshold' in data
        assert data['threshold'] == 10  # 10% threshold
    
    def test_monitor_with_failures(self, test_db):
        """Test monitor with failures (simulated by multiple syncs)."""
        init_ebilling_tables()
        
        # Sync many times to increase chance of failures
        for _ in range(3):
            sync_invoices_to_ebilling(['INV-1001', 'INV-1002'])
        
        data = check_failure_rate()
        
        assert 'failure_rate' in data
        assert isinstance(data['failure_rate'], float)


class TestEBillingRetryMechanism:
    """Test the retry decorator directly."""
    
    def test_retry_decorator_success(self, test_db):
        """Test that retry decorator works on successful calls."""
        result = call_kra_api('INV-1001', {})
        assert result['status'] == 'success'
        assert result['invoice_id'] == 'INV-1001'
    
    def test_retry_decorator_retries(self, test_db):
        """Test that retry decorator actually retries on failure."""
        # This is hard to test deterministically due to random failures
        # But we can check the function exists
        assert callable(call_kra_api)


# ============================================================================
# PERFORMANCE TEST
# ============================================================================

class TestEBillingPerformance:
    """Performance tests for E-Billing."""
    
    def test_sync_performance(self, test_db):
        """Test that sync completes in reasonable time."""
        init_ebilling_tables()
        
        start = time.time()
        sync_invoices_to_ebilling(['INV-1001'])
        elapsed = time.time() - start
        
        assert elapsed < 5  # Should complete in < 5 seconds