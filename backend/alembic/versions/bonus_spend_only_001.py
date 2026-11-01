"""Spend-only credit accounting and versioned admin bonus offers.

Revision ID: bonus_spend_only_001
Revises: e1a0c5f2b7d4

Prepared only: do not apply to shared databases without release approval.
The separate avatar_url_text_001 and 6b8bb9b66da7 heads are pre-existing and are not merged here.
"""
from alembic import op
import sqlalchemy as sa

revision = 'bonus_spend_only_001'
down_revision = 'e1a0c5f2b7d4'
branch_labels = None
depends_on = None


def upgrade():
    op.add_column('live_session_participants', sa.Column('payment_credit_transaction_id', sa.String(36), nullable=True))
    op.add_column('profiles', sa.Column('spend_only_credits', sa.Float(), nullable=False, server_default='0'))
    op.add_column('credit_transactions', sa.Column('spend_only_amount', sa.Float(), nullable=False, server_default='0'))
    op.add_column('credit_transactions', sa.Column('refund_of_transaction_id', sa.String(36), nullable=True))
    op.create_index('ix_credit_transactions_refund_of_transaction_id', 'credit_transactions', ['refund_of_transaction_id'])
    op.add_column('global_pricing_config', sa.Column('credit_package_bonuses', sa.JSON(), nullable=True))


def downgrade():
    # Dropping classification while promotional value remains would make it cashable.
    bind = op.get_bind()
    if (bind.execute(sa.text('SELECT COUNT(*) FROM profiles WHERE spend_only_credits <> 0')).scalar()
            or bind.execute(sa.text('SELECT COUNT(*) FROM credit_transactions WHERE spend_only_amount <> 0')).scalar()):
        raise RuntimeError('Cannot remove spend-only accounting while promotional balances remain')
    if bind.execute(sa.text('SELECT COUNT(*) FROM global_pricing_config WHERE credit_package_bonuses IS NOT NULL')).scalar():
        raise RuntimeError('Cannot remove saved offer history; outstanding checkouts may reference it')
    op.drop_column('global_pricing_config', 'credit_package_bonuses')
    op.drop_index('ix_credit_transactions_refund_of_transaction_id', table_name='credit_transactions')
    op.drop_column('credit_transactions', 'refund_of_transaction_id')
    op.drop_column('credit_transactions', 'spend_only_amount')
    op.drop_column('profiles', 'spend_only_credits')
    op.drop_column('live_session_participants', 'payment_credit_transaction_id')
