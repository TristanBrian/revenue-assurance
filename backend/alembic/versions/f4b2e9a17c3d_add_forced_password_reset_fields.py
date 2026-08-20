"""add forced password reset fields to users

Revision ID: f4b2e9a17c3d
Revises: a1c9f3d2b6e7
Create Date: 2026-08-20 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'f4b2e9a17c3d'
down_revision: Union[str, Sequence[str], None] = 'a1c9f3d2b6e7'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('must_reset_password', sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column('users', sa.Column('temp_password_expires_at', sa.DateTime(), nullable=True))
    op.add_column('users', sa.Column('last_login_at', sa.DateTime(), nullable=True))
    # Drop the server_default once existing rows are backfilled — new rows
    # rely on the ORM-side default=False instead (same convention as
    # is_active above it in the model), the server_default here only exists
    # to satisfy NOT NULL for rows that already existed pre-migration.
    op.alter_column('users', 'must_reset_password', server_default=None)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('users', 'last_login_at')
    op.drop_column('users', 'temp_password_expires_at')
    op.drop_column('users', 'must_reset_password')
