"""Scheduled checkout HTTP/ORM controls; provider doubles, no network or real money."""
import importlib
import importlib.util
import json
import shutil
import sys
import hashlib
import hmac
import time
import uuid
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path
from types import ModuleType, SimpleNamespace
from unittest.mock import AsyncMock

import pytest
import pytest_asyncio
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from sqlalchemy import create_engine, select, text
from sqlalchemy.engine import make_url
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import Booking, BookingParticipant, CreditTransaction, Notification, PaymentTransaction, Profile, RoleEnum


SESSION = 'checkout-fixture'
META = dict(type='scheduled_booking', booking_id='booking', user_id='owner',
            photographer_id='pro', credits_applied='20')


def bearer(actor='owner'):
    if actor is None:
        return {}
    if actor == 'invalid':
        return {'Authorization': 'Bearer invalid'}
    token = create_access_token({'sub': 'owner' if actor == 'expired' else actor},
                                expires_delta=timedelta(minutes=-1) if actor == 'expired' else None)
    return {'Authorization': 'Bearer ' + token}


@pytest.fixture(scope='module')
def schema(tmp_path_factory):
    path = tmp_path_factory.mktemp('booking-schema') / 'schema.sqlite'
    engine = create_engine(f'sqlite:///{path}')
    Base.metadata.create_all(engine)
    engine.dispose()
    return path


@pytest_asyncio.fixture
async def harness(tmp_path, schema, monkeypatch):
    package = ModuleType('repair_booking_routes')
    package.__path__ = [str(Path(__file__).parents[1] / 'routes/bookings')]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    module = importlib.import_module('repair_booking_routes.stripe_checkout')
    # Load recovery without importing the entire routes package into this focused harness.
    recovery_spec = importlib.util.spec_from_file_location('repair_payment_recovery',
        Path(__file__).parents[1] / 'routes/payment_recovery.py')
    recovery = importlib.util.module_from_spec(recovery_spec)
    recovery_spec.loader.exec_module(recovery)
    monkeypatch.setitem(sys.modules, 'routes.payment_recovery', recovery)
    push = ModuleType('routes.notifications.push')
    push.notify_booking = AsyncMock()
    monkeypatch.setitem(sys.modules, push.__name__, push)
    monkeypatch.setattr(module, 'STRIPE_API_KEY', object())
    # Refuse the legacy local cache rather than create a SQLite file outside the fixture.
    def forbidden_cache(*args, **kwargs):
        raise RuntimeError('Legacy payment cache is not provider evidence')
    monkeypatch.setattr(module, 'sqlite3', SimpleNamespace(connect=forbidden_cache), raising=False)
    created, retrieved = [], []
    session = SimpleNamespace(id=SESSION, payment_status='paid', status='complete', amount_total=8000,
                              currency='usd', metadata=dict(META), payment_intent='intent-fixture')
    def retrieve(identifier, **kwargs):
        retrieved.append(identifier)
        return session
    def create(**kwargs):
        created.append(kwargs)
        return SimpleNamespace(id='new-checkout', url='https://checkout.example.invalid/session',
            status='open', payment_status='unpaid', currency='usd', metadata=dict(kwargs['metadata']),
            amount_total=kwargs['line_items'][0]['price_data']['unit_amount'], expires_at=kwargs['expires_at'])
    monkeypatch.setattr(module.stripe.checkout.Session, 'retrieve', retrieve)
    monkeypatch.setattr(module.stripe.checkout.Session, 'create', create)
    monkeypatch.setattr(module, 'stripe_mcp_server', SimpleNamespace(DB_PATH='unused',
        stripe_create_checkout_session=lambda **kwargs: {
            'checkout_session_id': 'legacy-simulation', 'url': 'https://checkout.example.invalid/simulation'}), raising=False)
    pg_url = os.environ.get('PAYMENT_TEST_DATABASE_URL')
    pg_schema = None
    if pg_url:
        parsed = make_url(pg_url)
        if parsed.host not in ('localhost', '127.0.0.1', '::1') or not parsed.database.startswith('rawsurf_payment_gate'):
            raise RuntimeError('Payment fixtures refuse non-loopback or non-disposable PostgreSQL')
        pg_schema = 'payment_' + uuid.uuid4().hex
        engine = create_async_engine(pg_url, connect_args={'server_settings': {'search_path': pg_schema,
                                                                            'application_name': 'payment-gates'}})
        async with engine.begin() as conn:
            for role in ('anon', 'authenticated', 'service_role'):
                await conn.execute(text(f"DO $$ BEGIN IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='{role}') "
                                        f"THEN CREATE ROLE {role} NOLOGIN; END IF; END $$"))
            await conn.execute(text(f'CREATE SCHEMA "{pg_schema}"'))
            await conn.run_sync(Base.metadata.create_all)
    else:
        dbfile = tmp_path / 'booking.sqlite'
        shutil.copyfile(schema, dbfile)
        engine = create_async_engine(f'sqlite+aiosqlite:///{dbfile}')
    sessions = async_sessionmaker(engine, expire_on_commit=False, autoflush=False)
    async with sessions() as db:
        db.add_all([Profile(id=actor, user_id=actor, email=f'{actor}@example.invalid', full_name=actor,
                            role=RoleEnum.SURFER, credit_balance=80, booking_hourly_rate=100)
                    for actor in ('owner', 'other', 'pro')])
        db.add(Booking(id='booking', photographer_id='pro', creator_id='owner', location='Fixture beach',
                       session_date=datetime.now(timezone.utc) + timedelta(days=10), duration=60,
                       total_price=100, status='Pending Payment',
                       pending_payment_expires_at=datetime.now(timezone.utc) + timedelta(minutes=25)))
        db.add(BookingParticipant(id='participant', booking_id='booking', participant_id='owner',
                                  paid_amount=20, payment_status='Pending', status='pending'))
        db.add(PaymentTransaction(id='transaction', user_id='owner', session_id=SESSION, amount=80,
                                  currency='usd', status='Pending', payment_status='Pending',
                                  transaction_metadata=json.dumps(dict(META, credits_applied=20))))
        await db.commit()

    async def database():
        async with sessions() as db:
            yield db

    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    spec = importlib.util.spec_from_file_location('repair_payments', Path(__file__).parents[1] / 'routes/subscriptions_billing/payments.py')
    payments = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(payments)
    monkeypatch.setattr(payments, 'STRIPE_API_KEY', object())
    webhook_secret = uuid.uuid4().hex
    monkeypatch.setenv('STRIPE_WEBHOOK_SECRET', webhook_secret)
    app.include_router(payments.router, prefix='/api')
    app.dependency_overrides[get_db] = database
    async with AsyncClient(transport=ASGITransport(app=app, raise_app_exceptions=False),
                           base_url='https://test.invalid') as client:
        yield SimpleNamespace(client=client, sessions=sessions, module=module, app=app, session=session,
                              created=created, retrieved=retrieved, push=push, webhook_secret=webhook_secret, engine=engine,
                              payments=payments, recovery=recovery)
    if pg_schema:
        async with engine.begin() as conn:
            await conn.execute(text(f'DROP SCHEMA "{pg_schema}" CASCADE'))
    await engine.dispose()


async def confirm(h, actor='owner', **params):
    return await h.client.get('/api/bookings/payment-success', headers=bearer(actor),
                              params=dict(session_id=params.get('session_id', SESSION),
                                          booking_id=params.get('booking_id', 'booking')))


async def snapshot(h):
    async with h.sessions() as db:
        b = await db.get(Booking, 'booking')
        p = await db.get(BookingParticipant, 'participant')
        tx = await db.get(PaymentTransaction, 'transaction')
        owner = await db.get(Profile, 'owner')
        ledger = list((await db.scalars(select(CreditTransaction))).all())
        notifications = list((await db.scalars(select(Notification))).all())
        return b.status, p.payment_status, tx.payment_status if tx else None, owner.credit_balance, len(ledger), len(notifications)


@pytest.mark.parametrize('actor,status', [(None, 401), ('invalid', 401), ('expired', 401), ('other', 403)])
async def test_caller_authority_precedes_provider_and_mutations(harness, actor, status):
    before = await snapshot(harness)
    response = await confirm(harness, actor)
    assert response.status_code == status, response.text
    assert await snapshot(harness) == before
    assert harness.retrieved == []


@pytest.mark.parametrize('field,value', [
    ('payment_status', 'unpaid'), ('status', 'expired'), ('amount_total', 1), ('currency', 'eur'),
    ('id', 'other-checkout'), ('metadata', dict(META, booking_id='other')),
    ('metadata', dict(META, user_id='other')), ('metadata', dict(META, photographer_id='other')),
    ('metadata', dict(META, type='subscription')), ('metadata', dict(META, credits_applied='0')),
])
async def test_unbound_or_unpaid_provider_evidence_cannot_confirm(harness, field, value):
    before = await snapshot(harness)
    setattr(harness.session, field, value)
    response = await confirm(harness)
    assert response.status_code == 400, response.text
    assert await snapshot(harness) == before


async def test_prefix_is_not_evidence_even_when_local_transaction_is_missing(harness):
    before = await snapshot(harness)
    response = await confirm(harness, session_id='cs_' + 'test_unverified')
    assert response.status_code == 404, response.text
    assert await snapshot(harness) == before


@pytest.mark.parametrize('condition', ['cancelled', 'refunded', 'wrong-local-owner', 'missing-participant'])
async def test_ineligible_local_state_cannot_be_revived(harness, condition):
    async with harness.sessions() as db:
        b = await db.get(Booking, 'booking')
        tx = await db.get(PaymentTransaction, 'transaction')
        if condition == 'cancelled':
            b.status = 'Cancelled'
        elif condition == 'refunded':
            tx.payment_status = 'Refunded'
        elif condition == 'wrong-local-owner':
            tx.user_id = 'other'
        else:
            await db.delete(await db.get(BookingParticipant, 'participant'))
        await db.commit()
    response = await confirm(harness)
    assert response.status_code in (400, 403, 409), response.text
    async with harness.sessions() as db:
        assert (await db.get(Booking, 'booking')).status != 'Confirmed'
        assert not (await db.scalars(select(CreditTransaction))).all()
        assert not (await db.scalars(select(Notification))).all()


async def test_verified_test_mode_session_fulfills_once(harness):
    identifier = 'cs_' + 'test_verified'
    harness.session.id = identifier
    async with harness.sessions() as db:
        (await db.get(PaymentTransaction, 'transaction')).session_id = identifier
        await db.commit()
    for _ in range(2):
        response = await confirm(harness, session_id=identifier)
        assert response.status_code == 200, response.text
    assert harness.retrieved == [identifier, identifier]
    assert await snapshot(harness) == ('Confirmed', 'Paid', 'paid', 80, 2, 2)
    async with harness.sessions() as db:
        booking = await db.get(Booking, 'booking')
        participant = await db.get(BookingParticipant, 'participant')
        assert booking.escrow_amount == 80 and booking.escrow_status == 'held'
        assert participant.paid_amount == 100
        ledger = list((await db.scalars(select(CreditTransaction))).all())
        assert sorted(row.amount for row in ledger) == [-80, 80]


async def webhook(h, event_type='checkout.session.completed', signature=True):
    body = json.dumps({'type': event_type, 'data': {'object': vars(h.session)}}).encode()
    timestamp = int(time.time())
    digest = hmac.new(h.webhook_secret.encode(), str(timestamp).encode() + b'.' + body, hashlib.sha256).hexdigest()
    headers = {'Stripe-Signature': f't={timestamp},v1={digest}'} if signature else {}
    return await h.client.post('/api/webhook/stripe', content=body, headers=headers)


@pytest.mark.parametrize('first', ['webhook', 'status', 'redirect'])
async def test_every_entry_point_shares_one_fulfillment(harness, first):
    async def status():
        return await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
    actions = {'webhook': lambda: webhook(harness), 'status': status, 'redirect': lambda: confirm(harness)}
    for name in [first, 'webhook', 'status', 'redirect']:
        response = await actions[name]()
        assert response.status_code == 200, response.text
    assert await snapshot(harness) == ('Confirmed', 'Paid', 'paid', 80, 2, 2)


@pytest.mark.parametrize('invalid', ['missing-signature', 'wrong-signature', 'wrong-amount', 'wrong-booking', 'unpaid'])
async def test_webhook_rejects_invalid_evidence_without_mutation(harness, invalid):
    before = await snapshot(harness)
    if invalid == 'wrong-signature':
        harness.webhook_secret = uuid.uuid4().hex
    elif invalid == 'wrong-amount':
        harness.session.amount_total = 1
    elif invalid == 'wrong-booking':
        harness.session.metadata['booking_id'] = 'other'
    elif invalid == 'unpaid':
        harness.session.payment_status = 'unpaid'
    response = await webhook(harness, signature=invalid != 'missing-signature')
    assert response.status_code == (200 if invalid == 'unpaid' else 400), response.text
    assert await snapshot(harness) == before


@pytest.mark.parametrize('kind', ['scheduled_booking', 'live_session_join'])
async def test_booking_metadata_cannot_be_consumed_as_wallet_funding(harness, kind):
    from utils.payment_fulfillment import fulfill_wallet_payment
    before = await snapshot(harness)
    async with harness.sessions() as db:
        tx = await db.get(PaymentTransaction, 'transaction')
        tx.transaction_metadata = json.dumps(dict(META, type=kind, credits=80))
        amount, _ = await fulfill_wallet_payment(db, tx)
        assert amount == 0
        await db.commit()
    assert await snapshot(harness) == before


async def test_commit_failure_rolls_back_and_retry_is_safe(harness, monkeypatch):
    before = await snapshot(harness)
    real = harness.sessions.class_.commit
    async def failed_commit(self):
        raise RuntimeError('Injected transaction failure')
    with monkeypatch.context() as patch:
        patch.setattr(harness.sessions.class_, 'commit', failed_commit)
        assert (await confirm(harness)).status_code == 500
    assert await snapshot(harness) == before
    assert harness.push.notify_booking.await_count == 0
    assert (await confirm(harness)).status_code == 200
    assert harness.sessions.class_.commit is real


async def test_provider_unavailable_does_not_write(harness, monkeypatch):
    def unavailable(*args, **kwargs):
        raise harness.module.stripe.error.APIConnectionError('Unavailable')
    monkeypatch.setattr(harness.module.stripe.checkout.Session, 'retrieve', unavailable)
    before = await snapshot(harness)
    assert (await confirm(harness)).status_code == 502
    assert await snapshot(harness) == before


async def test_creation_uses_real_provider_contract_and_local_pending_record(harness):
    data = dict(photographer_id='pro', location='Fixture beach', duration=60, apply_credits=20,
                session_date=(datetime.now(timezone.utc) + timedelta(days=11)).isoformat(),
                origin_url='https://frontend.example.invalid')
    response = await harness.client.post('/api/bookings/create-with-stripe', json=data, headers=bearer())
    assert response.status_code == 200, response.text
    assert len(harness.created) == 1
    payload = harness.created[0]
    assert payload['line_items'][0]['price_data']['unit_amount'] == 8000
    assert payload['metadata']['type'] == 'scheduled_booking'
    assert payload['metadata']['user_id'] == 'owner'
    assert response.json()['session_id'] == 'new-checkout'
    async with harness.sessions() as db:
        tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.session_id == 'new-checkout'))).one()
        assert json.loads(tx.transaction_metadata)['type'] == 'scheduled_booking'
        assert tx.amount == 80 and tx.payment_status == 'Pending'
        assert (await db.get(Profile, 'owner')).credit_balance == 60


async def test_missing_provider_configuration_fails_before_creation(harness, monkeypatch):
    monkeypatch.setattr(harness.module, 'STRIPE_API_KEY', None)
    response = await harness.client.post('/api/bookings/create-with-stripe', headers=bearer(), json=dict(
        photographer_id='pro', location='Fixture beach', duration=60, apply_credits=20,
        session_date=(datetime.now(timezone.utc) + timedelta(days=11)).isoformat(),
        origin_url='https://frontend.example.invalid'))
    assert response.status_code == 503, response.text
    assert harness.created == []
    async with harness.sessions() as db:
        assert (await db.scalars(select(Booking.id))).all() == ['booking']
        assert (await db.get(Profile, 'owner')).credit_balance == 80


@pytest.mark.parametrize('invalid', ['provider-failure', 'negative-credit', 'negative-duration'])
async def test_creation_failure_retains_only_durable_unknown_reservation(harness, monkeypatch, invalid):
    data = dict(photographer_id='pro', location='Fixture beach', duration=60, apply_credits=20,
                session_date=(datetime.now(timezone.utc) + timedelta(days=11)).isoformat(),
                origin_url='https://frontend.example.invalid')
    if invalid == 'provider-failure':
        def fail(**kwargs):
            raise harness.module.stripe.error.APIConnectionError('Unavailable')
        monkeypatch.setattr(harness.module.stripe.checkout.Session, 'create', fail)
    elif invalid == 'negative-credit':
        data['apply_credits'] = -10
    else:
        data['duration'] = -10
    before = await snapshot(harness)
    response = await harness.client.post('/api/bookings/create-with-stripe', headers=bearer(), json=data)
    assert response.status_code == (502 if invalid == 'provider-failure' else 400), response.text
    if invalid == 'provider-failure':
        after=await snapshot(harness)
        assert after[:3]==before[:3] and after[3:]==(60,1,0)
        async with harness.sessions() as db:
            assert len((await db.scalars(select(Booking.id))).all())==2
            from models import CheckoutIntent
            intent=(await db.scalars(select(CheckoutIntent))).one()
            tx=await db.get(PaymentTransaction,intent.transaction_id)
            assert intent.state=='creating' and tx.session_id.startswith('pending:')
    else:
        assert await snapshot(harness) == before
        async with harness.sessions() as db:
            assert (await db.scalars(select(Booking.id))).all() == ['booking']


@pytest_asyncio.fixture
async def live(harness, monkeypatch):
    from models import LiveSession
    gamification = ModuleType('routes.career_hub.gamification')
    gamification.check_badge_milestones = AsyncMock()
    monkeypatch.setitem(sys.modules, gamification.__name__, gamification)
    package = ModuleType('repair_session_routes')
    package.__path__ = [str(Path(__file__).parents[1] / 'routes/sessions')]
    monkeypatch.setitem(sys.modules, package.__name__, package)
    module = importlib.import_module('repair_session_routes.join')
    helper = ModuleType('routes.subscriptions_billing.photo_sub_helpers')
    helper.get_subscription_discount = AsyncMock(return_value=0)
    helper.try_use_subscription_quota = AsyncMock(return_value={'used': False})
    monkeypatch.setitem(sys.modules, helper.__name__, helper)
    monkeypatch.setattr(module, 'STRIPE_API_KEY', object())
    monkeypatch.setattr(module, 'sqlite3', SimpleNamespace(connect=lambda *a, **kw: None), raising=False)
    monkeypatch.setattr(module, 'stripe_mcp_server', SimpleNamespace(DB_PATH='unused',
        stripe_create_checkout_session=lambda **kw: {'checkout_session_id': 'simulated', 'url': 'https://test.invalid'}), raising=False)
    harness.app.include_router(module.router, prefix='/api')
    async with harness.sessions() as db:
        photographer = await db.get(Profile, 'pro')
        photographer.is_shooting = True
        photographer.live_buyin_price = 25
        db.add(LiveSession(id='live', photographer_id='pro', status='active'))
        await db.commit()
    return module


async def test_live_checkout_creates_actual_provider_session(harness, live):
    response = await harness.client.post('/api/sessions/join?surfer_id=owner', headers=bearer(),
        json={'photographer_id': 'pro', 'payment_method': 'card', 'origin_url': 'https://frontend.example.invalid'})
    assert response.status_code == 200, response.text
    assert len(harness.created) == 1
    assert harness.created[0]['line_items'][0]['price_data']['unit_amount'] == 2500
    assert harness.created[0]['metadata']['type'] == 'live_session_join'
    assert response.json()['session_id'] == 'new-checkout'
    async with harness.sessions() as db:
        tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.session_id == 'new-checkout'))).one()
        assert tx.amount == 25 and json.loads(tx.transaction_metadata)['type'] == 'live_session_join'


async def test_paid_receipt_delivered_late_can_fulfill_pending_booking(harness):
    async with harness.sessions() as db:
        (await db.get(Booking, 'booking')).pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
        await db.commit()
    response = await webhook(harness)
    assert response.status_code == 200, response.text
    assert await snapshot(harness) == ('Confirmed', 'Paid', 'paid', 80, 2, 2)


async def test_legacy_deposit_metadata_still_routes_to_wallet(harness):
    async with harness.sessions() as db:
        (await db.get(PaymentTransaction, 'transaction')).transaction_metadata = str({'type': 'request_a_pro_deposit'})
        await db.commit()
    response = await webhook(harness)
    assert response.status_code == 200, response.text
    assert await snapshot(harness) == ('Pending Payment', 'Pending', 'paid', 160, 1, 0)


@pytest.mark.parametrize('path', ['scheduled', 'live'])
async def test_preparation_commit_failure_never_calls_provider(harness, live, monkeypatch, path):
    expired = []
    monkeypatch.setattr(harness.module.stripe.checkout.Session, 'expire', lambda identifier, **kw: expired.append(identifier))
    async def fail(self):
        raise RuntimeError('Injected commit failure')
    monkeypatch.setattr(harness.sessions.class_, 'commit', fail)
    if path == 'scheduled':
        route = '/api/bookings/create-with-stripe'
        data = dict(photographer_id='pro', location='Fixture beach', duration=60, apply_credits=20,
                    session_date=(datetime.now(timezone.utc) + timedelta(days=11)).isoformat(),
                    origin_url='https://frontend.example.invalid')
    else:
        route = '/api/sessions/join?surfer_id=owner'
        data = dict(photographer_id='pro', payment_method='card', origin_url='https://frontend.example.invalid')
    before = await snapshot(harness)
    response = await harness.client.post(route, headers=bearer(), json=data)
    assert response.status_code == 500
    assert expired == [] and harness.created == []
    assert await snapshot(harness) == before


@pytest.mark.parametrize('transition', ['cancel', 'expire'])
async def test_cancellation_and_expiry_lock_booking_before_reading_amounts(harness, monkeypatch, transition):
    from sqlalchemy.dialects import postgresql
    statements = []
    execute = harness.sessions.class_.execute
    async def capture(self, statement, *args, **kwargs):
        if 'FROM bookings' in str(statement.compile(dialect=postgresql.dialect())):
            statements.append(str(statement.compile(dialect=postgresql.dialect())))
        return await execute(self, statement, *args, **kwargs)
    monkeypatch.setattr(harness.sessions.class_, 'execute', capture)
    if transition == 'cancel':
        module = importlib.import_module('repair_booking_routes.booking_cancellation')
        harness.app.include_router(module.router, prefix='/api')
        assert (await confirm(harness)).status_code == 200
        statements.clear()
        response = await harness.client.post('/api/bookings/booking/cancel', json={}, headers=bearer())
        assert response.status_code == 200, response.text
        assert response.json()['refund_amount'] == 90
        async with harness.sessions() as db:
            booking = await db.get(Booking, 'booking')
            assert booking.escrow_status == 'refunded'
    else:
        import database
        monkeypatch.setattr(database, 'async_session_maker', harness.sessions)
        spec = importlib.util.spec_from_file_location('repair_booking_scheduler', Path(__file__).parents[1] / 'scheduler/bookings.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        async with harness.sessions() as db:
            (await db.get(Booking, 'booking')).pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=5)
            await db.commit()
        statements.clear()
        await module.cleanup_expired_booking_payments_task()
        async with harness.sessions() as db:
            assert (await db.get(Profile, 'owner')).credit_balance == 100
    assert 'FOR UPDATE' in statements[0]
    # A late paid receipt cannot silently revive an already cancelled booking.
    assert (await confirm(harness)).status_code == 409


@pytest_asyncio.fixture
async def live_completion(harness, live, monkeypatch):
    module = importlib.import_module('repair_session_routes.payments')
    monkeypatch.setattr(module, 'STRIPE_API_KEY', uuid.uuid4().hex)
    monkeypatch.setattr(module, 'checkout_emulation_allowed', lambda: False)
    refunds = []
    monkeypatch.setattr(module.stripe.Refund, 'create', lambda **kw: refunds.append(kw))
    harness.session.metadata = {'type': 'live_session_join', 'surfer_id': 'owner', 'photographer_id': 'pro', 'amount': '25', 'live_session_id': 'live'}
    harness.session.amount_total = 2500
    async with harness.sessions() as db:
        tx = await db.get(PaymentTransaction, 'transaction')
        tx.amount = 25
        tx.transaction_metadata = json.dumps(harness.session.metadata)
        await db.commit()
    harness.app.include_router(module.router, prefix='/api')
    return refunds


@pytest.mark.parametrize('field,value', [('amount_total', 1), ('currency', 'eur'), ('id', 'wrong'),
    ('status', 'open'), ('metadata', {'type': 'live_session_join', 'surfer_id': 'other', 'photographer_id': 'pro', 'amount': '25'})])
async def test_live_completion_rejects_unbound_evidence_without_refund(harness, live_completion, field, value):
    from models import LiveSessionParticipant
    setattr(harness.session, field, value)
    response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert response.status_code == 400, response.text
    assert live_completion == []
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'
        assert not (await db.scalars(select(LiveSessionParticipant))).all()


async def test_live_paid_completion_is_repeatable_without_duplicate_entitlement(harness, live_completion):
    from models import LiveSessionParticipant
    for _ in range(2):
        response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
        assert response.status_code == 200, response.text
    assert live_completion == []
    async with harness.sessions() as db:
        participants = (await db.scalars(select(LiveSessionParticipant))).all()
        assert len(participants) == 1 and participants[0].amount_paid == 25
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Completed'
        assert (await db.get(Profile, 'owner')).credit_balance == 80


async def test_subscription_covered_card_join_does_not_create_checkout(harness, live):
    helper = sys.modules['routes.subscriptions_billing.photo_sub_helpers']
    helper.try_use_subscription_quota.return_value = {'used': True}
    response = await harness.client.post('/api/sessions/join?surfer_id=owner', headers=bearer(),
        json={'photographer_id': 'pro', 'payment_method': 'card'})
    assert response.status_code == 200, response.text
    assert response.json().get('requires_payment') is not True
    assert response.json()['subscription_covered'] is True
    assert harness.created == []


@pytest.mark.parametrize('reason', ['another-paid-checkout', 'session-ended'])
async def test_live_paid_session_requires_reconciliation_if_entitlement_unavailable(harness, live_completion, reason):
    from models import LiveSession, LiveSessionParticipant
    async with harness.sessions() as db:
        if reason == 'session-ended':
            (await db.get(LiveSession, 'live')).status = 'ended'
        else:
            db.add(LiveSessionParticipant(id='existing', surfer_id='owner', photographer_id='pro',
                live_session_id='live', amount_paid=25, payment_method='card', status='active'))
        await db.commit()
    response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert response.status_code == 409, response.text
    assert live_completion == []
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'
