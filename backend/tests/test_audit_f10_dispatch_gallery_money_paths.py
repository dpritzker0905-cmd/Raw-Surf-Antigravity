"""2026-10-18 audit F-10: two money-path routes that crashed on every call.

* GET /dispatch/photographer/{id}/history loaded `DispatchRequest.participants`, a relationship the model never
  defined, so it answered 500 for every photographer (and it listed the surfers they shot to anyone).
* POST /gallery/bulk-purchase wrote `GalleryPurchase.item_id` / `price_paid` / `platform_fee` /
  `photographer_earnings` (none of them columns) and omitted the NOT NULL `CreditTransaction.balance_before`, so no
  bulk purchase could ever be recorded.

Both run here through the real routers, real JWTs and an ephemeral SQLite file; nothing leaves the process.
"""
import inspect
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import create_engine, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine
from sqlalchemy.orm import sessionmaker

import database
import websocket_manager
from core.security import create_access_token
from database import Base
from models import (
    CreditTransaction, DispatchRequest, DispatchRequestParticipant, DispatchRequestStatusEnum, GalleryItem,
    GalleryPurchase, Profile, RoleEnum,
)
from routes.dispatch import boost
from routes.gallery import sales


def auth(subject):
    return {'Authorization': f'Bearer {create_access_token({"sub": subject})}'}


def profile(pid, role, balance=0.0, name=None):
    return Profile(id=pid, user_id=pid, email=f'{pid}@example.invalid', username=pid, role=role,
                   full_name=name or pid.title(), credit_balance=balance, withdrawable_credits=0.0,
                   gear_only_credits=0.0)


def gallery_item(item_id, photographer_id, price):
    return GalleryItem(id=item_id, photographer_id=photographer_id, original_url=f'https://x.invalid/{item_id}.jpg',
                       preview_url=f'https://x.invalid/{item_id}-p.jpg', price_standard=price, title=item_id)


def dispatch(did, completed_at, **overrides):
    values = dict(id=did, requester_id='captain', photographer_id='pro', latitude=33.0, longitude=-117.0,
                  location_name='Fixture Beach', hourly_rate=100.0, estimated_total=150.0, deposit_amount=40.0,
                  estimated_duration_hours=1.5, status=DispatchRequestStatusEnum.COMPLETED, completed_at=completed_at)
    values.update(overrides)
    return DispatchRequest(**values)


@pytest.fixture
def client(tmp_path):
    path = tmp_path / 'f10.sqlite'
    sync_engine = create_engine(f'sqlite:///{path}')
    for table in Base.metadata.sorted_tables:
        try:
            table.create(sync_engine, checkfirst=True)
        except Exception:  # tables this test never reads may use types sqlite cannot create
            pass
    now = datetime.now(timezone.utc)
    with sessionmaker(sync_engine)() as db:
        db.add_all([
            profile('pro', RoleEnum.PHOTOGRAPHER, balance=5.0, name='Pat Pro'),
            profile('pro2', RoleEnum.PHOTOGRAPHER),
            profile('captain', RoleEnum.SURFER, balance=100.0, name='Cap Tain'),
            profile('crew', RoleEnum.SURFER, name='Crew Mate'),
            profile('broke', RoleEnum.SURFER, balance=1.0),
        ])
        db.flush()
        db.add_all([
            dispatch('d-new', now - timedelta(hours=1)),
            dispatch('d-old', now - timedelta(days=2), estimated_total=75.0),
            dispatch('d-other-pro', now, photographer_id='pro2'),
            dispatch('d-pending', now, status=DispatchRequestStatusEnum.SEARCHING_FOR_PRO),
        ])
        db.flush()
        db.add_all([
            DispatchRequestParticipant(dispatch_request_id='d-new', participant_id='crew', share_amount=25.0,
                                       paid=True, payer_name='Crew Nick', payer_avatar_url='https://x.invalid/a.png'),
            DispatchRequestParticipant(dispatch_request_id='d-new', participant_id='broke', share_amount=25.0,
                                       paid=False),
        ])
        db.add_all([gallery_item('g1', 'pro', 10.0), gallery_item('g2', 'pro', 20.0), gallery_item('g3', 'pro', 30.0)])
        db.commit()
    sync_engine.dispose()

    async def get_db():
        engine = create_async_engine(f'sqlite+aiosqlite:///{path}')
        async with async_sessionmaker(engine, expire_on_commit=False)() as session:
            yield session
        await engine.dispose()

    app = FastAPI()
    app.include_router(boost.router, prefix='/api')
    app.include_router(sales.router, prefix='/api')
    app.dependency_overrides[database.get_db] = get_db
    app.dependency_overrides[boost.get_db] = get_db
    app.dependency_overrides[sales.get_db] = get_db
    with TestClient(app) as test_client:
        test_client.sqlite_path = path
        yield test_client


def rows(client, model):
    """Read committed rows with a plain sync session, independent of the app's own connections."""
    engine = create_engine(f'sqlite:///{client.sqlite_path}')
    try:
        with sessionmaker(engine)() as db:
            return db.execute(select(model)).scalars().all()
    finally:
        engine.dispose()


# ---- GET /dispatch/photographer/{id}/history -------------------------------------------------------------------

def test_history_returns_200_with_the_owners_completed_sessions_and_rosters(client):
    response = client.get('/api/dispatch/photographer/pro/history', headers=auth('pro'))
    assert response.status_code == 200, response.text
    history = response.json()['history']
    assert [h['id'] for h in history] == ['d-new', 'd-old']  # newest first; pending and other pros' rows excluded
    newest, oldest = history
    assert newest['requester_name'] == 'Cap Tain'
    assert newest['earnings'] == 150.0 and newest['location_name'] == 'Fixture Beach'
    roster = {p['id']: p for p in newest['participants']}
    # a cached payer name wins, otherwise the participant's profile name
    assert roster['crew']['full_name'] == 'Crew Nick'
    assert roster['crew']['amount_paid'] == 25.0 and roster['crew']['paid'] is True
    assert roster['crew']['avatar_url'] == 'https://x.invalid/a.png'
    assert roster['broke']['full_name'] == 'Broke'
    assert roster['broke']['amount_paid'] == 0 and roster['broke']['paid'] is False
    assert newest['participant_count'] == 3  # two participants plus the captain
    assert oldest['participants'] == [] and oldest['participant_count'] == 1


def test_history_pages_with_limit_and_offset(client):
    response = client.get('/api/dispatch/photographer/pro/history?limit=1&offset=1', headers=auth('pro'))
    assert response.status_code == 200
    assert [h['id'] for h in response.json()['history']] == ['d-old']


def test_history_is_private_to_the_photographer(client):
    assert client.get('/api/dispatch/photographer/pro/history').status_code == 401
    other = client.get('/api/dispatch/photographer/pro/history', headers=auth('pro2'))
    assert other.status_code == 403
    surfer = client.get('/api/dispatch/photographer/pro/history', headers=auth('captain'))
    assert surfer.status_code == 403


# ---- POST /gallery/bulk-purchase -------------------------------------------------------------------------------

def bulk(client, who, item_ids, buyer=None):
    return client.post('/api/gallery/bulk-purchase', headers=auth(who),
                       json={'item_ids': item_ids, 'quality_tiers': {}, 'buyer_id': buyer or who})


def test_a_two_item_bulk_purchase_records_purchases_and_moves_the_money(client):
    response = bulk(client, 'captain', ['g1', 'g2'])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['purchase_count'] == 2 and body['discount_rate'] == 0
    assert body['final_total'] == 30.0 and body['new_balance'] == 70.0
    assert {p['item_id'] for p in body['purchases']} == {'g1', 'g2'}

    purchases = rows(client, GalleryPurchase)
    assert sorted((p.gallery_item_id, p.buyer_id, p.photographer_id, p.amount_paid, p.payment_method)
                  for p in purchases) == [('g1', 'captain', 'pro', 10.0, 'credits'),
                                          ('g2', 'captain', 'pro', 20.0, 'credits')]
    balances = {p.id: p.credit_balance for p in rows(client, Profile)}
    assert balances['captain'] == 70.0
    assert balances['pro'] == pytest.approx(5.0 + 30.0 * 0.8)  # the photographer keeps 80%
    ledger = {(t.user_id, t.transaction_type): t for t in rows(client, CreditTransaction)}
    buyer_tx = ledger[('captain', 'bulk_purchase')]
    assert (buyer_tx.balance_before, buyer_tx.amount, buyer_tx.balance_after) == (100.0, -30.0, 70.0)
    pro_tx = ledger[('pro', 'bulk_gallery_sale')]
    assert pro_tx.balance_before == 5.0 and pro_tx.balance_after == pytest.approx(29.0)
    assert {i.id: i.purchase_count for i in rows(client, GalleryItem)}['g1'] == 1


def test_each_photographer_gets_one_earnings_push_with_the_real_signature(client, monkeypatch):
    pushes = []

    async def record(*args, **kwargs):
        # bind against the real function so a wrong argument shape fails here, not only in production
        inspect.signature(websocket_manager.broadcast_earnings_update).bind(*args, **kwargs)
        pushes.append((args, kwargs))

    monkeypatch.setattr(sales, 'broadcast_earnings_update', record)
    assert bulk(client, 'captain', ['g1', 'g2']).status_code == 200
    assert len(pushes) == 1
    (user_id, update_type, amount, details), _ = pushes[0]
    assert (user_id, update_type, amount) == ('pro', 'bulk_sale', pytest.approx(24.0))
    assert details == {'item_count': 2, 'buyer_name': 'Cap Tain'}


def test_a_failed_earnings_push_does_not_undo_a_paid_purchase(client, monkeypatch):
    async def explode(*args, **kwargs):
        raise RuntimeError('websocket hub down')

    monkeypatch.setattr(sales, 'broadcast_earnings_update', explode)
    assert bulk(client, 'captain', ['g1', 'g2']).status_code == 200
    assert len(rows(client, GalleryPurchase)) == 2


def test_three_items_get_the_volume_discount(client):
    response = bulk(client, 'captain', ['g1', 'g2', 'g3'])
    assert response.status_code == 200, response.text
    body = response.json()
    assert body['base_total'] == 60.0 and body['discount_rate'] == 0.10
    assert body['final_total'] == pytest.approx(54.0) and body['new_balance'] == pytest.approx(46.0)
    assert len(rows(client, GalleryPurchase)) == 3


def test_an_item_cannot_be_bought_twice(client):
    assert bulk(client, 'captain', ['g1', 'g2']).status_code == 200
    again = bulk(client, 'captain', ['g2', 'g3'])
    assert again.status_code == 400 and 'already purchased' in again.json()['detail']
    assert len(rows(client, GalleryPurchase)) == 2  # nothing from the refused request was recorded
    assert {p.id: p.credit_balance for p in rows(client, Profile)}['captain'] == 70.0


def test_insufficient_credits_records_nothing(client):
    response = bulk(client, 'broke', ['g1', 'g2'])
    assert response.status_code == 400 and 'Insufficient credits' in response.json()['detail']
    assert rows(client, GalleryPurchase) == []


def test_a_caller_cannot_buy_as_someone_else(client):
    response = bulk(client, 'crew', ['g1', 'g2'], buyer='captain')
    assert response.status_code == 403
    assert rows(client, GalleryPurchase) == []
