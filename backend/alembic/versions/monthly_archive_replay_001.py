"""Durable monthly archive replay protection.

Revision ID: monthly_archive_replay_001
Revises: bonus_spend_only_001
Prepared only; do not apply to shared databases without release approval.
No historical snapshot adoption, cleanup or backfill is performed.
"""
from alembic import op
import sqlalchemy as sa

revision = 'monthly_archive_replay_001'
down_revision = 'bonus_spend_only_001'
branch_labels = None
depends_on = None


def upgrade():
    op.create_table(
        'monthly_leaderboard_archives',
        sa.Column('year', sa.Integer(), nullable=False),
        sa.Column('month', sa.Integer(), nullable=False),
        sa.Column('archived_count', sa.Integer(), nullable=False),
        sa.Column('completed_at', sa.DateTime(timezone=True), nullable=False),
        sa.PrimaryKeyConstraint('year', 'month'),
    )


def downgrade():
    # Dropping completion records would re-enable duplicate awards on retry.
    bind = op.get_bind()
    if bind.dialect.name == 'postgresql':
        bind.execute(sa.text('LOCK TABLE monthly_leaderboard_archives IN ACCESS EXCLUSIVE MODE'))
    if bind.execute(sa.text('SELECT COUNT(*) FROM monthly_leaderboard_archives')).scalar():
        raise RuntimeError('Cannot remove monthly archive replay protection while completion records exist')
    op.drop_table('monthly_leaderboard_archives')
