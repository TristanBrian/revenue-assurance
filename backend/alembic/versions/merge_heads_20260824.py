"""Merge the depot-user and fraud-feedback migration branches."""
from typing import Sequence, Union

from alembic import op

revision: str = "merge_20260824"
down_revision: Union[str, Sequence[str], None] = ("af4c10e5c828", "d4f1a9c2b876")
branch_labels = None
depends_on = None


def upgrade() -> None:
    pass


def downgrade() -> None:
    pass
