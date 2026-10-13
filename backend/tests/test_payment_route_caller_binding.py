"""Payment, subscription and sponsorship routes act only for the user who holds the token.

Each route takes the acting user's id from the query or body. These tests pin that the id must equal
the JWT subject (401 without a token, 403 for another user's token) before any balance is read or
written, and that the owner's own request still succeeds. Real JWT + HTTP + an ephemeral SQLite ORM;
the payment provider is stubbed and never reached.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
import stripe
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import (
    CreditTransaction, DispatchRequest, DispatchRequestParticipant, DispatchRequestStatusEnum,
    PaymentTransaction, PhotographerSubscriptionPlan, Profile, RoleEnum, SurferPhotoSubscription,
)
from routes.career_hub import career_stoke_sponsor
from routes.dispatch import crew as dispatch_crew
from routes.dispatch import dispatch_matching
from routes.dispatch import sessions as dispatch_sessions
from routes.subscriptions_billing import photo_subscriptions


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


NO_AUTH = [
    {},
    {'Authorization': 'Bearer invalid'},
    {'Authorization': 'Bearer ' + create_access_token({'sub': 'owner'}, expires_delta=timedelta(minutes=-1))},
]

SUB_META = '{"type": "photo_subscription", "plan_id": "plan", "photographer_id": "pro"}'


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'binding.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    future = datetime.now(timezone.utc) + timedelta(days=5)
    async with maker() as db:
        for pid, role in (('owner', RoleEnum.SURFER), ('other', RoleEnum.PHOTOGRAPHER), ('pro', RoleEnum.PHOTOGRAPHER)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', role=role, full_name=pid.title(),
                           credit_balance=100.0, withdrawable_credits=50.0, gear_only_credits=0.0))
        db.add(DispatchRequest(id='disp', requester_id='owner', latitude=33.0, longitude=-117.0, hourly_rate=40.0,
                               estimated_total=40.0, deposit_amount=40.0, estimated_duration_hours=1.0,
                               status=DispatchRequestStatusEnum.PENDING_PAYMENT, target_photographer_id='pro'))
        db.add(DispatchRequest(id='shared', requester_id='other', latitude=33.0, longitude=-117.0, hourly_rate=40.0,
                               estimated_total=40.0, deposit_amount=40.0, estimated_duration_hours=1.0,
                               status=DispatchRequestStatusEnum.SEARCHING_FOR_PRO, deposit_paid=True,
                               is_shared=True, location_name='Fixture Beach'))
        db.add(DispatchRequestParticipant(id='seat', dispatch_request_id='shared', participant_id='owner',
                                          share_amount=20.0, status='invited'))
        db.add(PhotographerSubscriptionPlan(id='plan', photographer_id='pro', name='Weekly', interval='weekly',
                                            price=10.0, photos_included=5, is_active=True))
        db.add(SurferPhotoSubscription(id='sub', surfer_id='owner', photographer_id='pro', plan_id='plan',
                                       plan_name='Weekly', plan_interval='weekly', plan_price=10.0,
                                       expires_at=future, amount_paid=10.0, status='active',
                                       photos_remaining=5, sessions_remaining=2))
        db.add(PaymentTransaction(id='ptx', user_id='owner', session_id='cs_sub', amount=10.0,
                                  payment_status='pending', status='pending', transaction_metadata=SUB_META))
        await db.commit()

    async def quiet(*args, **kwargs):
        return None

    monkeypatch.setattr(dispatch_sessions, 'process_dispatch_notifications', quiet)
    monkeypatch.setattr(dispatch_sessions, 'notify_crew_members', quiet)
    monkeypatch.setattr(dispatch_sessions, 'check_and_send_spending_alert', quiet)
    monkeypatch.setattr(dispatch_matching, 'process_dispatch_notifications', quiet)
    monkeypatch.setattr(dispatch_matching, 'notify_crew_members', quiet)
    monkeypatch.setattr(career_stoke_sponsor, 'broadcast_earnings_update', quiet)
    monkeypatch.setattr(photo_subscriptions, 'STRIPE_API_KEY', 'sk_test_fixture')
    monkeypatch.setattr(stripe, 'api_key', 'sk_test_fixture')
    monkeypatch.setenv('STRIPE_API_KEY', 'sk_test_fixture')

    created = []

    def fake_create(**kwargs):
        created.append(kwargs)
        return SimpleNamespace(id=f'cs_fixture_{len(created)}', url='https://fixture.invalid/checkout')

    monkeypatch.setattr(stripe.checkout.Session, 'create', staticmethod(fake_create))

    app = FastAPI()
    for module in (dispatch_sessions, dispatch_matching, dispatch_crew, photo_subscriptions, career_stoke_sponsor):
        app.include_router(module.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(app=app, client=client, maker=maker, created=created)
    await engine.dispose()


def paid_session(monkeypatch, **fields):
    session = SimpleNamespace(payment_status='paid', **fields)
    monkeypatch.setattr(stripe.checkout.Session, 'retrieve', staticmethod(lambda session_id: session))


async def scalar(maker, statement):
    async with maker() as db:
        return (await db.execute(statement)).scalar_one()


async def balances(maker):
    async with maker() as db:
        rows = (await db.execute(select(Profile.id, Profile.credit_balance, Profile.withdrawable_credits))).all()
        return {row[0]: (row[1], row[2]) for row in rows}


async def ledger_rows(maker):
    async with maker() as db:
        return len((await db.execute(select(CreditTransaction))).scalars().all())


PAY = ('post', '/api/dispatch/disp/pay?payer_id=owner', None)
CHECKOUT = ('post', '/api/dispatch/checkout',
            {'dispatch_id': 'disp', 'payer_id': 'owner', 'amount': 40.0, 'origin_url': 'https://fixture.invalid'})
CREW_PAY = ('post', '/api/dispatch/crew-invite/seat/pay?payer_id=owner', None)
CREW_CHECKOUT = ('post', '/api/dispatch/crew-invite/seat/checkout?payer_id=owner',
                 {'origin_url': 'https://fixture.invalid'})
SUBSCRIBE = ('post', '/api/photo-subscriptions/subscribe?surfer_id=owner',
             {'plan_id': 'plan', 'payment_method': 'credits'})
CANCEL = ('post', '/api/photo-subscriptions/cancel/sub?surfer_id=owner', None)
CHECK_QUOTA = ('get', '/api/photo-subscriptions/check-quota?surfer_id=owner&photographer_id=pro&quota_type=photo', None)
USE_QUOTA = ('post', '/api/photo-subscriptions/use-quota?surfer_id=owner&photographer_id=pro&quota_type=photo', None)
COMPLETE_SUB = ('post', '/api/photo-subscriptions/complete-card-payment?checkout_session_id=cs_sub', None)
CONTRIBUTE = ('post', '/api/career/stoke-sponsor/contribute?photographer_id=owner',
              {'surfer_id': 'pro', 'amount': 10.0})

ROUTES = [PAY, CHECKOUT, CREW_PAY, CREW_CHECKOUT, SUBSCRIBE, CANCEL, CHECK_QUOTA, USE_QUOTA, COMPLETE_SUB, CONTRIBUTE]
IDS = ['pay', 'checkout', 'crew_pay', 'crew_checkout', 'subscribe', 'cancel', 'check_quota', 'use_quota',
       'complete_subscription', 'contribute']


@pytest.mark.parametrize('headers', NO_AUTH, ids=['none', 'invalid', 'expired'])
@pytest.mark.parametrize('method,path,body', ROUTES, ids=IDS)
async def test_requires_a_valid_token_before_the_database(harness, headers, method, path, body):
    async def forbidden_db():
        raise AssertionError('a request without a valid token reached the database')
        yield

    harness.app.dependency_overrides[get_db] = forbidden_db
    response = await harness.client.request(method, path, json=body, headers=headers)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize('method,path,body', ROUTES, ids=IDS)
async def test_rejects_mismatched_caller(harness, method, path, body):
    before = await balances(harness.maker)
    response = await harness.client.request(method, path, json=body, headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert await balances(harness.maker) == before
    assert await ledger_rows(harness.maker) == 0
    assert harness.created == []
    assert await scalar(harness.maker, select(SurferPhotoSubscription.status).where(SurferPhotoSubscription.id == 'sub')) == 'active'
    assert await scalar(harness.maker, select(SurferPhotoSubscription.photos_remaining).where(SurferPhotoSubscription.id == 'sub')) == 5


async def test_owner_can_pay_their_dispatch_with_credits(harness):
    response = await harness.client.post('/api/dispatch/disp/pay?payer_id=owner', headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert (await balances(harness.maker))['owner'][0] == 60.0
    status = await scalar(harness.maker, select(DispatchRequest.status).where(DispatchRequest.id == 'disp'))
    assert status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO


async def test_only_the_requester_can_pay_a_dispatch(harness):
    response = await harness.client.post('/api/dispatch/disp/pay?payer_id=other', headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert (await balances(harness.maker))['other'][0] == 100.0
    status = await scalar(harness.maker, select(DispatchRequest.status).where(DispatchRequest.id == 'disp'))
    assert status == DispatchRequestStatusEnum.PENDING_PAYMENT


async def test_owner_checkout_charges_the_amount_on_the_record(harness):
    body = dict(CHECKOUT[2], amount=1.0)
    response = await harness.client.post('/api/dispatch/checkout', json=body, headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert response.json()['amount'] == 40.0
    assert harness.created[0]['line_items'][0]['price_data']['unit_amount'] == 4000
    assert await scalar(harness.maker, select(PaymentTransaction.amount).where(PaymentTransaction.user_id == 'owner',
                                                                            PaymentTransaction.id != 'ptx')) == 40.0


async def test_only_the_requester_can_open_a_dispatch_checkout(harness):
    body = dict(CHECKOUT[2], payer_id='other')
    response = await harness.client.post('/api/dispatch/checkout', json=body, headers=bearer('other'))
    assert response.status_code == 403, response.text
    assert harness.created == []


META = {'type': 'on_demand_dispatch', 'dispatch_id': 'disp', 'user_id': 'owner'}


@pytest.mark.parametrize('metadata,amount_total', [
    (dict(META, dispatch_id='shared'), 4000),
    (dict(META, user_id='other'), 4000),
    (dict(META, type='photo_subscription'), 4000),
    (META, 100),
], ids=['other_request', 'other_payer', 'other_kind', 'other_amount'])
async def test_payment_success_rejects_a_session_for_something_else(harness, monkeypatch, metadata, amount_total):
    paid_session(monkeypatch, metadata=metadata, amount_total=amount_total)
    response = await harness.client.get('/api/dispatch/payment-success?session_id=cs_x&dispatch_id=disp')
    assert response.status_code == 400, response.text
    status = await scalar(harness.maker, select(DispatchRequest.status).where(DispatchRequest.id == 'disp'))
    assert status == DispatchRequestStatusEnum.PENDING_PAYMENT


async def test_payment_success_confirms_the_matching_session(harness, monkeypatch):
    paid_session(monkeypatch, metadata=META, amount_total=4000)
    response = await harness.client.get('/api/dispatch/payment-success?session_id=cs_x&dispatch_id=disp')
    assert response.status_code == 200, response.text
    status = await scalar(harness.maker, select(DispatchRequest.status).where(DispatchRequest.id == 'disp'))
    assert status == DispatchRequestStatusEnum.SEARCHING_FOR_PRO


async def test_owner_can_pay_their_crew_share(harness):
    response = await harness.client.post('/api/dispatch/crew-invite/seat/pay?payer_id=owner', headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert (await balances(harness.maker))['owner'][0] == 80.0


async def test_owner_can_open_a_crew_checkout(harness):
    response = await harness.client.post('/api/dispatch/crew-invite/seat/checkout?payer_id=owner',
                                         json={'origin_url': 'https://fixture.invalid'}, headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert harness.created[0]['line_items'][0]['price_data']['unit_amount'] == 2000


async def test_owner_can_subscribe_with_credits(harness):
    async with harness.maker() as db:  # the seed already holds an active subscription with this photographer
        (await db.get(SurferPhotoSubscription, 'sub')).status = 'expired'
        await db.commit()
    response = await harness.client.post(SUBSCRIBE[1], json=SUBSCRIBE[2], headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert (await balances(harness.maker))['owner'][0] == 90.0


async def test_owner_can_cancel_check_and_use_their_quota(harness):
    checked = await harness.client.get(CHECK_QUOTA[1], headers=bearer('owner'))
    assert checked.status_code == 200 and checked.json()['remaining'] == 5, checked.text
    used = await harness.client.post(USE_QUOTA[1], headers=bearer('owner'))
    assert used.status_code == 200 and used.json()['remaining'] == 4, used.text
    cancelled = await harness.client.post(CANCEL[1], headers=bearer('owner'))
    assert cancelled.status_code == 200, cancelled.text
    assert await scalar(harness.maker, select(SurferPhotoSubscription.status).where(SurferPhotoSubscription.id == 'sub')) == 'cancelled'


async def test_subscription_completion_requires_a_paid_matching_checkout(harness, monkeypatch):
    paid_session(monkeypatch, metadata={'type': 'photo_subscription', 'surfer_id': 'owner', 'plan_id': 'plan'},
                 amount_total=1000)
    session = stripe.checkout.Session.retrieve("cs_sub")
    session.payment_status = "unpaid"
    response = await harness.client.post(COMPLETE_SUB[1], headers=bearer('owner'))
    assert response.status_code == 400, response.text
    session.amount_total, session.payment_status = 100, "paid"
    response = await harness.client.post(COMPLETE_SUB[1], headers=bearer('owner'))
    assert response.status_code == 400, response.text
    async with harness.maker() as db:
        assert len((await db.execute(select(SurferPhotoSubscription))).scalars().all()) == 1
    assert (await balances(harness.maker))['pro'][1] == 50.0


async def test_owner_completes_a_paid_subscription_once(harness, monkeypatch):
    paid_session(monkeypatch, metadata={'type': 'photo_subscription', 'surfer_id': 'owner', 'plan_id': 'plan'},
                 amount_total=1000)
    first = await harness.client.post(COMPLETE_SUB[1], headers=bearer('owner'))
    second = await harness.client.post(COMPLETE_SUB[1], headers=bearer('owner'))
    assert first.status_code == 200 and 'subscription' in first.json(), first.text
    assert second.status_code == 200 and second.json().get('message') == 'Already activated', second.text
    async with harness.maker() as db:
        assert len((await db.execute(select(SurferPhotoSubscription))).scalars().all()) == 2
    assert (await balances(harness.maker))['pro'][1] == pytest.approx(58.0)


@pytest.mark.parametrize('amount', [0, -5.0, 'NaN'])
async def test_contribution_amount_must_be_positive(harness, amount):
    response = await harness.client.post(CONTRIBUTE[1], json={'surfer_id': 'pro', 'amount': amount},
                                         headers=bearer('owner'))
    assert response.status_code in (400, 422), response.text
    assert await balances(harness.maker) == {pid: (100.0, 50.0) for pid in ('owner', 'other', 'pro')}


async def test_owner_can_contribute(harness):
    response = await harness.client.post(CONTRIBUTE[1], json=CONTRIBUTE[2], headers=bearer('owner'))
    assert response.status_code == 200, response.text
    assert (await balances(harness.maker))['owner'][1] == 40.0
