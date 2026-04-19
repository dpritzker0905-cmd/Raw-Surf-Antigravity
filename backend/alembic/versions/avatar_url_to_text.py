"""Widen avatar_url from VARCHAR(500) to TEXT

Revision ID: avatar_url_text_001
Revises: waves001
Create Date: 2026-04-19

WHY: Profile avatars are now stored as base64 data URLs directly in the DB
(to survive Render's ephemeral filesystem wipes on every deploy).
A compressed 800px JPEG at 85% quality is ~110,000 characters, which
overflows VARCHAR(500) and causes 'Failed to upload compressed avatar'.

TEXT in Postgres has no upper limit (up to 1GB), which is more than enough.
"""
from alembic import op
import sqlalchemy as sa

# revision identifiers, used by Alembic.
revision = 'avatar_url_text_001'
down_revision = 'waves001'
branch_labels = None
depends_on = None


def upgrade():
    # Alter the column type from VARCHAR(500) to TEXT
    op.alter_column(
        'profiles',
        'avatar_url',
        type_=sa.Text(),
        existing_type=sa.String(500),
        existing_nullable=True
    )


def downgrade():
    # Truncate and revert to VARCHAR(500) if rolling back
    # Note: any existing data > 500 chars will be truncated
    op.execute("UPDATE profiles SET avatar_url = LEFT(avatar_url, 500) WHERE LENGTH(avatar_url) > 500")
    op.alter_column(
        'profiles',
        'avatar_url',
        type_=sa.String(500),
        existing_type=sa.Text(),
        existing_nullable=True
    )
