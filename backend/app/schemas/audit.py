"""
Schema stub for app/models/audit.py — that model file is currently EMPTY
(no SQLAlchemy model defined), and there is no audit route or service
implementation anywhere in the codebase (routes/audit.py is also an empty
stub, not mounted in main.py). "Audit Trail" only exists today as a named
permission-mapped feature in README.md — there's no actual data yet.

AuditLog below is a minimal placeholder inferred only from that feature
name and the generic concept of an audit log entry (id/user_id/action/
timestamp) — not from any real model, route, or service, since none exist.
Treat every field as provisional; replace this once app/models/audit.py
and its route/service are actually implemented.
"""
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict


class AuditLog(BaseModel):
    id: str
    user_id: Optional[str] = None
    action: str
    timestamp: datetime

    model_config = ConfigDict(from_attributes=True)
