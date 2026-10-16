"""Commit purchases before provider creation and reconcile unknown creation outcomes."""
import hashlib
import json
import re
import uuid
from datetime import datetime, timedelta, timezone

import stripe
from fastapi import HTTPException
from sqlalchemy import select
from starlette.concurrency import run_in_threadpool

from models import Booking, CheckoutIntent, PaymentTransaction, Profile, LiveSession
from utils.scheduled_booking_payment import field


def identity(kind, data, request_key, scope=None):
    payload = data.model_dump(mode='json')
    fingerprint = hashlib.sha256(json.dumps([kind, payload], sort_keys=True, allow_nan=False).encode()).hexdigest()
    if request_key is not None and not re.fullmatch(r'[A-Za-z0-9_-]{8,128}', request_key):
        raise HTTPException(status_code=400, detail='Invalid checkout request key')
    stable = request_key if request_key is not None else f'auto:{fingerprint}:{scope or ""}'
    return hashlib.sha256(stable.encode()).hexdigest(), fingerprint


async def existing(db, user_id, kind, key, fingerprint):
    intent = (await db.scalars(select(CheckoutIntent).where(
        CheckoutIntent.user_id == user_id, CheckoutIntent.request_key == key))).one_or_none()
    if intent and (intent.fingerprint != fingerprint or intent.kind != kind):
        raise HTTPException(status_code=409, detail='Request key already belongs to a different purchase')
    return intent.id if intent else None


async def prepare(db, *, user_id, kind, key, fingerprint, params, metadata, amount_cents,
                  response, booking_id=None):
    identifier = str(uuid.uuid4())
    params = dict(params, metadata=dict(params['metadata'], checkout_intent_id=identifier))
    tx = PaymentTransaction(user_id=user_id, session_id=f'pending:{identifier}', amount=amount_cents/100,
        currency='usd', payment_status='Pending', status='Pending',
        transaction_metadata=json.dumps(dict(metadata, checkout_intent_id=identifier)))
    db.add(tx)
    await db.flush()
    db.add(CheckoutIntent(id=identifier, user_id=user_id, transaction_id=tx.id, booking_id=booking_id,
        kind=kind, request_key=key, fingerprint=fingerprint, amount_cents=amount_cents,
        provider_params=params, response_data=response))
    try:
        await db.commit()  # Includes booking, participant and any credit reservation.
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail='Checkout intent could not be saved') from exc
    return identifier


async def locked(db, identifier):
    tx_id = await db.scalar(select(CheckoutIntent.transaction_id).where(CheckoutIntent.id == identifier))
    if tx_id is None:
        raise HTTPException(status_code=404, detail='Checkout intent not found')
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == tx_id)
        .with_for_update().execution_options(populate_existing=True))).one()
    intent = (await db.scalars(select(CheckoutIntent).where(CheckoutIntent.id == identifier)
        .with_for_update().execution_options(populate_existing=True))).one()
    return intent, tx


def problem(intent, message):
    return dict(checkout_intent_id=intent.id, state=intent.state, message=message)


async def bind(db, identifier, session):
    intent, tx = await locked(db, identifier)
    params = intent.provider_params
    metadata = field(session, 'metadata', {})
    session_id = field(session, 'id')
    if not (isinstance(metadata, dict) and all(metadata.get(k) == v for k,v in params['metadata'].items())
            and session_id and isinstance(session_id, str) and not session_id.startswith('pending:')
            and field(session, 'currency') == 'usd' and type(field(session, 'amount_total')) is int
            and field(session, 'amount_total') == intent.amount_cents
            and field(session, 'status') in ('open','complete','expired')
            and (intent.session_id is None or intent.session_id == session_id)
            and tx.session_id in (f'pending:{intent.id}',session_id)):
        raise HTTPException(status_code=400, detail='Provider checkout does not match durable intent')
    tx.session_id = intent.session_id = session_id
    intent.state, intent.last_error_type = 'ready', None
    # Binding must survive rollback of later fulfillment/reconciliation work.
    await db.commit()
    return intent, tx


async def resume(db, identifier, api_key):
    if not api_key:
        raise HTTPException(status_code=503, detail='Payment processing not configured')
    intent, tx = await locked(db, identifier)
    if intent.state == 'review_required':
        raise HTTPException(status_code=409, detail=problem(intent,'Provider history requires review'))
    if tx.payment_status.lower() != 'pending' or tx.status.lower() != 'pending':
        raise HTTPException(status_code=409, detail=problem(intent,'Purchase is already processed'))
    if intent.booking_id:
        booking = await db.scalar(select(Booking).where(Booking.id == intent.booking_id)
            .with_for_update().execution_options(populate_existing=True))
        if not booking or booking.status != 'Pending Payment':
            raise HTTPException(status_code=409, detail=problem(intent,'Booking is no longer available'))
    now = datetime.now(timezone.utc)
    started = intent.first_attempt_at
    if started and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    if not intent.session_id and started and now-started >= timedelta(hours=23):
        intent.state, intent.last_error_type = 'review_required', 'IdempotencyWindowElapsed'
        await db.commit()
        raise HTTPException(status_code=409, detail=problem(intent,'Provider history requires review'))
    if not intent.session_id and not started and params_expired(intent.provider_params, now):
        intent.state, intent.last_error_type = 'review_required','CreationDeadlineElapsed'
        await db.commit()
        raise HTTPException(status_code=409, detail=problem(intent,'Checkout creation deadline elapsed'))
    intent.first_attempt_at = started or now
    intent.state = 'creating' if not intent.session_id else 'ready'
    params, session_id = dict(intent.provider_params), intent.session_id
    await db.commit()  # Attempt timestamp survives a process crash before or after the SDK call.
    try:
        if session_id:
            session = await run_in_threadpool(stripe.checkout.Session.retrieve, session_id, api_key=api_key)
        else:
            session = await run_in_threadpool(stripe.checkout.Session.create, **params,
                idempotency_key=f'checkout-intent:{identifier}', api_key=api_key)
    except stripe.error.StripeError as exc:
        await db.rollback()
        intent, tx = await locked(db, identifier)
        if not intent.session_id:
            intent.last_error_type = type(exc).__name__
            if isinstance(exc, stripe.error.InvalidRequestError):
                intent.state = 'review_required'
        await db.commit()
        raise HTTPException(status_code=502, detail=problem(intent,'Checkout outcome pending; retry this purchase')) from exc
    try:
        intent, tx = await bind(db, identifier, session)
    except HTTPException:
        await db.rollback()
        raise
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=502, detail=dict(checkout_intent_id=identifier,
            message='Checkout outcome pending; resume this purchase')) from exc
    # A cancellation or paid webhook can win while the provider request is in flight.
    intent, tx = await locked(db, identifier)
    if tx.payment_status.lower() != 'pending' or tx.status.lower() != 'pending':
        raise HTTPException(status_code=409, detail=problem(intent,'Purchase is already processed'))
    if intent.booking_id:
        booking = await db.scalar(select(Booking).where(Booking.id == intent.booking_id)
            .with_for_update().execution_options(populate_existing=True))
        if not booking or booking.status != 'Pending Payment':
            raise HTTPException(status_code=409, detail=problem(intent,'Booking is no longer available'))
    elif intent.kind == 'live':
        metadata=params['metadata']
        pro=await db.scalar(select(Profile).where(Profile.id==metadata['photographer_id'])
            .with_for_update().execution_options(populate_existing=True))
        live=await db.scalar(select(LiveSession).where(LiveSession.id==metadata['live_session_id'])
            .with_for_update().execution_options(populate_existing=True))
        if not pro or not pro.is_shooting or not live or live.status!='active':
            raise HTTPException(status_code=409,detail=problem(intent,'Live session is no longer available'))
    if field(session,'status') != 'open' or not field(session,'url'):
        raise HTTPException(status_code=409, detail=problem(intent,'Checkout is no longer open'))
    return dict(intent.response_data, checkout_intent_id=intent.id,
                checkout_url=field(session,'url'), session_id=intent.session_id)


def params_expired(params, now):
    # New creation needs Stripe's minimum30m lifetime; never change frozen parameters on retry.
    return params['expires_at'] < int((now+timedelta(minutes=30)).timestamp())
