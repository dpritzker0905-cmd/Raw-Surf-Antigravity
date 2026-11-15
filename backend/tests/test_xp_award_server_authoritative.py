"""POST /api/gamification/award-xp is server-authoritative (security fix, 2026-11-15).

Before: the route took `amount`, `reason` and `reference_*` from the client, so any signed-in user could award
themselves arbitrary XP. Now the client names only an ACTION and the reference_id of a row it owns; the amount
comes from the server table `XP_ACTIONS`, and one reference grants at most once per user (including the grant the
server flow already made inline). Proved here over real HTTP + JWT against a real SQLite database.
"""
import importlib.util
import pathlib
import secrets
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
import sqlalchemy as sa
from alembic.migration import MigrationContext
from alembic.operations import Operations
from fastapi import FastAPI
from sqlalchemy import Select, false, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (Badge, CreditTransaction, LiveSession, LiveSessionParticipant, Profile, Review, RoleEnum,
                    XPTransaction)
from routes.career_hub import gamification

URL = "/api/gamification/award-xp"


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Review, LiveSession, LiveSessionParticipant, XPTransaction, Badge, CreditTransaction):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    state = SimpleNamespace(stale=False)

    class StaleSnapshotSession(AsyncSession):
        """With state.stale on, the route's idempotency read sees nothing: a REPEATABLE READ snapshot taken before a
        concurrent grant committed. The partial unique index is then the only thing between a replay and XP."""

        async def execute(self, statement, *args, **kwargs):
            if state.stale and isinstance(statement, Select) and [
                    (c["entity"], c["name"]) for c in statement.column_descriptions] == [(XPTransaction, "id")]:
                statement = select(XPTransaction.id).where(false())
            return await super().execute(statement, *args, **kwargs)

    maker = async_sessionmaker(engine, expire_on_commit=False, class_=StaleSnapshotSession)
    async with maker() as db:
        for pid in ("surfer", "other", "photographer"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photographer" else RoleEnum.SURFER))
        db.add(Review(id="rev-surfer", reviewer_id="surfer", reviewee_id="photographer",
                      review_type="surfer_to_photographer", rating=5))
        db.add(Review(id="rev-other", reviewer_id="other", reviewee_id="photographer",
                      review_type="surfer_to_photographer", rating=4))
        db.add(LiveSessionParticipant(id="join-active", surfer_id="surfer", photographer_id="photographer",
                                      status="active"))
        db.add(LiveSessionParticipant(id="join-cancelled", surfer_id="surfer", photographer_id="photographer",
                                      status="cancelled"))
        # The inline grant reviews.py already made for this review (same reference key, its own reason text).
        db.add(Review(id="rev-granted", reviewer_id="surfer", reviewee_id="photographer",
                      review_type="surfer_to_photographer", rating=5))
        db.add(XPTransaction(user_id="surfer", amount=10, reason="review_given", reference_type="review",
                             reference_id="rev-granted"))
        await db.commit()

    app = FastAPI()
    app.include_router(gamification.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def ledger(user_id):
        async with maker() as db:
            rows = (await db.execute(select(XPTransaction.amount, XPTransaction.reason, XPTransaction.reference_id)
                                     .where(XPTransaction.user_id == user_id)
                                     .order_by(XPTransaction.reference_id))).all()
        return [tuple(r) for r in rows]

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, ledger=ledger, maker=maker, state=state)
    finally:
        await engine.dispose()


async def test_no_token_is_401_and_writes_nothing(world):
    before = await world.ledger("surfer")
    response = await world.client.post(URL, json={"action": "review_given", "reference_id": "rev-surfer"})
    assert response.status_code == 401
    # The legacy ?user_id= query never authenticates.
    legacy = await world.client.post(URL, params={"user_id": "surfer"},
                                     json={"action": "review_given", "reference_id": "rev-surfer"})
    assert legacy.status_code == 401
    assert await world.ledger("surfer") == before


async def test_client_supplied_amount_is_rejected(world):
    before = await world.ledger("surfer")
    body = {"action": "review_given", "reference_id": "rev-surfer", "amount": 1_000_000}
    response = await world.client.post(URL, json=body, headers=_token("surfer"))
    assert response.status_code == 422
    # The old query-string shape is refused too (no body -> 422), and no amount reaches the ledger.
    old = await world.client.post(URL, params={"amount": 1_000_000, "reason": "free"}, headers=_token("surfer"))
    assert old.status_code == 422
    assert await world.ledger("surfer") == before


async def test_server_decides_the_amount(world):
    response = await world.client.post(URL, json={"action": "review_given", "reference_id": "rev-surfer"},
                                       headers=_token("surfer"))
    assert response.status_code == 200 and response.json()["granted"] == gamification.XP_ACTIONS["review_given"].amount
    assert (10, "review_given", "rev-surfer") in await world.ledger("surfer")


async def test_unknown_action_is_400(world):
    before = await world.ledger("surfer")
    response = await world.client.post(URL, json={"action": "free_xp", "reference_id": "rev-surfer"},
                                       headers=_token("surfer"))
    assert response.status_code == 400
    assert await world.ledger("surfer") == before


async def test_replay_does_not_double_award(world):
    body = {"action": "live_session_joined", "reference_id": "join-active"}
    first = await world.client.post(URL, json=body, headers=_token("surfer"))
    assert first.status_code == 200 and first.json()["granted"] == 25
    for _ in range(3):
        again = await world.client.post(URL, json=body, headers=_token("surfer"))
        assert again.status_code == 200 and again.json() == {
            "granted": 0, "action": "live_session_joined", "already_granted": True}
    assert [r for r in await world.ledger("surfer") if r[2] == "join-active"] == [(25, "Joined a live session",
                                                                                   "join-active")]


async def test_claim_does_not_stack_on_the_inline_grant(world):
    response = await world.client.post(URL, json={"action": "review_given", "reference_id": "rev-granted"},
                                       headers=_token("surfer"))
    assert response.status_code == 200 and response.json()["granted"] == 0
    assert [r for r in await world.ledger("surfer") if r[2] == "rev-granted"] == [(10, "review_given", "rev-granted")]


async def test_only_the_owner_can_claim(world):
    before_surfer, before_other = await world.ledger("surfer"), await world.ledger("other")
    stolen = await world.client.post(URL, json={"action": "review_given", "reference_id": "rev-other"},
                                     headers=_token("surfer"))
    missing = await world.client.post(URL, json={"action": "review_given", "reference_id": "nope"},
                                      headers=_token("surfer"))
    # Someone else's row looks exactly like a missing one (no enumeration), and nothing is written for anyone.
    assert stolen.status_code == 404 and missing.status_code == 404 and stolen.json() == missing.json()
    cancelled = await world.client.post(URL, json={"action": "live_session_joined", "reference_id": "join-cancelled"},
                                        headers=_token("surfer"))
    assert cancelled.status_code == 404
    assert await world.ledger("surfer") == before_surfer and await world.ledger("other") == before_other

# ---------------------------------------------------------------- the partial unique index (backstop)

async def test_stale_snapshot_race_is_answered_as_a_replay_not_a_500(world):
    """The idempotency read misses an already-committed grant; the index refuses the second row and the route says
    'already granted' instead of paying twice or answering 500."""
    world.state.stale = True
    response = await world.client.post(URL, json={"action": "review_given", "reference_id": "rev-granted"},
                                       headers=_token("surfer"))
    assert response.status_code == 200 and response.json() == {
        "granted": 0, "action": "review_given", "already_granted": True}
    assert [r for r in await world.ledger("surfer") if r[2] == "rev-granted"] == [(10, "review_given", "rev-granted")]


async def test_index_covers_claimable_types_only(world):
    async with world.maker() as db:
        db.add(XPTransaction(user_id="surfer", amount=1, reason="dup", reference_type="review",
                             reference_id="rev-granted"))
        with pytest.raises(IntegrityError):
            await db.commit()
    async with world.maker() as db:
        # A buyer may buy the same gallery item twice: both purchase grants must still be written.
        for _ in range(2):
            db.add(XPTransaction(user_id="surfer", amount=10, reason="Purchased a photo",
                                 reference_type="gallery_purchase", reference_id="item-1"))
        await db.commit()
    assert [r for r in await world.ledger("surfer") if r[2] == "item-1"] == [(10, "Purchased a photo", "item-1")] * 2


# ---------------------------------------------------------------- the migration

def _migration():
    path = pathlib.Path(__file__).resolve().parents[1] / "alembic" / "versions" / "xp_claim_unique_001.py"
    spec = importlib.util.spec_from_file_location("xp_claim_unique_001", path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    return module


def _run(engine, step):
    with engine.begin() as connection:
        with Operations.context(MigrationContext.configure(connection)):
            step()


@pytest.mark.parametrize("duplicate", [False, True])
def test_migration_refuses_on_duplicates_and_otherwise_creates_the_index(duplicate):
    migration = _migration()
    assert migration.down_revision == "support_create_intent_001"
    engine = sa.create_engine("sqlite://")
    with engine.begin() as connection:
        connection.exec_driver_sql("CREATE TABLE xp_transactions (id TEXT PRIMARY KEY, user_id TEXT, amount INT, "
                                   "reason TEXT, reference_type TEXT, reference_id TEXT, created_at TEXT)")
        rows = [("a", "u", "review", "r1"), ("b", "u", "gallery_purchase", "i1"), ("c", "u", "gallery_purchase", "i1")]
        if duplicate:
            rows.append(("d", "u", "review", "r1"))
        for rid, uid, rtype, ref in rows:
            connection.exec_driver_sql("INSERT INTO xp_transactions (id, user_id, amount, reason, reference_type, "
                                       "reference_id) VALUES (?, ?, 10, 'x', ?, ?)", (rid, uid, rtype, ref))
    if duplicate:
        with pytest.raises(RuntimeError, match="duplicate XP grants"):
            _run(engine, migration.upgrade)
        assert migration.INDEX not in {i["name"] for i in sa.inspect(engine).get_indexes("xp_transactions")}
        return
    _run(engine, migration.upgrade)
    assert migration.INDEX in {i["name"] for i in sa.inspect(engine).get_indexes("xp_transactions")}
    with pytest.raises(sa.exc.IntegrityError), engine.begin() as connection:
        connection.exec_driver_sql("INSERT INTO xp_transactions (id, user_id, amount, reason, reference_type, "
                                   "reference_id) VALUES ('e', 'u', 10, 'x', 'review', 'r1')")
    _run(engine, migration.downgrade)
    assert migration.INDEX not in {i["name"] for i in sa.inspect(engine).get_indexes("xp_transactions")}
