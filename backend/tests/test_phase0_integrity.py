"""Phase 0 booking / payout / refund integrity fixes (2026-10-26), against a real SQLite database over HTTP + JWT.

Found by the read-only mapping of the booking, payout and refund code; every finding was re-read at current dev
before changing anything.

  1. `POST /dispatch/{id}/complete` and `/remind-crew` trusted a plain id in the request: now bound to the token
     (registered in tests/test_actor_route_binding.py).
  2. `PATCH /bookings/{id}/status` let either party set Cancelled / Completed / Confirmed / Pending on any booking
     with no money handling.
  3. The admin dispute refund built a ledger row with a column that does not exist (TypeError) and the admin
     refund-request approval wrote a row that cannot be inserted and never moved the balance.
  4. Nothing stopped a refund being credited to the seller of the transaction it refunds.
  5. The 2-hour / 30-minute session reminders called the push helper with keywords it does not take, and swallowed
     the error, so no reminder was ever sent.
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
from deps.admin_auth import get_current_admin
from models import (AuditLog, Booking, BookingParticipant, CreditTransaction, Dispute, Notification, Profile,
                    RefundRequest, RefundStatusEnum, RoleEnum)
from routes.admin import finance, moderation
from routes.photographer import bookings as photographer_bookings

NOW = datetime.now(timezone.utc)


def _token(sub):
    return {"Authorization": "Bearer " + security.create_access_token({"sub": sub})}


@pytest_asyncio.fixture
async def world(monkeypatch):
    monkeypatch.setattr(security, "SECRET_KEY", secrets.token_urlsafe(48))

    async def no_push(*args, **kwargs):
        return None

    monkeypatch.setattr("routes.notifications.push_payloads.notify_booking", no_push)
    engine = create_async_engine("sqlite+aiosqlite:///:memory:")
    async with engine.begin() as connection:
        for model in (Profile, Booking, BookingParticipant, CreditTransaction, Notification, Dispute, RefundRequest,
                      AuditLog):
            await connection.run_sync(lambda conn, table=model.__table__: table.create(conn))
    maker = async_sessionmaker(engine, expire_on_commit=False)
    async with maker() as db:
        for pid, role in (("buyer", RoleEnum.SURFER), ("other", RoleEnum.SURFER), ("photog", RoleEnum.PHOTOGRAPHER),
                          ("admin", RoleEnum.SURFER)):
            db.add(Profile(id=pid, user_id=pid, email=pid + "@example.invalid", full_name=pid, role=role,
                           credit_balance=100.0))
        db.add(Booking(id="bk", creator_id="buyer", photographer_id="photog", location="Fixture Beach",
                       session_date=NOW + timedelta(days=5), total_price=100.0, invite_code="bk", description="x",
                       status="Pending"))
        db.add(BookingParticipant(booking_id="bk", participant_id="buyer", paid_amount=100.0, payment_status="Paid",
                                  share_amount=100.0))
        await db.commit()

    app = FastAPI()
    for router in (photographer_bookings.router, finance.router, moderation.router):
        app.include_router(router, prefix="/api")

    async def dependency():
        async with maker() as db:
            yield db

    async def admin():
        return SimpleNamespace(id="admin", email="admin@example.invalid")

    app.dependency_overrides[get_db] = dependency
    app.dependency_overrides[get_current_admin] = admin

    async def snap():
        async with maker() as db:
            booking = (await db.execute(select(Booking))).scalar_one()
            balances = dict((await db.execute(select(Profile.id, Profile.credit_balance))).all())
            ledger = (await db.execute(select(func.count()).select_from(CreditTransaction))).scalar()
        return SimpleNamespace(status=booking.status, escrow=booking.escrow_status, balances=balances, ledger=ledger)

    async def set_booking(**fields):
        async with maker() as db:
            row = (await db.execute(select(Booking))).scalar_one()
            for key, value in fields.items():
                setattr(row, key, value)
            await db.commit()

    transport = httpx.ASGITransport(app=app, raise_app_exceptions=False)
    try:
        async with httpx.AsyncClient(transport=transport, base_url="http://fixture.invalid") as client:
            yield SimpleNamespace(client=client, maker=maker, snap=snap, set_booking=set_booking,
                                  monkeypatch=monkeypatch)
    finally:
        await engine.dispose()


# ------------------------------------------------------------------ 2. PATCH /bookings/{id}/status

async def patch_status(world, who, status):
    return await world.client.patch("/api/bookings/bk/status", headers=_token(who), json={"status": status})


@pytest.mark.parametrize("who,status", [("buyer", "Completed"), ("photog", "Completed"), ("buyer", "Pending"),
                                        ("photog", "Pending")])
async def test_the_status_route_no_longer_sets_completed_or_pending(world, who, status):
    before = await world.snap()
    r = await patch_status(world, who, status)
    assert r.status_code == 400, r.text
    assert (await world.snap()).__dict__ == before.__dict__


async def test_only_the_photographer_can_confirm_and_only_a_request_waiting_for_it(world):
    before = await world.snap()
    assert (await patch_status(world, "buyer", "Confirmed")).status_code == 403   # the creator cannot self-confirm
    assert (await patch_status(world, "other", "Confirmed")).status_code == 403   # a stranger certainly cannot
    assert (await world.snap()).__dict__ == before.__dict__
    for status in ("Cancelled", "Confirmed", "PendingPayment", "Completed"):
        await world.set_booking(status=status)
        r = await patch_status(world, "photog", "Confirmed")
        assert r.status_code == 400, (status, r.text)
    await world.set_booking(status="Pending Acceptance")
    ok = await patch_status(world, "photog", "Confirmed")
    assert ok.status_code == 200 and (await world.snap()).status == "Confirmed"


async def test_cancelling_through_the_status_route_goes_through_the_refund_path(world):
    await world.set_booking(escrow_status="held", escrow_amount=80.0)
    r = await patch_status(world, "buyer", "Cancelled")
    assert r.status_code == 200, r.text
    done = await world.snap()
    assert done.status == "Cancelled" and done.escrow == "refunded"
    assert done.balances["buyer"] == 190.0 and done.ledger == 1       # >48 h before the session: 90% of 100 back
    again = await patch_status(world, "buyer", "Cancelled")
    assert again.status_code == 400                                      # no second refund
    assert (await world.snap()).balances["buyer"] == 190.0


async def test_a_stranger_cannot_cancel_through_the_status_route(world):
    before = await world.snap()
    assert (await patch_status(world, "other", "Cancelled")).status_code == 403
    assert (await world.snap()).__dict__ == before.__dict__


# ------------------------------------------------------------------ 3 + 4. refund requests

async def make_refund(world, user_id, amount=25.0, **extra):
    async with world.maker() as db:
        refund = RefundRequest(user_id=user_id, amount=amount, reason="fixture", **extra)
        db.add(refund)
        await db.commit()
        return refund.id


async def refund_state(world, refund_id):
    async with world.maker() as db:
        return (await db.execute(select(RefundRequest.status).where(RefundRequest.id == refund_id))).scalar_one()


async def process(world, refund_id, action="approve"):
    return await world.client.post(f"/api/admin/finance/refunds/{refund_id}/process", json={"action": action})


async def test_an_approved_refund_moves_the_balance_and_writes_a_complete_ledger_row(world):
    rid = await make_refund(world, "buyer", booking_id="bk")
    r = await process(world, rid)
    assert r.status_code == 200, r.text
    assert await refund_state(world, rid) == RefundStatusEnum.COMPLETED
    done = await world.snap()
    assert done.balances["buyer"] == 125.0 and done.ledger == 1
    async with world.maker() as db:
        row = (await db.execute(select(CreditTransaction))).scalar_one()
    assert (row.transaction_type, row.amount, row.balance_before, row.balance_after) == ("refund", 25.0, 100.0, 125.0)
    assert (row.reference_type, row.reference_id) == ("refund_request", rid)


async def test_a_refund_cannot_be_approved_twice(world):
    rid = await make_refund(world, "buyer", booking_id="bk")
    assert (await process(world, rid)).status_code == 200
    again = await process(world, rid)
    assert again.status_code == 400
    assert (await world.snap()).balances["buyer"] == 125.0


async def test_a_refund_to_the_seller_of_the_booking_is_refused_and_stays_pending(world):
    before = await world.snap()
    rid = await make_refund(world, "photog", booking_id="bk")
    r = await process(world, rid)
    assert r.status_code == 400 and "seller" in r.json()["detail"]
    assert await refund_state(world, rid) == RefundStatusEnum.PENDING
    assert (await world.snap()).__dict__ == before.__dict__


async def test_a_refund_to_the_counterparty_of_the_original_ledger_row_is_refused(world):
    async with world.maker() as db:
        tx = CreditTransaction(user_id="buyer", amount=-100.0, balance_before=200.0, balance_after=100.0,
                               transaction_type="booking_payment", counterparty_id="photog")
        db.add(tx)
        await db.commit()
        tx_id = tx.id
    rid = await make_refund(world, "photog", transaction_id=tx_id)
    r = await process(world, rid)
    assert r.status_code == 400 and "seller" in r.json()["detail"]
    assert await refund_state(world, rid) == RefundStatusEnum.PENDING
    # the payer of the same transaction is refunded normally
    ok = await process(world, await make_refund(world, "buyer", transaction_id=tx_id))
    assert ok.status_code == 200


async def test_a_photographer_who_also_paid_into_the_booking_can_be_refunded_that_payment(world):
    async with world.maker() as db:
        db.add(BookingParticipant(booking_id="bk", participant_id="photog", paid_amount=10.0, payment_status="Paid"))
        await db.commit()
    r = await process(world, await make_refund(world, "photog", amount=10.0, booking_id="bk"))
    assert r.status_code == 200
    assert (await world.snap()).balances["photog"] == 110.0


@pytest.mark.parametrize("amount", [0.0, -5.0])  # (a NaN cannot be stored in the amount column at all)
async def test_a_refund_amount_must_be_a_positive_number(world, amount):
    rid = await make_refund(world, "buyer", amount=amount, booking_id="bk")
    before = await world.snap()
    r = await process(world, rid)
    assert r.status_code == 400
    assert await refund_state(world, rid) == RefundStatusEnum.PENDING
    assert (await world.snap()).__dict__ == before.__dict__


async def test_rejecting_a_refund_still_works_and_credits_nobody(world):
    rid = await make_refund(world, "photog", booking_id="bk")
    r = await world.client.post(f"/api/admin/finance/refunds/{rid}/process",
                                json={"action": "reject", "rejection_reason": "no"})
    assert r.status_code == 200 and await refund_state(world, rid) == RefundStatusEnum.REJECTED
    assert (await world.snap()).ledger == 0


# ------------------------------------------------------------------ 3 + 4. dispute resolution refund

async def make_dispute(world, complainant="buyer", respondent="photog", **extra):
    async with world.maker() as db:
        dispute = Dispute(complainant_id=complainant, respondent_id=respondent, dispute_type="payment", subject="s",
                          description="d", status="open", **extra)
        db.add(dispute)
        await db.commit()
        return dispute.id


async def resolve(world, dispute_id, amount):
    return await world.client.put(f"/api/admin/disputes/{dispute_id}",
                                  json={"status": "resolved_refund", "amount_refunded": amount})


async def test_resolving_a_dispute_with_a_refund_credits_the_complainant_and_writes_a_complete_row(world):
    did = await make_dispute(world, booking_id="bk")
    r = await resolve(world, did, 20.0)
    assert r.status_code == 200, r.text
    done = await world.snap()
    assert done.balances["buyer"] == 120.0 and done.ledger == 1
    async with world.maker() as db:
        row = (await db.execute(select(CreditTransaction))).scalar_one()
        dispute = (await db.execute(select(Dispute))).scalar_one()
    assert (row.transaction_type, row.amount, row.balance_before, row.balance_after) == ("dispute_refund", 20.0,
                                                                                         100.0, 120.0)
    assert (row.reference_type, row.reference_id) == ("dispute", did)
    assert dispute.amount_refunded == 20.0 and dispute.status == "resolved_refund"


async def test_a_dispute_refund_cannot_go_to_the_seller_or_the_other_side(world):
    before = await world.snap()
    seller = await make_dispute(world, complainant="photog", respondent="buyer", booking_id="bk")
    r = await resolve(world, seller, 20.0)
    assert r.status_code == 400 and "seller" in r.json()["detail"]
    same = await make_dispute(world, complainant="other", respondent="other")
    r2 = await resolve(world, same, 20.0)
    assert r2.status_code == 400
    assert (await world.snap()).__dict__ == before.__dict__
    async with world.maker() as db:
        statuses = set((await db.execute(select(Dispute.status))).scalars().all())
    assert statuses == {"open"}                                             # the refusal changed nothing


async def test_a_non_finite_dispute_refund_is_refused(world):
    did = await make_dispute(world, booking_id="bk")
    before = await world.snap()
    for raw in ("NaN", "Infinity"):
        r = await world.client.put(
            f"/api/admin/disputes/{did}", headers={"content-type": "application/json"},
            content='{"status": "resolved_refund", "amount_refunded": %s}' % raw)
        assert r.status_code == 400, (raw, r.status_code)
    assert (await world.snap()).__dict__ == before.__dict__


# ------------------------------------------------------------------ 5. session reminders

async def test_the_session_reminders_really_call_the_push_helper_with_its_real_signature(world):
    from scheduler import bookings as scheduled

    sent = []

    # The REAL signature of routes.notifications.push.send_push_notification: a wrong keyword raises TypeError
    # exactly as it does in production (the old call passed body= and db=, and the try/except hid it).
    async def push(user_id, title, message, data={}, action_url=None, urgent=True):
        sent.append((user_id, title, message))
        return {"status": "ok"}

    world.monkeypatch.setattr("routes.notifications.push.send_push_notification", push)
    world.monkeypatch.setattr("database.async_session_maker", world.maker)
    async with world.maker() as db:
        for bid, minutes in (("two-hour", 120), ("half-hour", 30)):
            db.add(Booking(id=bid, creator_id="buyer", photographer_id="photog", location="Fixture Beach",
                           session_date=datetime.now(timezone.utc) + timedelta(minutes=minutes), total_price=50.0,
                           invite_code=bid, description="x", status="Confirmed"))
        await db.commit()

    await scheduled.send_session_reminders_task()

    assert sorted({(u, t) for u, t, _m in sent}) == sorted([
        ("buyer", "Session in 2 Hours!"), ("photog", "Session in 2 Hours!"),
        ("buyer", "Session Starting Soon!"), ("photog", "Session Starting Soon!")])
    async with world.maker() as db:
        reminders = (await db.execute(select(Notification).where(Notification.type == "session_reminder"))).scalars().all()
    assert len(reminders) == 4
