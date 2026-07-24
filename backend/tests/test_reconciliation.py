"""
TEST SUITE FOR RECONCILIATION ENGINE (v2.0 – FinTech Features)
Professional-grade testing with:
- Edge case coverage
- Performance benchmarks
- Data quality validation
- Fraud detection verification
- Materiality threshold filtering
- Duplicate detection
- OMC risk profiling
- Overpayment detection

Run with: pytest tests/test_reconciliation.py -v
"""

import pytest
import pandas as pd
import sqlite3
import os
from datetime import datetime, timedelta
import sys

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.reconciliation import (
    run_reconciliation,
    calculate_data_quality,
    run_reconciliation_on_dataframes,
    detect_duplicates,
    calculate_omc_risk
)

# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def sample_data():
    """Create comprehensive sample data with all leak types."""
    dispatches = pd.DataFrame({
        'dispatch_id': ['DISP-001', 'DISP-002', 'DISP-003', 'DISP-004', 'DISP-005'],
        'customer_name': ['TotalEnergies', 'Vivo Energy', 'TotalEnergies', 'Kobil', 'Kobil'],
        'product': ['Diesel', 'Petrol', 'Diesel', 'Jet A-1', 'Diesel'],
        'volume_liters': [10000, 8000, 12000, 5000, 15000],
        'value_kes': [1500000, 1200000, 1800000, 800000, 2200000],
        'date': [datetime.now().strftime('%Y-%m-%d')] * 5
    })
    
    invoices = pd.DataFrame({
        'invoice_id': ['INV-001', 'INV-002', 'INV-004'],
        'dispatch_id': ['DISP-001', 'DISP-002', 'DISP-004'],
        'customer_name': ['TotalEnergies', 'Vivo Energy', 'Kobil'],
        'value_kes': [1500000, 1200000, 800000],
        'date': [datetime.now().strftime('%Y-%m-%d')] * 3
    })
    
    payments = pd.DataFrame({
        'payment_id': ['PAY-001', 'PAY-002', 'PAY-003'],
        'invoice_id': ['INV-001', 'INV-002', 'INV-004'],
        'value_kes': [1500000, 1000000, 900000],  # Underpayment for INV-002, Overpayment for INV-004
        'date': [datetime.now().strftime('%Y-%m-%d')] * 3
    })
    
    omcs = pd.DataFrame({
        'omc_id': ['OMC-001', 'OMC-002', 'OMC-003'],
        'customer_name': ['TotalEnergies', 'Vivo Energy', 'Kobil'],
        'risk_rating': ['Low', 'Medium', 'High']
    })
    
    return dispatches, invoices, payments, omcs


@pytest.fixture
def db_with_data(sample_data):
    """Create a test database with comprehensive sample data."""
    db_path = 'test_kpc.db'
    conn = sqlite3.connect(db_path)
    
    dispatches, invoices, payments, omcs = sample_data
    dispatches.to_sql('dispatches', conn, if_exists='replace', index=False)
    invoices.to_sql('invoices', conn, if_exists='replace', index=False)
    payments.to_sql('payments', conn, if_exists='replace', index=False)
    omcs.to_sql('omcs', conn, if_exists='replace', index=False)
    
    conn.close()

    # Point run_reconciliation() at this throwaway SQLite file instead of the
    # real kpc.db (DB_PATH no longer exists — services/reconciliation.py talks
    # to the DB via get_engine() since the SQLAlchemy migration).
    import app.services.reconciliation as recon_module
    from sqlalchemy import create_engine
    test_engine = create_engine(f'sqlite:///{db_path}')
    original_get_engine = recon_module.get_engine
    recon_module.get_engine = lambda: test_engine

    yield db_path

    # Cleanup
    recon_module.get_engine = original_get_engine
    test_engine.dispose()
    os.remove(db_path)


@pytest.fixture
def sample_dataframe_fixture(sample_data):
    """Return DataFrames directly for on-dataframe tests."""
    dispatches, invoices, payments, omcs = sample_data
    return dispatches, invoices, payments, omcs


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
        assert 'duplicate_anomalies' in result
        assert 'omc_risk_profile' in result
        
        # Check metrics
        metrics = result['metrics']
        assert metrics['total_dispatched_kes'] == 7500000  # Sum of all dispatches
        assert metrics['total_invoiced_kes'] == 3500000    # INV-001 + INV-002 + INV-004
        assert metrics['total_paid_kes'] == 3400000        # 1.5M + 1.0M + 0.9M
        
        # Check that we detected anomalies
        anomalies = result['anomalies']
        assert len(anomalies) > 0
        
        # Check data quality
        assert result['data_quality']['quality_score'] >= 0
    
    def test_anomaly_types(self, db_with_data):
        """Test that all three leak types are detected."""
        result = run_reconciliation()
        anomalies = result['anomalies']
        
        # DISP-003 and DISP-005 have no invoice -> Missing Invoice (2)
        missing_invoice = [a for a in anomalies if a['break_type'] == 'Missing Invoice']
        assert len(missing_invoice) == 2   # Updated from 1 to 2

        # DISP-002 has invoice but underpaid -> Underpayment (1)
        underpayment = [a for a in anomalies if a['break_type'] == 'Underpayment']
        assert len(underpayment) == 1

        # DISP-004 has invoice but overpaid -> Overpayment (1)
        overpayment = [a for a in anomalies if a['break_type'] == 'Overpayment']
        assert len(overpayment) == 1

    def test_data_quality_metrics(self, db_with_data):
        """Test data quality metrics calculation."""
        result = run_reconciliation()
        dq = result['data_quality']
        
        assert dq['total_rows'] == 5
        assert dq['quality_score'] >= 0
        assert 'null_volume' in dq


# =============================================================================
# TEST 2: MATERIALITY THRESHOLD
# =============================================================================

class TestMateriality:
    """Test materiality threshold filtering."""
    
    def test_materiality_filters_small_leaks(self, db_with_data):
        """Test that leaks below threshold are filtered out."""
        # Run with high materiality (1M)
        result = run_reconciliation(materiality=1000000)
        metrics = result['metrics']
        
        # Should only have leaks > 1M
        anomalies = result['anomalies']
        for anomaly in anomalies:
            assert anomaly['leakage_kes'] >= 1000000
        
        # Only missing invoices (1.8M + 2.2M) survive -> total 4.0M
        assert metrics['total_leakage_kes'] == 4000000   # Updated from 1800000
    
    def test_materiality_no_filter(self, db_with_data):
        """Test with zero materiality – all leaks are shown."""
        result = run_reconciliation(materiality=0)
        metrics = result['metrics']
        anomalies = result['anomalies']
        
        # All leaks: 1.8M + 2.2M + 200k + 100k = 4.3M
        assert metrics['total_leakage_kes'] == 4300000   # Updated from 2100000
        assert len(anomalies) == 4  # 2 missing invoices + underpayment + overpayment


# =============================================================================
# TEST 3: DUPLICATE DETECTION
# =============================================================================

class TestDuplicateDetection:
    """Test duplicate detection functionality."""
    
    def test_duplicate_invoice_detected(self, sample_dataframe_fixture):
        """Test duplicate invoices are flagged."""
        dispatches, invoices, payments, omcs = sample_dataframe_fixture
        
        # Create a duplicate invoice with same ID
        invoices_dup = invoices.copy()
        dup_row = invoices_dup.iloc[0].copy()  # INV-001
        invoices_dup = pd.concat([invoices_dup, pd.DataFrame([dup_row])], ignore_index=True)
        # Now we have two rows with invoice_id = 'INV-001'
        
        result = run_reconciliation_on_dataframes(dispatches, invoices_dup, payments)
        
        duplicates = result['duplicate_anomalies']
        # Should find at least one duplicate detection for 'invoice_id'
        assert len(duplicates) > 0
        # The detection should note the column 'invoice_id' and label 'Invoice'
        assert duplicates[0]['column'] == 'invoice_id'
    
    def test_no_duplicates_clean(self, sample_dataframe_fixture):
        """Test no duplicates when none present."""
        dispatches, invoices, payments, omcs = sample_dataframe_fixture
        result = run_reconciliation_on_dataframes(dispatches, invoices, payments)
        
        duplicates = result['duplicate_anomalies']
        # In sample data, there are no duplicates
        # But the function will return empty list if none
        assert isinstance(duplicates, list)


# =============================================================================
# TEST 4: OMC RISK PROFILING
# =============================================================================

class TestOMCRisk:
    """Test OMC risk profiling."""
    
    def test_omc_risk_profile_present(self, db_with_data):
        """Test that OMC risk profile is included."""
        result = run_reconciliation()
        profile = result['omc_risk_profile']
        
        assert isinstance(profile, list)
        if len(profile) > 0:
            assert 'customer' in profile[0]
            assert 'leakage_kes' in profile[0]
            assert 'anomaly_count' in profile[0]
            assert 'risk_level' in profile[0]
    
    def test_omc_risk_calculation(self, sample_dataframe_fixture):
        """Test that OMC risk is correctly aggregated."""
        dispatches, invoices, payments, omcs = sample_dataframe_fixture
        result = run_reconciliation_on_dataframes(dispatches, invoices, payments)
        profile = result['omc_risk_profile']
        
        # TotalEnergies should have missing invoice (1.8M) -> High risk
        totalenergies = [p for p in profile if p['customer'] == 'TotalEnergies']
        assert len(totalenergies) > 0
        assert totalenergies[0]['leakage_kes'] == 1800000
        assert totalenergies[0]['risk_level'] == 'High'


# =============================================================================
# TEST 5: EDGE CASES
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
        invoices = pd.DataFrame({
            'invoice_id': ['INV-001'],
            'dispatch_id': ['DISP-001'],
            'customer_name': ['TotalEnergies'],
            'value_kes': [1500000],
            'date': [datetime.now().strftime('%Y-%m-%d')]
        })
        payments = pd.DataFrame({
            'payment_id': ['PAY-001'],
            'invoice_id': ['INV-001'],
            'value_kes': [1500000],
            'date': [datetime.now().strftime('%Y-%m-%d')]
        })
        
        # Should not crash
        result = run_reconciliation_on_dataframes(dispatches, invoices, payments)
        assert result is not None
        assert 'metrics' in result


# =============================================================================
# TEST 6: PERFORMANCE
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
# TEST 7: DATA QUALITY
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
# TEST 8: E-BILLING INTEGRATION
# =============================================================================

class TestEBillingIntegration:
    """Test E-Billing integration readiness."""
    
    def test_ebilling_status_included(self, db_with_data):
        """Test that E-Billing status is included."""
        result = run_reconciliation()
        
        eb = result['ebilling_status']
        assert eb['system'] == 'KRA iCMS (Simulated)'
        assert eb['connected'] is True
        assert 'total_pending' in eb


# =============================================================================
# TEST 9: FRAUD DETECTION
# =============================================================================

class TestFraudDetection:
    """Test that fraud rings are detected."""
    
    def test_fraud_ring_detection(self):
        """Test that the data generator injects fraud rings."""
        result = run_reconciliation()
        anomalies = result['anomalies']
        
        # We expect some anomalies from fraud ring
        # At least one anomaly should exist
        assert len(anomalies) > 0


# =============================================================================
# TEST 10: END-TO-END
# =============================================================================

class TestEndToEnd:
    """End-to-end integration test."""
    
    def test_full_pipeline(self):
        """Test the entire reconciliation pipeline with default data."""
        result = run_reconciliation()
        
        # Verify all key fields
        assert 'metrics' in result
        assert 'anomalies' in result
        assert 'summary' in result
        assert 'performance' in result
        assert 'data_quality' in result
        assert 'duplicate_anomalies' in result
        assert 'omc_risk_profile' in result
        
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
        print(f"OMC Risk Profiles: {len(result['omc_risk_profile'])}")
        print("="*60)


# =============================================================================
# TEST 11: PERFORMANCE BENCHMARK
# =============================================================================

class TestBenchmark:
    """Performance benchmarks."""
    
    def test_benchmark_scalability(self):
        """Test that reconciliation handles large datasets."""
        import time
        
        start = time.time()
        result = run_reconciliation()
        elapsed = time.time() - start
        
        # Should handle 1200 rows quickly
        assert elapsed < 10
        assert result['performance']['rows_processed'] > 0
        
        print(f"\n⏱️ Benchmark: {elapsed:.2f}s for {result['performance']['rows_processed']} rows")


# =============================================================================
# TEST 12: OVERPAYMENT DETECTION
# =============================================================================

class TestOverpayment:
    """Test overpayment detection."""
    
    def test_overpayment_flagged(self, sample_dataframe_fixture):
        """Test that overpayments are correctly flagged."""
        dispatches, invoices, payments, omcs = sample_dataframe_fixture
        result = run_reconciliation_on_dataframes(dispatches, invoices, payments)
        
        anomalies = result['anomalies']
        overpayments = [a for a in anomalies if a['break_type'] == 'Overpayment']
        
        # Should have exactly one overpayment (DISP-004)
        assert len(overpayments) == 1
        assert overpayments[0]['dispatch_id'] == 'DISP-004'
        assert overpayments[0]['leakage_kes'] == 100000  # 900k paid vs 800k invoiced


# =============================================================================
# RUN TESTS
# =============================================================================

if __name__ == "__main__":
    print("\n" + "="*60)
    print("🧪 RUNNING RECONCILIATION TESTS (v2.0)")
    print("="*60)
    
    pytest.main([__file__, '-v', '--tb=short'])