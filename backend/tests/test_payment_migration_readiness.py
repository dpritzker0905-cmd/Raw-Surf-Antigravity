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

DEV_HEADS = ('2fd2888a0987', 'a107b7db4f12', 'avatar_url_text_001')


def config():
    return Config(str(Path(__file__).parents[1] / 'alembic.ini'))


def test_payment_upgrade_has_one_head_and_follows_all_existing_dev_heads():
    graph = ScriptDirectory.from_config(config())
    assert graph.get_heads() == ['checkout_intent_001']
    ancestry = {r.revision for r in graph.walk_revisions('base', 'checkout_intent_001')}
    assert set(DEV_HEADS) <= ancestry
    assert graph.get_revision('payment_reconciliation_001').down_revision == DEV_HEADS


@pytest.mark.skipif(not os.environ.get('PAYMENT_TEST_DATABASE_URL'), reason='Isolated PostgreSQL required')
async def test_real_alembic_upgrade_preserves_existing_rows_and_private_role_access(harness, monkeypatch):
    # Start with the current DEV schema, not the new ORM's create_all result.
    async with harness.engine.begin() as conn:
        namespace = await conn.scalar(text('SELECT current_schema()'))
        await conn.execute(text('DROP TABLE checkout_intents'))
        await conn.execute(text('DROP TABLE payment_reconciliation_cases'))
        await conn.execute(text(f'GRANT USAGE ON SCHEMA "{namespace}" TO anon, authenticated, service_role'))
    url = harness.engine.url.set(drivername='postgresql', query={'options': f'-csearch_path={namespace}'})
    monkeypatch.setenv('DATABASE_URL', url.render_as_string(hide_password=False))
    monkeypatch.setenv('PYTHON_DOTENV_DISABLED', '1')
    def upgrade():
        cfg = config()
        command.stamp(cfg, DEV_HEADS)
        command.upgrade(cfg, 'head')
    await asyncio.to_thread(upgrade)
    async with harness.engine.begin() as conn:
        assert await conn.scalar(text('SELECT version_num FROM alembic_version')) == 'checkout_intent_001'
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
    # Downgrade only the empty, new checkout table: existing commerce rows survive.
    await asyncio.to_thread(command.downgrade, config(), 'payment_reconciliation_001')
    await asyncio.to_thread(command.upgrade, config(), 'head')
    async with harness.engine.begin() as conn:
        assert await conn.scalar(text('SELECT count(*) FROM bookings')) == 1
        assert await conn.scalar(text('SELECT count(*) FROM payment_transactions')) == 1
        assert await conn.scalar(text('SELECT count(*) FROM checkout_intents')) == 0
