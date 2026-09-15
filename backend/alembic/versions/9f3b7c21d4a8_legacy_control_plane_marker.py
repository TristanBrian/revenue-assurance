"""Compatibility marker for databases migrated by an earlier branch.

The control-plane schema was already created by the earlier migration. This
no-op marker keeps that revision resolvable without recreating tables.
"""
revision = "9f3b7c21d4a8"
down_revision = "e195493cd484"
branch_labels = None
depends_on = None

def upgrade():
    pass

def downgrade():
    pass
