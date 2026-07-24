# backend/app/services/graph_engine.py
"""
Two coexisting graph features live here — no name collisions between them,
so they share this file rather than splitting into two:

1. Anomaly-based fraud graph (build_fraud_graph / build_fraud_graph_from_dataframes):
   builds an OMC<->Depot leakage graph from reconciliation anomalies, weight
   = summed leakage_kes. Community detection via python-louvain
   (`import community as community_louvain`). Backs GET /api/graph — the
   frontend's FraudGraph component/api.ts was built directly against this
   shape, so its node/edge/community fields aren't renamed even though the
   structural graph below happens to use similar names for a different
   design.

2. OMC<->depot structural graph (build_omc_depot_graph / detect_risk_communities
   / get_omc_community_info): builds the same OMC<->Depot graph but from raw
   dispatch/omc/depot data (not anomalies), plus direct omc<->omc edges for
   shared contact_email/phone/kra_pin. Projects to omc<->omc via depot
   overlap and runs Louvain via networkx's own
   networkx.algorithms.community.louvain_communities (not python-louvain).
   Imports FROM detective_service for per-OMC risk scoring, never the
   reverse — detective_service and its routes must keep working with
   networkx entirely absent from the import graph. Backs
   GET /api/graph/network, /communities, /omc/{omc_id}.

No caching/background-job infrastructure in either — synchronous
computation only, same note as detective_service.py.
"""
from typing import Optional

import pandas as pd
import networkx as nx
import community as community_louvain
from networkx.algorithms import bipartite
from networkx.algorithms.community import louvain_communities

from app.utils.db_connection import get_engine
from app.services.reconciliation import run_reconciliation, clean_json_values
from app.services import detective_service

# Same bins used by calculate_omc_risk() in reconciliation.py, applied here
# per-node/per-community instead of via pd.cut over a whole column.
_RISK_HIGH_THRESHOLD = 1_000_000
_RISK_MEDIUM_THRESHOLD = 100_000


def _risk_level(leakage_kes: float) -> str:
    if leakage_kes > _RISK_HIGH_THRESHOLD:
        return 'High'
    elif leakage_kes > _RISK_MEDIUM_THRESHOLD:
        return 'Medium'
    return 'Low'


def _empty_graph_result() -> dict:
    return {
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


def build_fraud_graph_from_dataframes(anomalies_df: pd.DataFrame, dispatches_df: pd.DataFrame) -> dict:
    """
    Pure function: build the OMC<->Depot leakage graph from an anomalies
    DataFrame (dispatch_id, customer, leakage_kes, ...) and a dispatches
    DataFrame (dispatch_id, omc_id, depot). No DB access — mirrors
    run_reconciliation_on_dataframes()'s testability.
    """
    if anomalies_df.empty or 'dispatch_id' not in anomalies_df.columns:
        return _empty_graph_result()

    required_disp_cols = {'dispatch_id', 'omc_id', 'depot'}
    if not required_disp_cols.issubset(dispatches_df.columns):
        return _empty_graph_result()

    merged = anomalies_df.merge(
        dispatches_df[['dispatch_id', 'omc_id', 'depot']],
        on='dispatch_id',
        how='left'
    )
    merged = merged.dropna(subset=['omc_id', 'depot'])

    if merged.empty:
        return _empty_graph_result()

    # Aggregate OMC<->Depot pairs before building edges, so repeated
    # dispatches between the same pair become one weighted edge.
    pair_stats = merged.groupby(['omc_id', 'customer', 'depot']).agg(
        leakage_kes=('leakage_kes', 'sum'),
        anomaly_count=('dispatch_id', 'count')
    ).reset_index()

    G = nx.Graph()
    omc_labels: dict = {}
    for _, row in pair_stats.iterrows():
        omc_node = f"omc:{row['omc_id']}"
        depot_node = f"depot:{row['depot']}"
        omc_labels[omc_node] = row['customer']
        G.add_edge(
            omc_node, depot_node,
            weight=float(row['leakage_kes']),
            anomaly_count=int(row['anomaly_count'])
        )

    if G.number_of_edges() == 0:
        return _empty_graph_result()

    partition = community_louvain.best_partition(G, weight='weight')

    weighted_degree = dict(G.degree(weight='weight'))
    anomaly_degree: dict = {n: 0 for n in G.nodes}
    for u, v, data in G.edges(data=True):
        anomaly_degree[u] += data['anomaly_count']
        anomaly_degree[v] += data['anomaly_count']

    nodes = []
    for node_id in G.nodes:
        node_type = 'omc' if node_id.startswith('omc:') else 'depot'
        label = omc_labels[node_id] if node_type == 'omc' else node_id.split(':', 1)[1]
        leakage = weighted_degree.get(node_id, 0.0)
        nodes.append({
            'id': node_id,
            'type': node_type,
            'label': label,
            'leakage_kes': leakage,
            'anomaly_count': anomaly_degree.get(node_id, 0),
            'community': partition.get(node_id, 0),
            'risk_level': _risk_level(leakage)
        })

    edges = [
        {
            'source': u,
            'target': v,
            'weight': data['weight'],
            'anomaly_count': data['anomaly_count']
        }
        for u, v, data in G.edges(data=True)
    ]

    communities_map: dict = {}
    for node in nodes:
        cid = node['community']
        bucket = communities_map.setdefault(cid, {'id': cid, 'node_ids': [], 'total_leakage_kes': 0.0})
        bucket['node_ids'].append(node['id'])
        bucket['total_leakage_kes'] += node['leakage_kes']

    communities = []
    for bucket in communities_map.values():
        communities.append({
            'id': bucket['id'],
            'node_ids': bucket['node_ids'],
            'member_count': len(bucket['node_ids']),
            'total_leakage_kes': bucket['total_leakage_kes'],
            'risk_level': _risk_level(bucket['total_leakage_kes'])
        })
    communities.sort(key=lambda c: c['total_leakage_kes'], reverse=True)

    top_risk_entities = sorted(
        [{'id': n['id'], 'label': n['label'], 'type': n['type'], 'leakage_kes': n['leakage_kes'], 'risk_level': n['risk_level']} for n in nodes],
        key=lambda n: n['leakage_kes'],
        reverse=True
    )[:5]

    result = {
        'nodes': nodes,
        'edges': edges,
        'communities': communities,
        'summary': {
            'node_count': len(nodes),
            'edge_count': len(edges),
            'community_count': len(communities),
            'top_risk_entities': top_risk_entities
        }
    }
    return clean_json_values(result)


def build_fraud_graph(materiality: float = 0) -> dict:
    """DB-backed wrapper: loads anomalies + dispatch->OMC/depot mapping, delegates to the pure builder."""
    result = run_reconciliation(materiality=materiality)
    anomalies_df = pd.DataFrame(result.get('anomalies', []))

    engine = get_engine()
    dispatches_df = pd.read_sql("SELECT dispatch_id, omc_id, depot FROM dispatches", engine)

    return build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)


# ==============================================================================
# OMC<->depot structural graph (see module docstring, part 2)
# ==============================================================================

def build_omc_depot_graph(engine) -> nx.Graph:
    """Nodes: one per omc_id, one per depot_id. Edges: omc<->depot from
    dispatches (weight = dispatch_count and total_volume_liters), plus
    direct omc<->omc edges where two OMCs share a contact_email, phone, or
    kra_pin (edge attribute "shared_identity" names which field(s)
    matched)."""
    omcs = pd.read_sql("SELECT omc_id, contact_email, phone, kra_pin FROM omcs", engine)
    depots = pd.read_sql("SELECT depot_id FROM depots", engine)
    dispatches = pd.read_sql("SELECT omc_id, depot AS depot_id, volume_liters FROM dispatches", engine)

    g = nx.Graph()
    for omc_id in omcs["omc_id"]:
        g.add_node(omc_id, type="omc")
    for depot_id in depots["depot_id"]:
        g.add_node(depot_id, type="depot")

    edge_stats = (
        dispatches.groupby(["omc_id", "depot_id"])["volume_liters"]
        .agg(dispatch_count="count", total_volume_liters="sum")
        .reset_index()
    )
    for _, row in edge_stats.iterrows():
        if row["omc_id"] in g and row["depot_id"] in g:
            g.add_edge(
                row["omc_id"],
                row["depot_id"],
                dispatch_count=int(row["dispatch_count"]),
                total_volume_liters=int(row["total_volume_liters"]),
            )

    for field in ["contact_email", "phone", "kra_pin"]:
        for _, group in omcs.dropna(subset=[field]).groupby(field)["omc_id"]:
            members = group.tolist()
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    a, b = members[i], members[j]
                    if g.has_edge(a, b) and "shared_identity" in g[a][b]:
                        matched_fields = set(g[a][b]["shared_identity"].split(",(")[0].split(","))
                        matched_fields.add(field)
                        g[a][b]["shared_identity"] = ",".join(sorted(matched_fields))
                    else:
                        g.add_edge(a, b, shared_identity=field)
    return g


def _bipartite_subgraph(full_graph: nx.Graph) -> tuple[nx.Graph, set, set]:
    """Extracts just the omc<->depot edges from build_omc_depot_graph's
    output — the direct shared-identity omc<->omc edges aren't part of the
    depot-overlap projection below."""
    omc_nodes = {n for n, d in full_graph.nodes(data=True) if d.get("type") == "omc"}
    depot_nodes = {n for n, d in full_graph.nodes(data=True) if d.get("type") == "depot"}

    bg = nx.Graph()
    bg.add_nodes_from(omc_nodes, type="omc")
    bg.add_nodes_from(depot_nodes, type="depot")
    for u, v, data in full_graph.edges(data=True):
        if (u in omc_nodes and v in depot_nodes) or (u in depot_nodes and v in omc_nodes):
            bg.add_edge(u, v, **data)
    return bg, omc_nodes, depot_nodes


def detect_risk_communities(engine) -> list[dict]:
    """Projects the omc<->depot bipartite graph to omc<->omc (edge weight
    = number of depots two OMCs both use — the simpler of the two options
    for "shared depot overlap", chosen over cosine similarity of depot
    volume vectors since it's simpler to implement correctly), runs
    Louvain community detection on that projection, then attaches each
    member's risk features from a SINGLE detective_service call (reused
    across all communities, not recomputed per community, to avoid
    redundant DB round-trips)."""
    full_graph = build_omc_depot_graph(engine)
    bipartite_graph, omc_nodes, _ = _bipartite_subgraph(full_graph)

    if not omc_nodes:
        return []

    projected = bipartite.weighted_projected_graph(bipartite_graph, omc_nodes)
    if projected.number_of_nodes() == 0:
        return []

    communities = louvain_communities(projected, weight="weight", seed=42)

    all_features = detective_service.compute_omc_risk_features(engine)
    features_by_omc = all_features.set_index("omc_id")

    result = []
    for community_id, members in enumerate(communities):
        member_ids = sorted(members)
        member_features = features_by_omc.loc[features_by_omc.index.intersection(member_ids)]

        # Aggregate risk score: equal-weight mean of 5 features per member,
        # then averaged across the community. value_delta_zscore is
        # clipped to [-3, 3] and rescaled to [0, 1] before averaging in
        # (a z of +/-3 already represents an extreme outlier; a per-
        # community min-max instead would be circular/unstable for small
        # communities). This weighting — equal weight, simple mean, no
        # feature has more influence than another — is a judgment call
        # with no real-data validation yet. Adjust here once real fraud
        # cases are seen and it's clear which signals actually matter more.
        if not member_features.empty:
            normalized_zscore = (member_features["value_delta_zscore"].clip(-3, 3) + 3) / 6
            per_member_score = pd.concat(
                [
                    member_features["ghost_load_rate"],
                    member_features["unmatched_payment_rate"],
                    member_features["product_mismatch_rate"],
                    normalized_zscore.rename("value_delta_zscore_normalized"),
                    member_features["aging_severity"],
                ],
                axis=1,
            ).mean(axis=1, skipna=True)
            aggregate_risk_score = float(per_member_score.mean(skipna=True))
        else:
            aggregate_risk_score = None

        result.append(
            {
                "community_id": community_id,
                "omc_ids": member_ids,
                "aggregate_risk_score": aggregate_risk_score,
                "members": member_features.reset_index().to_dict(orient="records"),
            }
        )

    return result


def get_omc_community_info(engine, omc_id: str) -> Optional[dict]:
    """{'community_id', 'aggregate_risk_score'} for the community omc_id
    belongs to, or None if community detection doesn't place it in any
    (e.g. an OMC with no depot overlap with anyone else)."""
    for community in detect_risk_communities(engine):
        if omc_id in community["omc_ids"]:
            return {
                "community_id": community["community_id"],
                "aggregate_risk_score": community["aggregate_risk_score"],
            }
    return None
