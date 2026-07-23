# backend/app/services/graph_engine.py
"""
Fraud Graph Service – builds an OMC <-> Depot leakage graph and runs
community detection (Louvain) to surface clusters of correlated revenue
leakage worth a closer audit.

Nodes are OMCs and depots (the two dimensions the data actually supports —
see PROBLEM_FRAMING_AND_ARCHITECTURE.md's actor list). An edge exists
wherever an anomaly ties an OMC's dispatch to a depot; edge weight is the
summed leakage_kes on that OMC-depot pair. Communities group OMCs/depots
whose leakage patterns cluster together, which is a genuine network-analysis
signal — not a "confirmed fraud" verdict, so this is deliberately labelled
as a leakage/risk cluster rather than an accusation.
"""
import pandas as pd
import networkx as nx
import community as community_louvain

from app.utils.db_connection import get_engine
from app.services.reconciliation import run_reconciliation, clean_json_values

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
