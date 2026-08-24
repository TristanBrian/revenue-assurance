"""
AuditLogBatch model — one row per SEALED batch of the post-cutover
Merkle-tree audit chain (see docs/audit-merkle-migration.md). Replaces
per-row block_hash/prev_block_hash chaining for new rows: a batch's
Merkle root commits to every AuditLog row in it (leaf order = leaf_index,
which follows block_index order), and batch_root_hash chains that root to
every batch before it — the same tamper-evident ordering guarantee
audit_logs.block_hash/prev_block_hash gave per-row, just at the batch
level so verify_chain_integrity() only has O(batch_count) sequential
steps instead of O(row_count).

Sealed, never updated afterward — same immutability posture as AuditLog
itself and AuditAnchorRecord (see those models' own docstrings). "Sealed"
specifically means: every AuditLog row with this batch_index already
exists and is final by the time this row is written — see
services/audit/audit_service.py's seal_batch().

start_block_index/end_block_index are inclusive and refer to
AuditLog.block_index (the same global sequence pre-cutover rows already
use) — NOT leaf_index, which is 0-based within the batch. Kept as a
denormalized convenience so a batch's row range is readable directly from
this table without joining audit_logs.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Boolean, Column, DateTime, Integer, Text
from sqlalchemy.dialects.postgresql import UUID

from app.utils.db_connection import Base


class AuditLogBatch(Base):
    __tablename__ = "audit_log_batches"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    # Separate, batch-scoped sequence starting at 0 for the first
    # post-cutover batch — unrelated to (much smaller than)
    # AuditLog.block_index, which keeps counting across both eras.
    # NEGATIVE for backfilled batches (see is_backfilled below) — counting
    # down from -1 for the newest backfilled batch, avoiding any collision
    # with the live 0, 1, 2, ... sequence without needing a second table.
    batch_index = Column(BigInteger, nullable=False, unique=True, index=True)
    # True for a batch produced by scripts/backfill_audit_batches.py
    # against PRE-CUTOVER rows (see that script and
    # docs/audit-merkle-migration.md Part 5.6) — a one-time, optional,
    # offline convenience so historical rows can be spot-checked via a
    # fast O(log n) Merkle proof (merkle_service.get_merkle_proof()/
    # verify_row_in_batch()) instead of walking the whole legacy prefix.
    # NOT wired into verify_chain_integrity()'s automatic walk
    # (_verify_batch_era() filters these out) — a backfilled batch
    # doesn't chain into the live batch_root_hash sequence at all
    # (prev_batch_root_hash for the newest backfilled batch is its own
    # GENESIS_PREV_HASH, not whatever the live sequence's tip is), since
    # legacy rows already have their own real chain-of-custody guarantee
    # (the pre-cutover block_hash chain) — this is purely an additional,
    # optional convenience on top of that, not a replacement for it.
    is_backfilled = Column(Boolean, nullable=False, default=False, server_default="false")
    start_block_index = Column(BigInteger, nullable=False)
    end_block_index = Column(BigInteger, nullable=False)
    row_count = Column(Integer, nullable=False)
    merkle_root = Column(Text, nullable=False)  # root over leaf_hash(row.data_hash) for every row in this batch
    prev_batch_root_hash = Column(Text, nullable=False)  # the previous batch's batch_root_hash, or genesis for batch 0
    batch_root_hash = Column(Text, nullable=False, unique=True, index=True)  # sha256(batch_index|start|end|merkle_root|prev_batch_root_hash)
    sealed_at = Column(
        DateTime(timezone=True), default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )
