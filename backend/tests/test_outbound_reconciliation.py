"""
TEST SUITE FOR OUTBOUND (STIPEND/DISBURSEMENT) RECONCILIATION — Stage 2

Mirrors tests/test_reconciliation.py's style/fixtures for the outbound
three-way match (attendance -> stipend_authorizations -> disbursements),
covering the acceptance-checklist items from the Outbound Recon Extension
spec that are specific to this engine:
- missing authorization / missing disbursement / underpayment flagged
- overpayment, duplicate disbursement, and ghost payment flagged CRITICAL
  and exempt from the materiality filter
- flow_direction tagging and inbound/outbound merge via
  run_combined_reconciliation()
- the Officer<->Beneficiary fraud graph clustering a shared
  disbursing_account ring into one Louvain community

Run with: pytest tests/test_outbound_reconciliation.py -v
"""
import os
import sqlite3
import sys
from datetime import datetime

import pandas as pd
import pytest

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.reconciliation.reconciliation import (
    run_outbound_reconciliation_on_dataframes,
    run_combined_reconciliation,
    GHOST_PAYMENT_LABEL,
    DUPLICATE_DISBURSEMENT_LABEL,
)
from app.services.fraud.graph_engine import build_outbound_fraud_graph_from_dataframes


# =============================================================================
# FIXTURES
# =============================================================================

@pytest.fixture
def outbound_data():
    """One attendance/authorization/disbursement row per break type, plus
    one clean (Reconciled) row and one ghost payment with no authorization
    at all."""
    today = datetime.now().strftime('%Y-%m-%d')

    attendance = pd.DataFrame({
        'attendance_id': ['ATT-001', 'ATT-002', 'ATT-003', 'ATT-004', 'ATT-005'],
        'beneficiary_id': ['BEN-001', 'BEN-002', 'BEN-003', 'BEN-004', 'BEN-005'],
        'officer_id': ['OFF-001', 'OFF-001', 'OFF-002', 'OFF-002', 'OFF-001'],
        'pillar_id': ['Scholarship'] * 5,
        'period': ['2026-01'] * 5,
        'eligible_amount_kes': [200000, 200000, 200000, 200000, 200000],
        'attendance_date': [today] * 5,
    })

    # ATT-001 -> reconciled; ATT-002 -> underpaid; ATT-003 -> overpaid;
    # ATT-004 -> never authorized (Missing Authorization, no auth row at
    # all); ATT-005 -> authorized but never disbursed (Missing Disbursement).
    authorizations = pd.DataFrame({
        'authorization_id': ['AUTH-001', 'AUTH-002', 'AUTH-003', 'AUTH-005'],
        'attendance_id': ['ATT-001', 'ATT-002', 'ATT-003', 'ATT-005'],
        'amount_authorized': [200000, 200000, 200000, 200000],
    })

    disbursements = pd.DataFrame({
        'disbursement_id': ['DISB-001', 'DISB-002', 'DISB-003', 'DISB-GHOST'],
        'authorization_id': ['AUTH-001', 'AUTH-002', 'AUTH-003', None],
        'beneficiary_id': ['BEN-001', 'BEN-002', 'BEN-003', 'BEN-999'],
        'pillar_id': ['Scholarship'] * 4,
        'period': ['2026-01'] * 4,
        'amount_paid': [200000, 120000, 260000, 75000],  # underpaid / overpaid / ghost
        'date': [today] * 4,
        'disbursing_account': ['ACC-A', 'ACC-B', 'ACC-C', 'ACC-D'],
    })

    return attendance, authorizations, disbursements


@pytest.fixture
def minimal_inbound_data():
    """A small standalone inbound fixture (deliberately not imported from
    test_reconciliation.py's sample_data — keeping this file independent
    of that one's internal structure). Just enough for run_reconciliation()
    to produce a non-empty, valid result alongside the outbound tables."""
    today = datetime.now().strftime('%Y-%m-%d')
    dispatches = pd.DataFrame({
        'dispatch_id': ['DISP-001', 'DISP-002'],
        'customer_name': ['TotalEnergies', 'Vivo Energy'],
        'product': ['Diesel', 'Petrol'],
        'volume_liters': [10000, 8000],
        'value_kes': [1500000, 1200000],
        'date': [today] * 2,
    })
    invoices = pd.DataFrame({
        'invoice_id': ['INV-001'],
        'dispatch_id': ['DISP-001'],
        'customer_name': ['TotalEnergies'],
        'value_kes': [1500000],
        'date': [today],
    })
    payments = pd.DataFrame({
        'payment_id': ['PAY-001'],
        'invoice_id': ['INV-001'],
        'value_kes': [1500000],
        'date': [today],
    })
    omcs = pd.DataFrame({
        'omc_id': ['OMC-001', 'OMC-002'],
        'customer_name': ['TotalEnergies', 'Vivo Energy'],
        'risk_rating': ['Low', 'Medium'],
    })
    return dispatches, invoices, payments, omcs


@pytest.fixture
def combined_db_with_data(minimal_inbound_data, outbound_data):
    """Mirrors test_reconciliation.py's db_with_data fixture — a throwaway
    SQLite file with BOTH inbound and outbound tables, and get_engine()
    monkeypatched to it — for exercising the DB-wrapper functions
    (run_reconciliation, run_outbound_reconciliation,
    run_combined_reconciliation), not just the pure DataFrame ones."""
    db_path = 'test_outbound_kpc.db'
    conn = sqlite3.connect(db_path)

    dispatches, invoices, payments, omcs = minimal_inbound_data
    dispatches.to_sql('dispatches', conn, if_exists='replace', index=False)
    invoices.to_sql('invoices', conn, if_exists='replace', index=False)
    payments.to_sql('payments', conn, if_exists='replace', index=False)
    omcs.to_sql('omcs', conn, if_exists='replace', index=False)

    attendance, authorizations, disbursements = outbound_data
    attendance.to_sql('attendance', conn, if_exists='replace', index=False)
    authorizations.to_sql('stipend_authorizations', conn, if_exists='replace', index=False)
    disbursements.to_sql('disbursements', conn, if_exists='replace', index=False)

    conn.close()

    import app.services.reconciliation.reconciliation as recon_module
    from sqlalchemy import create_engine
    test_engine = create_engine(f'sqlite:///{db_path}')
    original_get_engine = recon_module.get_engine
    recon_module.get_engine = lambda: test_engine

    yield db_path

    recon_module.get_engine = original_get_engine
    test_engine.dispose()
    os.remove(db_path)


# =============================================================================
# CHAIN ANOMALIES (Missing Authorization / Missing Disbursement / Underpayment)
# =============================================================================

class TestOutboundChainAnomalies:
    def test_missing_authorization_flagged(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=0
        )
        anomalies = result['anomalies']
        missing_auth = [a for a in anomalies if a['break_type'] == 'Missing Authorization']
        assert len(missing_auth) == 1
        assert missing_auth[0]['dispatch_id'] == 'ATT-004'
        assert missing_auth[0]['leakage_kes'] == 200000

    def test_missing_disbursement_flagged(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=0
        )
        missing_disb = [a for a in result['anomalies'] if a['break_type'] == 'Missing Disbursement']
        assert len(missing_disb) == 1
        assert missing_disb[0]['dispatch_id'] == 'ATT-005'

    def test_underpayment_flagged(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=0
        )
        underpaid = [a for a in result['anomalies'] if a['break_type'] == 'Underpayment']
        assert len(underpaid) == 1
        assert underpaid[0]['dispatch_id'] == 'ATT-002'
        assert underpaid[0]['leakage_kes'] == 80000  # 200000 authorized - 120000 disbursed


# =============================================================================
# ALWAYS-CRITICAL BREAKS: Overpayment / Ghost Payment / Duplicate Disbursement
# =============================================================================

class TestOutboundAlwaysCritical:
    def test_overpayment_is_critical_regardless_of_amount(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        # materiality far above the actual overpayment leak (60000) — an
        # inbound-style filter would drop this anomaly entirely.
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=10_000_000
        )
        overpaid = [a for a in result['anomalies'] if a['break_type'] == 'Overpayment']
        assert len(overpaid) == 1
        assert overpaid[0]['status'] == 'Critical'
        assert overpaid[0]['dispatch_id'] == 'ATT-003'

    def test_ghost_payment_detected_and_critical(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=10_000_000
        )
        ghosts = [a for a in result['anomalies'] if a['break_type'] == GHOST_PAYMENT_LABEL]
        assert len(ghosts) == 1
        assert ghosts[0]['status'] == 'Critical'
        assert ghosts[0]['beneficiary_id'] == 'BEN-999'
        assert ghosts[0]['leakage_kes'] == 75000

    def test_duplicate_disbursement_detected_and_critical(self, outbound_data):
        attendance, authorizations, disbursements = outbound_data
        # Duplicate the reconciled disbursement (same beneficiary+period, paid twice).
        dup_row = disbursements[disbursements['disbursement_id'] == 'DISB-001'].copy()
        dup_row['disbursement_id'] = 'DISB-001-DUP'
        disbursements_with_dup = pd.concat([disbursements, dup_row], ignore_index=True)

        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements_with_dup, materiality=10_000_000
        )
        dupes = [a for a in result['anomalies'] if a['break_type'] == DUPLICATE_DISBURSEMENT_LABEL]
        assert len(dupes) == 2  # both rows sharing the beneficiary+period key
        assert all(a['status'] == 'Critical' for a in dupes)

    def test_underpayment_is_filtered_by_materiality(self, outbound_data):
        """Sanity check for the exemption logic itself: a break type NOT
        in the always-critical set must still respect materiality."""
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=10_000_000
        )
        underpaid = [a for a in result['anomalies'] if a['break_type'] == 'Underpayment']
        assert len(underpaid) == 0


# =============================================================================
# flow_direction TAGGING AND MERGE
# =============================================================================

class TestFlowDirectionTagging:
    def test_outbound_dataframe_function_always_tags_outbound(self, outbound_data):
        """Unlike inbound (run_reconciliation_on_dataframes leaves
        flow_direction unset; only the run_reconciliation() DB wrapper
        tags "inbound"), the outbound pure function tags every anomaly
        "outbound" unconditionally via _build_outbound_anomaly() — there's
        no ambiguity to defer to a wrapper here, since this function only
        ever produces outbound anomalies. Anomaly.flow_direction is still
        Optional[str] on the schema because inbound's pure function can
        omit it, not because outbound's ever does."""
        attendance, authorizations, disbursements = outbound_data
        result = run_outbound_reconciliation_on_dataframes(
            attendance, authorizations, disbursements, materiality=0
        )
        assert len(result['anomalies']) > 0
        assert all(a['flow_direction'] == 'outbound' for a in result['anomalies'])


# =============================================================================
# OUTBOUND FRAUD GRAPH — Officer<->Beneficiary + shared disbursing_account ring
# =============================================================================

class TestOutboundFraudGraph:
    def test_ring_beneficiaries_cluster_into_one_community(self):
        """Mirrors inject_disbursement_ring()'s signal: several
        beneficiaries under DIFFERENT officers, paid from the same
        disbursing_account, should still land in one Louvain community —
        the whole point of adding a direct beneficiary<->beneficiary edge
        instead of relying solely on officer<->beneficiary edges (which
        would otherwise dominate by leakage weight and pull ring members
        toward their own officer's community instead of each other)."""
        anomalies_df = pd.DataFrame([
            {'dispatch_id': 'ATT-1', 'officer_id': 'OFF-A', 'beneficiary_id': 'BEN-1', 'customer': 'Beneficiary 1', 'leakage_kes': 500000, 'break_type': 'Underpayment'},
            {'dispatch_id': 'ATT-2', 'officer_id': 'OFF-B', 'beneficiary_id': 'BEN-2', 'customer': 'Beneficiary 2', 'leakage_kes': 500000, 'break_type': 'Underpayment'},
            {'dispatch_id': 'ATT-3', 'officer_id': 'OFF-C', 'beneficiary_id': 'BEN-3', 'customer': 'Beneficiary 3', 'leakage_kes': 500000, 'break_type': 'Underpayment'},
        ])
        disbursements_df = pd.DataFrame({
            'beneficiary_id': ['BEN-1', 'BEN-2', 'BEN-3'],
            'disbursing_account': ['RING-ACCOUNT'] * 3,
        })

        graph = build_outbound_fraud_graph_from_dataframes(anomalies_df, disbursements_df)
        node_community = {n['id']: n['community'] for n in graph['nodes']}
        ring_communities = {node_community[f'beneficiary:{b}'] for b in ('BEN-1', 'BEN-2', 'BEN-3')}
        assert len(ring_communities) == 1

    def test_shared_account_edge_does_not_inflate_displayed_leakage(self):
        """The clustering-only weight boost (RING_CLUSTER_WEIGHT) must
        never leak into the node's displayed leakage_kes — that field
        should stay real KES, not the Louvain-clustering weight."""
        anomalies_df = pd.DataFrame([
            {'dispatch_id': 'ATT-1', 'officer_id': 'OFF-A', 'beneficiary_id': 'BEN-1', 'customer': 'Beneficiary 1', 'leakage_kes': 50000, 'break_type': 'Underpayment'},
            {'dispatch_id': 'ATT-2', 'officer_id': 'OFF-B', 'beneficiary_id': 'BEN-2', 'customer': 'Beneficiary 2', 'leakage_kes': 50000, 'break_type': 'Underpayment'},
        ])
        disbursements_df = pd.DataFrame({
            'beneficiary_id': ['BEN-1', 'BEN-2'],
            'disbursing_account': ['RING-ACCOUNT'] * 2,
        })
        graph = build_outbound_fraud_graph_from_dataframes(anomalies_df, disbursements_df)
        leakages = {n['id']: n['leakage_kes'] for n in graph['nodes']}
        assert leakages['beneficiary:BEN-1'] == 50000
        assert leakages['beneficiary:BEN-2'] == 50000


# =============================================================================
# run_combined_reconciliation() — direction merge
# =============================================================================

class TestCombinedReconciliation:
    def test_direction_inbound_only_has_no_outbound_anomalies(self, combined_db_with_data):
        result = run_combined_reconciliation(direction="inbound", materiality=0)
        assert len(result['anomalies']) > 0
        assert all(a.get('flow_direction') != 'outbound' for a in result['anomalies'])

    def test_direction_outbound_only_has_only_outbound_anomalies(self, combined_db_with_data):
        result = run_combined_reconciliation(direction="outbound", materiality=0)
        assert len(result['anomalies']) > 0
        assert all(a.get('flow_direction') == 'outbound' for a in result['anomalies'])

    def test_direction_all_merges_both_and_tags_flow_direction(self, combined_db_with_data):
        result = run_combined_reconciliation(direction="all", materiality=0)
        anomalies = result['anomalies']
        inbound_count = sum(1 for a in anomalies if a.get('flow_direction') != 'outbound')
        outbound_count = sum(1 for a in anomalies if a.get('flow_direction') == 'outbound')
        assert inbound_count > 0
        assert outbound_count > 0
        assert inbound_count + outbound_count == len(anomalies)
        # ghost_payment_leak/duplicate_disbursement_leak are outbound-only
        # metrics keys — must survive the merge, not just exist on the
        # outbound-only result.
        assert 'ghost_payment_leak' in result['metrics']
        assert result['metrics']['ghost_payment_leak'] >= 0
