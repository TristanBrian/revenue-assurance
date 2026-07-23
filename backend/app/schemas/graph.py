"""
Pydantic response schemas for routes/graph.py.

Field lists match app/services/graph_engine.py's actual return shapes:
build_omc_depot_graph() node/edge attributes and detect_risk_communities()'s
per-community dict.
"""
from typing import Optional

from pydantic import BaseModel

from app.schemas.detective import OmcRiskFeatures


class GraphNode(BaseModel):
    id: str
    type: str  # "omc" | "depot"


class GraphEdge(BaseModel):
    source: str
    target: str
    # omc<->depot edges carry these two:
    dispatch_count: Optional[int] = None
    total_volume_liters: Optional[int] = None
    # omc<->omc edges carry this one instead (comma-separated field names,
    # e.g. "contact_email,kra_pin" if more than one matched):
    shared_identity: Optional[str] = None


class NetworkResponse(BaseModel):
    nodes: list[GraphNode]
    edges: list[GraphEdge]


class CommunityOut(BaseModel):
    community_id: int
    omc_ids: list[str]
    aggregate_risk_score: Optional[float] = None
    members: list[OmcRiskFeatures]
