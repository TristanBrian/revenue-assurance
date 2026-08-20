"""create alerts and alert_reads tables

Revision ID: a1c9f3d2b6e7
Revises: b748333e5d18
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'a1c9f3d2b6e7'
down_revision: Union[str, Sequence[str], None] = 'b748333e5d18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.create_table('alerts',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('title', sa.String(length=255), nullable=False),
    sa.Column('message', sa.Text(), nullable=False),
    sa.Column('severity', sa.String(length=20), nullable=False),
    sa.Column('category', sa.String(length=50), nullable=False),
    sa.Column('target_user_id', sa.UUID(), nullable=True),
    sa.Column('target_permission', sa.String(length=100), nullable=True),
    sa.Column('related_type', sa.String(length=50), nullable=True),
    sa.Column('related_id', sa.String(length=100), nullable=True),
    sa.Column('email_sent', sa.Boolean(), nullable=False),
    sa.Column('created_by_user_id', sa.UUID(), nullable=True),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['target_user_id'], ['users.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['created_by_user_id'], ['users.id'], ondelete='SET NULL'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_alerts_id'), 'alerts', ['id'], unique=False)
    op.create_index(op.f('ix_alerts_category'), 'alerts', ['category'], unique=False)
    op.create_index(op.f('ix_alerts_target_user_id'), 'alerts', ['target_user_id'], unique=False)
    op.create_index(op.f('ix_alerts_target_permission'), 'alerts', ['target_permission'], unique=False)
    op.create_index(op.f('ix_alerts_related_id'), 'alerts', ['related_id'], unique=False)
    op.create_index(op.f('ix_alerts_created_at'), 'alerts', ['created_at'], unique=False)

    op.create_table('alert_reads',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('alert_id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('read_at', sa.DateTime(), nullable=False),
    sa.ForeignKeyConstraint(['alert_id'], ['alerts.id'], ondelete='CASCADE'),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id'),
    sa.UniqueConstraint('alert_id', 'user_id', name='uq_alert_reads_alert_user')
    )
    op.create_index(op.f('ix_alert_reads_id'), 'alert_reads', ['id'], unique=False)
    op.create_index(op.f('ix_alert_reads_alert_id'), 'alert_reads', ['alert_id'], unique=False)
    op.create_index(op.f('ix_alert_reads_user_id'), 'alert_reads', ['user_id'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_alert_reads_user_id'), table_name='alert_reads')
    op.drop_index(op.f('ix_alert_reads_alert_id'), table_name='alert_reads')
    op.drop_index(op.f('ix_alert_reads_id'), table_name='alert_reads')
    op.drop_table('alert_reads')

    op.drop_index(op.f('ix_alerts_created_at'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_related_id'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_target_permission'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_target_user_id'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_category'), table_name='alerts')
    op.drop_index(op.f('ix_alerts_id'), table_name='alerts')
    op.drop_table('alerts')
