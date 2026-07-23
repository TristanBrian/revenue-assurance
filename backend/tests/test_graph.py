"""
Tests for services/graph_engine.py.

Same in-memory SQLite engine approach as test_detective_service.py.

Run with: pytest tests/test_graph.py -v
"""
import os
import sys
from unittest.mock import patch

import pandas as pd
import pytest
from sqlalchemy import create_engine

sys.path.append(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from app.services import detective_service
from app.services.graph_engine import build_omc_depot_graph, detect_risk_communities


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
    pd.DataFrame(columns=["invoice_id", "total_paid_kes", "date"]).to_sql("payments", eng, index=False)
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
