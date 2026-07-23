"""
Structural/network endpoints — the fraud/graph detection feature.

Thin routes, same convention as routes/auth.py and routes/detective.py.
Gated on "view_fraud_graph" (existing permission, correct for these three
since they ARE the graph feature — unlike routes/detective.py, which is
gated on the separate "view_risk_analytics").
"""
from fastapi import APIRouter, Depends, HTTPException

from app.core.dependencies import require_permission
from app.models.user import User
from app.schemas.graph import CommunityOut, GraphEdge, GraphNode, NetworkResponse
from app.schemas.detective import OmcRiskDetail
from app.services import detective_service, graph_engine
from app.utils.db_connection import get_engine

router = APIRouter()  # prefix="/api/graph" and tags supplied by main.py's include_router()


@router.get("/network", response_model=NetworkResponse)
async def get_network(user: User = Depends(require_permission("view_fraud_graph"))):
    g = graph_engine.build_omc_depot_graph(get_engine())
    nodes = [GraphNode(id=n, type=d.get("type", "unknown")) for n, d in g.nodes(data=True)]
    edges = [
        GraphEdge(
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
