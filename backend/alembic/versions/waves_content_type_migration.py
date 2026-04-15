"""Add content_type and aspect_ratio for Waves feature

Revision ID: waves001
Revises: 
Create Date: 2024-12-01

"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'waves001'
down_revision = None
branch_labels = None
depends_on = None


def upgrade():
    # Add content_type column to posts table
    # 'post' = regular post, 'wave' = short-form vertical video
    op.add_column('posts', sa.Column('content_type', sa.String(20), server_default='post', nullable=False))
    
    # Add aspect_ratio column for video orientation tracking
    # '9:16' = vertical (Waves), '16:9' = landscape, '1:1' = square, '4:5' = portrait
    op.add_column('posts', sa.Column('aspect_ratio', sa.String(10), nullable=True))
    
    # Add view_count for Waves engagement tracking
    op.add_column('posts', sa.Column('view_count', sa.Integer, server_default='0', nullable=False))
    
    # Add index for fast content_type filtering
    op.create_index('ix_posts_content_type', 'posts', ['content_type'])


def downgrade():
    op.drop_index('ix_posts_content_type', table_name='posts')
    op.drop_column('posts', 'view_count')
    op.drop_column('posts', 'aspect_ratio')
    op.drop_column('posts', 'content_type')
