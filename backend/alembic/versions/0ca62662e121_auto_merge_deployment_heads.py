"""Auto-merge deployment heads

Revision ID: 0ca62662e121
Revises: 6edf594b9320, a28256688a82
Create Date: 2026-08-25 14:53:31.235874

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '0ca62662e121'
down_revision: Union[str, Sequence[str], None] = ('6edf594b9320', 'a28256688a82')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
