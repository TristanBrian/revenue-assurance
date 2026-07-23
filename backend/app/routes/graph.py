# backend/app/routes/graph.py
"""
Two coexisting graph features (see services/graph_engine.py's module
docstring for the full split):

- GET /api/graph — anomaly-based fraud graph, frontend-compatible shape.
- GET /api/graph/network, /communities, /omc/{omc_id} — OMC<->depot
  structural graph, scored via detective_service.

Both gated on view_fraud_graph. All bare — this router's own paths don't
repeat "/graph"; prefix="/api/graph" is supplied by main.py's
include_router(), same convention as every other route file. (The path
was previously "/graph" here on TOP of that prefix, producing
/api/graph/graph — a real bug the frontend would have 404'd on, fixed by
this change.)
"""
import logging

from fastapi import APIRouter, Depends, HTTPException, Query

from app.core.dependencies import require_permission
from app.models.user import User
from app.schemas.detective import OmcRiskDetail
from app.schemas.graph import CommunityOut, FraudGraphResponse, NetworkResponse, OmcDepotEdge, OmcDepotNode
from app.services import detective_service, graph_engine
from app.services.graph_engine import build_fraud_graph
from app.utils.db_connection import get_engine

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("", response_model=FraudGraphResponse)
async def fraud_graph(
    materiality: float = Query(0, description="Min leakage to include"),
    user: User = Depends(require_permission("view_fraud_graph")),
):
    """
    Returns the OMC<->Depot leakage graph with Louvain community detection —
    clusters of correlated revenue leakage worth a closer audit.
    """
    try:
        data = build_fraud_graph(materiality=materiality)
        return {
            'status': 'success',
            'data': data
        }
    except Exception as e:
        logger.error(f"Fraud graph error: {e}")
        return {
            'status': 'error',
            'message': str(e),
            'data': {'nodes': [], 'edges': [], 'communities': [], 'summary': {'node_count': 0, 'edge_count': 0, 'community_count': 0, 'top_risk_entities': []}}
        }


@router.get("/network", response_model=NetworkResponse)
async def get_network(user: User = Depends(require_permission("view_fraud_graph"))):
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
async def get_communities(user: User = Depends(require_permission("view_fraud_graph"))):
    return graph_engine.detect_risk_communities(get_engine())


@router.get("/omc/{omc_id}", response_model=OmcRiskDetail)
async def get_omc_detail(omc_id: str, user: User = Depends(require_permission("view_fraud_graph"))):
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
