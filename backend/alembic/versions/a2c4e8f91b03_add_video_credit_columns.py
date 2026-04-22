"""add video credit columns

Revision ID: a2c4e8f91b03
Revises: d42bb546bc54
Create Date: 2026-04-22 01:40:00.000000

"""
from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision = 'a2c4e8f91b03'
down_revision = 'd42bb546bc54'
branch_labels = None
depends_on = None


def upgrade():
    # PhotographerSettings: Add videos_included for each session type
    op.add_column('photographer_settings',
        sa.Column('on_demand_videos_included', sa.Integer(), server_default='1', nullable=True))
    op.add_column('photographer_settings',
        sa.Column('live_session_videos_included', sa.Integer(), server_default='1', nullable=True))
    op.add_column('photographer_settings',
        sa.Column('booking_videos_included', sa.Integer(), server_default='1', nullable=True))
    
    # LiveSession: Add videos_included
    op.add_column('live_sessions',
        sa.Column('videos_included', sa.Integer(), server_default='1', nullable=True))
    
    # LiveSessionParticipant: Add videos_credit_remaining
    op.add_column('live_session_participants',
        sa.Column('videos_credit_remaining', sa.Integer(), server_default='0', nullable=True))


def downgrade():
    op.drop_column('live_session_participants', 'videos_credit_remaining')
    op.drop_column('live_sessions', 'videos_included')
    op.drop_column('photographer_settings', 'booking_videos_included')
    op.drop_column('photographer_settings', 'live_session_videos_included')
    op.drop_column('photographer_settings', 'on_demand_videos_included')
