"""
TEST SUITE FOR GRAPH FEATURES — two coexisting designs (see
services/graph_engine.py's module docstring):

1. TestFraudGraphBuilding / TestFraudGraphEdgeCases: the anomaly-based
   fraud graph (build_fraud_graph_from_dataframes), DataFrame-only
   fixtures, no DB.
2. test_build_omc_depot_graph_* / test_detect_risk_communities_* /
   test_community_members_carry_risk_features: the OMC<->depot structural
   graph (build_omc_depot_graph / detect_risk_communities), in-memory
   SQLite engine fixture.

Run with: pytest tests/test_graph.py -v
"""
import os
import sys
from datetime import datetime
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import create_engine

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import detective_service
from app.services.reconciliation import run_reconciliation_on_dataframes
from app.services.graph_engine import build_fraud_graph_from_dataframes, build_omc_depot_graph, detect_risk_communities


# ==============================================================================
# 1. Anomaly-based fraud graph
# ==============================================================================

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


# ==============================================================================
# 2. OMC<->depot structural graph
# ==============================================================================

@pytest.fixture
def engine():
    eng = create_engine("sqlite:///:memory:")

    # Two clearly separate clusters, so Louvain has something to find:
    # OMC-A / OMC-B both dispatch exclusively through Depot-1 and Depot-2;
    # OMC-C / OMC-D both dispatch exclusively through Depot-3 and Depot-4.
    # No OMC in one cluster ever touches the other cluster's depots, so
    # the projected omc<->omc graph should split cleanly into 2 components
    # (also 2 communities). OMC-A and OMC-C additionally share a kra_pin,
    # to exercise the shared-identity edge path.
    omcs = pd.DataFrame(
        {
            "omc_id": ["OMC-A", "OMC-B", "OMC-C", "OMC-D"],
            "contact_email": ["a@x.com", "b@x.com", "c@x.com", "d@x.com"],
            "phone": ["+254700000001", "+254700000002", "+254700000003", "+254700000004"],
            "kra_pin": ["SHARED-PIN", "P222", "SHARED-PIN", "P444"],
        }
    )
    depots = pd.DataFrame({"depot_id": ["Depot-1", "Depot-2", "Depot-3", "Depot-4"]})

    # Columns beyond omc_id/depot/volume_liters (dispatch_id, date, product,
    # value_kes) exist only because detect_risk_communities() reuses
    # detective_service.compute_omc_risk_features(), which reads the full
    # dispatches schema — build_omc_depot_graph() itself only needs the
    # first three.
    dispatches = pd.DataFrame(
        {
            "dispatch_id": [f"DISP-{i}" for i in range(1, 9)],
            "omc_id": ["OMC-A", "OMC-A", "OMC-B", "OMC-B", "OMC-C", "OMC-C", "OMC-D", "OMC-D"],
            "date": ["2026-01-10"] * 8,
            "product": ["PMS"] * 8,
            "depot": ["Depot-1", "Depot-2", "Depot-1", "Depot-2", "Depot-3", "Depot-4", "Depot-3", "Depot-4"],
            "volume_liters": [10000, 8000, 9000, 7000, 12000, 6000, 11000, 5000],
            "value_kes": [1000000, 900000, 950000, 850000, 1200000, 700000, 1100000, 650000],
        }
    )

    omcs.to_sql("omcs", eng, index=False)
    depots.to_sql("depots", eng, index=False)
    dispatches.to_sql("dispatches", eng, index=False)

    # detective_service.compute_omc_risk_features() also queries invoices/
    # payments/quota_ledger — empty but present, so that call doesn't
    # error when detect_risk_communities() reuses it.
    pd.DataFrame(columns=["invoice_id", "dispatch_id", "omc_id", "product", "date", "value_kes"]).to_sql(
        "invoices", eng, index=False
    )
    pd.DataFrame(columns=["invoice_id", "value_kes", "date"]).to_sql("payments", eng, index=False)
    pd.DataFrame(columns=["omc_id", "current_quota_litres", "trailing_window_days"]).to_sql(
        "quota_ledger", eng, index=False
    )
    return eng


def test_build_omc_depot_graph_node_and_edge_counts(engine):
    g = build_omc_depot_graph(engine)

    # 4 OMCs + 4 depots
    omc_nodes = [n for n, d in g.nodes(data=True) if d["type"] == "omc"]
    depot_nodes = [n for n, d in g.nodes(data=True) if d["type"] == "depot"]
    assert len(omc_nodes) == 4
    assert len(depot_nodes) == 4

    # 8 omc<->depot edges (one per dispatch row, all distinct omc/depot pairs)
    omc_depot_edges = [
        (u, v) for u, v, d in g.edges(data=True) if "dispatch_count" in d
    ]
    assert len(omc_depot_edges) == 8

    # OMC-A <-> OMC-C shared_identity edge (shared kra_pin)
    assert g.has_edge("OMC-A", "OMC-C")
    assert g["OMC-A"]["OMC-C"]["shared_identity"] == "kra_pin"
    # OMC-B/OMC-D share nothing
    assert not g.has_edge("OMC-B", "OMC-D")


def test_edge_weights_reflect_dispatch_count_and_volume(engine):
    g = build_omc_depot_graph(engine)
    edge = g["OMC-A"]["Depot-1"]
    assert edge["dispatch_count"] == 1
    assert edge["total_volume_liters"] == 10000


def test_detect_risk_communities_finds_at_least_two_communities(engine):
    communities = detect_risk_communities(engine)
    assert len(communities) >= 2

    omc_to_community = {}
    for c in communities:
        for omc_id in c["omc_ids"]:
            omc_to_community[omc_id] = c["community_id"]

    # OMC-A and OMC-B (both Depot-1/Depot-2 only) must land in the same
    # community; OMC-C and OMC-D (both Depot-3/Depot-4 only) must land in
    # the same community; the two pairs must be different communities.
    assert omc_to_community["OMC-A"] == omc_to_community["OMC-B"]
    assert omc_to_community["OMC-C"] == omc_to_community["OMC-D"]
    assert omc_to_community["OMC-A"] != omc_to_community["OMC-C"]


def test_detect_risk_communities_reuses_single_detective_service_call(engine):
    """compute_omc_risk_features must be called exactly once — reused
    across all communities, not recomputed per community (redundant DB
    round-trips)."""
    with patch.object(
        detective_service, "compute_omc_risk_features", wraps=detective_service.compute_omc_risk_features
    ) as spy:
        communities = detect_risk_communities(engine)
        assert len(communities) >= 2  # sanity: the run actually did something
        assert spy.call_count == 1


def test_community_members_carry_risk_features(engine):
    communities = detect_risk_communities(engine)
    for c in communities:
        assert set(c["members"][0].keys()) >= {"omc_id", "ghost_load_rate", "aging_severity"}
        member_ids = {m["omc_id"] for m in c["members"]}
        assert member_ids == set(c["omc_ids"])
