"""The photographer is paid for what was FUNDED, once; the split editors cannot configure an under-collected total.

(2026-10-25, audit finding F4/F6.) Every confirm path used to credit its own amount: crew-pay 0.80 x total_price,
cover 0.80 x the remaining balance, the scheduler and the expiry route nothing. Combined with a split editor that
only checked the shares summed, a booking could collect less than its price and still pay the photographer
0.80 x the price. These tests run the real handlers (and the real scheduler task) over a real SQLite database with
synthetic users; no live service is touched.
"""
import secrets
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from fastapi import FastAPI
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import async_sessionmaker, create_async_engine

from core import security
from database import get_db
from models import Booking, BookingParticipant, CreditTransaction, Notification, Profile, RoleEnum
from routes.bookings import crew_hub, crew_payments, stripe_checkout
from routes.bookings.split_lock import check_splits
from utils import booking_payout
from utils.booking_payout import funded_cents, photographer_cents, to_cents

NOW = datetime.now(timezone.utc)


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))

    async def no_push(*args, **kwargs):
        return None

    monkeypatch.setattr("routes.notifications.push_payloads.notify_crew_payment_received", no_push)
    monkeypatch.setattr("routes.notifications.push_payloads.notify_crew_session_confirmed", no_push)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CreditTransaction, Notification):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, role, balance in (("captain", RoleEnum.SURFER, 500.0), ("crew1", RoleEnum.SURFER, 500.0),
                                   ("crew2", RoleEnum.SURFER, 500.0), ("photog", RoleEnum.PHOTOGRAPHER, 0.0),
                                   ("outsider", RoleEnum.SURFER, 500.0)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=role,
                           credit_balance=balance))
        db.add(Booking(id="bk", creator_id="captain", photographer_id="photog", location="Fixture Beach",
                       session_date=NOW + timedelta(days=2), total_price=300.0, invite_code="bk", description="x",
                       status="PendingPayment", captain_hold_paid=True))
        db.add(BookingParticipant(booking_id="bk", participant_id="captain", is_captain=True, paid_amount=100.0,
                                  payment_status="Paid", share_amount=100.0))
        for pid in ("crew1", "crew2"):
            db.add(BookingParticipant(booking_id="bk", participant_id=pid, paid_amount=0.0,
                                      payment_status="Pending", share_amount=100.0))
        await db.commit()

    app = FastAPI()
    for router in (crew_payments.router, crew_hub.router, stripe_checkout.router):
        app.include_router(router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    app.dependency_overrides[get_db] = dependency

    async def snap():
        async with maker() as db:
            booking = (await db.execute(select(Booking))).scalar_one()
            balances = dict((await db.execute(select(Profile.id, Profile.credit_balance))).all())
            earnings = (await db.execute(select(CreditTransaction.amount)
                                         .where(CreditTransaction.transaction_type == "booking_earning"))).scalars().all()
            ledger = (await db.execute(select(func.count()).select_from(CreditTransaction))).scalar()
            shares = dict((await db.execute(select(BookingParticipant.participant_id,
                                                    BookingParticipant.share_amount))).all())
        return SimpleNamespace(status=booking.status, balances=balances, earnings=[round(e, 2) for e in earnings],
                               ledger=ledger, shares=shares)

    async def update_booking(**fields):
        async with maker() as db:
            booking = (await db.execute(select(Booking))).scalar_one()
            for key, value in fields.items():
                setattr(booking, key, value)
            await db.commit()

    async def update_participant(pid, **fields):
        async with maker() as db:
            row = (await db.execute(select(BookingParticipant)
                                    .where(BookingParticipant.participant_id == pid))).scalar_one()
            for key, value in fields.items():
                setattr(row, key, value)
            await db.commit()

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, snap=snap, update_booking=update_booking,
                                  update_participant=update_participant, monkeypatch=monkeypatch)
    finally:
        await engine.dispose()


async def pay(world, who):
    return await world.client.post("/api/bookings/bk/crew-pay", headers=_token(who),
                                   json={"participant_id": who, "amount": 100.0})


async def cover(world, who="captain", amount=200.0):
    return await world.client.post("/api/bookings/bk/crew-hub/captain-cover-remaining", headers=_token(who),
                                   json={"captain_id": who, "cover_amount": amount})


# ------------------------------------------------------------------ the arithmetic

def test_the_photographer_share_is_floored_in_whole_cents():
    assert photographer_cents(30000) == 24000 and photographer_cents(3333) == 2666 and photographer_cents(1) == 0
    assert photographer_cents(-5) == 0
    assert to_cents(33.335) in (3333, 3334) and to_cents(None) == 0
    booking = SimpleNamespace(participants=[SimpleNamespace(paid_amount=100.0), SimpleNamespace(paid_amount=0),
                                            SimpleNamespace(paid_amount=33.33)])
    assert funded_cents(booking) == 13333 and funded_cents(booking, 200) == 13533


def test_split_totals_are_compared_in_whole_cents_as_a_sum():
    booking = SimpleNamespace(status="Pending", total_price=100.0)
    members = {"a": 1, "b": 2, "c": 3}
    thirds = [SimpleNamespace(participant_id=k, share_amount=33.3333) for k in members]
    check_splits(booking, members, thirds, required=set(members))  # 99.9999 -> 10000 cents: still the price
    short = [SimpleNamespace(participant_id=k, share_amount=33.33) for k in members]
    with pytest.raises(Exception) as err:
        check_splits(booking, members, short, required=set(members))  # 99.99 -> 9999 cents
    assert err.value.status_code == 400


# ------------------------------------------------------------------ crew-pay

async def test_the_photographer_is_paid_once_on_the_funded_total(world):
    assert (await pay(world, "crew1")).status_code == 200
    mid = await world.snap()
    assert mid.status == "PendingPayment" and mid.earnings == []  # not confirmed, nothing credited yet
    r = await pay(world, "crew2")
    assert r.status_code == 200 and r.json()["booking_status"] == "Confirmed"
    done = await world.snap()
    assert done.status == "Confirmed" and done.earnings == [240.0]  # floor(0.80 x 300), once
    assert done.balances["photog"] == 240.0


async def test_an_under_funded_booking_pays_the_photographer_only_what_was_funded(world):
    """crew2's share is marked covered (the audited under-collection state): nothing was ever debited for it."""
    await world.update_participant("crew2", covered_by_captain=True, covered_amount=100.0, payment_status="Paid")
    r = await pay(world, "crew1")
    assert r.status_code == 200 and r.json()["booking_status"] == "Confirmed"
    done = await world.snap()
    assert done.earnings == [160.0] and done.balances["photog"] == 160.0  # floor(0.80 x 200), NOT 240


async def test_a_replayed_or_late_payment_after_confirmation_pays_nothing_more(world):
    await pay(world, "crew1")
    await pay(world, "crew2")
    before = await world.snap()
    for who in ("crew1", "crew2"):
        assert (await pay(world, who)).status_code == 400
    assert (await world.snap()).__dict__ == before.__dict__


async def test_crew_pay_refuses_a_cancelled_booking(world):
    await world.update_booking(status="Cancelled")
    before = await world.snap()
    r = await pay(world, "crew1")
    assert r.status_code == 400 and "not awaiting payment" in r.json()["detail"]
    assert (await world.snap()).__dict__ == before.__dict__


async def test_a_refused_photographer_credit_rolls_the_whole_payment_back(world):
    async def refuse(*args, **kwargs):
        return False, 0, "refused"

    await pay(world, "crew1")
    world.monkeypatch.setattr(booking_payout, "add_credits", refuse)
    before = await world.snap()
    r = await pay(world, "crew2")
    assert r.status_code == 500
    after = await world.snap()
    assert after.__dict__ == before.__dict__  # crew2 not charged, booking not confirmed, nothing credited


# ------------------------------------------------------------------ cover

async def test_cover_pays_on_the_funded_total_and_only_once(world):
    r = await cover(world)
    assert r.status_code == 200, r.text
    done = await world.snap()
    assert done.status == "Confirmed" and done.balances["captain"] == 300.0     # charged the 200 remaining
    assert done.earnings == [240.0]                                             # 100 funded + 200 covered = 300
    again = await cover(world)
    assert again.status_code == 400
    assert (await world.snap()).__dict__ == done.__dict__                       # no second debit, no second credit


async def test_cover_refuses_a_cancelled_booking(world):
    await world.update_booking(status="Cancelled")
    before = await world.snap()
    r = await cover(world)
    assert r.status_code == 400 and "not awaiting payment" in r.json()["detail"]
    assert (await world.snap()).__dict__ == before.__dict__


async def test_a_refused_cover_debit_leaves_the_booking_awaiting_payment(world):
    async with world.maker() as db:
        row = (await db.execute(select(Profile).where(Profile.id == "captain"))).scalar_one()
        row.credit_balance = 50.0
        await db.commit()
    before = await world.snap()
    r = await cover(world)
    assert r.status_code == 400
    after = await world.snap()
    assert after.status == "PendingPayment" and after.__dict__ == before.__dict__  # the claim rolled back with it


async def test_only_one_path_pays_when_two_paths_confirm(world):
    await pay(world, "crew1")
    await pay(world, "crew2")                                                    # crew-pay confirms and pays
    before = await world.snap()
    r = await world.client.post("/api/bookings/bk/crew-hub/handle-expiry", headers=_token("captain"))
    assert r.status_code == 200
    assert (await world.snap()).__dict__ == before.__dict__ and before.earnings == [240.0]


async def test_the_expiry_route_confirms_a_fully_paid_booking_and_pays_on_the_funded_basis(world):
    await world.update_participant("crew1", paid_amount=100.0, payment_status="Paid")
    await world.update_participant("crew2", paid_amount=100.0, payment_status="Paid")
    r = await world.client.post("/api/bookings/bk/crew-hub/handle-expiry", headers=_token("captain"))
    assert r.status_code == 200
    done = await world.snap()
    assert done.status == "Confirmed" and done.earnings == [240.0]


async def test_the_scheduler_confirms_and_pays_on_the_funded_basis_once(world):
    from scheduler import bookings as scheduled

    world.monkeypatch.setattr("database.async_session_maker", world.maker)
    await world.update_booking(payment_window_expires_at=NOW - timedelta(minutes=5))
    await world.update_participant("crew1", paid_amount=100.0, payment_status="Paid")
    await world.update_participant("crew2", covered_by_captain=True, covered_amount=100.0, payment_status="Paid")
    await scheduled.check_payment_window_expiry_task()
    first = await world.snap()
    assert first.status == "Confirmed" and first.earnings == [160.0]            # 200 funded of 300
    await scheduled.check_payment_window_expiry_task()
    assert (await world.snap()).__dict__ == first.__dict__                       # a second run pays nothing


# ------------------------------------------------------------------ crew-hub update-splits

def hub(splits, captain_share=100.0):
    return {"captain_id": "captain", "captain_share": captain_share,
            "splits": [{"participant_id": pid, "share_amount": amt, "share_percentage": 0.0} for pid, amt in splits]}


async def hub_post(world, payload, who="captain"):
    return await world.client.post("/api/bookings/bk/crew-hub/update-splits", headers=_token(who), json=payload)


@pytest.mark.parametrize("payload", [
    hub([("crew1", 100.0), ("crew2", 100.0), ("ghost", 0.0)]),            # unknown id
    hub([("crew1", 100.0), ("crew1", 100.0), ("crew2", 0.0)]),            # duplicate
    hub([("crew1", 250.0), ("crew2", -50.0)]),                            # offsetting negative
    hub([("crew1", 150.0)]),                                              # crew2 missing: stale share would remain
    hub([("crew1", 100.0), ("crew2", 100.0)], captain_share=-0.0 + 50.0), # total 250 != 300
    hub([("crew1", 100.0), ("crew2", 100.0)], captain_share=-100.0),      # negative captain share (total 100)
])
async def test_crew_hub_splits_refuse_bad_shapes_and_change_nothing(world, payload):
    before = await world.snap()
    r = await hub_post(world, payload)
    assert r.status_code == 400, r.text
    assert (await world.snap()).__dict__ == before.__dict__


async def test_crew_hub_splits_refuse_nan_and_infinity(world):
    before = await world.snap()
    for raw in ("NaN", "Infinity", "-Infinity"):
        text = ('{"captain_id": "captain", "captain_share": 100.0, "splits": [{"participant_id": "crew1", '
                '"share_amount": %s, "share_percentage": 0.0}, {"participant_id": "crew2", "share_amount": 100.0, '
                '"share_percentage": 0.0}]}' % raw)
        r = await world.client.post("/api/bookings/bk/crew-hub/update-splits", content=text,
                                    headers={**_token("captain"), "content-type": "application/json"})
        assert r.status_code >= 400
    assert (await world.snap()).__dict__ == before.__dict__


@pytest.mark.parametrize("status", ["Confirmed", "Cancelled", "Completed"])
async def test_both_split_editors_only_work_while_the_booking_awaits_payment(world, status):
    await world.update_booking(status=status)
    before = await world.snap()
    r = await hub_post(world, hub([("crew1", 100.0), ("crew2", 100.0)]))
    assert r.status_code == 400 and "awaits payment" in r.json()["detail"]
    legacy = await world.client.post(
        "/api/bookings/bk/update-splits", headers=_token("captain"),
        json={"splits": [{"participant_id": p, "share_amount": 100.0} for p in ("captain", "crew1", "crew2")]})
    assert legacy.status_code == 400 and "awaits payment" in legacy.json()["detail"]
    assert (await world.snap()).__dict__ == before.__dict__


async def test_a_valid_crew_hub_split_still_saves(world):
    r = await hub_post(world, hub([("crew1", 150.0), ("crew2", 50.0)]))
    assert r.status_code == 200, r.text
    assert (await world.snap()).shares["crew1"] == 150.0 and (await world.snap()).shares["crew2"] == 50.0
    # also in PendingPayment-before-hold ("Pending") bookings, which is where the captain edits them first
    await world.update_booking(status="Pending")
    assert (await hub_post(world, hub([("crew1", 120.0), ("crew2", 80.0)]))).status_code == 200


# ------------------------------------------------------------------ a lost claim pays nothing

async def test_cover_that_loses_the_claim_charges_nobody(world):
    """A concurrent confirm won the claim between this request's load and its claim: no debit, no credit."""
    async def lost(db, booking_id):
        return False

    world.monkeypatch.setattr("routes.bookings.crew_hub.claim_confirmation", lost)
    before = await world.snap()
    r = await cover(world)
    assert r.status_code == 409
    assert (await world.snap()).__dict__ == before.__dict__


async def test_crew_pay_that_loses_the_claim_credits_the_photographer_nothing(world):
    async def lost(db, booking_id):
        return False

    await pay(world, "crew1")
    world.monkeypatch.setattr(booking_payout, "claim_confirmation", lost)
    r = await pay(world, "crew2")
    assert r.status_code == 200 and r.json()["booking_status"] != "Confirmed"
    after = await world.snap()
    assert after.earnings == [] and after.status == "PendingPayment"
