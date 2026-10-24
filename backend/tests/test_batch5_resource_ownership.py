"""LA-SEC-03 batch 5: ownership BY RESOURCE (a notification, a booking), proved against a real SQLite database
over real HTTP + JWT, plus the realtime-broadcast allow-list.

The per-route 401 / 403 / owner-passes cases for routes that NAME the actor live in test_actor_route_binding.py.
Here the actor is implicit: whoever the booking or notification belongs to. A refusal must leave the rows exactly
as they were, so every negative case compares a before/after snapshot of the tables it could have touched.
"""
import math
import secrets
from datetime import datetime, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from fastapi.testclient import TestClient
from sqlalchemy import select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Booking, BookingParticipant, Notification, Profile, RoleEnum
from routes.bookings import crew_hub, crew_payments, stripe_checkout
from routes.notifications import notifications as notif_routes

DENIED = "Cannot act on behalf of another user"


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, Notification):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    start = datetime(2026, 1, 1, tzinfo=timezone.utc)
    async with maker() as db:
        for pid in ("captain", "crew", "crew2", "outsider", "photographer"):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid,
                           role=RoleEnum.PHOTOGRAPHER if pid == "photographer" else RoleEnum.SURFER))
        db.add(Booking(id="booking", creator_id="captain", photographer_id="photographer", location="Fixture Beach",
                       session_date=start, total_price=300.0, invite_code="booking", description="fixture",
                       max_participants=3))
        for pid, status in (("captain", "Paid"), ("crew", "Pending"), ("crew2", "Pending")):
            db.add(BookingParticipant(booking_id="booking", participant_id=pid, is_captain=pid == "captain",
                                      payment_status=status, share_amount=100.0))
        db.add(Notification(id="n-crew", user_id="crew", type="x", title="for crew"))
        db.add(Notification(id="n-captain", user_id="captain", type="x", title="for captain"))
        await db.commit()

    app = FastAPI()
    for router in (notif_routes.router, stripe_checkout.router, crew_payments.router, crew_hub.router):
        app.include_router(router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def snapshot():
        async with maker() as db:
            notes = (await db.execute(select(Notification.id, Notification.user_id, Notification.is_read)
                                      .order_by(Notification.id))).all()
            shares = (await db.execute(select(BookingParticipant.participant_id, BookingParticipant.share_amount,
                                              BookingParticipant.selfie_url)
                                       .order_by(BookingParticipant.participant_id))).all()
            booking = (await db.execute(select(Booking.status, Booking.payment_window_expired))).all()
        return [tuple(r) for r in notes], [tuple(r) for r in shares], [tuple(r) for r in booking]

    try:
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, snapshot=snapshot)
    finally:
        await engine.dispose()


# ---------------------------------------------------------------- notifications

async def test_only_the_owner_can_mark_a_notification_read(world):
    before = await world.snapshot()
    stranger = await world.client.post("/api/notifications/n-crew/read", headers=_token("outsider"))
    assert stranger.status_code == 404
    assert await world.snapshot() == before  # nothing written, and it looks exactly like a missing id
    missing = await world.client.post("/api/notifications/nope/read", headers=_token("outsider"))
    assert missing.status_code == 404 and missing.json() == stranger.json()

    owner = await world.client.post("/api/notifications/n-crew/read", headers=_token("crew"))
    assert owner.status_code == 200
    notes = (await world.snapshot())[0]
    assert ("n-crew", "crew", True) in notes and ("n-captain", "captain", False) in notes


async def test_read_all_touches_only_the_callers_notifications(world):
    other = await world.client.post("/api/notifications/captain/read-all", headers=_token("crew"))
    assert other.status_code == 403 and other.json()["detail"] == DENIED
    assert (await world.snapshot())[0] == [("n-captain", "captain", False), ("n-crew", "crew", False)]

    own = await world.client.post("/api/notifications/crew/read-all", headers=_token("crew"))
    assert own.status_code == 200
    assert (await world.snapshot())[0] == [("n-captain", "captain", False), ("n-crew", "crew", True)]


# ---------------------------------------------------------------- nudge / nudge-all

async def test_only_the_captain_can_nudge_and_only_a_member(world):
    before = await world.snapshot()
    for who in ("crew", "outsider"):
        r = await world.client.post("/api/bookings/booking/nudge", headers=_token(who),
                                    json={"participant_id": "crew2"})
        assert r.status_code == 403, who
    # the captain still cannot send a reminder to a user who is not on the booking
    r = await world.client.post("/api/bookings/booking/nudge", headers=_token("captain"),
                                json={"participant_id": "outsider"})
    assert r.status_code == 404
    assert await world.snapshot() == before

    ok = await world.client.post("/api/bookings/booking/nudge", headers=_token("captain"),
                                 json={"participant_id": "crew2"})
    assert ok.status_code == 200, ok.text
    notes = (await world.snapshot())[0]
    assert len(notes) == len(before[0]) + 1 and any(user == "crew2" for _id, user, _r in notes)


async def test_only_the_captain_can_nudge_all(world):
    before = await world.snapshot()
    for who in ("crew", "outsider"):
        r = await world.client.post("/api/bookings/booking/nudge-all", headers=_token(who))
        assert r.status_code == 403, who
    assert await world.snapshot() == before

    ok = await world.client.post("/api/bookings/booking/nudge-all", headers=_token("captain"))
    assert ok.status_code == 200 and ok.json()["reminders_sent"] == 2  # the two unpaid crew, not the paid captain
    users = sorted(user for _id, user, _r in (await world.snapshot())[0])
    assert users.count("crew") == 2 and users.count("crew2") == 1 and users.count("captain") == 1


# ---------------------------------------------------------------- update-splits

def _splits(**amounts):
    return {"splits": [{"participant_id": pid, "share_amount": amt} for pid, amt in amounts.items()]}


async def test_only_the_captain_can_change_splits(world):
    before = await world.snapshot()
    body = _splits(captain=50.0, crew=150.0, crew2=100.0)
    for who in ("crew", "outsider"):
        r = await world.client.post("/api/bookings/booking/update-splits", headers=_token(who), json=body)
        assert r.status_code == 403, who
    assert await world.snapshot() == before

    ok = await world.client.post("/api/bookings/booking/update-splits", headers=_token("captain"), json=body)
    assert ok.status_code == 200
    shares = {pid: amt for pid, amt, _s in (await world.snapshot())[1]}
    assert shares == {"captain": 50.0, "crew": 150.0, "crew2": 100.0}
    assert math.isclose(sum(shares.values()), 300.0)


@pytest.mark.parametrize("body", [
    _splits(captain=100.0, crew=100.0, crew2=50.0),            # total 250 != 300
    _splits(captain=-100.0, crew=250.0, crew2=150.0),          # negative amount, total right
    _splits(captain=150.0, crew=150.0, outsider=0.0),          # a stranger's id (total right)
    _splits(captain=150.0, crew=150.0),                        # total right, but crew2's old share would stay
])
async def test_bad_splits_are_refused_and_change_nothing(world, body):
    before = await world.snapshot()
    r = await world.client.post("/api/bookings/booking/update-splits", headers=_token("captain"), json=body)
    assert r.status_code == 400
    assert await world.snapshot() == before


async def test_a_nan_or_duplicate_split_cannot_slip_past_the_total_check(world):
    before = await world.snapshot()
    # NaN is not valid JSON, so send the raw text (Python's json emits NaN, and so do lax clients).
    raw = '{"splits": [{"participant_id": "captain", "share_amount": NaN}, ' \
          '{"participant_id": "crew", "share_amount": 300.0}]}'
    r = await world.client.post("/api/bookings/booking/update-splits",
                                headers={**_token("captain"), "content-type": "application/json"}, content=raw)
    assert r.status_code in (400, 422)
    dup = _splits(captain=100.0)
    dup["splits"] += [{"participant_id": "captain", "share_amount": 200.0}]
    r = await world.client.post("/api/bookings/booking/update-splits", headers=_token("captain"), json=dup)
    assert r.status_code == 400
    assert await world.snapshot() == before


# ---------------------------------------------------------------- participant selfie

async def test_selfie_is_the_callers_own_and_only_for_a_member(world):
    url = "https://example.invalid/selfie.jpg"
    before = await world.snapshot()
    # naming someone else is refused outright
    r = await world.client.patch("/api/bookings/booking/participant-selfie", headers=_token("outsider"),
                                 json={"participant_id": "crew", "selfie_url": url})
    assert r.status_code == 403 and r.json()["detail"] == DENIED
    # a non-member naming themselves finds no participant row, and nothing is created
    r = await world.client.patch("/api/bookings/booking/participant-selfie", headers=_token("outsider"),
                                 json={"participant_id": "outsider", "selfie_url": url})
    assert r.status_code == 404
    assert await world.snapshot() == before

    ok = await world.client.patch("/api/bookings/booking/participant-selfie", headers=_token("crew"),
                                  json={"participant_id": "crew", "selfie_url": url})
    assert ok.status_code == 200
    assert {pid: s for pid, _a, s in (await world.snapshot())[1]}["crew"] == url


# ---------------------------------------------------------------- handle-expiry

async def test_only_people_on_the_booking_can_trigger_expiry(world):
    # No expiry timestamp: the handler treats that as "expired already" (SQLite hands back naive datetimes, so a
    # real timestamp would trip a naive/aware comparison that Postgres does not have).
    before = await world.snapshot()
    r = await world.client.post("/api/bookings/booking/crew-hub/handle-expiry", headers=_token("outsider"))
    assert r.status_code == 403
    assert await world.snapshot() == before

    ok = await world.client.post("/api/bookings/booking/crew-hub/handle-expiry", headers=_token("crew"))
    assert ok.status_code == 200
    assert (await world.snapshot())[2] == [(before[2][0][0], True)]


# ---------------------------------------------------------------- realtime broadcast allow-list

class _Recorder:
    """Stands in for httpx.AsyncClient inside the route and records what would have gone to Supabase."""
    posts = []

    def __init__(self, *a, **k):
        pass

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False

    async def post(self, url, json=None, headers=None, timeout=None):
        _Recorder.posts.append((url, json))
        return SimpleNamespace(status_code=200)


@pytest.fixture
def broadcast(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://fixture.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_KEY", "fixture-key")
    monkeypatch.setattr("httpx.AsyncClient", _Recorder)
    _Recorder.posts = []
    app = FastAPI()
    app.include_router(notif_routes.router, prefix="/api")
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))
    with TestClient(app) as client:
        yield client


GOOD = {"channel": "post:abc-123", "event": "reaction_update",
        "payload": {"post_id": "abc-123", "user_name": "Kai", "emoji": "x", "action": "added"}}


def test_the_frontends_own_broadcast_still_goes_out(broadcast):
    r = broadcast.post("/api/realtime/broadcast", json=GOOD, headers=_token("u1"))
    assert r.status_code == 200 and r.json()["success"] is True
    assert [c for _u, c in _Recorder.posts] == [{"channel": "post:abc-123", "messages": [
        {"type": "broadcast", "event": "reaction_update", "payload": GOOD["payload"]}]}]


def test_broadcast_without_a_token_is_refused(broadcast):
    assert broadcast.post("/api/realtime/broadcast", json=GOOD).status_code in (401, 403)
    assert _Recorder.posts == []


@pytest.mark.parametrize("change", [
    {"channel": "user:victim"},                       # another user's private channel
    {"channel": "realtime:inbox-messages-1"},         # a conversation channel
    {"channel": "post:"},                              # empty id
    {"channel": "post:abc/../x"},                      # path-ish id
    {"channel": "post:" + "a" * 65},                   # too long
    {"channel": "post:other-post"},                    # payload says abc-123: channel and payload disagree
    {"event": "new_message"},                          # an event no channel listener of ours expects
    {"event": "INSERT"},
    {"payload": {"post_id": "abc-123", "html": "<script>"}},          # free-form key
    {"payload": {"post_id": "abc-123", "user_name": "x" * 5000}},     # oversized
])
def test_broadcast_outside_the_allow_list_is_refused_and_nothing_is_sent(broadcast, change):
    r = broadcast.post("/api/realtime/broadcast", json={**GOOD, **change}, headers=_token("u1"))
    assert r.status_code == 400, r.text
    assert _Recorder.posts == []
