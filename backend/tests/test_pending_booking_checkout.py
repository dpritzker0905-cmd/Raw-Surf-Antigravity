"""Buyer recovery after discarding the create response; real routes, local DB, mocked Stripe transport."""
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
import pytest_asyncio
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from models import Booking, BookingParticipant, CreditTransaction, PaymentTransaction
from routes.bookings import pending_checkout, stripe_checkout
from tests.test_credit_guards import _token, card_booking, checkout_calls, world


@pytest.mark.parametrize("stored,provider,status", [("USD", "usd", 200), ("", "usd", 409),
                                                   ("USD", "eur", 409), ("eur", "usd", 409)])
async def test_recovery_checks_legacy_currency_against_provider(recovery, stored, provider, status):
    async with recovery.world.maker.begin() as db:
        (await db.scalar(select(PaymentTransaction))).currency = stored
    recovery.session["currency"] = provider
    assert (await recovery.act("resume")).status_code == status


async def test_expiry_rechecks_stale_booking_before_refunding(recovery, monkeypatch):
    # Generic cancellation and the scheduler both enter this helper with an ORM object
    # loaded earlier. A previous cancellation can leave its receipt marked Pending.
    async with recovery.world.maker() as db:
        booking = await db.scalar(select(Booking).options(selectinload(Booking.participants)))
        await db.commit()
        async with recovery.world.maker.begin() as winner:
            (await winner.get(Booking, recovery.booking)).status = "Cancelled"
        def unexpected(*args, **kwargs):
            pytest.fail("Terminal booking must stop before contacting the provider")
        monkeypatch.setattr(stripe_checkout.stripe.checkout.Session, "retrieve", unexpected)
        assert not await stripe_checkout.reconcile_expired_booking_checkout(booking, db)


@pytest.mark.parametrize("legacy", [False, True])
async def test_duplicate_paid_events_leave_scheduled_settlement_to_recovery(recovery, monkeypatch, legacy):
    from routes.subscriptions_billing import payments

    r = recovery
    if legacy:
        async with r.world.maker.begin() as db:
            receipt = await db.scalar(select(PaymentTransaction))
            metadata = json.loads(receipt.transaction_metadata)
            del metadata["type"]
            receipt.transaction_metadata = json.dumps(metadata)
    r.world.app.include_router(payments.router, prefix="/api")
    monkeypatch.setattr(payments, "STRIPE_API_KEY", object())
    monkeypatch.setattr(payments.StripeCheckout, "__init__", lambda self, api_key, webhook_url: None)
    signing_secret = secrets.token_hex(32)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", signing_secret)
    r.session.update(status="complete", payment_status="paid")
    body = json.dumps({"type": "checkout.session.completed", "data": {"object": r.session}}).encode()
    timestamp = str(int(time.time()))
    signature = hmac.new(signing_secret.encode(), timestamp.encode() + b"." + body, hashlib.sha256).hexdigest()

    async def deliver():
        response = await r.world.client.post("/api/webhook/stripe", content=body,
                                             headers={"Stripe-Signature": f"t={timestamp},v1={signature}"})
        assert response.status_code == 200, response.text

    await deliver()
    assert (await r.world.state())[:3] == (90, 1, 1)
    assert (await r.act("resume")).json()["status"] == "Confirmed"
    await deliver()
    assert (await r.act("resume")).json() == {"status": "Confirmed"}
    assert (await r.world.state())[:3] == (90, 3, 1)


@pytest_asyncio.fixture
async def recovery(world, checkout_calls, monkeypatch, request):
    world.app.include_router(pending_checkout.router, prefix="/api")
    credits = getattr(request, "param", 10)
    created = await world.client.post("/api/bookings/create-with-stripe", json=card_booking(apply_credits=credits),
                                      headers=_token("user"))
    assert created.status_code == 200
    # A newly opened Scheduled Bookings screen only knows the persisted booking ID.
    async with world.maker() as db:
        booking_id = await db.scalar(select(Booking.id))
    session = {"object": "checkout.session", "id": "session-1", "mode": "payment", "currency": "usd",
               "status": "open", "payment_status": "unpaid", "amount_total": (60 - credits) * 100,
               "url": "https://checkout.stripe.com/c/pay/original",
               "metadata": {"type": "scheduled_booking", "user_id": "user", "booking_id": booking_id}}
    calls = []
    provider = SimpleNamespace(race=False, unavailable=False, lose_expiry=False, mismatched_reread=False)

    async def transport(self, request):
        calls.append((request.method, request.url.path))
        assert request.url.host == "api.stripe.com"
        if provider.unavailable:
            raise httpx.ReadTimeout("fixture")
        if request.method == "POST":
            assert request.url.path == "/v1/checkout/sessions/session-1/expire"
            assert request.headers["Idempotency-Key"] == "cancel_scheduled_checkout_session-1"
            if provider.race:
                session.update(status="complete", payment_status="paid")
                if provider.mismatched_reread:
                    session["currency"] = "eur"
                return httpx.Response(400, json={"error": {"message": "already completed"}})
            session["status"] = "expired"
            if provider.lose_expiry:
                provider.unavailable = True
                raise httpx.ReadTimeout("expiry response lost")
        else:
            assert request.url.path == "/v1/checkout/sessions/session-1"
        return httpx.Response(200, json=session)

    monkeypatch.setattr(stripe_checkout, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(httpx.AsyncHTTPTransport, "handle_async_request", transport)

    async def act(action, user="user"):
        return await world.client.post(f"/api/bookings/{booking_id}/pending-checkout",
                                      json={"action": action}, headers=_token(user))
    return SimpleNamespace(act=act, session=session, calls=calls, provider=provider, booking=booking_id,
                           creates=checkout_calls, world=world)


async def test_resume_then_cancel_one_original_checkout(recovery):
    r = recovery
    for _ in range(2):
        resumed = await r.act("resume")
        assert resumed.status_code == 200 and resumed.json() == {"status": "open", "checkout_url": r.session["url"]}
    for _ in range(2):
        cancelled = await r.act("cancel")
        assert cancelled.status_code == 200 and cancelled.json() == {"status": "Cancelled"}
    assert len(r.creates) == 1 and [method for method, _ in r.calls].count("POST") == 1
    assert (await r.world.state())[:3] == (100, 2, 1)
    async with r.world.maker() as db:
        rows = (await db.scalars(select(CreditTransaction).order_by(CreditTransaction.amount))).all()
        assert rows[1].refund_of_transaction_id == rows[0].id
        assert await db.scalar(select(BookingParticipant.paid_amount)) == 0
        assert await db.scalar(select(PaymentTransaction.payment_status)) == "expired"


async def test_cancel_racing_payment_confirms_without_refund(recovery):
    r = recovery
    r.provider.race = True
    result = await r.act("cancel")
    assert result.status_code == 200 and result.json()["status"] == "Confirmed"
    assert (await r.act("cancel")).json() == {"status": "Confirmed"}
    assert [method for method, _ in r.calls] == ["GET", "POST", "GET"]
    async with r.world.maker() as db:
        assert await db.scalar(select(BookingParticipant.paid_amount)) == 60
        assert await db.scalar(select(func.count()).where(CreditTransaction.transaction_type == "booking_refund")) == 0
    assert (await r.world.state())[:3] == (90, 3, 1)


async def test_lost_expiry_response_recovers_on_explicit_retry(recovery):
    r = recovery
    r.provider.lose_expiry = True
    assert (await r.act("cancel")).status_code == 503
    assert (await r.world.state())[:3] == (90, 1, 1)
    r.provider.unavailable = False
    assert (await r.act("resume")).status_code == 409
    assert (await r.act("cancel")).json() == {"status": "Cancelled"}
    assert (await r.world.state())[:3] == (100, 2, 1)
    assert [method for method, _ in r.calls].count("POST") == 1


async def test_raced_payment_is_reverified_before_settlement(recovery):
    r = recovery
    r.provider.race = r.provider.mismatched_reread = True
    assert (await r.act("cancel")).status_code == 409
    assert [method for method, _ in r.calls] == ["GET", "POST", "GET"]
    assert (await r.world.state())[:3] == (90, 1, 1)


async def test_resume_settles_an_already_paid_checkout_after_local_deadline(recovery):
    r = recovery
    async with r.world.maker.begin() as db:
        (await db.get(Booking, r.booking)).pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    r.session.update(status="complete", payment_status="paid")
    assert (await r.act("resume")).json()["status"] == "Confirmed"
    assert (await r.act("resume")).json() == {"status": "Confirmed"}
    assert [method for method, _ in r.calls] == ["GET"]
    assert (await r.world.state())[:3] == (90, 3, 1)


async def test_only_owner_can_recover_and_local_deadline_limits_resume(recovery):
    r = recovery
    assert (await r.act("resume", "photog")).status_code == 404
    assert (await r.act("cancel", "photog")).status_code == 404
    assert not r.calls
    async with r.world.maker.begin() as db:
        (await db.get(Booking, r.booking)).pending_payment_expires_at = datetime.now(timezone.utc) - timedelta(minutes=1)
    assert (await r.act("resume")).status_code == 409
    assert (await r.act("cancel")).json() == {"status": "Cancelled"}


@pytest.mark.parametrize("field,value", [("amount_total", 1), ("currency", "eur"), ("id", "different"),
                                        ("metadata", {"type": "other"}), ("mode", "subscription")])
async def test_provider_mismatch_cannot_expire_or_resume(recovery, field, value):
    r = recovery
    r.session[field] = value
    assert (await r.act("resume")).status_code == 409
    assert (await r.act("cancel")).status_code == 409
    assert [method for method, _ in r.calls] == ["GET", "GET"]
    assert (await r.world.state())[:3] == (90, 1, 1)


@pytest.mark.parametrize("recovery", [0], indirect=True)
async def test_cancellation_requires_the_original_reservation_debit(recovery):
    r = recovery
    # Simulate an inconsistent historical participant record, preserving ledger immutability.
    async with r.world.maker.begin() as db:
        (await db.get(Booking, r.booking)).total_price = 70
        (await db.scalar(select(BookingParticipant))).paid_amount = 10
    assert (await r.act("cancel")).status_code == 409
    assert (await r.world.state())[:3] == (100, 0, 1)
    assert not r.calls
    async with r.world.maker() as db:
        assert (await db.get(Booking, r.booking)).status == "Pending Payment"


async def test_ambiguous_receipts_do_not_contact_provider(recovery):
    r = recovery
    async with r.world.maker.begin() as db:
        original = await db.scalar(select(PaymentTransaction))
        db.add(PaymentTransaction(user_id="user", amount=50, session_id="another-session",
                                  payment_status="Pending", transaction_metadata=original.transaction_metadata))
    assert (await r.act("resume")).status_code == 409
    assert (await r.act("cancel")).status_code == 409
    assert not r.calls


@pytest.mark.parametrize("recovery", [0], indirect=True)
async def test_zero_reserved_credits_cancel_without_creating_a_ledger_entry(recovery):
    assert (await recovery.act("cancel")).json() == {"status": "Cancelled"}
    assert (await recovery.world.state())[:3] == (100, 0, 1)


@pytest.mark.parametrize("committed", [False, True], ids=["before-commit", "lost-commit-ack"])
async def test_retry_after_local_commit_error_refunds_the_original_debit_once(recovery, monkeypatch, committed):
    r = recovery
    commit = AsyncSession.commit

    async def interrupted(db):
        await db.flush()
        if committed:
            await commit(db)
        raise RuntimeError("synthetic commit interruption")

    with monkeypatch.context() as patch:
        patch.setattr(AsyncSession, "commit", interrupted)
        assert (await r.act("cancel")).status_code == 500
    assert (await r.world.state())[:3] == ((100, 2, 1) if committed else (90, 1, 1))
    assert r.session["status"] == "expired"
    assert (await r.act("cancel")).json() == {"status": "Cancelled"}
    assert (await r.world.state())[:3] == (100, 2, 1)
    async with r.world.maker() as db:
        debit, refund = (await db.scalars(select(CreditTransaction).order_by(CreditTransaction.amount))).all()
        assert refund.refund_of_transaction_id == debit.id
