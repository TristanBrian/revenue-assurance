"""
Pydantic response schema for routes/heatmap.py.

Note: there is no app/models/heatmap.py to mirror — heatmap.py has no
backing SQLAlchemy model (it pivots reconciliation results in memory, see
app/services/heatmap.py). This file exists because routes/heatmap.py still
needs a response_model per the schemas-layer requirement; it's named after
the route it serves rather than force-fit into reconciliation.py's schema
file.
"""
from typing import Optional

from pydantic import BaseModel


class HeatmapData(BaseModel):
    data: list[list[float]]
    omcs: list[str]
    products: list[str]
    total_leakage: float


class HeatmapResponse(BaseModel):
    """GET /heatmap. 'message' is only present on the caught-exception error
    path (status='error'); Optional covers both shapes."""
    status: str
    data: HeatmapData
    message: Optional[str] = None
