"""
Pydantic response schema for routes/feed.py.

Note: there is no app/models/feed.py to mirror — feed.py has no backing
SQLAlchemy model (it's an in-memory cache, see app/services/feed.py). This
file exists because routes/feed.py still needs a response_model per the
schemas-layer requirement; it's named after the route it serves rather than
force-fit into reconciliation.py's schema file.
"""
from typing import Optional

from pydantic import BaseModel

from app.schemas.reconciliation import Anomaly


class FeedData(BaseModel):
    anomalies: list[Anomaly]
    last_updated: Optional[str] = None
    total_count: int


class FeedResponse(BaseModel):
    """GET /feed. 'message' is only present on the caught-exception error
    path (status='error'); Optional covers both shapes."""
    status: str
    data: FeedData
    message: Optional[str] = None
