"""Real PostgreSQL interleavings; opt-in isolated loopback DB, never SQLite evidence."""
import asyncio
import importlib
import importlib.util
import json
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from models import Booking, CreditTransaction, LiveSessionParticipant, PaymentTransaction, Profile
from test_booking_payment_integrity import (  # noqa: F401
    SESSION, bearer, confirm, harness, live, live_completion, schema, snapshot, webhook,
)


pytestmark = pytest.mark.skipif(not os.environ.get('PAYMENT_TEST_DATABASE_URL'),
                               reason='Dedicated PostgreSQL gate requires an isolated loopback database')


async def observed_lock_wait(h):
    deadline = asyncio.get_running_loop().time() + 10
    async with h.engine.connect() as conn:
        while asyncio.get_running_loop().time() < deadline:
            # Fresh stats snapshot, actual server wait, not a guessed sleep.
            await conn.execute(text('SELECT pg_stat_clear_snapshot()'))
            count = await conn.scalar(text("SELECT count(*) FROM pg_stat_activity WHERE datname=current_database() "
                                           "AND application_name='payment-gates' AND wait_event_type='Lock'"))
            if count:
                return
            await asyncio.sleep(.025)
    raise AssertionError('The competing payment transaction never reached a PostgreSQL row-lock wait')


async def test_competing_callback_entry_points_commit_one_entitlement(harness):
    async with harness.sessions() as blocker:
        await blocker.scalar(select(PaymentTransaction).where(PaymentTransaction.id == 'transaction').with_for_update())
        tasks = [asyncio.create_task(action()) for action in (
            lambda: confirm(harness), lambda: webhook(harness),
            lambda: harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer()))]
        await observed_lock_wait(harness)
        await blocker.commit()
        responses = await asyncio.wait_for(asyncio.gather(*tasks), 15)
    assert [r.status_code for r in responses] == [200, 200, 200]
    assert await snapshot(harness) == ('Confirmed', 'Paid', 'paid', 80, 2, 2)


@pytest.mark.parametrize('winner', ['payment', 'cancel', 'expiry'])
async def test_payment_cancellation_expiry_have_serial_outcomes(harness, monkeypatch, winner):
    cancel = importlib.import_module('repair_booking_routes.booking_cancellation')
    harness.app.include_router(cancel.router, prefix='/api')
    import database
    monkeypatch.setattr(database, 'async_session_maker', harness.sessions)
    spec = importlib.util.spec_from_file_location('payment_gate_scheduler', Path(__file__).parents[1] / 'scheduler/bookings.py')
    scheduler = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(scheduler)
    async with harness.sessions() as db:
        (await db.get(Booking, 'booking')).pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        await db.commit()
    locked, release = asyncio.Event(), asyncio.Event()
    real_execute = harness.sessions.class_.execute
    async def execute(self, statement, *args, **kwargs):
        result = await real_execute(self, statement, *args, **kwargs)
        if (asyncio.current_task().get_name() == 'winning-transition' and
                getattr(statement, '_for_update_arg', None) is not None and 'FROM bookings' in str(statement)):
            locked.set()
            await asyncio.wait_for(release.wait(), 15)
        return result
    monkeypatch.setattr(harness.sessions.class_, 'execute', execute)
    async def payment(): return await confirm(harness)
    async def cancellation():
        return await harness.client.post('/api/bookings/booking/cancel', headers=bearer('pro'), json={})
    async def expiry(): return await scheduler.cleanup_expired_booking_payments_task()
    first = asyncio.create_task({'payment': payment, 'cancel': cancellation, 'expiry': expiry}[winner](), name='winning-transition')
    await asyncio.wait_for(locked.wait(), 15)
    second = asyncio.create_task(cancellation() if winner == 'payment' else payment())
    try:
        await observed_lock_wait(harness)
    finally:
        release.set()
    a, b = await asyncio.wait_for(asyncio.gather(first, second), 15)
    async with harness.sessions() as db:
        booking, owner = await db.get(Booking, 'booking'), await db.get(Profile, 'owner')
        ledger = (await db.scalars(select(CreditTransaction))).all()
        assert booking.status == 'Cancelled'
        if winner == 'payment':
            assert a.status_code == b.status_code == 200
            assert owner.credit_balance == 180 and len(ledger) == 3
        else:
            assert b.status_code == 409, b.text
            assert owner.credit_balance == 100 and len(ledger) == 1


async def test_live_two_paid_checkouts_create_one_participant_and_one_case(harness, live_completion):
    original = SimpleNamespace(**vars(harness.session))
    duplicate = SimpleNamespace(**dict(vars(original), id='second-checkout'))
    async with harness.sessions() as db:
        db.add(PaymentTransaction(id='second-transaction', user_id='owner', session_id='second-checkout',
            amount=25, currency='usd', status='Pending', payment_status='Pending',
            transaction_metadata=json.dumps(harness.session.metadata)))
        await db.commit()
    harness.module.stripe.checkout.Session.retrieve = lambda identifier, **kw: original if identifier == SESSION else duplicate
    async with harness.sessions() as blocker:
        await blocker.scalar(select(Profile).where(Profile.id == 'pro').with_for_update())
        tasks = [asyncio.create_task(harness.client.post('/api/sessions/complete-payment', headers=bearer(),
            json={'checkout_session_id': identifier})) for identifier in (SESSION, 'second-checkout')]
        await observed_lock_wait(harness)
        await blocker.commit()
        results = await asyncio.wait_for(asyncio.gather(*tasks), 15)
    assert sorted(r.status_code for r in results) == [200, 409]
    async with harness.sessions() as db:
        assert len((await db.scalars(select(LiveSessionParticipant))).all()) == 1
        assert await db.scalar(text('SELECT count(*) FROM payment_reconciliation_cases')) == 1


async def test_concurrent_unfulfillable_webhooks_leave_one_case(harness):
    async with harness.sessions() as db:
        (await db.get(Booking, 'booking')).status = 'Cancelled'
        await db.commit()
    results = await asyncio.wait_for(asyncio.gather(*[webhook(harness) for _ in range(5)]), 15)
    assert all(r.status_code == 200 for r in results), [r.text for r in results]
    async with harness.sessions() as db:
        assert await db.scalar(text('SELECT count(*) FROM payment_reconciliation_cases')) == 1
        assert not (await db.scalars(select(CreditTransaction))).all()


async def test_reconciliation_migration_matches_bootstrap_and_denies_public_roles(harness):
    from alembic.migration import MigrationContext
    from alembic.operations import Operations
    from sqlalchemy import inspect
    from models import PaymentReconciliationCase
    path = Path(__file__).parents[1] / 'alembic/versions/payment_reconciliation_001.py'
    spec = importlib.util.spec_from_file_location('payment_case_migration', path)
    migration = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(migration)
    def exercise(connection):
        with Operations.context(MigrationContext.configure(connection)):
            migration.downgrade()
            migration.upgrade()
        columns = inspect(connection).get_columns('payment_reconciliation_cases')
        assert {c['name']: c['nullable'] for c in columns} == {
            c.name: c.nullable for c in PaymentReconciliationCase.__table__.columns}
    async with harness.engine.begin() as conn:
        await conn.run_sync(exercise)
        assert await conn.scalar(text("SELECT relrowsecurity FROM pg_class WHERE oid='payment_reconciliation_cases'::regclass"))
        for role in ('anon', 'authenticated'):
            assert not await conn.scalar(text("SELECT has_table_privilege(:role, 'payment_reconciliation_cases', 'SELECT')"), {'role': role})
        assert await conn.scalar(text("SELECT has_table_privilege('service_role', 'payment_reconciliation_cases', 'SELECT')"))
