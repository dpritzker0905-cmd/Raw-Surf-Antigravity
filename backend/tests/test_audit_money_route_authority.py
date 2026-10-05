"""The three money routes the dead-import repair brought back must bind the buyer to the JWT.

`routes.photo_subscriptions` was deleted on 2026-05-03, so join / in-session purchase / quick-book
returned 500 before touching any balance. Repairing the import made them executable, and they take
the buyer from a query parameter. Real JWT + HTTP + ephemeral ORM; no payment provider is reached.
"""
from datetime import timedelta

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import CreditTransaction, GalleryItem, LiveSessionParticipant, Profile, RoleEnum
from routes.dispatch import sessions as dispatch_sessions
from routes.sessions import active as session_active
from routes.sessions import join as session_join


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


BAD_AUTH = [
    {},
    {'Authorization': 'Bearer invalid'},
    {'Authorization': 'Bearer ' + create_access_token({'sub': 'victim'}, expires_delta=timedelta(minutes=-1))},
]


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'money.sqlite'}")

    def create_all(sync_connection):
        for table in Base.metadata.sorted_tables:
            try:
                table.create(sync_connection, checkfirst=True)
            except Exception:  # tables this test never reads may use types sqlite cannot create
                pass

    async with engine.begin() as connection:
        await connection.run_sync(create_all)
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id='victim', user_id='victim', email='victim@example.invalid',
                       role=RoleEnum.SURFER, credit_balance=100.0, full_name='Victim'))
        db.add(Profile(id='attacker', user_id='attacker', email='attacker@example.invalid',
                       role=RoleEnum.PHOTOGRAPHER, credit_balance=0.0, withdrawable_credits=0.0,
                       gear_only_credits=0.0, full_name='Attacker', is_shooting=True,
                       live_buyin_price=25.0, live_photo_price=40.0))
        db.add(GalleryItem(id='item', photographer_id='attacker', media_type='image', price=40.0,
                           purchase_count=0, preview_url='https://fixture.invalid/p',
                           original_url='https://fixture.invalid/o'))
        db.add(LiveSessionParticipant(id='part', photographer_id='attacker', surfer_id='victim',
                                      status='active', amount_paid=0.0))
        await db.commit()

    app = FastAPI()
    for router in (session_join.router, session_active.router, dispatch_sessions.router):
        app.include_router(router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield app, client, maker
    await engine.dispose()


async def balance(maker, profile_id):
    async with maker() as db:
        return (await db.execute(select(Profile.credit_balance).where(Profile.id == profile_id))).scalar_one()


async def credit_transactions(maker):
    async with maker() as db:
        return len((await db.execute(select(CreditTransaction))).scalars().all())


JOIN = ('post', '/api/sessions/join?surfer_id=victim', {'photographer_id': 'attacker', 'payment_method': 'credits'})
PURCHASE = ('post', '/api/sessions/part/purchase-photo?surfer_id=victim', {'gallery_item_id': 'item'})
QUICK_BOOK = ('post', '/api/dispatch/request?requester_id=victim',
              {'latitude': 33.0, 'longitude': -117.0, 'target_photographer_id': 'attacker'})


@pytest.mark.parametrize('headers', BAD_AUTH)
@pytest.mark.parametrize('method,path,body', [JOIN, PURCHASE, QUICK_BOOK])
async def test_unauthenticated_callers_are_refused_before_the_database(harness, headers, method, path, body):
    app, client, _ = harness

    async def forbidden_db():
        raise AssertionError('unauthenticated request reached the database')
        yield

    app.dependency_overrides[get_db] = forbidden_db
    response = await client.request(method, path, json=body, headers=headers)
    assert response.status_code == 401, response.text


@pytest.mark.parametrize('method,path,body', [JOIN, PURCHASE, QUICK_BOOK])
async def test_another_users_token_cannot_spend_the_victims_balance(harness, method, path, body):
    _, client, maker = harness
    response = await client.request(method, path, json=body, headers=bearer('attacker'))
    assert response.status_code == 403, response.text
    assert await balance(maker, 'victim') == 100.0
    assert await balance(maker, 'attacker') == 0.0
    assert await credit_transactions(maker) == 0


async def test_owner_can_still_join_a_live_session(harness):
    _, client, maker = harness
    async with maker() as db:  # the shared seed already seats the victim; join needs a free seat
        participant = (await db.execute(select(LiveSessionParticipant))).scalar_one()
        await db.delete(participant)
        await db.commit()
    response = await client.post('/api/sessions/join?surfer_id=victim', headers=bearer('victim'),
                                 json={'photographer_id': 'attacker', 'payment_method': 'credits'})
    assert response.status_code == 200, response.text
    assert await balance(maker, 'victim') < 100.0


async def test_owner_can_still_buy_a_photo_in_session(harness):
    _, client, maker = harness
    response = await client.post('/api/sessions/part/purchase-photo?surfer_id=victim',
                                 headers=bearer('victim'), json={'gallery_item_id': 'item'})
    assert response.status_code == 200, response.text
    assert await balance(maker, 'victim') < 100.0


async def test_owner_passes_the_quick_book_guard(harness):
    # 404 comes from the profile lookup that follows the guard, so the matching token got through it.
    _, client, _ = harness
    response = await client.post('/api/dispatch/request?requester_id=ghost', headers=bearer('ghost'),
                                 json={'latitude': 33.0, 'longitude': -117.0})
    assert response.status_code == 404
    assert 'Requester not found' in response.text
