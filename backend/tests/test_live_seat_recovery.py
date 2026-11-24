"""Paid checkouts settle without a browser. No live providers are used."""
import asyncio
import hashlib
import hmac
import json
import secrets
import time
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import httpx
import pytest
from fastapi import FastAPI
from sqlalchemy import select

from database import get_db
from models import LiveSession, LiveSessionParticipant, PaymentTransaction, Profile, SupportTicket
from routes.notifications import push_payloads
from routes.sessions import payments
from routes.subscriptions_billing import payments as billing
from scheduler.live_seats import recover_live_seats
from tests.test_live_session_escrow import bearer, harness


@pytest.mark.parametrize("case", ["duplicate", "sweep", "closed", "refund_pending", "legacy_completed",
                                   "unpaid", "expired", "cleanup", "emulator", "delayed_row",
                                   "legacy_fulfilled", "legacy_ambiguous", "historical_closed", "missing_resource", "bad_signature", "provider_outage"])
async def test_unattended_live_seat(harness, monkeypatch, case):
    await check_outcome(harness, monkeypatch, case)


async def check_outcome(harness, monkeypatch, case):
    checkout_id = "synthetic-checkout"
    metadata = {"type": "live_session_join", "surfer_id": "owner", "photographer_id": "pro",
                "live_session_id": "original", "amount": "25"}
    secret = secrets.token_hex(32)
    monkeypatch.setenv("STRIPE_WEBHOOK_SECRET", secret)
    monkeypatch.setattr(billing, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "fixture")
    receipt = SimpleNamespace(id=checkout_id, mode="payment", client_reference_id="reference",
                              payment_status="unpaid" if case in ("unpaid", "expired") else "paid", amount_total=2500,
                              status={"unpaid": "open", "expired": "expired"}.get(case, "complete"), currency="usd",
                              payment_intent="intent", metadata=metadata)
    retrieve = Mock(return_value=receipt)
    if case == "missing_resource":
        retrieve.side_effect = payments.stripe.error.InvalidRequestError("fixture missing", "id", code="resource_missing")
    monkeypatch.setattr(payments.stripe.checkout.Session, "retrieve", retrieve)
    refunds = Mock(return_value=SimpleNamespace(data=[]))
    monkeypatch.setattr(payments.stripe.Refund, "list", refunds)
    refund = Mock(return_value=SimpleNamespace(status="pending" if case == "refund_pending" else "succeeded"))
    monkeypatch.setattr(payments.stripe.Refund, "create", refund)
    monkeypatch.setattr(push_payloads, "notify_session_join", AsyncMock())
    async with harness.maker() as db:
        closed = case in ("closed", "refund_pending", "historical_closed")
        db.add(LiveSession(id="original", photographer_id="pro", status="ended" if closed else "active"))
        state = "Completed" if case in ("legacy_completed", "legacy_fulfilled", "legacy_ambiguous") else "Pending"
        age = timedelta(days=30) if case == "historical_closed" else timedelta(hours=1)
        transaction = PaymentTransaction(user_id="owner", session_id=checkout_id, amount=25, currency="usd",
            status=state, payment_status=state, created_at=datetime.now(timezone.utc)-age,
            updated_at=datetime.now(timezone.utc)-timedelta(minutes=10),
            transaction_metadata=json.dumps({**metadata, "checkout_provider": "emulator" if case == "emulator" else "stripe", "checkout_reference":"reference"}))
        if case != "delayed_row":
            db.add(transaction)
        if case in ("legacy_fulfilled", "legacy_ambiguous"):
            await db.flush()
            db.add(LiveSessionParticipant(id="prior-seat", live_session_id="original", photographer_id="pro",
                surfer_id="owner", payment_method="card", amount_paid=25, status="completed"))
            if case == "legacy_ambiguous":
                db.add(PaymentTransaction(user_id="owner", session_id="different-checkout", amount=25,
                    payment_status="Refunded", status="Refunded", transaction_metadata=json.dumps(metadata)))
        await db.commit()

    app = FastAPI()
    app.include_router(billing.router, prefix="/api")
    async def database():
        async with harness.maker() as db:
            yield db
    app.dependency_overrides[get_db] = database
    event = {"id": "evt_synthetic", "object": "event", "type": "checkout.session.completed",
             "data": {"object": {"id": checkout_id, "metadata": metadata, "payment_status": "paid"}}}
    body = json.dumps(event).encode()
    timestamp = str(int(time.time()))
    digest = hmac.new(secret.encode(), timestamp.encode()+b"."+body, hashlib.sha256).hexdigest()
    headers = {"Stripe-Signature": f"t={timestamp},v1={digest if case != 'bad_signature' else 'incorrect'}"}
    async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url="http://fixture.invalid") as client:
        async def event_post():
            return await client.post("/api/webhook/stripe", content=body, headers=headers)
        if case == "race":
            browser, hook, _ = await asyncio.gather(harness.client.post("/api/sessions/complete-payment",
                headers=bearer("owner"), json={"checkout_session_id":checkout_id}), event_post(),
                recover_live_seats(harness.maker))
            assert browser.status_code == hook.status_code == 200
        elif case == "bad_signature":
            assert (await event_post()).status_code == 400
            retrieve.assert_not_called()
        elif case == "cleanup":
            import database as database_module
            from scheduler.financial import cleanup_abandoned_stripe_sessions_task
            monkeypatch.setattr(database_module, "async_session_maker", harness.maker)
            await cleanup_abandoned_stripe_sessions_task()
            retrieve.assert_not_called()
            async with harness.maker() as db:
                assert (await db.scalars(select(PaymentTransaction))).one().status == "Pending"
            await recover_live_seats(harness.maker)
        elif case in ("sweep", "legacy_completed", "unpaid", "expired", "emulator", "legacy_fulfilled",
                      "legacy_ambiguous", "historical_closed", "missing_resource"):
            await recover_live_seats(harness.maker)
            if case == "missing_resource":
                async with harness.maker() as db:
                    row = (await db.scalars(select(PaymentTransaction))).one()
                    row.updated_at = datetime.now(timezone.utc) - timedelta(hours=1)
                    await db.commit()
                await recover_live_seats(harness.maker)
                retrieve.assert_called_once()
        else:
            if case == "delayed_row":
                assert (await event_post()).status_code == 503
                retrieve.assert_not_called()
                async with harness.maker() as db:
                    db.add(transaction)
                    await db.commit()
            if case == "provider_outage":
                refunds.side_effect = payments.stripe.error.APIConnectionError("fixture")
                assert (await event_post()).status_code == 500
                refunds.side_effect = None
            for _ in range(2):
                response = await event_post()
                assert response.status_code == 200, response.text

    async with harness.maker() as db:
        transaction = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.session_id == checkout_id))).one()
        seats = (await db.scalars(select(LiveSessionParticipant))).all()
        tickets = (await db.scalars(select(SupportTicket))).all()
        assert (await db.get(Profile, "owner")).credit_balance == 100
        if case in ("closed", "refund_pending"):
            refund.assert_called_once_with(payment_intent="intent", idempotency_key=f"live-session-refund-{checkout_id}")
        else:
            refund.assert_not_called()
        if case == "missing_resource":
            assert transaction.status == "verification_required" and transaction.payment_status == "Pending"
            assert not seats and len(tickets) == 1 and "could not verify" in tickets[0].description
        elif case == "legacy_fulfilled":
            assert transaction.status == "Completed" and not tickets
            assert len(seats) == 1 and json.loads(transaction.transaction_metadata)["settled_participant_id"] == "prior-seat"
        elif case == "legacy_ambiguous":
            assert transaction.status == "review_required" and len(tickets) == len(seats) == 1
            assert "settled_participant_id" not in json.loads(transaction.transaction_metadata)
        elif case in ("legacy_completed", "refund_pending", "historical_closed"):
            assert transaction.status == "review_required" and len(tickets) == 1 and not seats
        elif case == "expired":
            assert transaction.status == "Expired" and not seats and not tickets
        elif case in ("unpaid", "bad_signature", "emulator"):
            if case == "emulator":
                retrieve.assert_not_called()
            assert transaction.status == "Pending" and not seats and not tickets
        elif case == "closed":
            assert transaction.status == "Refunded" and not seats and not tickets
        else:
            assert transaction.status == "Completed" and len(seats) == 1 and not tickets
            assert seats[0].live_session_id == "original" and seats[0].amount_paid == 25
