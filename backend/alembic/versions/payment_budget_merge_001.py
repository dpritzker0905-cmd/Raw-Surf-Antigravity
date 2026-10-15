"""Join qualified payment recovery and the existing private budget history.

This revision performs no DDL and must never reset the initialized budget ledger.
"""

revision = 'payment_budget_merge_001'
down_revision = ('checkout_intent_001', '6b8bb9b66da7')
branch_labels = None
depends_on = None


def upgrade():
    pass


def downgrade():
    pass
