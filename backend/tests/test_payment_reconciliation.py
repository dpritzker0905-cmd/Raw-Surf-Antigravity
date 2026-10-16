"""Durable recovery of verified receipts; HTTP/ORM tests with provider doubles."""
import json
import uuid
import asyncio
import threading
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text

from models import Booking, PaymentTransaction, Profile
from test_booking_payment_integrity import (  # noqa: F401
    SESSION, bearer, confirm, harness, live, live_completion, schema, snapshot, webhook,
)


async def cancel_locally(h):
    async with h.sessions() as db:
        (await db.get(Booking, 'booking')).status = 'Cancelled'
        await db.commit()


@pytest.fixture(autouse=True)
def recovery_provider(harness, monkeypatch):
    import sys
    recovery = sys.modules['routes.payment_recovery']
    monkeypatch.setattr(recovery, 'STRIPE_API_KEY', uuid.uuid4().hex)


async def cases(h):
    async with h.sessions() as db:
        return (await db.execute(text('SELECT * FROM payment_reconciliation_cases'))).mappings().all()


async def admin(h):
    async with h.sessions() as db:
        (await db.get(Profile, 'other')).is_admin = True
        await db.commit()
    return bearer('other')


@pytest.mark.parametrize('entry', ['webhook', 'redirect', 'status'])
async def test_verified_unfulfillable_receipt_has_one_durable_case(harness, entry):
    await cancel_locally(harness)
    before = await snapshot(harness)
    for _ in range(2):
        if entry == 'webhook':
            response = await webhook(harness)
        elif entry == 'redirect':
            response = await confirm(harness)
        else:
            response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
        assert response.status_code == (200 if entry == 'webhook' else 409), response.text
        body = response.json()
        evidence = body if entry == 'webhook' else body['detail']
        assert isinstance(evidence, dict) and evidence.get('reconciliation_required')
    records = await cases(harness)
    assert len(records) == 1
    assert records[0]['session_id'] == SESSION and records[0]['amount_cents'] == 8000
    assert records[0]['state'] == 'open' and records[0]['reason'] == 'booking_unavailable'
    assert await snapshot(harness) == before


@pytest.mark.parametrize('invalid', ['wrong-amount', 'wrong-booking', 'unpaid', 'wrong-signature'])
async def test_untrusted_or_unpaid_receipt_cannot_open_case(harness, invalid):
    await cancel_locally(harness)
    if invalid == 'wrong-amount':
        harness.session.amount_total = 1
    elif invalid == 'wrong-booking':
        harness.session.metadata['booking_id'] = 'other'
    elif invalid == 'unpaid':
        harness.session.payment_status = 'unpaid'
    else:
        harness.webhook_secret = 'different-local-test-secret'
    response = await webhook(harness)
    assert response.status_code == (200 if invalid == 'unpaid' else 400)
    assert await cases(harness) == []


@pytest.mark.parametrize('actor,expected', [(None, 401), ('owner', 403), ('other', 403)])
async def test_reconciliation_queue_requires_admin_authority(harness, actor, expected):
    response = await harness.client.get('/api/payments/reconciliation', headers=bearer(actor))
    assert response.status_code == expected, response.text
    assert harness.retrieved == []


async def test_scan_recovers_missed_receipt_without_browser_return(harness):
    response = await harness.client.post('/api/payments/reconciliation/scan', headers=await admin(harness))
    assert response.status_code == 200, response.text
    assert response.json()['fulfilled'] == 1
    assert await snapshot(harness) == ('Confirmed', 'Paid', 'paid', 80, 2, 2)


async def test_refund_retries_use_same_key_and_never_claim_pending_as_refunded(harness, monkeypatch):
    await cancel_locally(harness)
    assert (await webhook(harness)).status_code == 200
    record = (await cases(harness))[0]
    calls = []
    outcome = SimpleNamespace(id='refund-fixture', status='pending', payment_intent='intent-fixture', amount=8000, currency='usd')
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: calls.append(kw) or outcome)
    monkeypatch.setattr(harness.module.stripe.Refund, 'retrieve', lambda *a, **kw: outcome)
    headers = await admin(harness)
    url = f"/api/payments/reconciliation/{record['id']}/refund"
    response = await harness.client.post(url, headers=headers)
    assert response.status_code == 200, response.text
    assert response.json()['state'] == 'refund_pending'
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status != 'Refunded'
    outcome.status = 'succeeded'
    for _ in range(2):
        assert (await harness.client.post(url, headers=headers)).status_code == 200
    assert len(calls) == 1 and calls[0]['idempotency_key'] == f"payment-case-refund:{record['id']}"
    assert (await cases(harness))[0]['state'] == 'refunded'
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Refunded'


async def test_unknown_refund_outcome_keeps_case_and_reuses_key(harness, monkeypatch):
    await cancel_locally(harness)
    await webhook(harness)
    record = (await cases(harness))[0]
    calls = []
    def refund(**kwargs):
        calls.append(kwargs)
        if len(calls) == 1:
            raise harness.module.stripe.error.APIConnectionError('Injected lost response')
        return SimpleNamespace(id='refund-fixture', status='succeeded', payment_intent='intent-fixture', amount=8000, currency='usd')
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', refund)
    url = f"/api/payments/reconciliation/{record['id']}/refund"
    headers = await admin(harness)
    assert (await harness.client.post(url, headers=headers)).status_code == 502
    assert (await cases(harness))[0]['state'] == 'refund_pending'
    assert (await harness.client.post(url, headers=headers)).status_code == 200
    assert len(calls) == 2 and calls[0]['idempotency_key'] == calls[1]['idempotency_key']


async def test_refund_revalidates_receipt_and_entitlement(harness, monkeypatch):
    await cancel_locally(harness)
    await webhook(harness)
    record = (await cases(harness))[0]
    calls = []
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: calls.append(kw))
    harness.session.amount_total = 1
    response = await harness.client.post(f"/api/payments/reconciliation/{record['id']}/refund", headers=await admin(harness))
    assert response.status_code == 400, response.text
    assert calls == [] and (await cases(harness))[0]['state'] == 'open'


async def test_live_unavailable_receipt_is_durable_without_automatic_refund(harness, live_completion):
    from models import LiveSession
    async with harness.sessions() as db:
        (await db.get(LiveSession, 'live')).status = 'ended'
        await db.commit()
    response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert response.status_code == 409, response.text
    records = await cases(harness)
    assert len(records) == 1 and records[0]['reason'] == 'live_session_unavailable'
    assert records[0]['amount_cents'] == 2500 and live_completion == []


@pytest.mark.parametrize('state', ['refund_pending', 'review_required', 'refunded'])
@pytest.mark.parametrize('entry', ['webhook', 'redirect', 'status'])
async def test_scheduled_refund_case_remains_authoritative_when_booking_reopens(harness, state, entry):
    from models import PaymentReconciliationCase
    await cancel_locally(harness)
    await webhook(harness)
    async with harness.sessions() as db:
        case = (await db.scalars(select(PaymentReconciliationCase))).one()
        case.state = state
        if state == 'refunded':
            case.refund_id = 'refund-fixture'
            tx = await db.get(PaymentTransaction, 'transaction')
            tx.payment_status = tx.status = 'Refunded'
        (await db.get(Booking, 'booking')).status = 'Pending Payment'
        await db.commit()
    before = await snapshot(harness)
    for _ in range(2):
        response = (await webhook(harness) if entry == 'webhook' else await confirm(harness)
                    if entry == 'redirect' else await harness.client.get(
                        f'/api/payments/checkout/status/{SESSION}', headers=bearer()))
        assert response.status_code == (200 if entry == 'webhook' else 409), response.text
        body = response.json() if entry == 'webhook' else response.json()['detail']
        assert body['reconciliation_required'] is True and body['state'] == state
    assert await snapshot(harness) == before
    records = await cases(harness)
    assert len(records) == 1 and records[0]['state'] == state


async def test_refund_unknown_outcome_after_key_retention_window_requires_review(harness, monkeypatch):
    from models import PaymentReconciliationCase
    await cancel_locally(harness)
    await webhook(harness)
    async with harness.sessions() as db:
        case = (await db.scalars(select(PaymentReconciliationCase))).one()
        case.refund_started_at = datetime.now(timezone.utc) - timedelta(hours=25)
        case.state = 'refund_pending'
        case_id = case.id
        await db.commit()
    calls = []
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: calls.append(kw))
    r = await harness.client.post(f'/api/payments/reconciliation/{case_id}/refund', headers=await admin(harness))
    assert r.status_code == 409 and calls == []
    assert (await cases(harness))[0]['state'] == 'review_required'


@pytest.mark.parametrize('status', ['failed', 'canceled'])
async def test_provider_refund_failure_is_not_recorded_as_refunded(harness, monkeypatch, status):
    await cancel_locally(harness)
    await webhook(harness)
    record = (await cases(harness))[0]
    outcome = SimpleNamespace(id='refund-fixture', status=status, payment_intent='intent-fixture', amount=8000, currency='usd')
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: outcome)
    r = await harness.client.post(f"/api/payments/reconciliation/{record['id']}/refund", headers=await admin(harness))
    assert r.status_code == 200 and r.json()['state'] == 'review_required'
    async with harness.sessions() as db:
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'


async def test_fulfilled_payment_cannot_use_unfulfilled_case_refund(harness, monkeypatch):
    await cancel_locally(harness)
    await webhook(harness)
    record = (await cases(harness))[0]
    async with harness.sessions() as db:
        tx = await db.get(PaymentTransaction, 'transaction')
        tx.payment_status = 'paid'
        tx.status = 'completed'
        await db.commit()
    calls = []
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: calls.append(kw))
    r = await harness.client.post(f"/api/payments/reconciliation/{record['id']}/refund", headers=await admin(harness))
    assert r.status_code == 409 and calls == []


async def test_late_pending_refund_response_cannot_regress_terminal_success(harness, monkeypatch):
    from models import PaymentReconciliationCase
    await cancel_locally(harness)
    await webhook(harness)
    record = (await cases(harness))[0]
    async with harness.sessions() as db:
        case = await db.get(PaymentReconciliationCase, record['id'])
        case.state, case.refund_id = 'refund_pending', 'refund-fixture'
        case.refund_started_at = datetime.now(timezone.utc)
        await db.commit()
    waiting, release = asyncio.Event(), threading.Event()
    loop = asyncio.get_running_loop()
    calls = []
    def retrieve(*args, **kwargs):
        calls.append(1)
        if len(calls) == 1:
            loop.call_soon_threadsafe(waiting.set)
            assert release.wait(15)
            status = 'pending'
        else:
            status = 'succeeded'
        return SimpleNamespace(id='refund-fixture', status=status, payment_intent='intent-fixture', amount=8000, currency='usd')
    monkeypatch.setattr(harness.module.stripe.Refund, 'retrieve', retrieve)
    url = f"/api/payments/reconciliation/{record['id']}/refund"
    headers = await admin(harness)
    slow = asyncio.create_task(harness.client.post(url, headers=headers))
    await asyncio.wait_for(waiting.wait(), 10)
    try:
        fast = await harness.client.post(url, headers=headers)
        assert fast.status_code == 200 and fast.json()['state'] == 'refunded', fast.text
    finally:
        release.set()
    r = await asyncio.wait_for(slow, 10)
    assert r.status_code == 200 and r.json()['state'] == 'refunded'
    assert (await cases(harness))[0]['state'] == 'refunded'


async def test_live_fulfillment_failure_records_case_and_never_auto_refunds(harness, live_completion, monkeypatch):
    from models import LiveSessionParticipant
    original = harness.sessions.class_.flush
    async def fail(self, *args, **kwargs):
        if any(isinstance(row, LiveSessionParticipant) for row in self.new):
            raise RuntimeError('Injected entitlement persistence failure')
        return await original(self, *args, **kwargs)
    monkeypatch.setattr(harness.sessions.class_, 'flush', fail)
    r = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert r.status_code == 409, r.text
    assert live_completion == []
    assert (await cases(harness))[0]['reason'] == 'live_fulfillment_failed'
    async with harness.sessions() as db:
        assert not (await db.scalars(select(LiveSessionParticipant))).all()


async def test_scan_does_not_open_case_after_concurrent_live_fulfillment(harness, live_completion, monkeypatch):
    import sys
    recovery = sys.modules['routes.payment_recovery']
    waiting, release = asyncio.Event(), asyncio.Event()
    async def delayed(fn, *args, **kwargs):
        waiting.set()
        await asyncio.wait_for(release.wait(), 15)
        return harness.session
    monkeypatch.setattr(recovery, 'run_in_threadpool', delayed)
    scan = asyncio.create_task(harness.client.post('/api/payments/reconciliation/scan', headers=await admin(harness)))
    await asyncio.wait_for(waiting.wait(), 10)
    try:
        r = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
        assert r.status_code == 200, r.text
    finally:
        release.set()
    r = await asyncio.wait_for(scan, 10)
    assert r.status_code == 200 and r.json()['cases'] == 0, r.text
    assert await cases(harness) == []


async def test_pending_live_refund_can_finish_after_service_becomes_available(harness, live_completion, monkeypatch):
    async with harness.sessions() as db:
        (await db.get(Profile, 'pro')).is_shooting = False
        await db.commit()
    r = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert r.status_code == 409
    record = (await cases(harness))[0]
    outcome = SimpleNamespace(id='refund-fixture', status='pending', payment_intent='intent-fixture', amount=2500, currency='usd')
    monkeypatch.setattr(harness.module.stripe.Refund, 'create', lambda **kw: outcome)
    monkeypatch.setattr(harness.module.stripe.Refund, 'retrieve', lambda *a, **kw: outcome)
    url = f"/api/payments/reconciliation/{record['id']}/refund"
    headers = await admin(harness)
    assert (await harness.client.post(url, headers=headers)).json()['state'] == 'refund_pending'
    async with harness.sessions() as db:
        (await db.get(Profile, 'pro')).is_shooting = True
        await db.commit()
    outcome.status = 'succeeded'
    r = await harness.client.post(url, headers=headers)
    assert r.status_code == 200 and r.json()['state'] == 'refunded', r.text


async def test_scan_cursor_does_not_skip_when_fulfillment_shrinks_pending_set(harness, monkeypatch):
    from models import BookingParticipant
    async with harness.sessions() as db:
        original = await db.get(Booking, 'booking')
        metadata = dict(harness.session.metadata, booking_id='next-booking')
        db.add(Booking(id='next-booking', photographer_id='pro', creator_id='owner', location=original.location,
            session_date=original.session_date, duration=60, total_price=100, status='Pending Payment'))
        db.add(BookingParticipant(id='next-participant', booking_id='next-booking', participant_id='owner',
            paid_amount=20, payment_status='Pending', status='pending'))
        db.add(PaymentTransaction(id='zz-next', user_id='owner', session_id='next-checkout', amount=80,
            currency='usd', payment_status='Pending', status='Pending', transaction_metadata=json.dumps(metadata)))
        await db.commit()
    second = SimpleNamespace(**dict(vars(harness.session), id='next-checkout', metadata=metadata))
    monkeypatch.setattr(harness.module.stripe.checkout.Session, 'retrieve',
                        lambda identifier, **kw: harness.session if identifier == SESSION else second)
    headers = await admin(harness)
    first = await harness.client.post('/api/payments/reconciliation/scan?limit=1', headers=headers)
    assert first.status_code == 200 and first.json()['fulfilled'] == 1, first.text
    next_page = await harness.client.post('/api/payments/reconciliation/scan', headers=headers,
                                          params={'limit': 1, 'after_id': first.json()['next_cursor']})
    assert next_page.status_code == 200 and next_page.json()['fulfilled'] == 1, next_page.text
