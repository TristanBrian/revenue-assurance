"""
AuditAnchorRecord model — one row per successful on-chain anchor of the
audit_logs hash chain (see services/audit/anchor_service.py). Used by
GET /audit/verify's on-chain cross-check (finds the most recent anchor,
fetches its Anchored event from Base Sepolia, compares the on-chain
chainTipHash against what the local chain currently recomputes for that
block_index) and by the dashboard's "view on Base Sepolia explorer" link.

Not the chain itself — audit_logs is. This table only ever grows by one
row per anchor_service.anchor_chain_tip() call; nothing here is ever
updated or deleted either, same immutability posture as audit_logs, just
for a different reason (there's no "wrong" anchor to correct — a failed
anchor attempt simply doesn't get a row, see anchor_service.py).
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class AuditAnchorRecord(Base):
    __tablename__ = "audit_anchors"

    anchor_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    # The audit_logs.block_index that was the chain tip at anchor time —
    # the anchor covers every row up to and including this one, not just
    # rows added since the previous anchor (see AuditAnchor.sol's anchor()
    # docstring).
    block_index_anchored = Column(BigInteger, nullable=False, index=True)
    chain_tip_hash = Column(Text, nullable=False)  # audit_logs.block_hash at that block_index
    tx_hash = Column(Text, nullable=False, unique=True, index=True)
    base_block_number = Column(BigInteger, nullable=True)  # Base Sepolia block the anchor tx landed in
    anchored_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
