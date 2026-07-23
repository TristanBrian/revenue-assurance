"""
Pydantic response schemas for routes/graph.py — two coexisting graph
features, each with its own schema set (no shared names):

- Anomaly-based fraud graph (GraphNode/GraphEdge/.../FraudGraphResponse):
  OMC<->Depot leakage graph built from reconciliation anomalies, Louvain
  via python-louvain. GET /api/graph. The frontend's types.ts mirrors this
  shape directly — don't rename these.
- OMC<->depot structural graph (OmcDepotNode/OmcDepotEdge/NetworkResponse/
  CommunityOut): built from raw dispatch/omc/depot data (not anomalies),
  Louvain via networkx's built-in community detection, scored via
  detective_service. GET /api/graph/network, /communities, /omc/{omc_id}.

Note: there is no app/models/graph.py to mirror either — like heatmap.py,
neither has a backing SQLAlchemy model.
"""
from typing import Optional

from pydantic import BaseModel

from app.schemas.detective import OmcRiskFeatures


# --- Anomaly-based fraud graph (GET /api/graph) ------------------------------

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
    """GET /api/graph. 'message' is only present on the caught-exception
    error path (status='error'), same convention as HeatmapResponse."""
    status: str
    data: FraudGraphData
    message: Optional[str] = None


# --- OMC<->depot structural graph (GET /api/graph/network, /communities, /omc/{omc_id}) --

class OmcDepotNode(BaseModel):
    id: str
    type: str  # "omc" | "depot"


class OmcDepotEdge(BaseModel):
    source: str
    target: str
    # omc<->depot edges carry these two:
    dispatch_count: Optional[int] = None
    total_volume_liters: Optional[int] = None
    # omc<->omc edges carry this one instead (comma-separated field names,
    # e.g. "contact_email,kra_pin" if more than one matched):
    shared_identity: Optional[str] = None


class NetworkResponse(BaseModel):
    nodes: list[OmcDepotNode]
    edges: list[OmcDepotEdge]


class CommunityOut(BaseModel):
    community_id: int
    omc_ids: list[str]
    aggregate_risk_score: Optional[float] = None
    members: list[OmcRiskFeatures]
