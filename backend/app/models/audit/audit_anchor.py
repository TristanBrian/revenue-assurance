"""
AuditAnchorRecord model — one row per successful on-chain anchor of the
audit_logs hash chain (see services/audit/anchor_service.py). Used by
GET /audit/verify's on-chain cross-check (finds the most recent anchor,
fetches its Anchored event from Base Sepolia, compares the on-chain
chainTipHash against what the local chain currently recomputes for that
block_index) and by the dashboard's "view on Base Sepolia explorer" link.

Not the chain itself — audit_logs is. This table only ever grows by one
row per anchor_service.anchor_chain_tip() (pre-cutover) or
anchor_service.anchor_batch() (post-cutover) call; nothing here is ever
updated or deleted either, same immutability posture as audit_logs, just
for a different reason (there's no "wrong" anchor to correct — a failed
anchor attempt simply doesn't get a row, see anchor_service.py).

Batch Merkle cutover (see docs/audit-merkle-migration.md): a pre-cutover
row anchors a single audit_logs.block_index/block_hash pair on the V1
AuditAnchor contract (block_index_anchored/chain_tip_hash, both set;
batch_index_anchored/merkle_root/batch_root_hash all NULL). A
post-cutover row anchors one AuditLogBatch on the V2 contract instead
(batch_index_anchored/merkle_root/batch_root_hash all set;
block_index_anchored/chain_tip_hash NULL — a batch has no single
"block_hash" to anchor). Exactly one triple is set per row; which one
tells verify_on_chain_anchor() which contract address/event shape to
read this anchor back with.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class AuditAnchorRecord(Base):
    __tablename__ = "audit_anchors"

    anchor_id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)

    # --- Pre-cutover (V1 contract, per-row chain tip) ---
    # The audit_logs.block_index that was the chain tip at anchor time —
    # the anchor covers every row up to and including this one, not just
    # rows added since the previous anchor (see AuditAnchor.sol's anchor()
    # docstring).
    block_index_anchored = Column(BigInteger, nullable=True, index=True)
    chain_tip_hash = Column(Text, nullable=True)  # audit_logs.block_hash at that block_index

    # --- Post-cutover (V2 contract, batch Merkle root) ---
    batch_index_anchored = Column(BigInteger, nullable=True, index=True)
    merkle_root = Column(Text, nullable=True)  # AuditLogBatch.merkle_root at anchor time
    batch_root_hash = Column(Text, nullable=True)  # AuditLogBatch.batch_root_hash at anchor time

    tx_hash = Column(Text, nullable=False, unique=True, index=True)
    base_block_number = Column(BigInteger, nullable=True)  # Base Sepolia block the anchor tx landed in
    anchored_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
