"""
TEST SUITE FOR FRAUD GRAPH ENGINE

Run with: pytest tests/test_graph.py -v
"""

import pytest
import pandas as pd
import os
import sys
from datetime import datetime

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services.reconciliation import run_reconciliation_on_dataframes
from app.services.graph_engine import build_fraud_graph_from_dataframes


@pytest.fixture
def anomalies_and_dispatches():
    """Dispatches with omc_id/depot that produce known leaks, run through the
    real reconciliation engine so anomalies_df matches production shape."""
    today = datetime.now().strftime('%Y-%m-%d')

    dispatches = pd.DataFrame({
        'dispatch_id': ['DISP-001', 'DISP-002', 'DISP-003', 'DISP-004'],
        'customer_name': ['TotalEnergies', 'Vivo Energy', 'TotalEnergies', 'Kobil'],
        'omc_id': ['OMC-001', 'OMC-002', 'OMC-001', 'OMC-003'],
        'depot': ['Mombasa', 'Mombasa', 'Nairobi', 'Kisumu'],
        'product': ['Diesel', 'Petrol', 'Diesel', 'Jet A-1'],
        'value_kes': [1500000, 1200000, 1800000, 800000],
        'date': [today] * 4
    })

    # DISP-002 has no invoice (Missing Invoice), DISP-004 has an invoice but
    # no payment (Missing Payment). DISP-001/DISP-003 reconcile cleanly.
    invoices = pd.DataFrame({
        'invoice_id': ['INV-001', 'INV-003', 'INV-004'],
        'dispatch_id': ['DISP-001', 'DISP-003', 'DISP-004'],
        'customer_name': ['TotalEnergies', 'TotalEnergies', 'Kobil'],
        'value_kes': [1500000, 1800000, 800000],
        'date': [today] * 3
    })

    payments = pd.DataFrame({
        'payment_id': ['PAY-001', 'PAY-003'],
        'invoice_id': ['INV-001', 'INV-003'],
        'value_kes': [1500000, 1800000],
        'date': [today] * 2
    })

    result = run_reconciliation_on_dataframes(dispatches, invoices, payments, materiality=0)
    anomalies_df = pd.DataFrame(result['anomalies'])
    return anomalies_df, dispatches


class TestFraudGraphBuilding:
    def test_nodes_and_edges_built(self, anomalies_and_dispatches):
        anomalies_df, dispatches_df = anomalies_and_dispatches
        graph = build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)

        assert graph['summary']['node_count'] > 0
        assert graph['summary']['edge_count'] > 0

        node_ids = {n['id'] for n in graph['nodes']}
        assert 'omc:OMC-002' in node_ids  # Vivo Energy's missing-invoice dispatch
        assert 'depot:Mombasa' in node_ids
        assert 'depot:Kisumu' in node_ids

    def test_edge_weight_matches_leakage(self, anomalies_and_dispatches):
        anomalies_df, dispatches_df = anomalies_and_dispatches
        graph = build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)

        edge = next(
            e for e in graph['edges']
            if {e['source'], e['target']} == {'omc:OMC-002', 'depot:Mombasa'}
        )
        # DISP-002 (Vivo Energy, Mombasa) is a Missing Invoice -> leakage == dispatched value
        assert edge['weight'] == 1200000

    def test_communities_assigned(self, anomalies_and_dispatches):
        anomalies_df, dispatches_df = anomalies_and_dispatches
        graph = build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)

        assert graph['summary']['community_count'] > 0
        assigned_communities = {n['community'] for n in graph['nodes']}
        community_ids = {c['id'] for c in graph['communities']}
        assert assigned_communities == community_ids

    def test_risk_levels_computed(self, anomalies_and_dispatches):
        anomalies_df, dispatches_df = anomalies_and_dispatches
        graph = build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)

        for node in graph['nodes']:
            assert node['risk_level'] in {'Low', 'Medium', 'High'}
        for community in graph['communities']:
            assert community['risk_level'] in {'Low', 'Medium', 'High'}

    def test_top_risk_entities_sorted_desc(self, anomalies_and_dispatches):
        anomalies_df, dispatches_df = anomalies_and_dispatches
        graph = build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)

        leakages = [e['leakage_kes'] for e in graph['summary']['top_risk_entities']]
        assert leakages == sorted(leakages, reverse=True)


class TestFraudGraphEdgeCases:
    def test_empty_anomalies_returns_empty_shape(self):
        empty_anomalies = pd.DataFrame(columns=['dispatch_id', 'customer', 'leakage_kes'])
        dispatches = pd.DataFrame({'dispatch_id': [], 'omc_id': [], 'depot': []})

        graph = build_fraud_graph_from_dataframes(empty_anomalies, dispatches)

        assert graph == {
            'nodes': [],
            'edges': [],
            'communities': [],
            'summary': {
                'node_count': 0,
                'edge_count': 0,
                'community_count': 0,
                'top_risk_entities': []
            }
        }

    def test_dispatches_missing_omc_or_depot_columns(self):
        anomalies = pd.DataFrame({
            'dispatch_id': ['DISP-001'],
            'customer': ['TotalEnergies'],
            'leakage_kes': [500000]
        })
        dispatches_without_depot = pd.DataFrame({
            'dispatch_id': ['DISP-001'],
            'omc_id': ['OMC-001']
        })

        graph = build_fraud_graph_from_dataframes(anomalies, dispatches_without_depot)
        assert graph['summary']['node_count'] == 0

    def test_unmatched_dispatch_ids_dropped(self):
        anomalies = pd.DataFrame({
            'dispatch_id': ['DISP-999'],
            'customer': ['Unknown'],
            'leakage_kes': [100000]
        })
        dispatches = pd.DataFrame({
            'dispatch_id': ['DISP-001'],
            'omc_id': ['OMC-001'],
            'depot': ['Mombasa']
        })

        graph = build_fraud_graph_from_dataframes(anomalies, dispatches)
        assert graph['summary']['node_count'] == 0
