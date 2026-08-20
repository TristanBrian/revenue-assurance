"""alerts: plural targeting (target_permissions/target_roles) + tier

Revision ID: c7d8e1f4a9b2
Revises: f4b2e9a17c3d
Create Date: 2026-08-20 00:00:00.000000

Replaces the single target_permission column with target_permissions +
target_roles (both JSON lists, OR semantics) so one alert can address
multiple audiences (e.g. "whoever can act on this, plus the platform
admin") — see app/services/alert_types.py's registry docstring for why.
Adds tier (immediate/digested/throttled/transactional) so it's a real
queryable column instead of implied by which notify_* function ran.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

# revision identifiers, used by Alembic.
revision: str = 'c7d8e1f4a9b2'
down_revision: Union[str, Sequence[str], None] = 'f4b2e9a17c3d'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None

_JSON_TYPE = postgresql.JSONB(astext_type=sa.Text()).with_variant(sa.JSON(), 'sqlite')


def upgrade() -> None:
    """Upgrade schema."""
    op.drop_index(op.f('ix_alerts_target_permission'), table_name='alerts')
    op.drop_column('alerts', 'target_permission')

    op.add_column('alerts', sa.Column('target_permissions', _JSON_TYPE, nullable=True))
    op.add_column('alerts', sa.Column('target_roles', _JSON_TYPE, nullable=True))
    op.add_column('alerts', sa.Column('tier', sa.String(length=20), nullable=False, server_default='immediate'))
    op.alter_column('alerts', 'tier', server_default=None)
    op.add_column('alerts', sa.Column('exclude_user_id', sa.UUID(), nullable=True))
    op.create_foreign_key(
        'alerts_exclude_user_id_fkey', 'alerts', 'users', ['exclude_user_id'], ['id'], ondelete='SET NULL'
    )


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('alerts_exclude_user_id_fkey', 'alerts', type_='foreignkey')
    op.drop_column('alerts', 'exclude_user_id')
    op.drop_column('alerts', 'tier')
    op.drop_column('alerts', 'target_roles')
    op.drop_column('alerts', 'target_permissions')

    op.add_column('alerts', sa.Column('target_permission', sa.String(length=100), nullable=True))
    op.create_index(op.f('ix_alerts_target_permission'), 'alerts', ['target_permission'], unique=False)
