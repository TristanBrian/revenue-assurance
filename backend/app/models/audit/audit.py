"""
AuditLog model — persists the security/compliance audit trail (anomaly
resolution, e-billing sync/retry, user administration, login attempts,
and — as of the immutable audit trail extension — every ingested
dispatch/invoice/payment/attendance/authorization/disbursement record).
Real ORM class (UUID PK), same pattern as models/auth/user.py, since audit logs
need real filtering/querying (by actor, action, target, date range) unlike
the raw-pandas reconciliation/e-billing tables.

Immutable hash chain (block_index/data_hash/prev_block_hash/block_hash):
every row chains to the one before it, one sequence across the whole
table regardless of source or direction — see
services/audit/audit_service.py's chain_entry()/log_action()/
log_ingested_record() for the write path, and services/audit/
anchor_service.py for periodically anchoring the chain tip on Base
Sepolia. No UPDATE/DELETE path exists on this table anywhere in the API
— see routes/audit/audit.py, which only ever reads.
"""
import uuid
from datetime import datetime, timezone

from sqlalchemy import BigInteger, Column, DateTime, ForeignKey, JSON, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from app.utils.db_connection import Base

# JSONB in Postgres (production); falls back to the generic JSON type
# under SQLite so tests/test_audit_service.py can exercise the real model
# against an in-memory SQLite engine without a Postgres dependency.
_JSONVariant = JSONB().with_variant(JSON(), "sqlite")


class AuditLog(Base):
    __tablename__ = "audit_logs"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, index=True)
    # Nullable: null = no authenticated actor exists yet (failed login
    # attempt), a system-triggered action, or an ingested record whose
    # actor is named in external_actor instead (see below — an ETL-
    # ingested dispatch/authorization/disbursement is attributed to
    # whoever the SOURCE record names, e.g. dispatched_by/authorized_by/
    # processed_by, which is virtually never a row in this platform's own
    # users table). ON DELETE SET NULL rather than the FK default
    # (RESTRICT) so deleting a user later (DELETE /api/admin/users/{id})
    # can't be blocked by that user's own audit history — the log entry
    # survives, just loses the actor reference.
    actor_user_id = Column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="SET NULL"), nullable=True, index=True
    )
    # Free-text actor identity for ingestion-path rows — the depot clerk/
    # KPC finance staffer/field officer/payments-desk id the SOURCE record
    # itself names, not a platform user. Deliberately NOT a foreign key:
    # these identities live in the upstream systems this platform ingests
    # from (simulated today by generate_kpc_data.py), not in `users`.
    # Exactly one of actor_user_id / external_actor is set for a row that
    # has any actor at all; both are null for the rare case where a
    # record genuinely has no natural human actor (e.g. a payment, which
    # is a bank-to-bank remittance — see generate_kpc_data.py's comment
    # above KPC_FINANCE_STAFF).
    external_actor = Column(Text, nullable=True, index=True)
    action = Column(Text, nullable=False, index=True)  # stable code, e.g. "anomaly.resolve", "user.create", "ingested"
    target_type = Column(Text, nullable=True, index=True)  # e.g. "dispatch", "invoice", "user"
    target_id = Column(Text, nullable=True, index=True)
    before_value = Column(_JSONVariant, nullable=True)
    after_value = Column(_JSONVariant, nullable=True)
    extra_metadata = Column(_JSONVariant, nullable=True)
    # When the underlying real-world event happened (per the source
    # record's own date/timestamp field for ingestion rows; same as
    # created_at for in-platform actions, where "happened" and "logged"
    # are the same moment). Deliberately separate from created_at (below)
    # — created_at is "when this platform actually wrote the row" (ETL
    # run time), and the gap between the two is itself meaningful data:
    # how stale is the ingested fabric. Falls back to created_at's value
    # at insert time if the caller doesn't have a more specific business
    # timestamp.
    #
    # timezone=True (TIMESTAMPTZ in Postgres) deliberately, unlike
    # created_at above: this column feeds the hash chain
    # (audit_service.py's chain_entry()/verify_chain_integrity() both
    # call .isoformat() on it), and Postgres' plain TIMESTAMP silently
    # drops tzinfo on write, turning a tz-aware value hashed at write
    # time into a naive one on read-back — same wall-clock moment, but a
    # different .isoformat() string, which broke every verify() call
    # (caught via a live migration test against a real Postgres instance,
    # not by inspection). audit_service._hashable_timestamp() normalizes
    # this defensively too, but storing it correctly is the real fix.
    event_timestamp = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(
        DateTime, default=lambda: datetime.now(timezone.utc), nullable=False, index=True
    )

    # --- Immutable hash chain ---
    # Sequential across the ENTIRE table (not per-direction, not per-
    # target_type) — one chain, both directions, per the extension's
    # guiding principle. block_index=0 is genesis; its prev_block_hash is
    # the fixed genesis value (64 zero chars), not null, so "no prior
    # block" is an explicit, hashable value rather than a special case
    # every downstream reader has to know about.
    block_index = Column(BigInteger, nullable=False, unique=True, index=True)
    data_hash = Column(Text, nullable=False)  # sha256(canonical JSON of the event payload)
    prev_block_hash = Column(Text, nullable=False)  # the prior row's block_hash (or genesis)
    block_hash = Column(Text, nullable=False, unique=True, index=True)  # sha256(block_index || event_timestamp || data_hash || prev_block_hash)
