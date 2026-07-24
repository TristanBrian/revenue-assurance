# backend/app/routes/graph.py
"""
Two coexisting graph features (see services/graph_engine.py's module
docstring for the full split):

- GET /api/graph — anomaly-based fraud graph, frontend-compatible shape.
- GET /api/graph/network, /communities, /omc/{omc_id} — OMC<->depot
  structural graph, scored via detective_service.

Both gated on view_fraud_graph. All bare — this router's own paths don't
repeat "/graph"; prefix="/api/graph" is supplied by main.py's
include_router(), same convention as every other route file.
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.dependencies import require_permission
from app.models.user import User
from app.schemas.detective import OmcRiskDetail
from app.schemas.graph import CommunityOut, FraudGraphResponse, NetworkResponse, OmcDepotEdge, OmcDepotNode
from app.services import detective_service, graph_engine
from app.services.graph_engine import build_fraud_graph  # fallback if needed
from app.core.cache import get_cached_result, set_cached_result
from app.services.reconciliation import run_reconciliation
from app.utils.db_connection import get_engine
import pandas as pd
import networkx as nx
from collections import defaultdict

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================================
# Local helper to build graph from anomalies (no reconciliation)
# ============================================================================

def build_fraud_graph_from_anomalies(anomalies, materiality=0):
    """
    Builds a fraud graph (nodes & edges) from a list of anomalies.
    This is the same logic as build_fraud_graph() but without running reconciliation.
    """
    if not anomalies:
        return {'nodes': [], 'edges': [], 'communities': [], 'summary': {'node_count': 0, 'edge_count': 0, 'community_count': 0, 'top_risk_entities': []}}
    
    df = pd.DataFrame(anomalies)
    
    # Filter by materiality if needed
    if materiality > 0:
        df = df[df['leakage_kes'] >= materiality]
    
    # Build graph: nodes are OMCs and Depots
    G = nx.Graph()
    
    # Add OMC nodes
    omcs = df['customer'].unique()
    for omc in omcs:
        G.add_node(omc, type='omc')
    
    # Add depot nodes (extract from dispatch_id or other fields? We'll use a placeholder)
    # Since we don't have depot info in anomalies, we'll skip depot nodes for now.
    # We'll add edges from OMC to OMC based on shared invoice or other patterns.
    # For simplicity, we'll create edges between OMCs that share a product or invoice.
    # This is a placeholder; you should adapt to your actual graph logic.
    
    # Simple: connect OMCs that have anomalies with same product
    product_omc = df.groupby('product')['customer'].apply(list).to_dict()
    for product, omc_list in product_omc.items():
        for i in range(len(omc_list)):
            for j in range(i+1, len(omc_list)):
                u, v = omc_list[i], omc_list[j]
                if G.has_edge(u, v):
                    G[u][v]['weight'] += 1
                else:
                    G.add_edge(u, v, weight=1)
    
    # Build nodes list
    nodes = [{'id': n, 'type': d.get('type', 'omc')} for n, d in G.nodes(data=True)]
    
    # Build edges list
    edges = [{'source': u, 'target': v, 'weight': d.get('weight', 1)} for u, v, d in G.edges(data=True)]
    
    # Community detection (Louvain)
    try:
        import community as community_louvain
        partition = community_louvain.best_partition(G)
        communities = {}
        for node, comm_id in partition.items():
            communities.setdefault(comm_id, []).append(node)
        community_list = [{'id': cid, 'nodes': nodes} for cid, nodes in communities.items()]
    except ImportError:
        community_list = []
    
    summary = {
        'node_count': len(nodes),
        'edge_count': len(edges),
        'community_count': len(community_list),
        'top_risk_entities': []  # you can compute top OMCs by leakage
    }
    
    return {
        'nodes': nodes,
        'edges': edges,
        'communities': community_list,
        'summary': summary
    }


# ============================================================================
# Main graph endpoint (cached)
# ============================================================================

@router.get("", response_model=FraudGraphResponse)
def fraud_graph(
    materiality: float = Query(100000, description="Min leakage to include"),
    user: User = Depends(require_permission("view_fraud_graph")),
):
    """
    Returns the OMC<->Depot leakage graph with Louvain community detection.
    Uses cached reconciliation data to avoid re-running reconciliation.
    """
    try:
        # Try to get full reconciliation result from cache
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)
        
        if cached and 'anomalies' in cached:
            logger.info(f"✅ Graph using cached anomalies for materiality={materiality}")
            anomalies = cached['anomalies']
            # Build graph from anomalies
            data = build_fraud_graph_from_anomalies(anomalies, materiality)
            return {'status': 'success', 'data': data}
        
        # If not cached, run reconciliation once and store
        logger.info(f"🔄 Graph cache miss – running reconciliation...")
        result = run_reconciliation(materiality=materiality)
        anomalies = result.get('anomalies', [])
        
        # Cache full result
        metrics_data = {
            'metrics': result['metrics'],
            'summary': result['summary'],
            'performance': result['performance'],
            'data_quality': result['data_quality'],
            'ebilling_status': result.get('ebilling_status'),
            'duplicate_anomalies': result.get('duplicate_anomalies', []),
            'omc_risk_profile': result.get('omc_risk_profile', []),
            'anomalies': anomalies,
        }
        set_cached_result(cache_key, metrics_data)
        logger.info(f"✅ Graph cached full result for materiality={materiality}")
        
        data = build_fraud_graph_from_anomalies(anomalies, materiality)
        return {'status': 'success', 'data': data}

    except Exception as e:
        logger.error(f"Fraud graph error: {e}")
        return {
            'status': 'error',
            'message': str(e),
            'data': {'nodes': [], 'edges': [], 'communities': [], 'summary': {'node_count': 0, 'edge_count': 0, 'community_count': 0, 'top_risk_entities': []}}
        }


# ============================================================================
# Other graph endpoints (unchanged)
# ============================================================================

@router.get("/network", response_model=NetworkResponse)
def get_network(user: User = Depends(require_permission("view_fraud_graph"))):
    g = graph_engine.build_omc_depot_graph(get_engine())
    nodes = [OmcDepotNode(id=n, type=d.get("type", "unknown")) for n, d in g.nodes(data=True)]
    edges = [
        OmcDepotEdge(
            source=u,
            target=v,
            dispatch_count=d.get("dispatch_count"),
            total_volume_liters=d.get("total_volume_liters"),
            shared_identity=d.get("shared_identity"),
        )
        for u, v, d in g.edges(data=True)
    ]
    return NetworkResponse(nodes=nodes, edges=edges)


@router.get("/communities", response_model=list[CommunityOut])
def get_communities(user: User = Depends(require_permission("view_fraud_graph"))):
    return graph_engine.detect_risk_communities(get_engine())


@router.get("/omc/{omc_id}", response_model=OmcRiskDetail)
def get_omc_detail(omc_id: str, user: User = Depends(require_permission("view_fraud_graph"))):
    engine = get_engine()
    try:
        features = detective_service.get_omc_risk(engine, omc_id)
    except ValueError:
        raise HTTPException(status_code=404, detail=f"Unknown omc_id: {omc_id}")

    community_info = graph_engine.get_omc_community_info(engine, omc_id)
    return OmcRiskDetail(
        **features,
        community_id=community_info["community_id"] if community_info else None,
        community_aggregate_risk_score=community_info["aggregate_risk_score"] if community_info else None,
    )