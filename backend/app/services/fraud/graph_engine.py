# backend/app/services/fraud/graph_engine.py
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
from app.services.reconciliation.reconciliation import run_reconciliation, clean_json_values
from app.services.fraud import detective_service

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

    # Reconciliation anomaly rows may already carry depot metadata. Use an
    # explicit suffix for the dispatch-side copy so the two sources do not
    # become depot_x/depot_y and leave the graph builder without the plain
    # depot column it expects below.
    merged = anomalies_df.merge(
        dispatches_df[['dispatch_id', 'omc_id', 'depot']],
        on='dispatch_id',
        how='left',
        suffixes=('', '_dispatch'),
    )
    if 'depot_dispatch' in merged.columns:
        if 'depot' in merged.columns:
            merged['depot'] = merged['depot'].combine_first(merged['depot_dispatch'])
        else:
            merged = merged.rename(columns={'depot_dispatch': 'depot'})
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
# Outbound (stipend/disbursement) anomaly-based fraud graph — Stage 2.
# Mirrors build_fraud_graph_from_dataframes() above (Officer<->Beneficiary in
# place of OMC<->Depot), with one addition: build_fraud_graph_from_dataframes
# needs a merge against `dispatches` because the inbound anomaly dict only
# carries `customer` (an OMC name), not `omc_id`/`depot`. The outbound
# anomaly dict already carries `officer_id`/`beneficiary_id` directly
# (see _build_outbound_anomaly() in reconciliation.py), so no merge/second
# dataframe is required for that part. What outbound needs that inbound
# doesn't is disbursements_df: inject_disbursement_ring()'s fraud signal is
# several beneficiaries sharing one `disbursing_account`, and that column
# doesn't exist anywhere in an anomaly dict (it isn't a reconciliation
# break, just a ring signal) — so it's added as direct beneficiary<->
# beneficiary edges from the raw disbursements table, the same role
# build_omc_depot_graph()'s shared contact_email/phone/kra_pin edges play
# for OMCs, just inlined here instead of in the separate structural-graph
# section below (a full parallel /network,/communities,/omc/{id}-style
# structural subsystem for officers is a bigger lift than this endpoint,
# the one the dashboard's FraudGraph component actually renders, needs).
# ==============================================================================

def build_outbound_fraud_graph_from_dataframes(anomalies_df: pd.DataFrame, disbursements_df: Optional[pd.DataFrame] = None) -> dict:
    """
    Pure function: build the Officer<->Beneficiary leakage graph from an
    outbound anomalies DataFrame (dispatch_id, officer_id, beneficiary_id,
    customer, leakage_kes, ...), plus optional direct beneficiary<->
    beneficiary edges for shared disbursing_account (ring detection).
    """
    if anomalies_df.empty or 'officer_id' not in anomalies_df.columns:
        return _empty_graph_result()

    pair_source = anomalies_df.dropna(subset=['officer_id', 'beneficiary_id'])
    if pair_source.empty:
        return _empty_graph_result()

    pair_stats = pair_source.groupby(['officer_id', 'beneficiary_id', 'customer']).agg(
        leakage_kes=('leakage_kes', 'sum'),
        anomaly_count=('dispatch_id', 'count')
    ).reset_index()

    # Two separate edge weights, deliberately not the same number:
    # - 'leakage_weight' is real KES leakage, summed into each node's
    #   displayed leakage_kes/risk_level below — a ring edge contributes 0
    #   here since sharing a disbursing_account isn't itself a leakage
    #   amount, just a structural fraud signal, and inflating displayed
    #   leakage would misrepresent the dashboard's headline numbers.
    # - 'weight' is what community_louvain.best_partition() clusters on.
    #   If ring edges used the same real-KES scale as leakage edges,
    #   Louvain would keep pulling ring beneficiaries into their own
    #   officer's community (typically far more total leakage on that
    #   edge than the flat ring signal) instead of grouping them with
    #   each other — RING_CLUSTER_WEIGHT is set an order of magnitude
    #   above realistic per-pair leakage sums specifically so shared-
    #   account beneficiaries reliably land in one community together,
    #   which is the whole point of surfacing this edge at all.
    RING_CLUSTER_WEIGHT = 10_000_000.0

    G = nx.Graph()
    beneficiary_labels: dict = {}
    for _, row in pair_stats.iterrows():
        officer_node = f"officer:{row['officer_id']}"
        beneficiary_node = f"beneficiary:{row['beneficiary_id']}"
        beneficiary_labels[beneficiary_node] = row['customer']
        G.add_edge(
            officer_node, beneficiary_node,
            weight=float(row['leakage_kes']),
            leakage_weight=float(row['leakage_kes']),
            anomaly_count=int(row['anomaly_count'])
        )

    # Ring signal: beneficiaries paid out of the same disbursing_account.
    # Direct beneficiary<->beneficiary edges, same pattern as
    # build_omc_depot_graph()'s shared-identity edges — these are what let
    # inject_disbursement_ring()'s beneficiaries cluster together in their
    # own community even when they don't share an officer.
    if disbursements_df is not None and not disbursements_df.empty and \
            {'beneficiary_id', 'disbursing_account'}.issubset(disbursements_df.columns):
        for _, group in disbursements_df.dropna(subset=['disbursing_account']).groupby('disbursing_account')['beneficiary_id']:
            members = sorted(set(group.tolist()))
            if len(members) < 2:
                continue
            for i in range(len(members)):
                for j in range(i + 1, len(members)):
                    a, b = f"beneficiary:{members[i]}", f"beneficiary:{members[j]}"
                    if G.has_edge(a, b):
                        G[a][b]['weight'] = G[a][b].get('weight', 0.0) + RING_CLUSTER_WEIGHT
                        G[a][b]['shared_account'] = True
                    else:
                        G.add_edge(a, b, weight=RING_CLUSTER_WEIGHT, leakage_weight=0.0, anomaly_count=0, shared_account=True)
                    beneficiary_labels.setdefault(a, members[i])
                    beneficiary_labels.setdefault(b, members[j])

    if G.number_of_edges() == 0:
        return _empty_graph_result()

    partition = community_louvain.best_partition(G, weight='weight')

    weighted_degree = dict(G.degree(weight='leakage_weight'))
    anomaly_degree: dict = {n: 0 for n in G.nodes}
    for u, v, data in G.edges(data=True):
        anomaly_degree[u] += data.get('anomaly_count', 0)
        anomaly_degree[v] += data.get('anomaly_count', 0)

    nodes = []
    for node_id in G.nodes:
        node_type = 'officer' if node_id.startswith('officer:') else 'beneficiary'
        raw_id = node_id.split(':', 1)[1]
        label = beneficiary_labels.get(node_id, raw_id) if node_type == 'beneficiary' else raw_id
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
            # Real leakage_weight, not the boosted 'weight' Louvain
            # clustered on — a shared_account ring edge should show as
            # 0 KES here (it isn't leakage), not RING_CLUSTER_WEIGHT.
            'weight': data.get('leakage_weight', data['weight']),
            'anomaly_count': data.get('anomaly_count', 0),
            'shared_account': data.get('shared_account', False),
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


def build_outbound_fraud_graph(materiality: float = 0) -> dict:
    """DB-backed wrapper for build_outbound_fraud_graph_from_dataframes()."""
    from app.services.reconciliation.reconciliation import run_outbound_reconciliation
    result = run_outbound_reconciliation(materiality=materiality)
    anomalies_df = pd.DataFrame(result.get('anomalies', []))

    engine = get_engine()
    try:
        disbursements_df = pd.read_sql("SELECT beneficiary_id, disbursing_account FROM disbursements", engine)
    except Exception:
        disbursements_df = None

    return build_outbound_fraud_graph_from_dataframes(anomalies_df, disbursements_df)


def _merge_graph_results(a: dict, b: dict) -> dict:
    """Concatenates two build_fraud_graph_from_dataframes()-shaped results
    (used for direction="all"). Community ids are re-namespaced with a
    large integer offset (rather than merged by Louvain across both graphs
    at once, which would require rebuilding one combined nx.Graph out of
    two otherwise-disconnected node sets for no analytical benefit — an
    inbound OMC and an outbound officer never actually interact) so an
    inbound community id and an outbound community id never collide.
    Kept as an int offset rather than a string prefix (e.g. "out-3")
    specifically because GraphNode.community/GraphCommunity.id are typed
    `int` in schemas/fraud/graph.py — a string would fail response
    validation on every direction="all" request."""
    if not a.get('nodes'):
        return b
    if not b.get('nodes'):
        return a

    # Comfortably above any realistic Louvain partition id (community ids
    # are small sequential ints starting at 0) from either graph.
    OUTBOUND_COMMUNITY_OFFSET = 100_000

    for community in b['communities']:
        community['id'] = community['id'] + OUTBOUND_COMMUNITY_OFFSET
    for node in b['nodes']:
        node['community'] = node['community'] + OUTBOUND_COMMUNITY_OFFSET

    merged_communities = sorted(a['communities'] + b['communities'], key=lambda c: c['total_leakage_kes'], reverse=True)
    merged_top_risk = sorted(
        a['summary']['top_risk_entities'] + b['summary']['top_risk_entities'],
        key=lambda n: n['leakage_kes'],
        reverse=True
    )[:5]

    return {
        'nodes': a['nodes'] + b['nodes'],
        'edges': a['edges'] + b['edges'],
        'communities': merged_communities,
        'summary': {
            'node_count': a['summary']['node_count'] + b['summary']['node_count'],
            'edge_count': a['summary']['edge_count'] + b['summary']['edge_count'],
            'community_count': a['summary']['community_count'] + b['summary']['community_count'],
            'top_risk_entities': merged_top_risk,
        }
    }


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
