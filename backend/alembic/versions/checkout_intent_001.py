"""Durable pre-provider checkout identity; apply explicitly after recovery migration."""
from alembic import op
import sqlalchemy as sa
revision='checkout_intent_001'
down_revision='payment_reconciliation_001'
branch_labels=None
depends_on=None


def upgrade():
    op.create_table('checkout_intents',
        sa.Column('id',sa.String(36),primary_key=True),
        sa.Column('user_id',sa.String(36),sa.ForeignKey('profiles.id'),nullable=False),
        sa.Column('transaction_id',sa.String(36),sa.ForeignKey('payment_transactions.id'),nullable=False,unique=True),
        sa.Column('booking_id',sa.String(36),sa.ForeignKey('bookings.id')),
        sa.Column('kind',sa.String(30),nullable=False),
        sa.Column('request_key',sa.String(64),nullable=False),
        sa.Column('fingerprint',sa.String(64),nullable=False),
        sa.Column('amount_cents',sa.Integer(),nullable=False),
        sa.Column('provider_params',sa.JSON(),nullable=False),
        sa.Column('response_data',sa.JSON(),nullable=False),
        sa.Column('state',sa.String(30),nullable=False),
        sa.Column('session_id',sa.String(255),unique=True),
        sa.Column('first_attempt_at',sa.DateTime(timezone=True)),
        sa.Column('last_error_type',sa.String(80)),
        sa.Column('created_at',sa.DateTime(timezone=True),nullable=False),
        sa.Column('updated_at',sa.DateTime(timezone=True),nullable=False),
        sa.UniqueConstraint('user_id','request_key',name='uq_checkout_intent_request'))
    op.create_index('ix_checkout_intents_user_id','checkout_intents',['user_id'])
    op.create_index('ix_checkout_intents_state','checkout_intents',['state'])
    if op.get_bind().dialect.name=='postgresql':
        op.execute('ALTER TABLE checkout_intents ENABLE ROW LEVEL SECURITY')
        op.execute('REVOKE ALL ON TABLE checkout_intents FROM anon, authenticated')
        op.execute('GRANT SELECT, INSERT, UPDATE, DELETE ON TABLE checkout_intents TO service_role')


def downgrade():
    op.drop_table('checkout_intents')
