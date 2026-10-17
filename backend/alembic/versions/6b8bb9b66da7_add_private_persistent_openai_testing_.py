"""add private persistent OpenAI testing budget

Revision ID: 6b8bb9b66da7
Revises: 2fd2888a0987
Create Date: 2026-10-15 16:58:38.210147

"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa


# revision identifiers, used by Alembic.
revision: str = '6b8bb9b66da7'
down_revision: Union[str, Sequence[str], None] = '2fd2888a0987'
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    """A closed ledger must be explicitly initialized after prior spend is verified."""
    if op.get_bind().dialect.name != "postgresql":
        raise RuntimeError("OpenAI budget migration requires PostgreSQL")
    op.execute("CREATE SCHEMA ai_budget_private")
    op.execute("REVOKE ALL ON SCHEMA ai_budget_private FROM PUBLIC")
    op.create_table(
        "openai_budget",
        sa.Column("id", sa.String(40), primary_key=True),
        sa.Column("reserved_microdollars", sa.BigInteger(), nullable=False),
        sa.Column("initialized", sa.Boolean(), nullable=False),
        sa.CheckConstraint("reserved_microdollars >= 0 AND reserved_microdollars <= 10000000"),
        schema="ai_budget_private",
    )
    op.execute("ALTER TABLE ai_budget_private.openai_budget ENABLE ROW LEVEL SECURITY")
    op.execute("REVOKE ALL ON TABLE ai_budget_private.openai_budget FROM PUBLIC")
    # These roles exist on Supabase but need not exist in isolated PostgreSQL CI.
    op.execute("""DO $$ BEGIN
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'anon') THEN
            REVOKE ALL ON SCHEMA ai_budget_private FROM anon;
            REVOKE ALL ON TABLE ai_budget_private.openai_budget FROM anon;
        END IF;
        IF EXISTS (SELECT FROM pg_roles WHERE rolname = 'authenticated') THEN
            REVOKE ALL ON SCHEMA ai_budget_private FROM authenticated;
            REVOKE ALL ON TABLE ai_budget_private.openai_budget FROM authenticated;
        END IF;
    END $$""")
    op.execute("""INSERT INTO ai_budget_private.openai_budget
        (id, reserved_microdollars, initialized) VALUES ('openai-testing-v1', 10000000, false)""")


def downgrade() -> None:
    raise RuntimeError("Retain the spending ledger; disable the guard through OPENAI_TEST_BUDGET_ENABLED")
