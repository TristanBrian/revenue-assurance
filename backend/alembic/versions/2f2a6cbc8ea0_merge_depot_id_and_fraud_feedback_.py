"""merge depot_id and fraud_feedback branches

Revision ID: 2f2a6cbc8ea0
Revises: af4c10e5c828, d4f1a9c2b876
Create Date: 2026-08-24 10:13:56.794712

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '2f2a6cbc8ea0'
down_revision: Union[str, Sequence[str], None] = ('af4c10e5c828', 'd4f1a9c2b876')
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    pass


def downgrade() -> None:
    """Downgrade schema."""
    pass
