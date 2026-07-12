"""add_pricing_config_rate_maps

Revision ID: a107b7db4f12
Revises: a2c4e8f91b03
Create Date: 2026-07-12 00:00:00.000000

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = 'a107b7db4f12'
down_revision: Union[str, Sequence[str], None] = 'a2c4e8f91b03'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """Upgrade schema."""
    op.add_column('global_pricing_config', sa.Column('commission_rates', sa.JSON(), nullable=True))
    op.add_column('global_pricing_config', sa.Column('surfer_discount_rates', sa.JSON(), nullable=True))


def downgrade() -> None:
    """Downgrade schema."""
    op.drop_column('global_pricing_config', 'surfer_discount_rates')
    op.drop_column('global_pricing_config', 'commission_rates')
