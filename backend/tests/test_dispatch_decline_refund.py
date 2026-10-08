"""A targeted photographer's decline refunds the requester at most once, and only what was paid.

Real JWT + HTTP + an ephemeral SQLite ORM. Each case reads the requester's balance and the
credit ledger after the decline(s).
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
from models import CreditTransaction, DispatchRequest, DispatchRequestStatusEnum, Profile, RoleEnum
from routes.dispatch import lifecycle as dispatch_lifecycle

S = DispatchRequestStatusEnum


def bearer(subject):
    return {'Authorization': 'Bearer ' + create_access_token({'sub': subject})}


@pytest_asyncio.fixture
async def harness(tmp_path):
    engine = create_async_engine(f"sqlite+aiosqlite:///{tmp_path / 'decline.sqlite'}")

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
        db.add(Profile(id='pro', user_id='pro', email='pro@example.invalid', role=RoleEnum.PHOTOGRAPHER,
                       full_name='Pro', credit_balance=0.0))
        for did, status, paid, share in (
            ('paid', S.SEARCHING_FOR_PRO, True, None),
            ('unpaid', S.PENDING_PAYMENT, False, None),
            ('split', S.SEARCHING_FOR_PRO, True, 10.0),
            ('done', S.COMPLETED, True, None),
        ):
            db.add(DispatchRequest(id=did, requester_id='owner', target_photographer_id='pro', latitude=33.0,
                                   longitude=-117.0, hourly_rate=40.0, estimated_total=40.0, deposit_amount=40.0,
                                   captain_share_amount=share, status=status, deposit_paid=paid))
        await db.commit()

    app = FastAPI()
    app.include_router(dispatch_lifecycle.router, prefix='/api')

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app, raise_app_exceptions=False),
                                 base_url='http://fixture.invalid') as client:
        yield SimpleNamespace(client=client, maker=maker)
    await engine.dispose()


async def decline(harness, dispatch_id):
    response = await harness.client.post(f'/api/dispatch/{dispatch_id}/decline?photographer_id=pro',
                                         headers=bearer('pro'))
    assert response.status_code == 200, response.text


async def state(harness, dispatch_id):
    async with harness.maker() as db:
        balance = (await db.execute(select(Profile.credit_balance).where(Profile.id == 'owner'))).scalar_one()
        refunds = (await db.execute(select(CreditTransaction))).scalars().all()
        status = (await db.execute(select(DispatchRequest.status).where(DispatchRequest.id == dispatch_id))).scalar_one()
        return balance, len(refunds), status


async def test_repeated_decline_refunds_once(harness):
    await decline(harness, 'paid')
    await decline(harness, 'paid')
    assert await state(harness, 'paid') == (140.0, 1, S.CANCELLED)


async def test_decline_of_an_unpaid_request_refunds_nothing(harness):
    await decline(harness, 'unpaid')
    assert await state(harness, 'unpaid') == (100.0, 0, S.CANCELLED)


async def test_decline_refunds_the_requesters_own_share(harness):
    await decline(harness, 'split')
    assert await state(harness, 'split') == (110.0, 1, S.CANCELLED)


async def test_decline_leaves_a_finished_request_unchanged(harness):
    await decline(harness, 'done')
    assert await state(harness, 'done') == (100.0, 0, S.COMPLETED)
