"""A paid live checkout must activate without relying on the buyer's return page."""
import pytest
from sqlalchemy import select

from models import LiveSessionParticipant, PaymentTransaction, Profile
from test_booking_payment_integrity import (  # noqa: F401
    SESSION, bearer, harness, live, live_completion, schema, webhook,
)


@pytest.mark.parametrize('entry', ['webhook', 'status'])
async def test_paid_live_checkout_activates_before_return_and_replay_is_harmless(harness, live_completion, entry):
    response = (await webhook(harness) if entry == 'webhook' else
                await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer()))
    assert response.status_code == 200, response.text
    async with harness.sessions() as db:
        participants = (await db.scalars(select(LiveSessionParticipant))).all()
        assert len(participants) == 1
        assert participants[0].photos_credit_remaining == 3
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Completed'
    for action in (lambda: webhook(harness), lambda: harness.client.post('/api/sessions/complete-payment',
            headers=bearer(), json={'checkout_session_id': SESSION})):
        assert (await action()).status_code == 200
    async with harness.sessions() as db:
        assert len((await db.scalars(select(LiveSessionParticipant))).all()) == 1
    assert live_completion == []


async def test_admin_scan_recovers_a_missed_live_callback(harness, live_completion, monkeypatch):
    monkeypatch.setattr(harness.recovery, 'STRIPE_API_KEY', object())
    async with harness.sessions() as db:
        (await db.get(Profile, 'other')).is_admin = True
        await db.commit()
    response = await harness.client.post('/api/payments/reconciliation/scan', headers=bearer('other'))
    assert response.status_code == 200, response.text
    assert response.json()['fulfilled'] == 1 and response.json()['cases'] == 0
    async with harness.sessions() as db:
        assert len((await db.scalars(select(LiveSessionParticipant))).all()) == 1


@pytest.mark.parametrize('entry', ['webhook', 'status', 'scan'])
async def test_live_commit_failure_retains_a_recovery_case(harness, live_completion, monkeypatch, entry):
    from models import PaymentReconciliationCase
    monkeypatch.setattr(harness.recovery, 'STRIPE_API_KEY', object())
    async with harness.sessions() as db:
        (await db.get(Profile, 'other')).is_admin = True
        await db.commit()
    original = harness.sessions.class_.commit
    count = 0
    async def fail_once(db):
        nonlocal count
        count += 1
        if count == 1:
            raise RuntimeError('Injected outer commit failure')
        return await original(db)
    monkeypatch.setattr(harness.sessions.class_, 'commit', fail_once)
    if entry == 'webhook':
        response = await webhook(harness)
    elif entry == 'status':
        response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
    else:
        response = await harness.client.post('/api/payments/reconciliation/scan', headers=bearer('other'))
    assert response.status_code == (409 if entry == 'status' else 200), response.text
    async with harness.sessions() as db:
        assert not (await db.scalars(select(LiveSessionParticipant))).all()
        assert (await db.get(PaymentTransaction, 'transaction')).payment_status == 'Pending'
        assert len((await db.scalars(select(PaymentReconciliationCase))).all()) == 1


@pytest.mark.parametrize('method', ['credits', 'subscription'])
@pytest.mark.parametrize('entry', ['webhook', 'status', 'return'])
async def test_paid_card_does_not_duplicate_participation_from_other_method(harness, live_completion, method, entry):
    from models import PaymentReconciliationCase
    async with harness.sessions() as db:
        db.add(LiveSessionParticipant(id='already-in', surfer_id='owner', photographer_id='pro',
            live_session_id='live', amount_paid=25, payment_method=method, status='active'))
        await db.commit()
    if entry == 'webhook': response = await webhook(harness)
    elif entry == 'status': response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
    else: response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(), json={'checkout_session_id': SESSION})
    assert response.status_code == (200 if entry == 'webhook' else 409), response.text
    async with harness.sessions() as db:
        assert len((await db.scalars(select(LiveSessionParticipant))).all()) == 1
        assert len((await db.scalars(select(PaymentReconciliationCase))).all()) == 1


async def test_successful_live_recovery_closes_the_original_case(harness, live_completion, monkeypatch):
    from models import PaymentReconciliationCase
    from services import live_session_escrow
    original = live_session_escrow.hold
    monkeypatch.setattr(live_session_escrow, 'hold', lambda *args: (_ for _ in ()).throw(RuntimeError('Transient fulfillment failure')))
    assert (await webhook(harness)).json()['reconciliation_required'] is True
    monkeypatch.setattr(live_session_escrow, 'hold', original)
    assert (await webhook(harness)).status_code == 200
    async with harness.sessions() as db:
        cases = (await db.scalars(select(PaymentReconciliationCase))).all()
        assert len(cases) == 1 and cases[0].state == 'fulfilled'
        assert len((await db.scalars(select(LiveSessionParticipant))).all()) == 1


@pytest.mark.parametrize('state', ['refund_pending', 'review_required', 'refunded'])
@pytest.mark.parametrize('entry', ['webhook', 'status', 'return'])
async def test_refund_case_links_buyer_receipt_without_reactivating_live_session(harness, live_completion, state, entry):
    from models import LiveSession, PaymentReconciliationCase
    async with harness.sessions() as db:
        (await db.get(LiveSession, 'live')).status = 'ended'
        await db.commit()
    await webhook(harness)
    async with harness.sessions() as db:
        case = (await db.scalars(select(PaymentReconciliationCase))).one()
        case.state = state
        if state == 'refunded':
            case.refund_id = 'refund-fixture'
            tx = await db.get(PaymentTransaction, 'transaction')
            tx.payment_status = tx.status = 'Refunded'
        case_id = case.id
        # Even if availability returns, a refund already underway must block entitlement.
        (await db.get(LiveSession, 'live')).status = 'active'
        await db.commit()
    for _ in range(2):
        if entry == 'webhook':
            response = await webhook(harness)
        elif entry == 'status':
            response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
        else:
            response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(),
                json={'checkout_session_id': SESSION})
        assert response.status_code == (200 if entry == 'webhook' else 409), response.text
        body = response.json() if entry == 'webhook' else response.json()['detail']
        assert {key: body.get(key) for key in ('reconciliation_required', 'case_id', 'state')} == {
            'reconciliation_required': True, 'case_id': case_id, 'state': state}
    async with harness.sessions() as db:
        assert not (await db.scalars(select(LiveSessionParticipant))).all()
        cases = (await db.scalars(select(PaymentReconciliationCase))).all()
        assert len(cases) == 1 and cases[0].state == state
        tx = await db.get(PaymentTransaction, 'transaction')
        assert tx.payment_status == ('Refunded' if state == 'refunded' else 'Pending')
    assert live_completion == []


@pytest.mark.parametrize('entry', ['status', 'return'])
@pytest.mark.parametrize('actor', [None, 'other'])
async def test_refund_receipt_still_requires_owner_before_provider(harness, live_completion, entry, actor):
    if entry == 'status':
        response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer(actor))
    else:
        response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(actor),
            json={'checkout_session_id': SESSION})
    assert response.status_code == (401 if actor is None else (404 if entry == 'status' else 403))
    assert harness.retrieved == []


@pytest.mark.parametrize('entry', ['status', 'return'])
async def test_refunded_case_does_not_bypass_provider_receipt_binding(harness, live_completion, entry):
    from models import PaymentReconciliationCase
    async with harness.sessions() as db:
        db.add(PaymentReconciliationCase(transaction_id='transaction', session_id=SESSION,
            payment_intent_id='intent-fixture', amount_cents=2500, currency='usd',
            reason='live_session_unavailable', state='refunded', refund_id='refund-fixture'))
        tx = await db.get(PaymentTransaction, 'transaction')
        tx.payment_status = tx.status = 'Refunded'
        await db.commit()
    harness.session.amount_total = 1
    if entry == 'status':
        response = await harness.client.get(f'/api/payments/checkout/status/{SESSION}', headers=bearer())
    else:
        response = await harness.client.post('/api/sessions/complete-payment', headers=bearer(),
            json={'checkout_session_id': SESSION})
    assert response.status_code == 400, response.text
    assert live_completion == []
