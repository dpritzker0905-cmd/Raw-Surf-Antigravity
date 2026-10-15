"""Durable checkout purchase identity across provider/process response loss."""
import asyncio
import copy
import json
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest
from sqlalchemy import select, text
from models import Booking, PaymentTransaction, Profile
from test_booking_payment_integrity import bearer, harness, live, schema  # noqa: F401


@pytest.fixture(autouse=True)
def recovery_configuration(harness,monkeypatch):
    monkeypatch.setattr(harness.recovery,'STRIPE_API_KEY',object())


def purchase(kind):
    if kind == 'scheduled':
        return '/api/bookings/create-with-stripe', dict(photographer_id='pro', location='Intent fixture beach',
            duration=60, apply_credits=20, session_date=(datetime.now(timezone.utc)+timedelta(days=14)).isoformat(),
            origin_url='https://frontend.example.invalid')
    return '/api/sessions/join?surfer_id=owner', dict(photographer_id='pro', payment_method='card',
        origin_url='https://frontend.example.invalid')


def receipt(params, identifier='durable-checkout', status='open'):
    return SimpleNamespace(id=identifier, url='https://checkout.example.invalid/durable', status=status,
        payment_status='paid' if status == 'complete' else 'unpaid', currency='usd',
        amount_total=params['line_items'][0]['price_data']['unit_amount'], metadata=copy.deepcopy(params['metadata']),
        expires_at=params['expires_at'], payment_intent='durable-intent-fixture')


@pytest.mark.parametrize('kind', ['scheduled', 'live'])
async def test_local_purchase_is_committed_before_provider_creation(harness, live, monkeypatch, kind):
    # A provider call before durable intent leaves no recoverable purchase after a process crash.
    observations = []
    loop = asyncio.get_running_loop()
    async def observed():
        async with harness.sessions() as db:
            return len((await db.scalars(select(PaymentTransaction.id))).all()), (await db.get(Profile,'owner')).credit_balance
    def create(**params):
        observations.append(asyncio.run_coroutine_threadsafe(observed(), loop).result(10))
        return receipt(params)
    monkeypatch.setattr(harness.module.stripe.checkout.Session, 'create', create)
    route, body = purchase(kind)
    r = await harness.client.post(route, json=body, headers=dict(bearer(), **{'Idempotency-Key': str(uuid.uuid4())}))
    assert observations == [(2, 60 if kind == 'scheduled' else 80)], 'Provider ran before durable purchase/reservation'
    async with harness.sessions() as db:
        from models import CheckoutIntent
        intent=(await db.scalars(select(CheckoutIntent))).one()
        assert intent.provider_params['payment_method_types']==['card']
    assert r.status_code == 200, r.text


@pytest.mark.parametrize('kind', ['scheduled', 'live'])
async def test_response_loss_retry_uses_one_frozen_provider_purchase(harness, live, monkeypatch, kind):
    # The first creation reached Stripe, but its response was lost; retry must not create a second purchase.
    calls=[]
    def create(**params):
        calls.append(copy.deepcopy({k:v for k,v in params.items() if k!='api_key'}))
        if len(calls)==1:
            raise harness.module.stripe.error.APIConnectionError('Injected response loss')
        return receipt(params)
    monkeypatch.setattr(harness.module.stripe.checkout.Session, 'create', create)
    route, body=purchase(kind)
    headers=dict(bearer(), **{'Idempotency-Key': str(uuid.uuid4())})
    first=await harness.client.post(route,json=body,headers=headers)
    assert first.status_code==502, first.text
    second=await harness.client.post(route,json=body,headers=headers)
    assert second.status_code==200,second.text
    assert calls[0].get('idempotency_key') and calls[0]==calls[1], 'Retry changed purchase identity or provider parameters'
    async with harness.sessions() as db:
        assert len((await db.scalars(select(PaymentTransaction))).all())==2
        assert (await db.get(Profile,'owner')).credit_balance==(60 if kind=='scheduled' else 80)


@pytest.mark.parametrize('kind', ['scheduled', 'live'])
async def test_reusing_request_key_for_changed_purchase_is_rejected_before_provider(harness,live,monkeypatch,kind):
    calls=[]
    def create(**params):
        calls.append(params)
        return receipt(params, identifier=f'checkout-{len(calls)}')
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    route,body=purchase(kind)
    headers=dict(bearer(), **{'Idempotency-Key':str(uuid.uuid4())})
    first=await harness.client.post(route,json=body,headers=headers)
    assert first.status_code==200,first.text
    changed=dict(body,origin_url='https://another.example.invalid')
    second=await harness.client.post(route,json=changed,headers=headers)
    assert second.status_code==409,second.text
    assert len(calls)==1


async def lost(h, monkeypatch, kind='scheduled'):
    calls=[]
    def create(**params):
        calls.append(params)
        raise h.module.stripe.error.APIConnectionError('Injected response loss')
    monkeypatch.setattr(h.module.stripe.checkout.Session,'create',create)
    route,body=purchase(kind)
    headers=dict(bearer(), **{'Idempotency-Key':str(uuid.uuid4())})
    r=await h.client.post(route,json=body,headers=headers)
    assert r.status_code==502,r.text
    async with h.sessions() as db:
        from models import CheckoutIntent
        intent=(await db.scalars(select(CheckoutIntent))).one()
        return intent.id,copy.deepcopy(calls[0]),route,body,headers


async def test_signed_lost_response_receipt_binds_before_expired_booking_case(harness,monkeypatch):
    # A paid signed receipt remains recoverable after local expiry/rollback of entitlement work.
    from models import CheckoutIntent, BookingParticipant
    from test_booking_payment_integrity import webhook
    identifier,params,*_=await lost(harness,monkeypatch)
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        (await db.get(Booking,intent.booking_id)).status='Cancelled'
        await db.commit()
    session=vars(receipt(params,status='complete'))
    harness.session=SimpleNamespace(**session)
    r=await webhook(harness)
    assert r.status_code==200,r.text
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        tx=await db.get(PaymentTransaction,intent.transaction_id)
        assert tx.session_id=='durable-checkout'
        assert await db.scalar(text('SELECT count(*) FROM payment_reconciliation_cases'))==1
        assert (await db.get(Booking,intent.booking_id)).status=='Cancelled'


@pytest.mark.parametrize('actor,code', [(None,401),('other',403)])
async def test_resume_requires_purchase_owner(harness,monkeypatch,actor,code):
    identifier,*_=await lost(harness,monkeypatch)
    r=await harness.client.post(f'/api/payments/checkout-intents/{identifier}/resume',headers=bearer(actor))
    assert r.status_code==code,r.text


async def test_unknown_outcome_after_retention_window_is_reviewed_without_creation(harness,monkeypatch):
    from models import CheckoutIntent
    identifier,params,*_=await lost(harness,monkeypatch)
    async with harness.sessions() as db:
        (await db.get(CheckoutIntent,identifier)).first_attempt_at=datetime.now(timezone.utc)-timedelta(hours=24)
        await db.commit()
    calls=[]
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',lambda **kw: calls.append(kw))
    r=await harness.client.post(f'/api/payments/checkout-intents/{identifier}/resume',headers=bearer())
    assert r.status_code==409,r.text
    assert calls==[]
    async with harness.sessions() as db:
        assert (await db.get(CheckoutIntent,identifier)).state=='review_required'


async def test_owner_queue_exposes_unknown_intent_without_private_provider_parameters(harness,monkeypatch):
    identifier,*_=await lost(harness,monkeypatch)
    r=await harness.client.get('/api/payments/checkout-intents',headers=bearer())
    assert r.status_code==200,r.text
    assert [x['id'] for x in r.json()['intents']]==[identifier]
    assert 'provider_params' not in r.text and 'customer_email' not in r.text


@pytest.mark.parametrize('change', ['amount','currency','metadata','binding'])
async def test_admin_attach_rejects_mismatched_provider_receipt(harness,monkeypatch,change):
    identifier,params,*_=await lost(harness,monkeypatch)
    session=receipt(params)
    if change=='amount': session.amount_total=1
    elif change=='currency': session.currency='eur'
    elif change=='metadata': session.metadata['user_id']='other'
    else: session.metadata['checkout_intent_id']='another-intent'
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'retrieve',lambda *a,**kw:session)
    async with harness.sessions() as db:
        (await db.get(Profile,'other')).is_admin=True
        await db.commit()
    r=await harness.client.post(f'/api/payments/reconciliation/checkout-intents/{identifier}/attach',
        headers=bearer('other'),json={'session_id':session.id})
    assert r.status_code==400,r.text


async def test_admin_can_attach_verified_session_after_unsafe_recreation_window(harness,monkeypatch):
    from models import CheckoutIntent
    identifier,params,*_=await lost(harness,monkeypatch)
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        intent.state='review_required'
        intent.first_attempt_at=datetime.now(timezone.utc)-timedelta(hours=24)
        (await db.get(Profile,'other')).is_admin=True
        await db.commit()
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'retrieve',lambda *a,**kw:receipt(params))
    r=await harness.client.post(f'/api/payments/reconciliation/checkout-intents/{identifier}/attach',
        headers=bearer('other'),json={'session_id':'durable-checkout'})
    assert r.status_code==200,r.text
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        assert intent.session_id=='durable-checkout'
        assert (await db.get(PaymentTransaction,intent.transaction_id)).session_id=='durable-checkout'


@pytest.mark.parametrize('entry',['status','scheduled','live'])
async def test_placeholder_never_reaches_provider(harness,live,monkeypatch,entry):
    from models import CheckoutIntent
    identifier,*_=await lost(harness,monkeypatch,'live' if entry=='live' else 'scheduled')
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        tx=await db.get(PaymentTransaction,intent.transaction_id)
        placeholder=tx.session_id
        booking=intent.booking_id
    calls=[]
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'retrieve',lambda *a,**kw:calls.append(a))
    if entry=='status':
        r=await harness.client.get('/api/payments/checkout/status/'+placeholder,headers=bearer())
    elif entry=='scheduled':
        r=await harness.client.get('/api/bookings/payment-success',headers=bearer(),params={'session_id':placeholder,'booking_id':booking})
    else:
        from test_booking_payment_integrity import live_completion
        # Load the actual live-completion route through its existing focused fixture.
        await live_completion.__wrapped__(harness,live,monkeypatch)
        r=await harness.client.post('/api/sessions/complete-payment',headers=bearer(),json={'checkout_session_id':placeholder})
    assert r.status_code==409,r.text
    assert calls==[]


@pytest.mark.parametrize('kind',['scheduled','live'])
async def test_failed_attachment_commit_keeps_recoverable_purchase(harness,live,monkeypatch,kind):
    from models import CheckoutIntent
    calls=[]
    def create(**params):
        calls.append({k:v for k,v in params.items() if k!='api_key'})
        return receipt(params)
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    original=harness.sessions.class_.commit
    count=0
    async def commit(self):
        nonlocal count
        count+=1
        if count==3:
            raise RuntimeError('Injected binding commit failure')
        await original(self)
    monkeypatch.setattr(harness.sessions.class_,'commit',commit)
    route,body=purchase(kind);headers=dict(bearer(),**{'Idempotency-Key':str(uuid.uuid4())})
    first=await harness.client.post(route,json=body,headers=headers)
    assert first.status_code==502,first.text
    async with harness.sessions() as db:
        intent=(await db.scalars(select(CheckoutIntent))).one()
        assert intent.state=='creating' and intent.session_id is None
    second=await harness.client.post(route,json=body,headers=headers)
    assert second.status_code==200,second.text
    assert len(calls)==2 and calls[0]==calls[1]
    async with harness.sessions() as db:
        assert len((await db.scalars(select(CheckoutIntent))).all())==1
        assert len((await db.scalars(select(PaymentTransaction))).all())==2


async def test_webhook_winning_create_response_does_not_expose_stale_checkout(harness,monkeypatch):
    from test_booking_payment_integrity import webhook
    from models import CheckoutIntent
    loop=asyncio.get_running_loop();events=[]
    async def paid(params):
        harness.session=receipt(params,status='complete')
        events.append(await webhook(harness))
    def create(**params):
        asyncio.run_coroutine_threadsafe(paid(params),loop).result(15)
        return receipt(params) # Original open snapshot arrived after the signed paid event.
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    route,body=purchase('scheduled')
    r=await harness.client.post(route,json=body,headers=dict(bearer(),**{'Idempotency-Key':str(uuid.uuid4())}))
    assert [event.status_code for event in events]==[200]
    assert r.status_code==409 and 'checkout_url' not in r.text,r.text
    async with harness.sessions() as db:
        intent=(await db.scalars(select(CheckoutIntent))).one()
        assert (await db.get(PaymentTransaction,intent.transaction_id)).payment_status=='paid'
        assert (await db.get(Booking,intent.booking_id)).status=='Confirmed'


async def test_retry_uses_original_purchase_after_balance_and_price_change(harness,monkeypatch):
    identifier,params,route,body,headers=await lost(harness,monkeypatch)
    async with harness.sessions() as db:
        (await db.get(Profile,'owner')).credit_balance=0
        (await db.get(Profile,'pro')).booking_hourly_rate=200
        await db.commit()
    captured=[]
    def create(**kw):captured.append(kw);return receipt(kw)
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    r=await harness.client.post(route,json=body,headers=headers)
    assert r.status_code==200,r.text
    assert r.json()['checkout_intent_id']==identifier
    assert captured[0]['line_items'][0]['price_data']['unit_amount']==8000
    async with harness.sessions() as db:assert (await db.get(Profile,'owner')).credit_balance==0


async def test_live_retry_does_not_consume_subscription_quota(harness,live,monkeypatch):
    import sys
    identifier,params,route,body,headers=await lost(harness,monkeypatch,'live')
    calls=[]
    async def forbidden(*a,**kw):calls.append(1);return {'used':True}
    monkeypatch.setattr(sys.modules['routes.subscriptions_billing.photo_sub_helpers'],'try_use_subscription_quota',forbidden)
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',lambda **kw:receipt(kw))
    r=await harness.client.post(route,json=body,headers=headers)
    assert r.status_code==200,r.text
    assert calls==[] and r.json()['checkout_intent_id']==identifier


@pytest.mark.parametrize('kind',['scheduled','live'])
async def test_legacy_response_loss_reuses_same_purchase_without_header(harness,live,monkeypatch,kind):
    calls=[]
    def create(**params):
        calls.append({k:v for k,v in params.items() if k!='api_key'})
        if len(calls)==1:raise harness.module.stripe.error.APIConnectionError('Injected response loss')
        return receipt(params)
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    route,body=purchase(kind)
    assert (await harness.client.post(route,json=body,headers=bearer())).status_code==502
    r=await harness.client.post(route,json=body,headers=bearer())
    assert r.status_code==200,r.text
    assert calls[0]==calls[1]


async def test_neighboring_deposit_creation_remains_unchanged(harness,monkeypatch):
    from unittest.mock import AsyncMock
    create=AsyncMock(return_value=SimpleNamespace(session_id='deposit-new',url='https://checkout.example.invalid/deposit'))
    monkeypatch.setattr(harness.payments.StripeCheckout,'create_checkout_session',create)
    r=await harness.client.post('/api/payments/checkout',headers=bearer(),json={
        'package_id':'1hr','origin_url':'https://frontend.example.invalid','photographer_id':'pro'})
    assert r.status_code==200,r.text
    assert r.json()['session_id']=='deposit-new' and create.await_count==1


@pytest.mark.parametrize('kind',['scheduled','live'])
async def test_service_disappearing_during_create_never_exposes_checkout(harness,live,monkeypatch,kind):
    from models import CheckoutIntent, LiveSession
    loop=asyncio.get_running_loop()
    async def unavailable(params):
        async with harness.sessions() as db:
            if kind=='scheduled':
                intent=(await db.scalars(select(CheckoutIntent))).one()
                (await db.get(Booking,intent.booking_id)).status='Cancelled'
            else:
                (await db.get(LiveSession,'live')).status='ended'
            await db.commit()
    def create(**params):
        asyncio.run_coroutine_threadsafe(unavailable(params),loop).result(10)
        return receipt(params)
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',create)
    route,body=purchase(kind)
    r=await harness.client.post(route,json=body,headers=dict(bearer(),**{'Idempotency-Key':str(uuid.uuid4())}))
    assert r.status_code==409 and 'checkout_url' not in r.text,r.text
    async with harness.sessions() as db:
        intent=(await db.scalars(select(CheckoutIntent))).one()
        assert intent.session_id=='durable-checkout'


@pytest.mark.parametrize('kind',['scheduled','live'])
async def test_attempt_checkpoint_failure_never_calls_provider(harness,live,monkeypatch,kind):
    from models import CheckoutIntent
    original=harness.sessions.class_.commit
    count=0
    async def commit(self):
        nonlocal count
        count+=1
        if count==2:raise RuntimeError('Injected attempt checkpoint failure')
        await original(self)
    monkeypatch.setattr(harness.sessions.class_,'commit',commit)
    route,body=purchase(kind);headers=dict(bearer(),**{'Idempotency-Key':str(uuid.uuid4())})
    assert (await harness.client.post(route,json=body,headers=headers)).status_code==500
    assert harness.created==[]
    async with harness.sessions() as db:
        intent=(await db.scalars(select(CheckoutIntent))).one()
        assert intent.state=='prepared' and intent.first_attempt_at is None
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',lambda **kw:receipt(kw))
    assert (await harness.client.post(route,json=body,headers=headers)).status_code==200


@pytest.mark.parametrize('kind',['scheduled','live'])
async def test_lost_prepare_commit_ack_reuses_durable_purchase(harness,live,monkeypatch,kind):
    from models import CheckoutIntent
    original=harness.sessions.class_.commit
    count=0
    async def commit(self):
        nonlocal count
        count+=1
        await original(self)
        if count==1:raise RuntimeError('Injected commit acknowledgement loss')
    monkeypatch.setattr(harness.sessions.class_,'commit',commit)
    route,body=purchase(kind);headers=dict(bearer(),**{'Idempotency-Key':str(uuid.uuid4())})
    assert (await harness.client.post(route,json=body,headers=headers)).status_code==500
    assert harness.created==[]
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',lambda **kw:receipt(kw))
    r=await harness.client.post(route,json=body,headers=headers)
    assert r.status_code==200,r.text
    async with harness.sessions() as db:
        assert len((await db.scalars(select(CheckoutIntent))).all())==1
        assert (await db.get(Profile,'owner')).credit_balance==(60 if kind=='scheduled' else 80)


async def test_expiry_refunds_partial_once_then_late_receipt_records_one_case(harness,monkeypatch):
    from models import CheckoutIntent, CreditTransaction
    from test_booking_payment_integrity import webhook
    import importlib.util
    from pathlib import Path
    import database
    identifier,params,*_=await lost(harness,monkeypatch)
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        (await db.get(Booking,intent.booking_id)).pending_payment_expires_at=datetime.now(timezone.utc)-timedelta(minutes=1)
        await db.commit()
    monkeypatch.setattr(database,'async_session_maker',harness.sessions)
    spec=importlib.util.spec_from_file_location('orphan_expiry',Path(__file__).parents[1]/'scheduler/bookings.py')
    scheduler=importlib.util.module_from_spec(spec);spec.loader.exec_module(scheduler)
    await scheduler.cleanup_expired_booking_payments_task()
    await scheduler.cleanup_expired_booking_payments_task()
    harness.session=receipt(params,status='complete')
    for _ in range(2):assert (await webhook(harness)).status_code==200
    async with harness.sessions() as db:
        intent=await db.get(CheckoutIntent,identifier)
        assert (await db.get(Profile,'owner')).credit_balance==80
        assert (await db.get(Booking,intent.booking_id)).status=='Cancelled'
        assert len((await db.scalars(select(CreditTransaction))).all())==2
        assert await db.scalar(text('SELECT count(*) FROM payment_reconciliation_cases'))==1


@pytest.mark.parametrize('actor,code',[(None,401),('owner',403),('other',403)])
async def test_admin_intent_queue_requires_admin(harness,actor,code):
    r=await harness.client.get('/api/payments/reconciliation/checkout-intents',headers=bearer(actor))
    assert r.status_code==code,r.text


async def test_canonical_scan_never_sends_placeholder_to_provider(harness,monkeypatch):
    await lost(harness,monkeypatch)
    called=[]
    def retrieve(identifier,**kw):called.append(identifier);return harness.session
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'retrieve',retrieve)
    async with harness.sessions() as db:
        (await db.get(Profile,'other')).is_admin=True
        await db.commit()
    r=await harness.client.post('/api/payments/reconciliation/scan',headers=bearer('other'))
    assert r.status_code==200,r.text
    assert called==['checkout-fixture']


async def test_known_session_after_retention_window_is_retrieved_never_recreated(harness,monkeypatch):
    from models import CheckoutIntent
    identifier,params,*_=await lost(harness,monkeypatch)
    from utils.checkout_intents import bind
    async with harness.sessions() as db:
        await bind(db,identifier,receipt(params))
        intent=await db.get(CheckoutIntent,identifier)
        intent.first_attempt_at=datetime.now(timezone.utc)-timedelta(hours=24)
        await db.commit()
    calls=[]
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'create',lambda **kw:calls.append('create'))
    monkeypatch.setattr(harness.module.stripe.checkout.Session,'retrieve',lambda *a,**kw:receipt(params,status='expired'))
    r=await harness.client.post(f'/api/payments/checkout-intents/{identifier}/resume',headers=bearer())
    assert r.status_code==409 and calls==[],r.text


async def test_slot_rejection_explicitly_proves_no_purchase_was_prepared(harness, monkeypatch):
    from unittest.mock import AsyncMock
    from models import CheckoutIntent
    monkeypatch.setattr(harness.module, 'check_time_slot_conflict', AsyncMock(return_value={'message': 'Occupied slot'}))
    route, body = purchase('scheduled')
    response = await harness.client.post(route, json=body, headers=dict(bearer(), **{'Idempotency-Key': 'fresh-slot-request'}))
    assert response.status_code == 409
    assert isinstance(response.json()['detail'], dict)
    assert response.json()['detail']['checkout_intent_created'] is False
    assert harness.created == []
    async with harness.sessions() as db:
        assert not (await db.scalars(select(CheckoutIntent))).all()


async def test_live_unavailability_proves_no_purchase_was_prepared(harness, live):
    from models import CheckoutIntent
    async with harness.sessions() as db:
        (await db.get(Profile, 'pro')).is_shooting = False
        await db.commit()
    route, body = purchase('live')
    response = await harness.client.post(route, json=body, headers=dict(bearer(), **{'Idempotency-Key': 'fresh-live-request'}))
    assert response.status_code == 400
    assert isinstance(response.json()['detail'], dict)
    assert response.json()['detail']['checkout_intent_created'] is False
    async with harness.sessions() as db:
        assert not (await db.scalars(select(CheckoutIntent))).all()


@pytest.mark.parametrize('overrides', [{'duration': 0}, {'duration': 30, 'apply_credits': 50}])
async def test_correctable_scheduled_rejection_proves_no_purchase_exists(harness, overrides):
    from models import CheckoutIntent
    route, body = purchase('scheduled')
    response = await harness.client.post(route, json={**body, **overrides},
        headers=dict(bearer(), **{'Idempotency-Key': 'correctable-scheduled-request'}))
    assert response.status_code == 400, response.text
    assert response.json()['detail']['checkout_intent_created'] is False
    assert harness.created == []
    async with harness.sessions() as db:
        assert not (await db.scalars(select(CheckoutIntent))).all()
