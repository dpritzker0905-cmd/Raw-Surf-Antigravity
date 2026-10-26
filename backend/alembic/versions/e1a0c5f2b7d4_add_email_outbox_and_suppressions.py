"""Add email_outbox and email_suppressions tables

Revision ID: e1a0c5f2b7d4
Revises: a107b7db4f12
Create Date: 2026-10-24 20:00:00

Production does not run Alembic (Render runs uvicorn only); the same tables are created by the startup
self-heal (`Base.metadata.create_all`). This revision keeps a migrated database on the same shape.
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


revision: str = 'e1a0c5f2b7d4'
down_revision: Union[str, Sequence[str], None] = 'a107b7db4f12'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.create_table(
        'email_outbox',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('template', sa.String(length=64), nullable=False),
        sa.Column('recipient_hash', sa.String(length=64), nullable=False),
        sa.Column('recipient_address', sa.String(length=320), nullable=True),
        sa.Column('payload', sa.JSON(), nullable=True),
        sa.Column('priority', sa.String(length=12), nullable=False),
        sa.Column('not_before', sa.DateTime(timezone=True), nullable=True),
        sa.Column('status', sa.String(length=16), nullable=False),
        sa.Column('attempts', sa.Integer(), nullable=False),
        sa.Column('idempotency_key', sa.String(length=200), nullable=False),
        sa.Column('provider_message_id', sa.String(length=128), nullable=True),
        sa.Column('last_error', sa.String(length=64), nullable=True),
        sa.Column('claimed_until', sa.DateTime(timezone=True), nullable=True),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('idempotency_key'),
    )
    op.create_index(op.f('ix_email_outbox_recipient_hash'), 'email_outbox', ['recipient_hash'], unique=False)
    op.create_index(op.f('ix_email_outbox_created_at'), 'email_outbox', ['created_at'], unique=False)
    op.create_index('ix_email_outbox_status_created', 'email_outbox', ['status', 'created_at'], unique=False)

    op.create_table(
        'email_suppressions',
        sa.Column('id', sa.String(length=36), nullable=False),
        sa.Column('recipient_hash', sa.String(length=64), nullable=False),
        sa.Column('reason', sa.String(length=16), nullable=False),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('id'),
        sa.UniqueConstraint('recipient_hash'),
    )


def downgrade() -> None:
    op.drop_table('email_suppressions')
    op.drop_index('ix_email_outbox_status_created', table_name='email_outbox')
    op.drop_index(op.f('ix_email_outbox_created_at'), table_name='email_outbox')
    op.drop_index(op.f('ix_email_outbox_recipient_hash'), table_name='email_outbox')
    op.drop_table('email_outbox')
