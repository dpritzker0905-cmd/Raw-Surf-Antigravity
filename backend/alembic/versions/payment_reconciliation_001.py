"""Durable payment reconciliation cases. Apply explicitly; no deployment in repair batch."""
from alembic import op
import sqlalchemy as sa

revision = 'payment_reconciliation_001'
# Unreleased: join all three current DEV heads before adding private payment tables.
down_revision = ('2fd2888a0987', 'a107b7db4f12', 'avatar_url_text_001')
branch_labels = None
depends_on = None


def upgrade():
    op.create_table('payment_reconciliation_cases',
        sa.Column('id', sa.String(36), primary_key=True),
        sa.Column('transaction_id', sa.String(36), sa.ForeignKey('payment_transactions.id'), nullable=False, unique=True),
        sa.Column('session_id', sa.String(255), nullable=False, unique=True),
        sa.Column('payment_intent_id', sa.String(255)),
        sa.Column('amount_cents', sa.Integer(), nullable=False),
        sa.Column('currency', sa.String(10), nullable=False),
        sa.Column('reason', sa.String(80), nullable=False),
        sa.Column('state', sa.String(30), nullable=False),
        sa.Column('refund_id', sa.String(255)),
        sa.Column('refund_started_at', sa.DateTime(timezone=True)),
        sa.Column('last_error_type', sa.String(100)),
        sa.Column('resolved_by', sa.String(36), sa.ForeignKey('profiles.id')),
        sa.Column('created_at', sa.DateTime(timezone=True), nullable=False),
        sa.Column('updated_at', sa.DateTime(timezone=True), nullable=False))
    op.create_index('ix_payment_reconciliation_cases_state', 'payment_reconciliation_cases', ['state'])
    if op.get_bind().dialect.name == 'postgresql':
        op.execute('ALTER TABLE payment_reconciliation_cases ENABLE ROW LEVEL SECURITY')
        op.execute('REVOKE ALL ON TABLE payment_reconciliation_cases FROM anon, authenticated')
        op.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE payment_reconciliation_cases TO service_role')


def downgrade():
    op.drop_table('payment_reconciliation_cases')
