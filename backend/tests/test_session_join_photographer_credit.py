"""A live-session buy-in adds the photographer's earning to their balance without replacing it.

Real JWT + HTTP + an ephemeral SQLite ORM; the buy-in is paid with credits, so no payment provider
is involved.
"""
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core.security import create_access_token
from database import Base, get_db
from models import CreditTransaction, Profile, RoleEnum
from routes.sessions import join as session_join


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'join.sqlite'}")

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
        db.add(Profile(id='owner', user_id='owner', email='owner@example.invalid', role=RoleEnum.SURFER,
                       full_name='Owner', credit_balance=100.0))
        for pid, role in (('pro', RoleEnum.PHOTOGRAPHER), ('hobby', RoleEnum.HOBBYIST)):
            db.add(Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', role=role, full_name=pid.title(),
                           credit_balance=30.0, withdrawable_credits=0.0, gear_only_credits=0.0,
                           is_shooting=True, live_buyin_price=25.0))
        await db.commit()

    app = FastAPI()
    app.include_router(session_join.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, maker=maker)
    await engine.dispose()


@pytest.mark.parametrize('photographer,bucket', [('pro', 'withdrawable_credits'), ('hobby', 'gear_only_credits')])
async def test_join_keeps_the_photographers_existing_credit(harness, photographer, bucket):
    response = await harness.client.post('/api/sessions/join?surfer_id=owner', headers=bearer('owner'),
                                         json={'photographer_id': photographer, 'payment_method': 'credits'})
    assert response.status_code == 200, response.text
    async with harness.maker() as db:
        profile = (await db.execute(select(Profile).where(Profile.id == photographer))).scalar_one()
        earning = (await db.execute(select(CreditTransaction).where(
            CreditTransaction.user_id == photographer))).scalar_one()
    assert profile.credit_balance == pytest.approx(50.0)
    assert getattr(profile, bucket) == pytest.approx(20.0)
    assert (earning.amount, earning.balance_before, earning.balance_after) == pytest.approx((20.0, 30.0, 50.0))
