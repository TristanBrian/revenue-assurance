"""Auto-merge deployment heads

Revision ID: a28256688a82
Revises: 13f59b7c4f8a, merge_20260824
Create Date: 2026-08-25 08:16:05.720458

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a28256688a82'
down_revision: Union[str, Sequence[str], None] = ('13f59b7c4f8a', 'merge_20260824')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
