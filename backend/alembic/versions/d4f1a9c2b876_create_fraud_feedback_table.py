"""create fraud_feedback table

One row per investigator resolution that carries a fraud judgment —
feeds the fraud-scoring layer's retraining loop. See
app/models/fraud/fraud_feedback.py and
app/services/fraud/fraud_scoring_service.py.

Revision ID: d4f1a9c2b876
Revises: c2b8e04f9a17
Create Date: 2026-08-21 15:30:00.000000

"""
from typing import Sequence, Union

import sqlalchemy as sa
from alembic import op

# revision identifiers, used by Alembic.
revision: str = 'd4f1a9c2b876'
down_revision: Union[str, Sequence[str], None] = 'c2b8e04f9a17'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('fraud_feedback',
    sa.Column('feedback_id', sa.UUID(), nullable=False),
    sa.Column('anomaly_id', sa.Text(), nullable=False),
    sa.Column('resolution_label', sa.Text(), nullable=False),
    sa.Column('resolved_by', sa.UUID(), nullable=True),
    sa.Column('resolved_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['resolved_by'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('feedback_id')
    )
    op.create_index(op.f('ix_fraud_feedback_feedback_id'), 'fraud_feedback', ['feedback_id'], unique=False)
    op.create_index(op.f('ix_fraud_feedback_anomaly_id'), 'fraud_feedback', ['anomaly_id'], unique=False)
    op.create_index(op.f('ix_fraud_feedback_resolved_by'), 'fraud_feedback', ['resolved_by'], unique=False)
    op.create_index(op.f('ix_fraud_feedback_resolved_at'), 'fraud_feedback', ['resolved_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_fraud_feedback_resolved_at'), table_name='fraud_feedback')
    op.drop_index(op.f('ix_fraud_feedback_resolved_by'), table_name='fraud_feedback')
    op.drop_index(op.f('ix_fraud_feedback_anomaly_id'), table_name='fraud_feedback')
    op.drop_index(op.f('ix_fraud_feedback_feedback_id'), table_name='fraud_feedback')
    op.drop_table('fraud_feedback')
