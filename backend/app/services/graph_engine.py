"""
graph_engine.py — structural/network layer: graph building and community
detection only. No feature-computation logic lives here — that's
detective_service.py's job. This file imports FROM detective_service,
never the reverse; detective_service and its routes must keep working with
networkx entirely absent from the import graph.

No caching/background-job infrastructure here either — synchronous
computation only, same note as detective_service.py.
"""
from typing import Optional

import networkx as nx
import pandas as pd
from networkx.algorithms import bipartite
from networkx.algorithms.community import louvain_communities

from app.services import detective_service


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
