"""A captain can open a card checkout and then pay their Quick Book deposit by wallet."""
from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import select

from models import (Booking, CreditTransaction, DispatchRequest, DispatchRequestStatusEnum as Status,
                    PaymentTransaction, Profile, SurferPhotoSubscription)
from routes.admin import quick_book_preview
from routes.dispatch import dispatch_transitions, sessions
from tests.test_audit_money_route_authority import bearer, harness
from tests.test_shared_quick_book_price import CAPTAIN, PRO, TERMS, create, preview, shared


@pytest.mark.parametrize("paid_by_wallet", [True, False], ids=["wallet_debit", "missing_debit"])
async def test_linked_abandoned_checkout_after_captain_wallet_payment(shared, harness, monkeypatch, paid_by_wallet):
    app, client, maker = harness
    app.include_router(dispatch_transitions.router, prefix="/api")
    app.include_router(quick_book_preview.router, prefix="/api")
    async with maker.begin() as db:
        (await db.get(SurferPhotoSubscription, "plan")).sessions_remaining = 0
        (await db.get(Profile, CAPTAIN)).spend_only_credits = 8
        (await db.get(Profile, PRO)).is_admin = True
    quote = await preview(client, TERMS)
    assert quote["captain_cents"] == 2800
    created = await create(client, TERMS, quote["quote_id"])
    assert created.status_code == 200, created.text
    did = created.json()["id"]
    session_id = "fixture-abandoned"
    checkout = Mock(return_value=SimpleNamespace(id=session_id, url="https://fixture.invalid/card"))
    retrieve = Mock(side_effect=AssertionError("no provider lookup expected"))
    monkeypatch.setattr(sessions.stripe, "api_key", "fixture")
    monkeypatch.setattr(sessions.stripe.checkout.Session, "create", checkout)
    monkeypatch.setattr(sessions.stripe.checkout.Session, "retrieve", retrieve)
    opened = await client.post("/api/dispatch/checkout", headers=bearer(CAPTAIN), json={
        "dispatch_id": did, "payer_id": CAPTAIN, "origin_url": "https://fixture.invalid"})
    assert opened.status_code == 200 and opened.json()["session_id"] == session_id, opened.text
    if paid_by_wallet:
        paid = await client.post(f"/api/dispatch/{did}/pay?payer_id={CAPTAIN}", headers=bearer(CAPTAIN))
        assert paid.status_code == 200, paid.text
    async with maker.begin() as db:
        row = await db.get(DispatchRequest, did)
        assert row.stripe_checkout_session_id == session_id
        # The negative control retains the checkout link and has no paid deposit or ledger entry.
        assert bool(row.deposit_paid) == paid_by_wallet
        row.status, row.photographer_id, row.accepted_at = Status.EN_ROUTE, PRO, datetime.now(timezone.utc)
    closed = await client.post(f"/api/dispatch/{did}/cancel", headers=bearer(CAPTAIN), json={})
    assert closed.status_code == 200, closed.text
    bid = closed.json()["booking_id"]
    path = f"/api/admin/support/quick-books/{did}/settlement-preview"
    decisions = {"seats": [{"seat": member, "outcome": "no_service"} for member in (CAPTAIN, "north", "south")]}
    async with maker() as db:
        receipt = await db.scalar(select(PaymentTransaction).where(PaymentTransaction.session_id == session_id))
        receipt_id = receipt.id
        assert (receipt.status, receipt.payment_status) == ("Pending", "Pending")
    if not paid_by_wallet:
        missing = await client.post(path, headers=bearer(PRO), json=decisions)
        assert missing.status_code == 409, missing.text
        assert missing.json()["detail"] == "Funding records need reconciliation before a settlement can be previewed."
        retrieve.assert_not_called()
        return
    for _ in range(2):
        response = await client.post(path, headers=bearer(PRO), json=decisions)
        assert response.status_code == 200, response.text
        result = response.json()
        assert (result["collected_cents"], result["refund_cents"], result["photographer_gross_cents"],
                result["reserved_cents"]) == (2800, 2800, 0, 0)
        source, = result["funding"]
        assert (source["payer_id"], source["method"], source["cash_wallet_refund_cents"],
                source["promo_refund_cents"]) == (CAPTAIN, "wallet", 2000, 800)
        assert result["separate_receipts"] == [{"seat": CAPTAIN, "receipt_id": receipt_id, "status": "pending",
                                               "amount_cents": 2800, "payer_id": CAPTAIN}]
        assert result["included_session"]["action"] == "none"
    async with maker.begin() as db:
        debit, = (await db.scalars(select(CreditTransaction))).all()
        assert debit.amount == -28 and debit.spend_only_amount == -8
        payer = await db.get(Profile, CAPTAIN)
        assert (payer.credit_balance, payer.spend_only_credits) == (72, 0)
        assert (await db.get(Booking, bid)).escrow_amount == 28
        receipt = await db.get(PaymentTransaction, receipt_id)
        assert (receipt.status, receipt.payment_status) == ("Pending", "Pending")
        receipt.amount = 29
    mismatch = await client.post(path, headers=bearer(PRO), json=decisions)
    assert mismatch.status_code == 409, mismatch.text
    async with maker.begin() as db:
        (await db.get(PaymentTransaction, receipt_id)).amount = 28.005
    fractional_cent = await client.post(path, headers=bearer(PRO), json=decisions)
    assert fractional_cent.status_code == 409, fractional_cent.text
    async with maker.begin() as db:
        receipt = await db.get(PaymentTransaction, receipt_id)
        receipt.amount = 28
        receipt.status, receipt.payment_status = "Completed", "Completed"
    conflict = await client.post(path, headers=bearer(PRO), json=decisions)
    assert conflict.status_code == 409, conflict.text
    checkout.assert_called_once()
    retrieve.assert_not_called()
