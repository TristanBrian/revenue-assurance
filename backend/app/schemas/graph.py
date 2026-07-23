"""
Pydantic response schema for routes/graph.py.

Note: there is no app/models/graph.py to mirror — like heatmap.py, this has
no backing SQLAlchemy model (it's derived in-memory from reconciliation
anomalies + the dispatches table, see app/services/graph_engine.py).
"""
from typing import Optional

from pydantic import BaseModel


class GraphNode(BaseModel):
    id: str
    type: str
    label: str
    leakage_kes: float
    anomaly_count: int
    community: int
    risk_level: str


class GraphEdge(BaseModel):
    source: str
    target: str
    weight: float
    anomaly_count: int


class GraphCommunity(BaseModel):
    id: int
    node_ids: list[str]
    member_count: int
    total_leakage_kes: float
    risk_level: str


class TopRiskEntity(BaseModel):
    id: str
    label: str
    type: str
    leakage_kes: float
    risk_level: str


class GraphSummary(BaseModel):
    node_count: int
    edge_count: int
    community_count: int
    top_risk_entities: list[TopRiskEntity]


class FraudGraphData(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]
    communities: list[GraphCommunity]
    summary: GraphSummary


class FraudGraphResponse(BaseModel):
    """GET /graph. 'message' is only present on the caught-exception error
    path (status='error'), same convention as HeatmapResponse."""
    status: str
    data: FraudGraphData
    message: Optional[str] = None
