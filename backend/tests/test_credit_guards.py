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

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select, text
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import (AdConfig, Booking, BookingParticipant, CreditTransaction, Notification, Profile, RoleEnum)
from routes.bookings import booking_lifecycle, stripe_checkout
from routes.commerce import ad_controls
from utils.credits import add_credits, clean_amount, deduct_credits

TABLES = (Profile, Booking, BookingParticipant, CreditTransaction, Notification, AdConfig)


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
            yield SimpleNamespace(client=client, maker=maker, state=state)
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


@pytest.mark.parametrize("change", [{"duration": -60, "apply_credits": 50}, {"duration": 0}, {"apply_credits": -5},
                                    {"max_participants": 0}])
async def test_the_card_checkout_route_has_the_same_bounds(world, change):
    before = await world.state()
    r = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(**change), headers=_token("user"))
    assert r.status_code == 422, r.text
    assert await world.state() == before


async def test_the_card_checkout_route_refuses_a_negative_price_from_a_negative_rate(world):
    async with world.maker() as db:
        row = (await db.execute(select(Profile).where(Profile.id == "photog"))).scalar_one()
        row.booking_hourly_rate = -50.0
        await db.commit()
    before = await world.state()
    r = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(apply_credits=10),
                                headers=_token("user"))
    assert r.status_code == 400 and "valid price" in r.json()["detail"]
    assert await world.state() == before
