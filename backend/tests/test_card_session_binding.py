"""A confirmed card payment can fulfill only its original live session."""
import json
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models import LiveSession, LiveSessionParticipant, PaymentTransaction, Profile, SupportTicket
from scripts.reconcile_paid_seat_tickets import reconcile_paid_seat_tickets
from routes.sessions import join, payments
from routes.sessions.pricing import CaptureSessionPricingRequest, get_session_pricing
from routes.notifications import push_payloads
from tests.test_live_session_escrow import BUYIN, bearer, harness


@pytest.mark.parametrize("case", [
    "completed_retry", "ended", "replacement", "overlapping", "stopped", "legacy",
    "provider_mismatch", "unknown_provider", "refund_unconfirmed", "refund_pending", "refund_commit_lost", "unpaid_mismatch", "newer_on_demand", "review_commit_durable", "review_commit_rolled_back",
])
async def test_paid_checkout_keeps_original_session(harness, monkeypatch, case):
    target_id = "original-live"
    checkout_id = "checkout-fixture"
    metadata = {
        "type": "live_session_join", "amount": str(BUYIN), "surfer_id": "owner",
        "photographer_id": "pro", "live_session_id": target_id,
    }
    if case == "legacy":
        del metadata["live_session_id"]
    saved = {**metadata, "checkout_provider": "stripe", "checkout_reference": "attempt-fixture"}
    if case == "unknown_provider":
        del saved["checkout_provider"]
    async with harness.maker() as db:
        db.add(LiveSession(
            id=target_id, photographer_id="pro", buyin_price=BUYIN,
            created_at=datetime.now(timezone.utc) - timedelta(hours=1),
            status="ended" if case in ("ended", "replacement", "review_commit_durable", "review_commit_rolled_back") else "active",
        ))
        if case in ("overlapping", "replacement", "newer_on_demand"):
            db.add(LiveSession(
                id="later", photographer_id="pro", status="active",
                session_mode="on_demand" if case == "newer_on_demand" else "live_join",
            ))
        if case == "stopped":
            (await db.get(Profile, "pro")).is_shooting = False
        db.add(PaymentTransaction(
            session_id=checkout_id, user_id="owner", amount=BUYIN, currency="usd",
            transaction_metadata=json.dumps(saved),
        ))
        await db.commit()

    provider_metadata = dict(metadata)
    if case in ("provider_mismatch", "unpaid_mismatch"):
        provider_metadata["live_session_id"] = "different"
    receipt = SimpleNamespace(
        id=checkout_id, mode="payment", client_reference_id="attempt-fixture", amount_total=int(BUYIN * 100),
        currency="usd", payment_status="paid", payment_intent="fixture-intent", metadata=provider_metadata,
    )
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: False)
    monkeypatch.setattr(payments.stripe.checkout.Session, "retrieve", Mock(return_value=receipt))
    refund = Mock()
    refund_history = []
    monkeypatch.setattr(payments.stripe.Refund, "list", Mock(return_value=SimpleNamespace(data=refund_history)))
    monkeypatch.setattr(payments.stripe.Refund, "create", refund)
    monkeypatch.setattr(push_payloads, "notify_session_join", AsyncMock())
    if case in ("refund_unconfirmed", "refund_pending"):
        monkeypatch.setattr(payments.live_session_escrow, "hold", Mock(side_effect=RuntimeError("seat write failed")))
        if case == "refund_unconfirmed":
            refund.side_effect = RuntimeError("refund unavailable")
        else:
            refund.return_value = SimpleNamespace(status="pending")
    if case == "unpaid_mismatch":
        receipt.payment_status = "unpaid"
    request = {"headers": bearer("owner"), "json": {"checkout_session_id": checkout_id}}
    with monkeypatch.context() as first_attempt:
        if case == "refund_commit_lost":
            first_attempt.setattr(payments.live_session_escrow, "hold", Mock(side_effect=RuntimeError("seat write failed")))

            def record_refund(**kwargs):
                completed = SimpleNamespace(status="succeeded")
                refund_history.append(completed)
                return completed

            refund.side_effect = record_refund
        if case in ("review_commit_durable", "review_commit_rolled_back", "refund_commit_lost"):
            commit = AsyncSession.commit

            async def uncertain_commit(db):
                if case == "review_commit_durable":
                    await commit(db)
                raise ConnectionError("Unconfirmed review receipt")

            first_attempt.setattr(AsyncSession, "commit", uncertain_commit)
        first = await harness.client.post("/api/sessions/complete-payment", **request)
    if case == "completed_retry":
        async with harness.maker() as db:
            (await db.get(LiveSession, target_id)).status = "ended"
            db.add(LiveSession(id="next", photographer_id="pro", status="active"))
            await db.commit()
    again = await harness.client.post("/api/sessions/complete-payment", **request)
    if case in ("refund_unconfirmed", "refund_pending", "refund_commit_lost"):
        refund.assert_called_once()
    else:
        refund.assert_not_called()

    async with harness.maker() as db:
        tx = (await db.scalars(select(PaymentTransaction))).one()
        seats = (await db.scalars(select(LiveSessionParticipant))).all()
        tickets = (await db.scalars(select(SupportTicket))).all()
        if case == "unpaid_mismatch":
            assert first.status_code == again.status_code == 400
            assert tx.payment_status == tx.status == "Pending"
            assert seats == tickets == []
            return
        if case in ("completed_retry", "newer_on_demand"):
            assert tickets == []
        else:
            [ticket] = tickets
            assert ticket.related_transaction_id == tx.id and ticket.user_id == tx.user_id
            assert again.json()["support_ticket_id"] == ticket.id
            if first.status_code == 409:
                assert first.json()["support_ticket_id"] == ticket.id
        if case in ("completed_retry", "newer_on_demand"):
            assert first.status_code == again.status_code == 200, first.text
            [seat] = seats
            assert first.json()["session_id"] == again.json()["session_id"] == seat.id
            assert seat.live_session_id == target_id and seat.amount_paid == BUYIN
            assert tx.payment_status == "Completed"
        else:
            assert first.status_code == (503 if case.startswith("review_commit_") or case == "refund_commit_lost" else 409), first.text
            assert again.status_code == 409
            assert seats == []
            assert (tx.payment_status, tx.status) == ("Paid", "review_required")
            reason = json.loads(tx.transaction_metadata)["review_reason"]
            if case == "provider_mismatch":
                assert reason == "checkout_mismatch"
            elif case in ("refund_unconfirmed", "refund_pending", "refund_commit_lost"):
                assert reason == "refund_unconfirmed"
            elif case == "unknown_provider":
                assert reason == "unverified_binding"
            else:
                assert reason in ("missing_original_session", "original_session_unavailable")


    if case == "ended":
        async with harness.maker() as db:
            (await db.get(Profile, "hobby")).is_admin = True
            await db.commit()
        owner_url = f"/api/support/tickets/{ticket.id}"
        staff_url = f"/api/admin/support/tickets/{ticket.id}"
        staff = bearer("hobby")
        listed = await harness.client.get("/api/admin/support/tickets?category=billing&priority=high", headers=staff)
        assert listed.status_code == 200, listed.text
        assert [item["id"] for item in listed.json()["tickets"]] == [ticket.id]
        detail = await harness.client.get(staff_url, headers=staff)
        assert detail.json()["related_transaction_id"] == tx.id
        assert (await harness.client.get(staff_url, headers=bearer("owner"))).status_code == 403
        assert (await harness.client.get(owner_url, headers=bearer("pro"))).status_code == 404
        for internal, message in ((True, "Internal case note"), (False, "We reviewed your payment.")):
            response = await harness.client.post(staff_url + "/reply", headers=staff,
                                                 json={"message": message, "is_internal_note": internal})
            assert response.status_code == 200, response.text
        closed = await harness.client.put(staff_url, headers=staff, json={"status": "resolved"})
        assert closed.status_code == 200
        retry = await harness.client.post("/api/sessions/complete-payment", **request)
        assert retry.status_code == 409 and retry.json()["support_ticket_id"] == ticket.id
        detail = await harness.client.get(owner_url, headers=bearer("owner"))
        assert detail.json()["status"] == "resolved"
        assert [m["message"] for m in detail.json()["messages"]] == ["We reviewed your payment."]
        assert "related_transaction_id" not in detail.json()
        refund.assert_not_called()


@pytest.mark.parametrize("case", ["no_session", "different_rate"])
async def test_card_checkout_requires_a_matching_live_offer(harness, monkeypatch, case):
    if case == "different_rate":
        async with harness.maker() as db:
            db.add(LiveSession(photographer_id="pro", buyin_price=BUYIN + 5))
            await db.commit()
    create = Mock()
    monkeypatch.setattr(join, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: False)
    monkeypatch.setattr(join.stripe.checkout.Session, "create", create)
    response = await harness.client.post(
        "/api/sessions/join?surfer_id=owner", headers=bearer("owner"),
        json={"photographer_id": "pro", "payment_method": "card", "max_buyin_amount": BUYIN, "origin_url": "https://dev--rawsurf.netlify.app"},
    )
    assert response.status_code == 409, response.text
    create.assert_not_called()
    async with harness.maker() as db:
        assert (await db.scalars(select(PaymentTransaction))).all() == []

async def test_reconcile_existing_paid_reviews(harness):
    qualifying = {"type": "live_session_join", "review_reason": "missing_original_session"}
    async with harness.maker() as db:
        for ref, paid, state, meta in (
            ("seat", "paid", "review_required", qualifying),
            ("pending", "Pending", "review_required", qualifying),
            ("settled", "paid", "completed", qualifying),
            ("other", "paid", "review_required", {**qualifying, "type": "subscription"}),
            ("unknown", "paid", "review_required", {**qualifying, "review_reason": "other"}),
        ):
            db.add(PaymentTransaction(user_id="owner", session_id=ref, amount=13.75, currency="usd",
                                      payment_status=paid, status=state, transaction_metadata=json.dumps(meta)))
        await db.commit()
    assert await reconcile_paid_seat_tickets(harness.maker) == {"missing": 1, "created": 0, "unreadable": 0}
    assert (await reconcile_paid_seat_tickets(harness.maker, apply=True))["created"] == 1
    assert (await reconcile_paid_seat_tickets(harness.maker, apply=True))["missing"] == 0
    async with harness.maker() as db:
        [ticket] = (await db.scalars(select(SupportTicket))).all()
        assert "13.75 USD" in ticket.description
        tx = await db.get(PaymentTransaction, ticket.related_transaction_id)
        assert (tx.session_id, tx.status, tx.payment_status) == ("seat", "review_required", "paid")


@pytest.mark.parametrize("replaced", [False, True])
async def test_card_quote_through_seat_or_support(harness, monkeypatch, replaced):
    async with harness.maker() as db:
        db.add(LiveSession(id="quoted-session", photographer_id="pro", buyin_price=17.50))
        await db.commit()
        quote = await get_session_pricing(CaptureSessionPricingRequest(photographer_id="pro"), db=db, user_id="owner")
        assert quote["entry_fee"] == 17.50

    checkout = SimpleNamespace(id="fixture-checkout", url="https://example.invalid/checkout")
    create = Mock(return_value=checkout)
    refund = Mock()
    monkeypatch.setattr(join, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(payments, "STRIPE_API_KEY", "fixture")
    monkeypatch.setattr(payments, "checkout_emulation_allowed", lambda: False)
    monkeypatch.setattr(join.stripe.checkout.Session, "create", create)
    monkeypatch.setattr(payments.stripe.Refund, "list", Mock(return_value=SimpleNamespace(data=[])))
    monkeypatch.setattr(payments.stripe.Refund, "create", refund)
    monkeypatch.setattr(push_payloads, "notify_session_join", AsyncMock())
    auth = bearer("owner")
    start = await harness.client.post("/api/sessions/join?surfer_id=owner", headers=auth, json={
        "photographer_id": "pro", "payment_method": "card", "max_buyin_amount": quote["entry_fee"],
        "origin_url": "https://dev--rawsurf.netlify.app",
    })
    assert start.status_code == 200, start.text
    sent = create.call_args.kwargs
    line = sent["line_items"][0]["price_data"]
    assert line["unit_amount"] == 1750 and sent["metadata"]["live_session_id"] == "quoted-session"
    receipt = SimpleNamespace(id=checkout.id, mode="payment", client_reference_id=sent["client_reference_id"],
                              currency=line["currency"], amount_total=line["unit_amount"], payment_status="paid",
                              payment_intent="fixture-intent", metadata=sent["metadata"])
    monkeypatch.setattr(payments.stripe.checkout.Session, "retrieve", Mock(return_value=receipt))
    if replaced:
        async with harness.maker() as db:
            (await db.get(LiveSession, "quoted-session")).status = "ended"
            db.add(LiveSession(id="replacement", photographer_id="pro", buyin_price=17.50))
            await db.commit()

    confirm = {"headers": auth, "json": {"checkout_session_id": checkout.id}}
    first = await harness.client.post("/api/sessions/complete-payment", **confirm)
    again = await harness.client.post("/api/sessions/complete-payment", **confirm)
    assert first.status_code == again.status_code == (409 if replaced else 200), first.text
    create.assert_called_once()
    refund.assert_not_called()
    async with harness.maker() as db:
        tx = (await db.scalars(select(PaymentTransaction))).one()
        seats = (await db.scalars(select(LiveSessionParticipant))).all()
        tickets = (await db.scalars(select(SupportTicket))).all()
        assert tx.amount == 17.50
        if replaced:
            [ticket] = tickets
            assert seats == [] and tx.status == "review_required"
            assert first.json()["support_ticket_id"] == again.json()["support_ticket_id"] == ticket.id
            assert ticket.related_transaction_id == tx.id
            inbox = await harness.client.get(f"/api/support/tickets/{ticket.id}", headers=auth)
            assert inbox.status_code == 200 and "17.50 USD" in inbox.json()["description"]
        else:
            [seat] = seats
            assert tickets == [] and seat.amount_paid == 17.50
            assert seat.live_session_id == "quoted-session"
            assert first.json()["session_id"] == again.json()["session_id"] == seat.id
