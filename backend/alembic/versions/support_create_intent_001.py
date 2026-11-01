"""Preserve original support creation intent across staff edits.

Revision ID: support_create_intent_001
Revises: monthly_archive_replay_001
Prepared only. Apply before deploying the new ORM; no historical intent is inferred.
"""
from alembic import op
import sqlalchemy as sa

revision = "support_create_intent_001"
down_revision = "monthly_archive_replay_001"
branch_labels = None
depends_on = None


def upgrade():
    op.add_column("support_tickets", sa.Column("creation_request_fingerprint", sa.String(64), nullable=True))


def downgrade():
    bind = op.get_bind()
    if bind.dialect.name == "postgresql":
        bind.execute(sa.text("LOCK TABLE support_tickets IN ACCESS EXCLUSIVE MODE"))
    if bind.execute(sa.text("SELECT 1 FROM support_tickets WHERE creation_request_fingerprint IS NOT NULL LIMIT 1")).first():
        raise RuntimeError("Cannot discard stored support creation intent")
    op.drop_column("support_tickets", "creation_request_fingerprint")
