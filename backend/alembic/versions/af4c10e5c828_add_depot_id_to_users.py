"""add depot_id to users

Revision ID: af4c10e5c828
Revises: b748333e5d18
Create Date: 2026-08-20 18:28:29.166490

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'af4c10e5c828'
down_revision: Union[str, Sequence[str], None] = 'b748333e5d18'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    # Scoped to users.depot_id only. Autogenerate also proposed creating
    # depot_ledger — a pre-existing gap unrelated to this change (and
    # models/depot_ledger.py's own docstring says it's since been replaced
    # by depot_daily_inventory), so left out rather than folded in here.
    #
    # depots was loaded straight by the ETL script (pandas to_sql), never
    # through Alembic, so it carries no primary key in Postgres at all
    # despite the ORM model declaring one — a FOREIGN KEY needs a real
    # unique constraint to reference, so add the PK it should have had.
    # Fresh production databases must not need synthetic ETL to migrate.
    # Existing ETL databases retain their master data; do not replace it.
    inspector = sa.inspect(op.get_bind())
    if not inspector.has_table('depots'):
        op.create_table(
            'depots',
            sa.Column('depot_id', sa.Text(), nullable=False),
            sa.Column('depot_name', sa.Text(), nullable=False),
            sa.Column('location', sa.Text(), nullable=True),
            sa.Column('capacity_litres', sa.Integer(), nullable=True),
            sa.Column('is_active', sa.Boolean(), nullable=True),
            sa.PrimaryKeyConstraint('depot_id', name='pk_depots'),
        )
    elif not inspector.get_pk_constraint('depots')['constrained_columns']:
        op.create_primary_key('pk_depots', 'depots', ['depot_id'])
    op.add_column('users', sa.Column('depot_id', sa.Text(), nullable=True))
    op.create_foreign_key('fk_users_depot_id_depots', 'users', 'depots', ['depot_id'], ['depot_id'])


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_constraint('fk_users_depot_id_depots', 'users', type_='foreignkey')
    op.drop_column('users', 'depot_id')
    op.drop_constraint('pk_depots', 'depots', type_='primary')
