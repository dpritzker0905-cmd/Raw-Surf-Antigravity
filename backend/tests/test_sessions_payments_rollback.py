"""HTTP/ORM controls: lost recovery evidence, accidental refunds and test-ID bypass."""
import importlib

import pytest
import stripe
from sqlalchemy import select

from models import LiveSessionParticipant, PaymentReconciliationCase, PaymentTransaction
from test_booking_payment_integrity import (  # noqa: F401
    SESSION, bearer, harness, live, live_completion, schema,
)


async def complete(harness, session_id=SESSION):
    return await harness.client.post('/api/sessions/complete-payment', headers=bearer(),
                                     json={'checkout_session_id': session_id})


async def test_complete_payment_stripe_error_triggers_rollback(harness, live_completion, monkeypatch):
    def unavailable(*args, **kwargs):
        raise stripe.error.APIConnectionError('Provider unavailable')
    monkeypatch.setattr(stripe.checkout.Session, 'retrieve', unavailable)
    response = await complete(harness)
    assert response.status_code == 500
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'
        assert not (await db.scalars(select(LiveSessionParticipant))).all()
        assert not (await db.scalars(select(PaymentReconciliationCase))).all()
    assert live_completion == []


@pytest.mark.parametrize('identifier', [SESSION, 'cs_test_verified_checkout'])
async def test_verified_fulfillment_failure_retains_one_case_without_automatic_refund(
        harness, live_completion, monkeypatch, identifier):
    harness.session.id = identifier
    async with harness.sessions() as db:
        (await db.get(PaymentTransaction, 'transaction')).session_id = identifier
        await db.commit()
    module = importlib.import_module('repair_session_routes.payments')
    def failed_hold(*args, **kwargs):
        raise RuntimeError('Injected entitlement failure')
    monkeypatch.setattr(module.live_session_escrow, 'hold', failed_hold)
    for _ in range(2):
        response = await complete(harness, identifier)
        assert response.status_code == 409, response.text
        assert response.json()['detail']['reconciliation_required'] is True
    assert harness.retrieved == [identifier, identifier]
    assert live_completion == []
    async with harness.sessions() as db:
        tx = await db.get(PaymentTransaction, 'transaction')
        assert (tx.payment_status, tx.status) == ('Pending', 'Pending')
        assert not (await db.scalars(select(LiveSessionParticipant))).all()
        cases = (await db.scalars(select(PaymentReconciliationCase))).all()
        assert len(cases) == 1
        assert (cases[0].session_id, cases[0].amount_cents, cases[0].currency) == (identifier, 2500, 'usd')
        assert (cases[0].reason, cases[0].state) == ('live_fulfillment_failed', 'open')


async def test_incomplete_receipt_cannot_trigger_refund_or_case(harness, live_completion):
    harness.session.amount_total = None
    response = await complete(harness)
    assert response.status_code == 400
    assert live_completion == []
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'
        assert not (await db.scalars(select(PaymentReconciliationCase))).all()
