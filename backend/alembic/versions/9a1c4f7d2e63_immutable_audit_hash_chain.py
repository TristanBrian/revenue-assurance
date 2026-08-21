"""immutable audit hash chain

Adds the hash-chain columns (block_index/data_hash/prev_block_hash/
block_hash) and external_actor/event_timestamp to audit_logs — see
app/models/audit/audit.py's column comments and
app/services/audit/audit_service.py's chain_entry() for what these mean
and how they're computed.

Columns are added nullable first, backfilled for any pre-existing rows
(chained in created_at order — the best available approximation of
"when this happened" for rows written before event_timestamp existed),
then made NOT NULL. The backfill reimplements chain_entry()'s hashing
inline rather than importing app.services.audit.audit_service from a
migration — migrations should stay self-contained and not depend on
application code that's free to change independently of migration
history.

Revision ID: 9a1c4f7d2e63
Revises: d3f6a2b8e5c1
Create Date: 2026-08-21 06:30:00.000000

"""
import hashlib
import json
from datetime import timezone
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = '9a1c4f7d2e63'
down_revision: Union[str, Sequence[str], None] = 'd3f6a2b8e5c1'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

GENESIS_PREV_HASH = "0" * 64


def _canonical_json(payload: dict) -> str:
    return json.dumps(payload, sort_keys=True, default=str, separators=(",", ":"))


def _sha256_hex(material: str) -> str:
    return hashlib.sha256(material.encode("utf-8")).hexdigest()


def _as_utc(dt):
    """created_at (read back here via raw SQL from a plain, non-tz
    TIMESTAMP column) comes back naive — treat it as already being UTC
    (everything in this system is) rather than the DB session's local
    tz, and attach that explicitly before it's used for hashing or
    written into the new tz-aware event_timestamp column. Mirrors
    audit_service._hashable_timestamp()'s normalization, kept as a
    separate copy here for the same self-containment reason
    _canonical_json/_sha256_hex are."""
    if dt.tzinfo is None:
        return dt.replace(tzinfo=timezone.utc)
    return dt.astimezone(timezone.utc)


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('audit_logs', sa.Column('external_actor', sa.Text(), nullable=True))
    # timezone=True (TIMESTAMPTZ) — see app/models/audit/audit.py's
    # comment on this column: a plain TIMESTAMP silently drops tzinfo on
    # write, which breaks the hash chain (the same moment hashes
    # differently as tz-aware vs naive) — caught via a live migration
    # test against Postgres, not by inspection.
    op.add_column('audit_logs', sa.Column('event_timestamp', sa.DateTime(timezone=True), nullable=True))
    op.add_column('audit_logs', sa.Column('block_index', sa.BigInteger(), nullable=True))
    op.add_column('audit_logs', sa.Column('data_hash', sa.Text(), nullable=True))
    op.add_column('audit_logs', sa.Column('prev_block_hash', sa.Text(), nullable=True))
    op.add_column('audit_logs', sa.Column('block_hash', sa.Text(), nullable=True))

    # --- Backfill any pre-existing rows into a valid chain ---
    connection = op.get_bind()
    existing_rows = connection.execute(
        sa.text(
            "SELECT id, actor_user_id, action, target_type, target_id, "
            "before_value, after_value, created_at FROM audit_logs "
            "ORDER BY created_at ASC"
        )
    ).fetchall()

    expected_prev = GENESIS_PREV_HASH
    for index, row in enumerate(existing_rows):
        event_timestamp = _as_utc(row.created_at)
        payload = {
            "actor_user_id": str(row.actor_user_id) if row.actor_user_id else None,
            "external_actor": None,
            "action": row.action,
            "target_type": row.target_type,
            "target_id": row.target_id,
            "before": row.before_value,
            "after": row.after_value,
            "event_timestamp": event_timestamp.isoformat(),
        }
        data_hash = _sha256_hex(_canonical_json(payload))
        block_hash = _sha256_hex(f"{index}|{event_timestamp.isoformat()}|{data_hash}|{expected_prev}")

        connection.execute(
            sa.text(
                "UPDATE audit_logs SET event_timestamp = :event_timestamp, "
                "block_index = :block_index, data_hash = :data_hash, "
                "prev_block_hash = :prev_block_hash, block_hash = :block_hash "
                "WHERE id = :id"
            ),
            {
                "event_timestamp": event_timestamp,
                "block_index": index,
                "data_hash": data_hash,
                "prev_block_hash": expected_prev,
                "block_hash": block_hash,
                "id": row.id,
            },
        )
        expected_prev = block_hash

    # --- Now safe to enforce NOT NULL: the backfill loop above already
    # gave every existing row a real value for all four columns, and no
    # new row can exist yet (this migration just added the columns) —
    # no server_default dance needed. ---
    op.alter_column('audit_logs', 'event_timestamp', nullable=False)
    op.alter_column('audit_logs', 'block_index', nullable=False)
    op.alter_column('audit_logs', 'data_hash', nullable=False)
    op.alter_column('audit_logs', 'prev_block_hash', nullable=False)
    op.alter_column('audit_logs', 'block_hash', nullable=False)

    op.create_index(op.f('ix_audit_logs_external_actor'), 'audit_logs', ['external_actor'], unique=False)
    op.create_index(op.f('ix_audit_logs_block_index'), 'audit_logs', ['block_index'], unique=True)
    op.create_index(op.f('ix_audit_logs_block_hash'), 'audit_logs', ['block_hash'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_audit_logs_block_hash'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_block_index'), table_name='audit_logs')
    op.drop_index(op.f('ix_audit_logs_external_actor'), table_name='audit_logs')
    op.drop_column('audit_logs', 'block_hash')
    op.drop_column('audit_logs', 'prev_block_hash')
    op.drop_column('audit_logs', 'data_hash')
    op.drop_column('audit_logs', 'block_index')
    op.drop_column('audit_logs', 'event_timestamp')
    op.drop_column('audit_logs', 'external_actor')
