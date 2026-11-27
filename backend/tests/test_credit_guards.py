"""P0 money (2026-10-24): no negative or non-finite credit amounts, and an atomic debit.

Found by the full-app audit (source-read, never exercised live): a signed-in user could MINT credits because two
routes let a negative amount reach the shared debit helper (`POST /ads/submit`: a negative `budget_credits`; and
`POST /bookings/create`: a negative `duration` gave a negative price, which became a negative `credits_applied`),
and the helper accepted it (balance - (-x) = balance + x). The helper also took a row lock but then used the
ORM object the caller had loaded earlier, so its balance check and subtraction ran on a stale value.

Everything here runs the real helpers and real route handlers over HTTP + JWT against a real SQLite database, with
synthetic users only; nothing touches a live service. Postgres-specific behaviour (row locks under READ COMMITTED)
is NOT covered by SQLite; the atomic-UPDATE semantics are.
"""
import asyncio
import math
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock
from urllib.parse import parse_qs

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI, HTTPException
from sqlalchemy import func, select, text
from sqlalchemy.dialects import postgresql
from sqlalchemy.exc import DBAPIError
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (AdConfig, Booking, BookingParticipant, CreditTransaction, Notification, PaymentTransaction,
                    Post, Profile, RoleEnum)
from routes.bookings import booking_lifecycle, crud, stripe_checkout
from routes.commerce import ad_controls
from utils.credits import add_credits, clean_amount, deduct_credits

TABLES = (Profile, Booking, BookingParticipant, CreditTransaction, Notification, AdConfig, PaymentTransaction, Post)


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


async def _make_engine(url="sqlite+aiosqlite:///:memory:"):
    engine = create_async_engine(url)
    async with engine.begin() as connection:
        for model in TABLES:
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        db.add(Profile(id="user", user_id="user", email="user@example.invalid", full_name="user",
                       role=RoleEnum.SURFER, credit_balance=100.0))
        db.add(Profile(id="photog", user_id="photog", email="photog@example.invalid", full_name="photog",
                       role=RoleEnum.PHOTOGRAPHER, credit_balance=0.0, booking_hourly_rate=60.0))
        await db.commit()
    return engine, maker


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))

    async def no_push(*args, **kwargs):  # the push provider is not under test
        return None

    monkeypatch.setattr("routes.notifications.push_payloads.notify_booking", no_push)
    engine, maker = await _make_engine()
    app = FastAPI()
    app.include_router(ad_controls.router, prefix="/api")
    app.include_router(booking_lifecycle.router, prefix="/api")
    app.include_router(stripe_checkout.router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def state():
        async with maker() as db:
            balance = (await db.execute(select(Profile.credit_balance).where(Profile.id == "user"))).scalar()
            ledger = (await db.execute(select(func.count()).select_from(CreditTransaction))).scalar()
            bookings = (await db.execute(select(func.count()).select_from(Booking))).scalar()
            ads = (await db.execute(select(func.count()).select_from(AdConfig))).scalar()
        return balance, ledger, bookings, ads

    try:
        # raise_app_exceptions=False: FastAPI's default 422 body cannot JSON-encode a NaN/inf input and answers 500
        # (a refusal that writes nothing); the test must see that status, not an exception.
        transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
        async with httpx.AsyncClient(transport=transport, base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(app=app, client=client, maker=maker, state=state)
    finally:
        await engine.dispose()


# ------------------------------------------------------------------ the helpers

BAD = [-1, -0.01, float("nan"), float("inf"), float("-inf"), None, "x", "-5"]


@pytest.mark.parametrize("bad", BAD)
async def test_a_bad_amount_is_refused_by_both_helpers_and_changes_nothing(world, bad):
    before = await world.state()
    async with world.maker() as db:
        ok, _bal, error = await deduct_credits("user", bad, "t", db)
        assert ok is False and error == "Invalid amount"
        ok, _bal, error = await add_credits("user", bad, "t", db)
        assert ok is False and error == "Invalid amount"
        await db.commit()
    assert await world.state() == before


def test_clean_amount_rounds_to_cents_and_rejects_the_rest():
    assert clean_amount(10.126) == 10.13 and clean_amount(0) == 0.0 and clean_amount("5") == 5.0
    assert all(clean_amount(x) is None for x in BAD if x != "-5") and clean_amount("-5") is None


async def test_a_valid_debit_and_credit_move_the_balance_and_write_consistent_ledger_rows(world):
    async with world.maker() as db:
        ok, after, _ = await deduct_credits("user", 30.126, "t", db, reference_type="x", reference_id="r1")
        assert ok and after == 69.87
        ok, after2, _ = await add_credits("user", 5, "t", db)
        assert ok and after2 == 74.87
        await db.commit()
    async with world.maker() as db:
        rows = (await db.execute(select(CreditTransaction).order_by(CreditTransaction.created_at))).scalars().all()
    assert [round(r.amount, 2) for r in rows] == [-30.13, 5.0]
    assert all(math.isclose(r.balance_before + r.amount, r.balance_after, abs_tol=0.005) for r in rows)


async def test_an_overdraw_is_refused(world):
    async with world.maker() as db:
        ok, balance, error = await deduct_credits("user", 100.01, "t", db)
        assert ok is False and balance == 100.0 and "Insufficient" in error
        await db.commit()
    assert (await world.state())[:2] == (100.0, 0)


async def test_an_unknown_user_is_refused(world):
    async with world.maker() as db:
        assert (await deduct_credits("nobody", 1, "t", db))[0] is False
        assert (await add_credits("nobody", 1, "t", db))[0] is False


async def test_the_check_runs_on_the_database_not_on_a_stale_loaded_object(world):
    """The audited hole: the caller had loaded the Profile (100); the balance then changed underneath it (40)."""
    async with world.maker() as db:
        loaded = (await db.execute(select(Profile).where(Profile.id == "user"))).scalar_one()
        assert loaded.credit_balance == 100.0
        await db.execute(text("update profiles set credit_balance = 40 where id = 'user'"))  # bypasses the ORM
        ok, balance, error = await deduct_credits("user", 60, "t", db)
        assert ok is False and balance == 40.0 and "Insufficient" in error  # the old code subtracted from 100
        ok, balance, _ = await add_credits("user", 10, "t", db)
        assert ok is True and balance == 50.0                              # the old code wrote 110
        await db.commit()
    assert (await world.state())[0] == 50.0


async def test_the_callers_loaded_object_shows_the_new_balance_afterwards(world):
    async with world.maker() as db:
        loaded = (await db.execute(select(Profile).where(Profile.id == "user"))).scalar_one()
        await deduct_credits("user", 25, "t", db)
        assert loaded.credit_balance == 75.0
        await add_credits("user", 5, "t", db)
        assert loaded.credit_balance == 80.0


async def test_two_concurrent_debits_cannot_overdraw(tmp_path, monkeypatch):
    """Two sessions on a file database race to spend 60 of 100: exactly one may succeed (SQLite serialises the
    UPDATEs; Postgres row-lock behaviour under READ COMMITTED is not exercised here)."""
    engine, maker = await _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'race.db'}")
    try:
        async def spend():
            async with maker() as db:
                ok, _balance, _err = await deduct_credits("user", 60, "t", db)
                await db.commit()
                return ok

        results = await asyncio.gather(spend(), spend())
        assert sorted(results) == [False, True]
        async with maker() as db:
            assert (await db.execute(select(Profile.credit_balance).where(Profile.id == "user"))).scalar() == 40.0
            assert (await db.execute(select(func.count()).select_from(CreditTransaction))).scalar() == 1
    finally:
        await engine.dispose()


# ------------------------------------------------------------------ POST /api/ads/submit

AD = {"headline": "Surf shop", "description": "Boards", "cta": "Shop", "cta_link": "https://example.invalid"}


@pytest.mark.parametrize("budget", [-1, -100000, 0, 5.5, "abc", 1_000_001])
async def test_ads_submit_refuses_a_non_positive_or_silly_budget(world, budget):
    before = await world.state()
    r = await world.client.post("/api/ads/submit", json={**AD, "budget_credits": budget}, headers=_token("user"))
    assert r.status_code == 422
    assert await world.state() == before  # no balance change, no ledger row, no ad saved


async def test_ads_submit_more_than_the_balance_is_refused(world):
    before = await world.state()
    r = await world.client.post("/api/ads/submit", json={**AD, "budget_credits": 101}, headers=_token("user"))
    assert r.status_code == 400
    assert await world.state() == before


async def test_a_valid_ad_submission_still_works_and_is_in_the_ledger(world):
    r = await world.client.post("/api/ads/submit", json={**AD, "budget_credits": 10}, headers=_token("user"))
    assert r.status_code == 200, r.text
    ad_id = r.json()["ad_id"]
    assert r.json()["new_balance"] == 90.0
    async with world.maker() as db:
        row = (await db.execute(select(CreditTransaction))).scalar_one()
        balance = (await db.execute(select(Profile.credit_balance).where(Profile.id == "user"))).scalar()
    assert balance == 90.0
    assert (row.amount, row.transaction_type, row.reference_type, row.reference_id) == (-10.0, "ad_purchase",
                                                                                         "ad_submission", ad_id)
    assert row.balance_before - row.balance_after == 10.0


# ------------------------------------------------------------------ POST /api/bookings/create

def booking(**over):
    base = {"photographer_id": "photog", "location": "Fixture Beach",
            "session_date": (datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), "duration": 60}
    base.update(over)
    return base


@pytest.mark.parametrize("change", [
    {"duration": -60, "apply_credits": 50},      # the audited exploit: negative price -> negative "debit"
    {"duration": -60}, {"duration": 0}, {"duration": 1441},
    {"max_participants": 0}, {"max_participants": -3}, {"max_participants": 101},
    {"apply_credits": -50}, {"apply_credits": -0.01},
])
async def test_booking_create_refuses_negative_and_out_of_range_numbers(world, change):
    before = await world.state()
    r = await world.client.post("/api/bookings/create", json=booking(**change), headers=_token("user"))
    assert r.status_code == 422, r.text
    assert await world.state() == before


@pytest.mark.parametrize("raw", ['"apply_credits": NaN', '"apply_credits": Infinity', '"apply_credits": -Infinity'])
async def test_booking_create_refuses_non_finite_credits(world, raw):
    before = await world.state()
    payload = ('{"photographer_id": "photog", "location": "x", "session_date": "%s", "duration": 60, %s}'
               % ((datetime.now(timezone.utc) + timedelta(days=3)).isoformat(), raw))
    r = await world.client.post("/api/bookings/create", content=payload,
                                headers={**_token("user"), "content-type": "application/json"})
    assert r.status_code >= 400, r.text  # 422, or the 500 FastAPI gives a NaN body; either way nothing is written
    assert await world.state() == before


async def test_a_photographer_with_a_negative_rate_cannot_make_a_negative_price(world):
    async with world.maker() as db:
        row = (await db.execute(select(Profile).where(Profile.id == "photog"))).scalar_one()
        row.booking_hourly_rate = -50.0
        await db.commit()
    before = await world.state()
    r = await world.client.post("/api/bookings/create", json=booking(apply_credits=40), headers=_token("user"))
    assert r.status_code == 400 and "valid price" in r.json()["detail"]
    assert await world.state() == before


async def test_a_valid_booking_with_credits_still_works(world):
    r = await world.client.post("/api/bookings/create", json=booking(apply_credits=40), headers=_token("user"))
    assert r.status_code == 200, r.text
    assert r.json()["credits_applied"] == 40.0 and r.json()["total_price"] == 60.0
    balance, ledger, bookings, _ads = await world.state()
    assert (balance, ledger, bookings) == (60.0, 1, 1)
    async with world.maker() as db:
        row = (await db.execute(select(CreditTransaction))).scalar_one()
        paid = (await db.execute(select(BookingParticipant.paid_amount))).scalar()
    assert (row.amount, row.transaction_type) == (-40.0, "booking_payment") and paid == 40.0


# ------------------------------------------------------------------ POST /api/bookings/create-with-stripe

def card_booking(**over):
    return booking(origin_url="https://example.invalid", **over)


def test_scheduled_time_display_converts_an_aware_non_utc_read():
    start = datetime.fromisoformat("2032-01-01T03:45:00+05:30")
    assert crud.format_scheduled_start(start) == "Dec 31, 2031 at 10:15 PM UTC"


async def test_wallet_booking_time_in_messages_and_sharing(world, monkeypatch):
    push = AsyncMock()
    monkeypatch.setattr("routes.notifications.push_payloads.notify_booking", push)
    payload = booking(session_date="2031-12-31T21:15:00-05:00", allow_splitting=True, apply_credits=60)
    response = await world.client.post("/api/bookings/create", json=payload, headers=_token("user"))
    assert response.status_code == 200, response.text
    booking_id = response.json()["booking_id"]
    expected = "Jan 01, 2032 at 02:15 AM UTC"
    async with world.maker() as db:
        notes = (await db.scalars(select(Notification))).all()
        assert {note.user_id for note in notes} == {"user", "photog"}
        assert all(expected in note.body for note in notes)
        assert (await db.get(Booking, booking_id)).session_date == datetime(2032, 1, 1, 2, 15)
    assert {call.kwargs["user_id"] for call in push.await_args_list} == {"user", "photog"}
    assert all(expected in call.kwargs["message"] for call in push.await_args_list)

    # SQLite drops the offset on reload. Historical wall times cannot be attributed to a zone.
    reloaded = "Jan 01, 2032 at 02:15 AM (time zone unavailable)"
    world.app.include_router(crud.router, prefix="/api")
    link = await world.client.get(f"/api/bookings/{booking_id}/share-link", params={"user_id": "user"})
    assert link.status_code == 200, link.text
    assert reloaded in link.json()["share_message"]
    feed = await world.client.post(f"/api/bookings/{booking_id}/share-to-feed", headers=_token("user"))
    assert feed.status_code == 200, feed.text
    async with world.maker() as db:
        assert reloaded in (await db.get(Post, feed.json()["post_id"])).caption


@pytest.fixture
def checkout_calls(monkeypatch):
    calls = []

    async def create(**kwargs):
        calls.append(kwargs["idempotency_key"])
        return SimpleNamespace(id=f"session-{len(calls)}", url="https://checkout.example.invalid/fixture")

    monkeypatch.setattr(stripe_checkout, "STRIPE_API_KEY", True)
    monkeypatch.setattr(stripe_checkout, "_create_scheduled_checkout", create)
    return calls


@pytest.mark.parametrize("endpoint", ["create", "create-with-stripe"])
@pytest.mark.parametrize("lock_busy", [False, True], ids=["acquired", "timed-out"])
async def test_buyer_lock_is_the_first_work_in_each_postgres_transaction(world, checkout_calls, endpoint, lock_busy):
    dialect = postgresql.dialect()
    statements = []
    db = Mock()
    db.get_bind.return_value.dialect = dialect
    db.rollback = AsyncMock()

    async def execute(statement, params=None):
        sql = str(statement.compile(dialect=dialect))
        statements.append(sql)
        if "FOR NO KEY UPDATE" in sql:
            if lock_busy:
                cause = Exception("fixture lock timeout")
                cause.sqlstate = "55P03"
                raise DBAPIError(sql, {}, cause)
            # Stop the successful acquisition path at its ordinary unknown-buyer response.
            return SimpleNamespace(scalar_one_or_none=lambda: None)
        if "set_config" in sql:
            assert params == {"previous": "10000"}

    async def scalar(statement):
        statements.append(str(statement.compile(dialect=dialect)))
        return 10000

    db.execute = execute
    db.scalar = scalar
    world.app.dependency_overrides[get_db] = lambda: db
    response = await world.client.post(f"/api/bookings/{endpoint}", json=card_booking(), headers=_token("user"))

    assert statements[0] == "SET TRANSACTION ISOLATION LEVEL READ COMMITTED"
    assert "pg_settings" in statements[1] and "lock_timeout" in statements[1]
    assert statements[2] == "SET LOCAL lock_timeout = '5s'"
    assert "FOR NO KEY UPDATE" in statements[3]
    if lock_busy:
        assert response.status_code == 503 and len(statements) == 4
        db.rollback.assert_awaited_once()
    else:
        assert response.status_code == 404 and len(statements) == 5
        assert "set_config('lock_timeout'" in statements[4]
    assert checkout_calls == []


@pytest.mark.parametrize("retry_endpoint", ["create-with-stripe", "create"])
async def test_reopened_checkout_cannot_book_or_debit_twice(world, checkout_calls, retry_endpoint):
    payload = card_booking(apply_credits=10)
    first = await world.client.post("/api/bookings/create-with-stripe", json=payload, headers=_token("user"))
    assert first.status_code == 200, first.text
    # Discard the first receipt. A fresh drawer sends no booking or checkout ID.
    retry = await world.client.post(f"/api/bookings/{retry_endpoint}", json=payload, headers=_token("user"))
    async with world.maker() as db:
        payments = await db.scalar(select(func.count()).select_from(PaymentTransaction))
        participants = await db.scalar(select(func.count()).select_from(BookingParticipant))
    balance, debits, bookings, _ = await world.state()
    assert (bookings, payments, participants, debits, balance, len(checkout_calls)) == (1, 1, 1, 1, 90, 1)
    assert retry.status_code == 409 and "scheduled bookings" in retry.json()["detail"]
    assert retry.json() == {
        "detail": "You already started checkout for this session. Check your scheduled bookings.",
        "pending_booking_id": first.json()["booking_id"],
    }

    async with world.maker.begin() as db:
        original = await db.get(Booking, first.json()["booking_id"])
        original.status = "Confirmed"
    occupied = await world.client.post(f"/api/bookings/{retry_endpoint}", json=payload, headers=_token("user"))
    assert occupied.status_code == 409 and set(occupied.json()) == {"detail"}


async def test_pending_checkout_identity_uses_the_start_instant(world, checkout_calls):
    payload = card_booking(session_date="2030-01-02T09:00:00-05:00")
    endpoint = "/api/bookings/create-with-stripe"
    async def submit(**changes):
        return await world.client.post(endpoint, json={**payload, **changes}, headers=_token("user"))

    assert (await submit()).status_code == 200
    assert (await submit(session_date="2030-01-02T14:00:00Z", location="Edited", duration=120)).status_code == 409
    assert (await submit(session_date="2030-01-02T16:00:00Z")).status_code == 200
    assert len(checkout_calls) == 2


async def test_only_reconciled_cancellation_releases_pending_checkout(world, checkout_calls):
    payload = card_booking()
    endpoint = "/api/bookings/create-with-stripe"
    async def submit():
        return await world.client.post(endpoint, json=payload, headers=_token("user"))

    first = await submit()
    assert first.status_code == 200
    booking_id = first.json()["booking_id"]
    async with world.maker.begin() as db:
        original = await db.get(Booking, booking_id)
        original.pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert (await submit()).status_code == 409
    async with world.maker.begin() as db:
        original = await db.get(Booking, booking_id)
        original.status = "Cancelled"
    assert (await submit()).status_code == 200
    assert len(checkout_calls) == 2


async def test_another_buyers_pending_checkout_remains_private(world, checkout_calls):
    async with world.maker.begin() as db:
        db.add(Profile(id="other", user_id="other", email="other@example.invalid", role=RoleEnum.SURFER))
    endpoint = "/api/bookings/create-with-stripe"
    payload = card_booking()
    first = await world.client.post(endpoint, json=payload, headers=_token("user"))
    other = await world.client.post(endpoint, json=payload, headers=_token("other"))
    assert first.status_code == other.status_code == 200
    assert first.json()["booking_id"] != other.json()["booking_id"]
    for buyer, expected in (("user", first), ("other", other)):
        retry = await world.client.post(endpoint, json=payload, headers=_token(buyer))
        assert retry.status_code == 409
        assert retry.json()["pending_booking_id"] == expected.json()["booking_id"]
    assert len(checkout_calls) == 2


async def test_overlapping_checkout_requests_serialize_before_provider(tmp_path, checkout_calls, world):
    engine, maker = await _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'checkout.db'}")
    payload = card_booking(apply_credits=10)

    async def dependency():
        async with maker() as db:
            yield db

    world.app.dependency_overrides[get_db] = dependency
    async def submit():
        return await world.client.post("/api/bookings/create-with-stripe", json=payload, headers=_token("user"))

    try:
        created, duplicate = sorted(await asyncio.gather(submit(), submit()), key=lambda r: r.status_code)
        assert (created.status_code, duplicate.status_code) == (200, 409)
        assert duplicate.json()["pending_booking_id"] == created.json()["booking_id"]
        assert len(checkout_calls) == 1
        async with maker() as db:
            assert await db.scalar(select(func.count()).select_from(Booking)) == 1
            assert await db.scalar(select(Profile.credit_balance).where(Profile.id == "user")) == 90
    finally:
        await engine.dispose()


async def test_uncommitted_checkout_failure_allows_a_fresh_create(world, checkout_calls, monkeypatch):
    payload = card_booking(apply_credits=10)
    endpoint = "/api/bookings/create-with-stripe"

    async def unavailable(**kwargs):
        raise RuntimeError("fixture unavailable")

    with monkeypatch.context() as patch:
        patch.setattr(stripe_checkout, "_create_scheduled_checkout", unavailable)
        failed = await world.client.post(endpoint, json=payload, headers=_token("user"))
    assert failed.status_code == 500
    assert (await world.state())[:3] == (100, 0, 0)
    retry = await world.client.post(endpoint, json=payload, headers=_token("user"))
    assert retry.status_code == 200
    assert (await world.state())[:3] == (90, 1, 1)
    assert len(checkout_calls) == 1


async def test_sqlite_buyer_lock_blocks_a_second_writer_before_any_insert(tmp_path):
    engine, maker = await _make_engine(f"sqlite+aiosqlite:///{tmp_path / 'buyer-lock.db'}")
    try:
        async with maker() as first, maker() as second:
            await first.execute(text("BEGIN"))
            await stripe_checkout.lock_booking_buyer(first, "user")
            await second.execute(text("PRAGMA busy_timeout=0"))
            with pytest.raises(HTTPException) as busy:
                await stripe_checkout.lock_booking_buyer(second, "user")
            assert busy.value.status_code == 503
            assert not second.in_transaction()
            await first.rollback()
            buyer = await stripe_checkout.lock_booking_buyer(second, "user")
            assert buyer.credit_balance == 100
            assert await second.scalar(select(func.count()).select_from(Booking)) == 0
    finally:
        await engine.dispose()


@pytest.mark.parametrize("failure", ["deadline", "read_timeout"])
async def test_checkout_transport_timeout_rolls_back_and_does_not_retry(world, monkeypatch, failure):
    calls = []
    stopped = asyncio.Event()

    async def slow_transport(self, request):
        calls.append(request)
        if failure == "read_timeout":
            raise httpx.ReadTimeout("mock transport timed out", request=request)
        try:
            await asyncio.Event().wait()
        finally:
            stopped.set()

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", slow_transport)
    monkeypatch.setattr(stripe_checkout, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(stripe_checkout, "CHECKOUT_TIMEOUT_SECONDS", 0.25)
    response = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(apply_credits=10),
                                       headers=_token("user"))
    assert response.status_code == 503
    assert "Check your scheduled bookings" in response.json()["detail"]
    assert len(calls) == 1
    assert calls[0].headers["Idempotency-Key"].startswith("scheduled_booking_")
    assert set(calls[0].extensions["timeout"].values()) == {0.25}
    if failure == "deadline":
        assert stopped.is_set()
    assert (await world.state())[:3] == (100, 0, 0)
    async with world.maker() as db:
        assert await db.scalar(select(func.count()).select_from(PaymentTransaction)) == 0
        assert await db.scalar(select(func.count()).select_from(BookingParticipant)) == 0


async def test_async_checkout_sends_one_bound_request_and_keeps_the_receipt_on_retry(world, monkeypatch):
    requests = []

    async def accepted(self, request):
        requests.append(request)
        return httpx.Response(200, json={"object": "checkout.session", "id": "session-one",
                                         "url": "https://checkout.example.invalid/one"})

    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", accepted)
    monkeypatch.setattr(stripe_checkout, "STRIPE_API_KEY", "fixture")
    endpoint = "/api/bookings/create-with-stripe"
    payload = card_booking(apply_credits=10, session_date="2031-12-31T21:15:00-05:00")
    first = await world.client.post(endpoint, json=payload, headers=_token("user"))
    repeat = await world.client.post(endpoint, json=payload, headers=_token("user"))
    assert first.status_code == 200 and repeat.status_code == 409
    assert len(requests) == 1 and requests[0].url.path == "/v1/checkout/sessions"
    receipt = first.json()
    fields = parse_qs(requests[0].content.decode())
    assert requests[0].headers["Idempotency-Key"] == f"scheduled_booking_{receipt['booking_id']}"
    assert fields["metadata[booking_id]"] == [receipt["booking_id"]]
    assert fields["metadata[user_id]"] == ["user"]
    assert fields["line_items[0][price_data][unit_amount]"] == ["5000"]
    assert fields["line_items[0][price_data][product_data][description]"] == [
        "Fixture Beach on Jan 01, 2032 at 02:15 AM UTC"
    ]
    assert receipt["session_id"] == "session-one" and receipt["remaining_credits"] == 90
    assert (await world.state())[:3] == (90, 1, 1)
    paid = SimpleNamespace(payment_status="paid", amount_total=5000,
                           metadata={"type": "scheduled_booking", "booking_id": receipt["booking_id"], "user_id": "user"})
    monkeypatch.setattr(stripe_checkout.stripe.checkout.Session, "retrieve", lambda session_id: paid)
    confirmed = await world.client.get("/api/bookings/payment-success", headers=_token("user"),
                                       params={"booking_id": receipt["booking_id"], "session_id": receipt["session_id"]})
    assert confirmed.status_code == 200, confirmed.text
    async with world.maker() as db:
        notes = (await db.scalars(select(Notification))).all()
    assert {note.user_id for note in notes} == {"user", "photog"}
    assert all("Jan 01, 2032 at 02:15 AM (time zone unavailable)" in note.body for note in notes)


@pytest.mark.parametrize("change", [{"duration": -60, "apply_credits": 50}, {"duration": 0}, {"apply_credits": -5},
                                    {"max_participants": 0}])
async def test_the_card_checkout_route_has_the_same_bounds(world, change):
    before = await world.state()
    r = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(**change), headers=_token("user"))
    assert r.status_code == 422, r.text
    assert await world.state() == before


async def test_the_card_checkout_route_refuses_a_negative_price_from_a_negative_rate(world, monkeypatch):
    # Exercise price validation with a configured fake provider; no checkout call may be reached.
    monkeypatch.setattr(stripe_checkout, "STRIPE_API_KEY", "fixture-provider-configured")
    async def unexpected_checkout(**kwargs):
        pytest.fail("Invalid price reached the payment provider")
    monkeypatch.setattr(stripe_checkout, "_create_scheduled_checkout", unexpected_checkout)
    async with world.maker() as db:
        row = (await db.execute(select(Profile).where(Profile.id == "photog"))).scalar_one()
        row.booking_hourly_rate = -50.0
        await db.commit()
    before = await world.state()
    r = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(apply_credits=10),
                                headers=_token("user"))
    assert r.status_code == 400 and "valid price" in r.json()["detail"]
    assert await world.state() == before
