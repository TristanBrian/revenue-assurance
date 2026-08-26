"""merge duplicate heads-fix branch with batch merkle audit chain

Revision ID: 6edf594b9320
Revises: 13f59b7c4f8a, merge_20260824
Create Date: 2026-08-24 11:07:52.889530

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6edf594b9320'
down_revision: Union[str, Sequence[str], None] = ('13f59b7c4f8a', 'merge_20260824')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
