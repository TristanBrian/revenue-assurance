"""create audit_anchors table

One row per successful on-chain anchor of the audit_logs hash chain —
see app/models/audit/audit_anchor.py and
app/services/audit/anchor_service.py.

Revision ID: c2b8e04f9a17
Revises: 9a1c4f7d2e63
Create Date: 2026-08-21 07:00:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'c2b8e04f9a17'
down_revision: Union[str, Sequence[str], None] = '9a1c4f7d2e63'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('audit_anchors',
    sa.Column('anchor_id', sa.UUID(), nullable=False),
    sa.Column('block_index_anchored', sa.BigInteger(), nullable=False),
    sa.Column('chain_tip_hash', sa.Text(), nullable=False),
    sa.Column('tx_hash', sa.Text(), nullable=False),
    sa.Column('base_block_number', sa.BigInteger(), nullable=True),
    sa.Column('anchored_at', sa.DateTime(timezone=True), nullable=False),
    sa.PrimaryKeyConstraint('anchor_id')
    )
    op.create_index(op.f('ix_audit_anchors_anchor_id'), 'audit_anchors', ['anchor_id'], unique=False)
    op.create_index(op.f('ix_audit_anchors_anchored_at'), 'audit_anchors', ['anchored_at'], unique=False)
    op.create_index(op.f('ix_audit_anchors_block_index_anchored'), 'audit_anchors', ['block_index_anchored'], unique=False)
    op.create_index(op.f('ix_audit_anchors_tx_hash'), 'audit_anchors', ['tx_hash'], unique=True)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_audit_anchors_tx_hash'), table_name='audit_anchors')
    op.drop_index(op.f('ix_audit_anchors_block_index_anchored'), table_name='audit_anchors')
    op.drop_index(op.f('ix_audit_anchors_anchored_at'), table_name='audit_anchors')
    op.drop_index(op.f('ix_audit_anchors_anchor_id'), table_name='audit_anchors')
    op.drop_table('audit_anchors')
