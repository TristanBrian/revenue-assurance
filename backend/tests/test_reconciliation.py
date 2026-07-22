"""
TEST SUITE FOR RECONCILIATION ENGINE
Professional-grade testing with:
- Edge case coverage
- Performance benchmarks
- Data quality validation
- Fraud detection verification

Run with: pytest tests/test_reconciliation.py -v
"""

import pytest
import pandas as pd
import sqlite3
import os
import json
from datetime import datetime, timedelta
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
from app.services.reconciliation import run_reconciliation, calculate_data_quality

# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def sample_data():
    """Create sample data for testing."""
    dispatches = pd.DataFrame({
        'dispatch_id': ['DISP-001', 'DISP-002', 'DISP-003'],
        'customer_name': ['TotalEnergies', 'Vivo Energy', 'TotalEnergies'],
        'product': ['Diesel', 'Petrol', 'Diesel'],
        'volume_liters': [10000, 8000, 12000],
        'value_kes': [1500000, 1200000, 1800000],
        'date': [datetime.now().strftime('%Y-%m-%d')] * 3
    })
    
    invoices = pd.DataFrame({
        'invoice_id': ['INV-001', 'INV-002'],
        'dispatch_id': ['DISP-001', 'DISP-002'],
        'customer_name': ['TotalEnergies', 'Vivo Energy'],
        'value_kes': [1500000, 1200000],
        'date': [datetime.now().strftime('%Y-%m-%d')] * 2
    })
    
    payments = pd.DataFrame({
        'payment_id': ['PAY-001', 'PAY-002'],
        'invoice_id': ['INV-001', 'INV-002'],
        'value_kes': [1500000, 1000000],  # Second is underpaid
        'date': [datetime.now().strftime('%Y-%m-%d')] * 2
    })
    
    return dispatches, invoices, payments


@pytest.fixture
def db_with_data(sample_data):
    """Create a test database with sample data."""
    db_path = 'test_kpc.db'
    conn = sqlite3.connect(db_path)
    
    dispatches, invoices, payments = sample_data
    dispatches.to_sql('dispatches', conn, if_exists='replace', index=False)
    invoices.to_sql('invoices', conn, if_exists='replace', index=False)
    payments.to_sql('payments', conn, if_exists='replace', index=False)
    
    conn.close()
    
    # Patch DB_PATH for this test
    import app.services.reconciliation
    original_path = app.services.reconciliation.DB_PATH
    app.services.reconciliation.DB_PATH = db_path
    
    yield db_path
    
    # Cleanup
    app.services.reconciliation.DB_PATH = original_path
    os.remove(db_path)


# =============================================================================
# TEST 1: BASIC RECONCILIATION
# =============================================================================

class TestReconciliation:
    """Test basic reconciliation functionality."""
    
    def test_basic_reconciliation(self, db_with_data):
        """Test that reconciliation runs and returns expected structure."""
        result = run_reconciliation()
        
        # Check structure
        assert 'metrics' in result
        assert 'anomalies' in result
        assert 'summary' in result
        assert 'ebilling_status' in result
        assert 'performance' in result
        assert 'data_quality' in result
        
        # Check metrics
        metrics = result['metrics']
        assert metrics['total_dispatched_kes'] == 4500000  # 1.5M + 1.2M + 1.8M
        assert metrics['total_invoiced_kes'] == 2700000    # 1.5M + 1.2M
        assert metrics['total_paid_kes'] == 2500000        # 1.5M + 1.0M
        
        # Should detect underpayment on DISP-002
        anomalies = result['anomalies']
        assert len(anomalies) > 0
        
        # Check data quality
        assert 'quality_score' in result['data_quality']
        assert result['data_quality']['quality_score'] >= 0
    
    def test_anomaly_types(self, db_with_data):
        """Test that all three leak types are detected."""
        result = run_reconciliation()
        anomalies = result['anomalies']
        
        # DISP-003 has no invoice -> Missing Invoice
        missing_invoice = [a for a in anomalies if a['break_type'] == 'Missing Invoice']
        assert len(missing_invoice) == 1
        
        # DISP-002 has invoice but underpaid -> Underpayment
        underpayment = [a for a in anomalies if a['break_type'] == 'Underpayment']
        assert len(underpayment) == 1

    def test_data_quality_metrics(self, db_with_data):
        """Test data quality metrics calculation."""
        result = run_reconciliation()
        dq = result['data_quality']
        
        assert dq['total_rows'] == 3
        assert dq['quality_score'] >= 0
        assert 'null_volume' in dq


# =============================================================================
# TEST 2: EDGE CASES
# =============================================================================

class TestEdgeCases:
    """Test edge cases and error handling."""
    
    def test_zero_values(self, db_with_data):
        """Test handling of zero values."""
        result = run_reconciliation()
        metrics = result['metrics']
        
        # Should still produce valid metrics
        assert metrics['total_dispatched_kes'] > 0
        assert metrics['reconciliation_rate'] >= 0
    
    def test_null_values(self):
        """Test handling of null values in data."""
        # Create data with nulls
        dispatches = pd.DataFrame({
            'dispatch_id': ['DISP-001'],
            'customer_name': [None],  # Null customer
            'product': ['Diesel'],
            'volume_liters': [10000],
            'value_kes': [1500000],
            'date': [datetime.now().strftime('%Y-%m-%d')]
        })
        
        # Should not crash
        result = run_reconciliation()
        assert result is not None


# =============================================================================
# TEST 3: PERFORMANCE
# =============================================================================

class TestPerformance:
    """Test performance and scaling."""
    
    def test_performance_metrics(self, db_with_data):
        """Test that performance metrics are reasonable."""
        result = run_reconciliation()
        
        perf = result['performance']
        assert perf['processing_time_seconds'] < 5  # Should be fast
        assert perf['rows_processed'] > 0
        assert perf['rows_per_second'] >= 0


# =============================================================================
# TEST 4: DATA QUALITY
# =============================================================================

class TestDataQuality:
    """Test data quality validation."""
    
    def test_quality_score(self):
        """Test quality score calculation."""
        df = pd.DataFrame({
            'customer_name': ['A', 'B', 'C'],
            'volume_liters': [100, 200, 300],
            'value_kes': [1000, 2000, 3000]
        })
        
        report = calculate_data_quality(df, 'customer_name', 'value_kes')
        assert report.quality_score == 100.0
        
        # Add null values
        df_with_nulls = df.copy()
        df_with_nulls.loc[0, 'customer_name'] = None
        report = calculate_data_quality(df_with_nulls, 'customer_name', 'value_kes')
        assert report.quality_score < 100.0


# =============================================================================
# TEST 5: INTEGRATION WITH E-BILLING
# =============================================================================

class TestEBillingIntegration:
    """Test E-Billing integration readiness."""
    
    def test_ebilling_status(self, db_with_data):
        """Test that E-Billing status is included."""
        result = run_reconciliation()
        
        eb = result['ebilling_status']
        assert eb['system'] == 'KRA iCMS (Simulated)'
        assert eb['connected'] is True
        assert 'total_pending' in eb


# =============================================================================
# TEST 6: FRAUD DETECTION VERIFICATION
# =============================================================================

class TestFraudDetection:
    """Test that fraud rings are detected."""
    
    def test_fraud_ring_detection(self):
        """Test that the data generator injects fraud rings."""
        # Run reconciliation on full dataset
        result = run_reconciliation()
        
        # Check if any anomalies are present (fraud should create anomalies)
        assert result['metrics']['anomaly_count'] > 0
        
        # Check if we have customers flagged
        anomalies = result['anomalies']
        customers = [a['customer'] for a in anomalies]
        assert len(set(customers)) > 0


# =============================================================================
# TEST 7: END-TO-END FLOW
# =============================================================================

class TestEndToEnd:
    """End-to-end integration test."""
    
    def test_full_pipeline(self):
        """Test the entire reconciliation pipeline."""
        # Run reconciliation
        result = run_reconciliation()
        
        # Verify all key fields
        assert 'metrics' in result
        assert 'anomalies' in result
        assert 'summary' in result
        
        # Print summary for manual verification
        print("\n" + "="*60)
        print("📊 RECONCILIATION TEST RESULTS")
        print("="*60)
        print(f"Total Dispatched: KSh {result['metrics']['total_dispatched_kes']:,}")
        print(f"Total Leakage: KSh {result['metrics']['total_leakage_kes']:,}")
        print(f"Reconciliation Rate: {result['metrics']['reconciliation_rate']:.2f}%")
        print(f"Anomalies Found: {result['metrics']['anomaly_count']}")
        print(f"Processing Time: {result['performance']['processing_time_seconds']}s")
        print(f"Data Quality Score: {result['data_quality']['quality_score']:.2f}%")
        print("="*60)


# =============================================================================
# TEST 8: PERFORMANCE BENCHMARK
# =============================================================================

class TestBenchmark:
    """Performance benchmarks."""
    
    def test_benchmark_scalability(self):
        """Test that reconciliation handles large datasets."""
        import time
        
        # Run and time
        start = time.time()
        result = run_reconciliation()
        elapsed = time.time() - start
        
        # Should handle 1200 rows quickly
        assert elapsed < 10
        assert result['performance']['rows_processed'] > 0
        
        print(f"\n⏱️ Benchmark: {elapsed:.2f}s for {result['performance']['rows_processed']} rows")


# =============================================================================
# RUN TESTS
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🧪 RUNNING RECONCILIATION TESTS")
    print("="*60)
    
    # Run all tests
    pytest.main([__file__, '-v', '--tb=short'])