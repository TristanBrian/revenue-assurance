"""terms documents and consent tracking

Revision ID: d3f6a2b8e5c1
Revises: c7d8e1f4a9b2
Create Date: 2026-08-20 00:00:00.000000

Adds users.terms_accepted_version/terms_accepted_at (cached latest state),
terms_documents (versioned legal text, is_active flag), and
consent_records (full per-acceptance audit history) — see
app/models/terms_document.py / consent_record.py.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision: str = 'd3f6a2b8e5c1'
down_revision: Union[str, Sequence[str], None] = 'c7d8e1f4a9b2'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('users', sa.Column('terms_accepted_version', sa.String(length=50), nullable=True))
    op.add_column('users', sa.Column('terms_accepted_at', sa.DateTime(), nullable=True))

    op.create_table('terms_documents',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('document_type', sa.String(length=50), nullable=False),
    sa.Column('version', sa.String(length=50), nullable=False),
    sa.Column('content', sa.Text(), nullable=False),
    sa.Column('content_hash', sa.String(length=64), nullable=False),
    sa.Column('is_active', sa.Boolean(), nullable=False),
    sa.Column('created_at', sa.DateTime(), nullable=False),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_terms_documents_id'), 'terms_documents', ['id'], unique=False)
    op.create_index(op.f('ix_terms_documents_document_type'), 'terms_documents', ['document_type'], unique=False)
    op.create_index(op.f('ix_terms_documents_is_active'), 'terms_documents', ['is_active'], unique=False)

    op.create_table('consent_records',
    sa.Column('id', sa.UUID(), nullable=False),
    sa.Column('user_id', sa.UUID(), nullable=False),
    sa.Column('document_type', sa.String(length=50), nullable=False),
    sa.Column('document_version', sa.String(length=50), nullable=False),
    sa.Column('document_hash', sa.String(length=64), nullable=False),
    sa.Column('accepted_at', sa.DateTime(), nullable=False),
    sa.Column('ip_address', sa.String(length=64), nullable=True),
    sa.Column('user_agent', sa.Text(), nullable=True),
    sa.ForeignKeyConstraint(['user_id'], ['users.id'], ondelete='CASCADE'),
    sa.PrimaryKeyConstraint('id')
    )
    op.create_index(op.f('ix_consent_records_id'), 'consent_records', ['id'], unique=False)
    op.create_index(op.f('ix_consent_records_user_id'), 'consent_records', ['user_id'], unique=False)
    op.create_index(op.f('ix_consent_records_document_type'), 'consent_records', ['document_type'], unique=False)
    op.create_index(op.f('ix_consent_records_accepted_at'), 'consent_records', ['accepted_at'], unique=False)


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_index(op.f('ix_consent_records_accepted_at'), table_name='consent_records')
    op.drop_index(op.f('ix_consent_records_document_type'), table_name='consent_records')
    op.drop_index(op.f('ix_consent_records_user_id'), table_name='consent_records')
    op.drop_index(op.f('ix_consent_records_id'), table_name='consent_records')
    op.drop_table('consent_records')

    op.drop_index(op.f('ix_terms_documents_is_active'), table_name='terms_documents')
    op.drop_index(op.f('ix_terms_documents_document_type'), table_name='terms_documents')
    op.drop_index(op.f('ix_terms_documents_id'), table_name='terms_documents')
    op.drop_table('terms_documents')

    op.drop_column('users', 'terms_accepted_at')
    op.drop_column('users', 'terms_accepted_version')
