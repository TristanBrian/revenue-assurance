"""Restore the legacy deployment merge marker.

Revision ID: e195493cd484
Revises: 0ca62662e121

An older startup script generated this no-op merge revision dynamically and
then stamped deployed databases with it. Committing the marker restores a
stable migration graph without changing schema or rewriting database history.
"""

from typing import Sequence, Union


revision: str = "e195493cd484"
down_revision: Union[str, Sequence[str], None] = "0ca62662e121"
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """No-op: the legacy merge marker made no schema changes."""
    pass


def downgrade() -> None:
    """No-op: the legacy merge marker made no schema changes."""
    pass
