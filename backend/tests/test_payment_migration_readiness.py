"""Exercise the real Alembic graph and existing-schema payment upgrade path."""
import asyncio
import os
from pathlib import Path

from alembic import command
from alembic.config import Config
from alembic.script import ScriptDirectory
import pytest
from sqlalchemy import text

from test_booking_payment_integrity import harness, schema  # noqa: F401

LEGACY_HEADS = ('2fd2888a0987', 'a107b7db4f12', 'avatar_url_text_001')
DEV_HEADS = ('6b8bb9b66da7', 'a107b7db4f12', 'avatar_url_text_001')
COMBINED_HEAD = 'payment_budget_merge_001'


def config():
    return Config(str(Path(__file__).parents[1] / 'alembic.ini'))


def test_payment_upgrade_has_one_head_and_follows_all_existing_dev_heads():
    graph = ScriptDirectory.from_config(config())
    assert graph.get_heads() == [COMBINED_HEAD]
    ancestry = {r.revision for r in graph.walk_revisions('base', COMBINED_HEAD)}
    assert set(DEV_HEADS) <= ancestry
    assert graph.get_revision('payment_reconciliation_001').down_revision == LEGACY_HEADS
    assert graph.get_revision(COMBINED_HEAD).down_revision == ('checkout_intent_001', '6b8bb9b66da7')
    assert [step.revision.revision for step in graph._upgrade_revs(COMBINED_HEAD, DEV_HEADS)] == [
        'payment_reconciliation_001', 'checkout_intent_001', COMBINED_HEAD]
    # The merge joins history only: calling either direction must issue no operations.
    merge = graph.get_revision(COMBINED_HEAD).module
    assert merge.upgrade() is None
    assert merge.downgrade() is None


@pytest.mark.skipif(not os.environ.get('PAYMENT_TEST_DATABASE_URL'), reason='Isolated PostgreSQL required')
async def test_real_alembic_upgrade_preserves_existing_rows_and_private_role_access(harness, monkeypatch):
    # The harness itself refuses non-loopback/non-disposable databases. The private
    # budget schema has a fixed name: refuse an occupied one and only clean our own.
    async with harness.engine.begin() as conn:
        assert not await conn.scalar(text("SELECT to_regnamespace('ai_budget_private')"))
        namespace = await conn.scalar(text('SELECT current_schema()'))
        await conn.execute(text('DROP TABLE checkout_intents'))
        await conn.execute(text('DROP TABLE payment_reconciliation_cases'))
        await conn.execute(text(f'GRANT USAGE ON SCHEMA "{namespace}" TO anon, authenticated, service_role'))
    url = harness.engine.url.set(drivername='postgresql', query={'options': f'-csearch_path={namespace}'})
    monkeypatch.setenv('DATABASE_URL', url.render_as_string(hide_password=False))
    monkeypatch.setenv('PYTHON_DOTENV_DISABLED', '1')

    def install_existing_budget():
        cfg = config()
        # Fixture-only history for the pre-existing commerce schema. Real budget DDL
        # then runs once, before payment integration, just as on the reported baseline.
        command.stamp(cfg, LEGACY_HEADS)
        command.upgrade(cfg, '6b8bb9b66da7')

    async def budget_snapshot(conn):
        row = (await conn.execute(text("""SELECT n.oid, n.nspacl::text, c.oid,
            c.relrowsecurity, c.relacl::text, b.id, b.reserved_microdollars, b.initialized
            FROM pg_namespace n JOIN pg_class c ON c.relnamespace=n.oid
            CROSS JOIN ai_budget_private.openai_budget b
            WHERE n.nspname='ai_budget_private' AND c.relname='openai_budget'"""))).one()
        return tuple(row)

    owned_budget = False
    try:
        await asyncio.to_thread(install_existing_budget)
        owned_budget = True
        async with harness.engine.begin() as conn:
            assert set((await conn.execute(text('SELECT version_num FROM alembic_version'))).scalars()) == set(DEV_HEADS)
            # Synthetic initialization/reservation, never a provider request or live cap reset.
            await conn.execute(text("""UPDATE ai_budget_private.openai_budget
                SET reserved_microdollars=3700000, initialized=true WHERE id='openai-testing-v1'"""))
            before = await budget_snapshot(conn)
            assert before[-2:] == (3700000, True)
        await asyncio.to_thread(command.upgrade, config(), COMBINED_HEAD)
        async with harness.engine.begin() as conn:
            assert list((await conn.execute(text('SELECT version_num FROM alembic_version'))).scalars()) == [COMBINED_HEAD]
            assert await budget_snapshot(conn) == before
            assert await conn.scalar(text('SELECT count(*) FROM bookings')) == 1
            assert await conn.scalar(text('SELECT count(*) FROM payment_transactions')) == 1
            for table in ('checkout_intents', 'payment_reconciliation_cases'):
                assert await conn.scalar(text(f"SELECT relrowsecurity FROM pg_class WHERE oid='{table}'::regclass"))
                for role in ('anon', 'authenticated'):
                    for operation in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                        assert not await conn.scalar(text(
                            f"SELECT has_table_privilege('{role}', '{table}', '{operation}')"))
                for operation in ('SELECT', 'INSERT', 'UPDATE', 'DELETE'):
                    assert await conn.scalar(text(
                        f"SELECT has_table_privilege('service_role', '{table}', '{operation}')"))
            await conn.execute(text('SET LOCAL ROLE service_role'))
            assert await conn.scalar(text('SELECT count(*) FROM checkout_intents')) == 0
        # Re-running the exact target must not replay budget DDL or erase its record.
        await asyncio.to_thread(command.upgrade, config(), COMBINED_HEAD)
        async with harness.engine.begin() as conn:
            assert await budget_snapshot(conn) == before
            assert await conn.scalar(text('SELECT count(*) FROM bookings')) == 1
            assert await conn.scalar(text('SELECT count(*) FROM payment_transactions')) == 1
    finally:
        if owned_budget:
            async with harness.engine.begin() as conn:
                await conn.execute(text('DROP SCHEMA ai_budget_private CASCADE'))
