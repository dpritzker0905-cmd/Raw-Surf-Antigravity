"""One XP grant per (user, claimable reference): partial unique index on xp_transactions.

Revision ID: xp_claim_unique_001
Revises: support_create_intent_001
Prepared only. Defense in depth for POST /gamification/award-xp (PR #920): the route already serializes replays
with a row lock under READ COMMITTED; this index makes a double grant impossible at any isolation level.

Partial on purpose: only reference_type 'review' and 'live_session' (the types the route can claim). A gallery
purchase references the ITEM, which a buyer may buy twice, so a full constraint would break checkout.

Pre-check (read-only, 2026-11-15, Supabase project "Raw Surf App Antigravity"): review 3 rows / 3 keys,
live_session 14 rows / 14 keys (2 with NULL reference_id, which a unique index treats as distinct). No duplicates.
upgrade() re-checks and refuses with the offending keys rather than failing half-way.
"""
from alembic import op
import sqlalchemy as sa

revision = "xp_claim_unique_001"
down_revision = "support_create_intent_001"
branch_labels = None
depends_on = None

INDEX = "uq_xp_transactions_claim_ref"
WHERE = "reference_type IN ('review', 'live_session')"


def upgrade():
    bind = op.get_bind()
    duplicates = bind.execute(sa.text(
        "SELECT user_id, reference_type, reference_id, count(*) FROM xp_transactions "
        f"WHERE {WHERE} AND reference_id IS NOT NULL "
        "GROUP BY user_id, reference_type, reference_id HAVING count(*) > 1 LIMIT 20"
    )).fetchall()
    if duplicates:
        raise RuntimeError(
            f"{INDEX}: duplicate XP grants exist; resolve them (owner decision) before applying: {duplicates}")
    op.create_index(INDEX, "xp_transactions", ["user_id", "reference_type", "reference_id"], unique=True,
                    postgresql_where=sa.text(WHERE), sqlite_where=sa.text(WHERE))


def downgrade():
    op.drop_index(INDEX, table_name="xp_transactions")
