"""batch merkle audit chain cutover

Revision ID: 13f59b7c4f8a
Revises: 2f2a6cbc8ea0
Create Date: 2026-08-24 10:35:02.032161

Schema for docs/audit-merkle-migration.md — the batch Merkle cutover of
the immutable audit trail. Autogenerate also detected 'pillars',
'depot_ledger', and 'stipend_ledger' as missing from migration history
(a pre-existing gap unrelated to this change — those models exist in
app/models/ but were never migrated); deliberately NOT included here to
keep this migration scoped to only what the batch Merkle cutover
actually needs. That gap should get its own separate migration.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '13f59b7c4f8a'
down_revision: Union[str, Sequence[str], None] = '2f2a6cbc8ea0'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('audit_log_batches',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('batch_index', sa.BigInteger(), nullable=False),
    sa.Column('is_backfilled', sa.Boolean(), server_default='false', nullable=False),
    sa.Column('start_block_index', sa.BigInteger(), nullable=False),
    sa.Column('end_block_index', sa.BigInteger(), nullable=False),
    sa.Column('row_count', sa.Integer(), nullable=False),
    sa.Column('merkle_root', sa.Text(), nullable=False),
    sa.Column('prev_batch_root_hash', sa.Text(), nullable=False),
    sa.Column('batch_root_hash', sa.Text(), nullable=False),
    sa.Column('sealed_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_audit_log_batches_batch_index'), 'audit_log_batches', ['batch_index'], unique=True)
    op.create_index(op.f('ix_audit_log_batches_batch_root_hash'), 'audit_log_batches', ['batch_root_hash'], unique=True)
    op.create_index(op.f('ix_audit_log_batches_id'), 'audit_log_batches', ['id'], unique=False)
    op.create_index(op.f('ix_audit_log_batches_sealed_at'), 'audit_log_batches', ['sealed_at'], unique=False)

    op.add_column('audit_anchors', sa.Column('batch_index_anchored', sa.BigInteger(), nullable=True))
    op.add_column('audit_anchors', sa.Column('merkle_root', sa.Text(), nullable=True))
    op.add_column('audit_anchors', sa.Column('batch_root_hash', sa.Text(), nullable=True))
    op.alter_column('audit_anchors', 'block_index_anchored',
               existing_type=sa.BIGINT(),
               nullable=True)
    op.alter_column('audit_anchors', 'chain_tip_hash',
               existing_type=sa.TEXT(),
               nullable=True)
    op.create_index(op.f('ix_audit_anchors_batch_index_anchored'), 'audit_anchors', ['batch_index_anchored'], unique=False)

    op.add_column('audit_logs', sa.Column('batch_index', sa.BigInteger(), nullable=True))
    op.add_column('audit_logs', sa.Column('leaf_index', sa.Integer(), nullable=True))
    op.alter_column('audit_logs', 'prev_block_hash',
               existing_type=sa.TEXT(),
               nullable=True)
    op.alter_column('audit_logs', 'block_hash',
               existing_type=sa.TEXT(),
               nullable=True)
    op.create_index(op.f('ix_audit_logs_batch_index'), 'audit_logs', ['batch_index'], unique=False)


def downgrade() -> None:
    """Downgrade schema.

    NOTE: downgrading after any post-cutover rows have been written is
    lossy — batch_index/leaf_index (and the AuditLogBatch rows deriving
    from them) are dropped, but block_hash/prev_block_hash are NOT
    retroactively recomputed for those rows (there's no way to derive a
    per-row hash chain after the fact for rows that were never chained
    that way to begin with). Re-tightening block_hash/prev_block_hash to
    NOT NULL below will fail outright if any such row exists — by
    design, not an oversight: that failure is the signal that a
    downgrade past the cutover point requires a real decision (delete
    those rows? re-run the legacy chain formula over them retroactively,
    accepting they were never actually chained live?), not something
    this migration should silently paper over.
    """
    op.drop_index(op.f('ix_audit_logs_batch_index'), table_name='audit_logs')
    op.alter_column('audit_logs', 'block_hash',
               existing_type=sa.TEXT(),
               nullable=False)
    op.alter_column('audit_logs', 'prev_block_hash',
               existing_type=sa.TEXT(),
               nullable=False)
    op.drop_column('audit_logs', 'leaf_index')
    op.drop_column('audit_logs', 'batch_index')

    op.drop_index(op.f('ix_audit_anchors_batch_index_anchored'), table_name='audit_anchors')
    op.alter_column('audit_anchors', 'chain_tip_hash',
               existing_type=sa.TEXT(),
               nullable=False)
    op.alter_column('audit_anchors', 'block_index_anchored',
               existing_type=sa.BIGINT(),
               nullable=False)
    op.drop_column('audit_anchors', 'batch_root_hash')
    op.drop_column('audit_anchors', 'merkle_root')
    op.drop_column('audit_anchors', 'batch_index_anchored')

    op.drop_index(op.f('ix_audit_log_batches_sealed_at'), table_name='audit_log_batches')
    op.drop_index(op.f('ix_audit_log_batches_id'), table_name='audit_log_batches')
    op.drop_index(op.f('ix_audit_log_batches_batch_root_hash'), table_name='audit_log_batches')
    op.drop_index(op.f('ix_audit_log_batches_batch_index'), table_name='audit_log_batches')
    op.drop_table('audit_log_batches')
