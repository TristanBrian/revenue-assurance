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
from app.core.cache import get_cached_result, set_cached_result
from app.services.reconciliation import run_reconciliation
from app.utils.db_connection import get_engine
import pandas as pd

logger = logging.getLogger(__name__)

router = APIRouter()


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

    Reuses graph_engine.build_fraud_graph_from_dataframes() — the same
    pure builder build_fraud_graph() delegates to — on both the cache-hit
    and cache-miss paths, rather than a separate reimplementation. An
    earlier version of this cache-sharing optimization built its own
    OMC-to-OMC "shared product" graph with no depot nodes at all as a
    stand-in ("we'll skip depot nodes for now... placeholder; you should
    adapt to your actual graph logic"), and that shape didn't satisfy
    FraudGraphResponse's schema (edges need anomaly_count, communities need
    node_ids/member_count/total_leakage_kes/risk_level) — every call 500'd.
    dispatches_df is a cheap single-table read either way, so reusing the
    real builder costs nothing extra on the cache-hit path.
    """
    try:
        cache_key = f"metrics_{materiality}"
        cached = get_cached_result(cache_key)

        if cached and 'anomalies' in cached:
            logger.info(f"✅ Graph using cached anomalies for materiality={materiality}")
            anomalies = cached['anomalies']
        else:
            logger.info(f"🔄 Graph cache miss – running reconciliation...")
            result = run_reconciliation(materiality=materiality)
            anomalies = result.get('anomalies', [])

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

        anomalies_df = pd.DataFrame(anomalies)
        dispatches_df = pd.read_sql("SELECT dispatch_id, omc_id, depot FROM dispatches", get_engine())
        data = graph_engine.build_fraud_graph_from_dataframes(anomalies_df, dispatches_df)
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