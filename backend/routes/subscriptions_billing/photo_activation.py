"""Ordered activation locks and frozen photo-plan receipt validation.

Standalone helpers; endpoints and ledger settlement stay in photo_subscriptions.
"""
import math
import json
from fastapi import HTTPException
from sqlalchemy import select
from models import Profile, SurferPhotoSubscription


async def _lock_subscription_parties(db, buyer_id, seller_id):
    """Serialize access decisions and activation with a stable profile lock order."""
    result = await db.execute(select(Profile).where(
        Profile.id.in_(sorted({buyer_id, seller_id}))
    ).order_by(Profile.id).with_for_update().execution_options(populate_existing=True))
    parties = {profile.id: profile for profile in result.scalars().all()}
    if buyer_id not in parties:
        raise HTTPException(status_code=404, detail="User not found")
    return parties[buyer_id]


def _valid_plan_terms(terms, plan_id, photographer_id, amount_cents):
    if not isinstance(terms, dict) or type(terms.get('version')) is not int or terms['version'] != 1:
        return False
    if (terms.get('plan_id') != plan_id or terms.get('photographer_id') != photographer_id
            or type(terms.get('amount_cents')) is not int or terms['amount_cents'] != amount_cents
            or not isinstance(terms.get('name'), str) or not terms['name'].strip()
            or terms.get('interval') not in ('weekly', 'monthly')):
        return False
    for field in ('photos_included', 'videos_included', 'live_session_buyins', 'sessions_included'):
        if type(terms.get(field)) is not int or terms[field] < 0:
            return False
    for field in ('booking_discount_pct', 'on_demand_discount_pct'):
        value = terms.get(field)
        if type(value) not in (int, float) or not math.isfinite(value) or not 0 <= value <= 100:
            return False
    return True


def _freeze_plan_terms(plan, amount_cents):
    terms = {'version': 1, 'plan_id': plan.id, 'photographer_id': plan.photographer_id,
             'amount_cents': amount_cents, 'name': plan.name, 'interval': plan.interval}
    for field in ('photos_included', 'videos_included', 'live_session_buyins', 'sessions_included',
                  'booking_discount_pct', 'on_demand_discount_pct'):
        terms[field] = getattr(plan, field)
    return terms if _valid_plan_terms(terms, plan.id, plan.photographer_id, amount_cents) else None


def _activation_review_response(code):
    messages = {
        'paid_overlap': 'Payment received, but this checkout was not activated because paid-through access already exists. This payment requires review.',
        'plan_terms_unavailable': 'Payment received, but the purchased plan terms could not be verified. Activation requires review.',
        'activation_missing': 'This payment is marked completed, but no unique linked subscription could be confirmed. Activation requires review.',
    }
    return {'success': False, 'activation_status': 'review_required', 'paid': True,
            'code': code, 'message': messages.get(code, 'Payment received; activation requires review.')}


def _recorded_refund_response(transaction):
    statuses = (str(transaction.payment_status or '').strip().lower(),
                str(transaction.status or '').strip().lower())
    if not any(status in ('refunded', 'partially_refunded') for status in statuses):
        return None
    return {'success': False, 'activation_status': 'not_activated',
            'code': 'payment_refunded',
            'message': 'This payment has a recorded refund and cannot activate a subscription.'}


async def _hold_paid_activation(tx, metadata, db, code):
    tx.payment_status = 'paid'
    tx.status = 'review_required'
    tx.transaction_metadata = json.dumps({**metadata, 'activation_review_code': code})
    await db.commit()
    return _activation_review_response(code)


async def _read_completed_activation(tx, metadata, db, serialize):
    result = await db.execute(select(SurferPhotoSubscription).where(
        SurferPhotoSubscription.stripe_session_id == tx.session_id,
        SurferPhotoSubscription.surfer_id == tx.user_id,
        SurferPhotoSubscription.photographer_id == metadata.get('photographer_id'),
    ))
    subscriptions = result.scalars().all()
    if len(subscriptions) != 1:
        return await _hold_paid_activation(tx, metadata, db, 'activation_missing')
    return {'success': True, 'subscription': serialize(subscriptions[0]), 'already_completed': True}
