"""Admin recovery of missed or unfulfillable scheduled/live booking payments."""
from datetime import datetime, timedelta, timezone
import os

from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession
from starlette.concurrency import run_in_threadpool
import stripe

from database import get_db
from deps.admin_auth import get_current_admin
from models import CheckoutIntent, Booking, LiveSession, LiveSessionParticipant, PaymentReconciliationCase, PaymentTransaction, Profile
from utils.payment_reconciliation import PaymentNeedsReconciliation, receipt_identity, record_case
from utils.scheduled_booking_payment import field, fulfill_scheduled_booking, is_scheduled_booking, metadata_of


router = APIRouter(prefix='/payments/reconciliation')
STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')


def require_provider():
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=503, detail='Payment recovery not configured')


def representation(case):
    return {key: getattr(case, key) for key in (
        'id', 'transaction_id', 'session_id', 'reason', 'state', 'amount_cents', 'currency',
        'refund_id', 'last_error_type', 'created_at', 'updated_at', 'resolved_by')}


@router.get('')
async def list_cases(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db),
                     limit: int = Query(50, ge=1, le=100), offset: int = Query(0, ge=0)):
    cases = (await db.scalars(select(PaymentReconciliationCase).order_by(
        PaymentReconciliationCase.created_at, PaymentReconciliationCase.id).offset(offset).limit(limit))).all()
    return {'cases': [representation(case) for case in cases]}


@router.post('/scan')
async def scan_pending(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db),
                       limit: int = Query(25, ge=1, le=100), after_id: str | None = Query(None, max_length=36)):
    """Explicit bounded scan, never a background sweep against a shared live service."""
    require_provider()
    query = select(PaymentTransaction.id).where(
        PaymentTransaction.payment_status == 'Pending', PaymentTransaction.status == 'Pending',
        ~PaymentTransaction.session_id.startswith('pending:')
    )
    if after_id is not None:
        query = query.where(PaymentTransaction.id > after_id)
    identifiers = (await db.scalars(query.order_by(PaymentTransaction.id).limit(limit))).all()
    await db.rollback()
    result = dict(checked=0, fulfilled=0, cases=0, unpaid=0, unsupported=0, errors=0,
                  next_cursor=identifiers[-1] if len(identifiers) == limit else None)
    for identifier in identifiers:
        tx = await db.get(PaymentTransaction, identifier)
        if not is_scheduled_booking(tx) and metadata_of(tx).get('type') != 'live_session_join':
            result['unsupported'] += 1
            await db.rollback()
            continue
        try:
            session = await run_in_threadpool(stripe.checkout.Session.retrieve, tx.session_id, api_key=STRIPE_API_KEY)
            result['checked'] += 1
            if field(session, 'payment_status') != 'paid':
                result['unpaid'] += 1
                await db.rollback()
                continue
            if is_scheduled_booking(tx):
                _, changed = await fulfill_scheduled_booking(db, tx, session)
                await db.commit()
                result['fulfilled'] += int(changed)
            else:
                receipt_identity(tx, session)
                recovered = await record_case(db, PaymentNeedsReconciliation(tx.id, 'live_callback_missing', session))
                result['cases'] += int(recovered['reconciliation_required'])
        except PaymentNeedsReconciliation as problem:
            recovered = await record_case(db, problem)
            result['cases'] += int(recovered['reconciliation_required'])
        except (stripe.error.StripeError, HTTPException):
            await db.rollback()
            result['errors'] += 1
    return result


async def refundable_state(db, tx):
    if tx.payment_status.lower() in ('paid', 'completed') or tx.status.lower() == 'completed':
        raise HTTPException(status_code=409, detail='Fulfilled payments use the normal cancellation policy')
    if tx.payment_status.lower() == 'refunded':
        raise HTTPException(status_code=409, detail='Payment already refunded outside this case')
    metadata = metadata_of(tx)
    if is_scheduled_booking(tx):
        booking = (await db.scalars(select(Booking).where(Booking.id == metadata.get('booking_id'))
            .with_for_update().execution_options(populate_existing=True))).one_or_none()
        if booking is None or booking.status != 'Cancelled' or booking.creator_id != tx.user_id:
            raise HTTPException(status_code=409, detail='Cancel and review the booking before refunding its unfulfilled card payment')
    else:
        pro = (await db.scalars(select(Profile).where(Profile.id == metadata.get('photographer_id'))
            .with_for_update().execution_options(populate_existing=True))).one_or_none()
        session = (await db.scalars(select(LiveSession).where(LiveSession.id == metadata.get('live_session_id'))
            .with_for_update().execution_options(populate_existing=True))).one_or_none()
        existing = (await db.scalars(select(LiveSessionParticipant.id).where(
            LiveSessionParticipant.surfer_id == tx.user_id,
            LiveSessionParticipant.photographer_id == metadata.get('photographer_id'),
            LiveSessionParticipant.payment_method == 'card', LiveSessionParticipant.status == 'active'))).first()
        if session and session.status == 'active' and pro and pro.is_shooting and not existing:
            raise HTTPException(status_code=409, detail='Available live participation must be reviewed before refund')


@router.post('/{case_id}/refund')
async def refund_case(case_id: str, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Explicit operator refund, with durable intent and a fixed Stripe idempotency key."""
    require_provider()
    admin_id = admin.id
    case = await db.get(PaymentReconciliationCase, case_id)
    if case is None:
        raise HTTPException(status_code=404, detail='Payment case not found')
    transaction_id = case.transaction_id
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == case.transaction_id)
        .with_for_update().execution_options(populate_existing=True))).one()
    case = (await db.scalars(select(PaymentReconciliationCase).where(PaymentReconciliationCase.id == case_id)
        .with_for_update().execution_options(populate_existing=True))).one()
    if case.state == 'refunded':
        return representation(case)
    if case.state == 'review_required':
        raise HTTPException(status_code=409, detail='Provider history must be reviewed manually')
    if tx.payment_status.lower() in ('paid', 'completed', 'refunded') or tx.status.lower() == 'completed':
        raise HTTPException(status_code=409, detail='Payment state requires review before refund recovery')
    # Eligibility is decided before the first money movement. Once its intent
    # is durable, current service availability cannot prevent outcome recovery.
    if not (case.state == 'refund_pending' and case.refund_started_at):
        await refundable_state(db, tx)
    session = await run_in_threadpool(stripe.checkout.Session.retrieve, case.session_id, api_key=STRIPE_API_KEY)
    intent = receipt_identity(tx, session)
    if not intent or (case.payment_intent_id and intent != case.payment_intent_id):
        raise HTTPException(status_code=400, detail='Refund payment intent does not match verified receipt')
    if case.amount_cents != field(session, 'amount_total') or case.currency != field(session, 'currency'):
        raise HTTPException(status_code=400, detail='Refund amount does not match case')
    now = datetime.now(timezone.utc)
    started = case.refund_started_at
    if started and started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    # Stripe may prune idempotency keys at 24h. Unknown outcomes must never be
    # retried as new money movements beyond a conservative 23h window.
    if started and not case.refund_id and now - started >= timedelta(hours=23):
        case.state, case.last_error_type = 'review_required', 'IdempotencyWindowElapsed'
        await db.commit()
        raise HTTPException(status_code=409, detail='Refund outcome needs provider-history review')
    case.payment_intent_id = intent
    case.refund_started_at = started or now
    case.state, tx.status = 'refund_pending', 'Reconciliation'
    await db.commit()  # Durable before the provider side effect; fixed parameters on every retry.
    try:
        if case.refund_id:
            refund = await run_in_threadpool(stripe.Refund.retrieve, case.refund_id, api_key=STRIPE_API_KEY)
        else:
            refund = await run_in_threadpool(stripe.Refund.create, payment_intent=intent,
                amount=case.amount_cents, idempotency_key=f'payment-case-refund:{case.id}', api_key=STRIPE_API_KEY)
    except stripe.error.StripeError as exc:
        # Only the exception class is retained; provider payloads can contain PII.
        await db.rollback()
        tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == transaction_id).with_for_update())).one()
        case = (await db.scalars(select(PaymentReconciliationCase).where(PaymentReconciliationCase.id == case_id)
            .with_for_update().execution_options(populate_existing=True))).one()
        if case.state == 'refunded':
            return representation(case)
        case.last_error_type = type(exc).__name__
        await db.commit()
        raise HTTPException(status_code=502, detail='Refund outcome is pending; retry the same case') from exc
    # Re-acquire the transaction lock after the durable pre-provider commit.
    tx = (await db.scalars(select(PaymentTransaction).where(PaymentTransaction.id == case.transaction_id)
        .with_for_update().execution_options(populate_existing=True))).one()
    case = (await db.scalars(select(PaymentReconciliationCase).where(PaymentReconciliationCase.id == case_id)
        .with_for_update().execution_options(populate_existing=True))).one()
    if case.state == 'refunded':
        return representation(case)
    if not (field(refund, 'id') and field(refund, 'payment_intent') == case.payment_intent_id
            and field(refund, 'amount') == case.amount_cents and field(refund, 'currency') == case.currency):
        case.state, case.last_error_type = 'review_required', 'RefundEvidenceMismatch'
    else:
        case.refund_id = field(refund, 'id')
        case.last_error_type = None
        status = field(refund, 'status')
        if status == 'succeeded':
            case.state, case.resolved_by = 'refunded', admin_id
            tx.payment_status = tx.status = 'Refunded'
        elif status in ('pending', 'requires_action'):
            case.state = 'refund_pending'
        else:
            case.state, case.last_error_type = 'review_required', 'RefundNotSucceeded'
    await db.commit()
    return representation(case)


# Owner recovery is distinct from the admin-only reconciliation queue.
from core.security import get_current_user_id
from pydantic import BaseModel, Field
from utils.checkout_intents import bind as bind_intent, resume as resume_intent
checkout_router = APIRouter(prefix='/payments/checkout-intents')


def intent_representation(intent):
    return {key: getattr(intent,key) for key in (
        'id','kind','state','transaction_id','booking_id','session_id','amount_cents',
        'first_attempt_at','last_error_type','created_at','updated_at')}


@checkout_router.get('')
async def owner_intents(user_id: str = Depends(get_current_user_id), db: AsyncSession = Depends(get_db),
                        limit: int = Query(25,ge=1,le=100), after_id: str | None = Query(None,max_length=36)):
    query=select(CheckoutIntent).where(CheckoutIntent.user_id==user_id)
    if after_id is not None:
        query=query.where(CheckoutIntent.id>after_id)
    rows=(await db.scalars(query.order_by(CheckoutIntent.id).limit(limit))).all()
    return {'intents':[intent_representation(row) for row in rows],
            'next_cursor':rows[-1].id if len(rows)==limit else None}


@checkout_router.post('/{intent_id}/resume')
async def owner_resume(intent_id: str, user_id: str = Depends(get_current_user_id),
                        db: AsyncSession = Depends(get_db)):
    intent=await db.get(CheckoutIntent,intent_id)
    if intent is None:
        raise HTTPException(status_code=404,detail='Checkout intent not found')
    if intent.user_id!=user_id:
        raise HTTPException(status_code=403,detail='Cannot resume another purchaser checkout')
    await db.rollback()
    return await resume_intent(db,intent_id,STRIPE_API_KEY)


@router.get('/checkout-intents')
async def admin_intents(admin: Profile = Depends(get_current_admin),db: AsyncSession = Depends(get_db),
                        limit: int = Query(25,ge=1,le=100),after_id: str | None = Query(None,max_length=36)):
    query=select(CheckoutIntent)
    if after_id is not None:
        query=query.where(CheckoutIntent.id>after_id)
    rows=(await db.scalars(query.order_by(CheckoutIntent.id).limit(limit))).all()
    return {'intents':[intent_representation(row) for row in rows],
            'next_cursor':rows[-1].id if len(rows)==limit else None}


class AttachCheckout(BaseModel):
    session_id: str = Field(min_length=1,max_length=255)


@router.post('/checkout-intents/{intent_id}/attach')
async def admin_attach(intent_id: str,data: AttachCheckout,admin: Profile = Depends(get_current_admin),
                       db: AsyncSession = Depends(get_db)):
    require_provider()
    if data.session_id.startswith('pending:'):
        raise HTTPException(status_code=400,detail='A real provider session is required')
    try:
        session=await run_in_threadpool(stripe.checkout.Session.retrieve,data.session_id,api_key=STRIPE_API_KEY)
    except stripe.error.StripeError as exc:
        raise HTTPException(status_code=502,detail='Provider verification unavailable') from exc
    if field(session,'id')!=data.session_id:
        raise HTTPException(status_code=400,detail='Provider session identity mismatch')
    intent,_=await bind_intent(db,intent_id,session)
    return intent_representation(intent)
