# backend/app/routes/graph.py
from fastapi import APIRouter, Depends, Query
from app.services.graph_engine import build_fraud_graph
from app.schemas.graph import FraudGraphResponse
from app.core.dependencies import require_permission
from app.models.user import User
import logging

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/graph", response_model=FraudGraphResponse)
async def fraud_graph(
    materiality: float = Query(0, description="Min leakage to include"),
    _user: User = Depends(require_permission("view_fraud_graph")),
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
