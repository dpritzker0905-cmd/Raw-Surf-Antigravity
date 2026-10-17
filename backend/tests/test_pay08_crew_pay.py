"""LA-PAY-08: crew-share payment acts as the token's subject, pays the recorded share, and reaches its push.

The route imported a push helper that did not exist at that path, so it raised ImportError on its first line
and (had that been repaired alone) would have taken any caller's participant_id from the body. Real JWT + HTTP +
an ephemeral SQLite ORM; the push network call is stubbed and recorded.
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import Booking, BookingParticipant, Profile, RoleEnum
from routes.bookings import crew_payments
from routes.notifications import push_payloads


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path, monkeypatch):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'pay08.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    when = datetime.now(timezone.utc) + timedelta(days=3)
    async with maker() as db:
        for pid, role in (('captain', RoleEnum.SURFER), ('pro', RoleEnum.PHOTOGRAPHER),
                          ('crew1', RoleEnum.SURFER), ('crew2', RoleEnum.SURFER), ('stranger', RoleEnum.SURFER)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                           full_name=pid.title(), credit_balance=100.0, withdrawable_credits=0.0,
                           gear_only_credits=0.0))
        db.add(Booking(id='bk', photographer_id='pro', creator_id='captain', location='Fixture Beach',
                       session_date=when, duration=60, total_price=90.0, status='Pending Payment',
                       crew_payment_required=True))
        db.add(BookingParticipant(booking_id='bk', participant_id='captain', is_captain=True, paid_amount=0.0,
                                  payment_status='Paid', status='confirmed', covered_by_captain=True))
        db.add(BookingParticipant(booking_id='bk', participant_id='crew1', paid_amount=0.0, share_amount=30.0,
                                  payment_status='Pending', status='pending'))
        db.add(BookingParticipant(booking_id='bk', participant_id='crew2', paid_amount=0.0, share_amount=0.0,
                                  payment_status='Pending', status='pending'))
        await db.commit()

    pushes = []

    async def record(**kwargs):
        pushes.append(kwargs)

    monkeypatch.setattr(push_payloads, 'notify_crew_payment_received', record)

    app = FastAPI()
    app.include_router(crew_payments.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, maker=maker, pushes=pushes)
    await engine.dispose()


async def participant(maker, pid):
    async with maker() as db:
        return (await db.execute(select(BookingParticipant).where(
            BookingParticipant.booking_id == 'bk', BookingParticipant.participant_id == pid))).scalar_one()


async def balance(maker, pid):
    async with maker() as db:
        return (await db.execute(select(Profile.credit_balance).where(Profile.id == pid))).scalar_one()


def pay(harness, who, participant_id, amount, token=None):
    headers = bearer(token or who) if (token or who) else {}
    return harness.client.post('/api/bookings/bk/crew-pay', headers=headers,
                               json={'participant_id': participant_id, 'amount': amount})


@pytest.mark.parametrize('headers', [{}, {'Authorization': 'Bearer invalid'}], ids=['none', 'invalid'])
async def test_crew_pay_needs_a_token(harness, headers):
    response = await harness.client.post('/api/bookings/bk/crew-pay', headers=headers,
                                         json={'participant_id': 'crew1', 'amount': 30.0})
    assert response.status_code == 401, response.text
    assert (await participant(harness.maker, 'crew1')).payment_status == 'Pending'
    assert await balance(harness.maker, 'crew1') == 100.0


@pytest.mark.parametrize('caller', ['crew2', 'captain', 'stranger'])
async def test_nobody_can_pay_another_members_share(harness, caller):
    response = await pay(harness, caller, 'crew1', 30.0)
    assert response.status_code == 403, response.text
    assert (await participant(harness.maker, 'crew1')).payment_status == 'Pending'
    assert await balance(harness.maker, 'crew1') == 100.0
    assert harness.pushes == []


@pytest.mark.parametrize('amount', [0.01, 29.0, 31.0, 1000.0])
async def test_the_amount_must_be_the_recorded_share(harness, amount):
    response = await pay(harness, 'crew1', 'crew1', amount)
    assert response.status_code == 400, response.text
    assert (await participant(harness.maker, 'crew1')).payment_status == 'Pending'
    assert await balance(harness.maker, 'crew1') == 100.0


async def test_a_member_pays_their_recorded_share_and_the_captain_is_notified(harness):
    response = await pay(harness, 'crew1', 'crew1', 30.0)
    assert response.status_code == 200, response.text
    row = await participant(harness.maker, 'crew1')
    assert (row.payment_status, row.paid_amount) == ('Paid', 30.0)
    assert await balance(harness.maker, 'crew1') == 70.0
    assert [p['captain_id'] for p in harness.pushes] == ['captain']


async def test_a_member_with_no_custom_share_pays_the_equal_split(harness):
    response = await pay(harness, 'crew2', 'crew2', 30.0)  # 90.0 across three participants
    assert response.status_code == 200, response.text
    assert (await participant(harness.maker, 'crew2')).payment_status == 'Paid'


async def test_paying_twice_is_refused(harness):
    assert (await pay(harness, 'crew1', 'crew1', 30.0)).status_code == 200
    assert (await pay(harness, 'crew1', 'crew1', 30.0)).status_code == 400
    assert await balance(harness.maker, 'crew1') == 70.0
