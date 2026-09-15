"""create persisted review queue assignment state

Revision ID: b1c7d9e2f4a6
Revises: a28256688a82
"""
from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects import postgresql

revision = "b1c7d9e2f4a6"
down_revision = "2c8d4e71f6b0"
branch_labels = None
depends_on = None

def upgrade() -> None:
    op.add_column("anomaly_resolutions", sa.Column("assigned_to_user_id", postgresql.UUID(as_uuid=True), nullable=True))
    op.add_column("anomaly_resolutions", sa.Column("escalated", sa.Boolean(), nullable=False, server_default=sa.false()))
    op.add_column("anomaly_resolutions", sa.Column("assigned_at", sa.DateTime(), nullable=True))
    op.add_column("anomaly_resolutions", sa.Column("escalated_at", sa.DateTime(), nullable=True))
    op.create_foreign_key("fk_anomaly_resolutions_assignee", "anomaly_resolutions", "users", ["assigned_to_user_id"], ["id"], ondelete="SET NULL")
    op.create_index("ix_anomaly_resolutions_assigned_to_user_id", "anomaly_resolutions", ["assigned_to_user_id"])
    op.alter_column("anomaly_resolutions", "escalated", server_default=None)

def downgrade() -> None:
    op.drop_index("ix_anomaly_resolutions_assigned_to_user_id", table_name="anomaly_resolutions")
    op.drop_constraint("fk_anomaly_resolutions_assignee", "anomaly_resolutions", type_="foreignkey")
    op.drop_column("anomaly_resolutions", "escalated_at")
    op.drop_column("anomaly_resolutions", "assigned_at")
    op.drop_column("anomaly_resolutions", "escalated")
    op.drop_column("anomaly_resolutions", "assigned_to_user_id")
