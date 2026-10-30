"""
Photo Subscriptions — Photographer ↔ Surfer recurring plans.
Photographers define weekly/monthly bundles; surfers subscribe via credits or card.
When subscription expires, surfer reverts to regular rates.
Minimum pricing: $5/week enforced server-side.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, update, func
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import os
import stripe
import json
import logging

from database import get_db
from utils.checkout_recovery import persist_pending_checkout
from .photo_activation import (
    _lock_subscription_parties, _valid_plan_terms, _freeze_plan_terms,
    _activation_review_response, _hold_paid_activation, _read_completed_activation,
    _recorded_refund_response,
)
from utils.credits import deduct_credits, add_credits, clean_amount
from .photo_sub_helpers import (
    subscription_utc, subscription_has_access, subscription_access_filters,
    select_access_subscription,
)
from core.security import get_current_user_id
from models import (
    Profile, PhotographerSubscriptionPlan, SurferPhotoSubscription,
    PaymentTransaction, RoleEnum
)

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# ── Constants ────────────────────────────────────────────────
MIN_WEEKLY_PRICE = 5.0
MIN_MONTHLY_PRICE = 15.0   # ~$3.75/week equivalent


def _require_caller(surfer_id: str, current_user_id: str) -> None:
    """A surfer's subscriptions and quota are read and spent only by that surfer's own token."""
    if surfer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on another user's subscriptions")

async def _subscription_seller(db, seller_id):
    """Lock and validate the seller before staging a subscription or earning."""
    result = await db.execute(select(Profile).where(Profile.id == seller_id)
                              .with_for_update().execution_options(populate_existing=True))
    seller = result.scalar_one_or_none()
    if seller is None or seller.role not in (RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO):
        raise HTTPException(status_code=409, detail="Subscription seller requires reconciliation")
    amounts = [clean_amount(round(value or 0, 2)) for value in (
        seller.credit_balance, seller.spend_only_credits, seller.withdrawable_credits)]
    if any(value is None for value in amounts):
        raise HTTPException(status_code=409, detail="Seller wallet requires reconciliation")
    total, promo, cash = [int(round(value * 100)) for value in amounts]
    if not 0 <= promo <= total or not 0 <= cash <= total - promo:
        # add_credits synchronizes pockets to total-minus-promo. Do not let that
        # clamp unsupported legacy cash away or silently backfill historical total.
        raise HTTPException(status_code=409, detail="Seller wallet requires reconciliation")
    return seller


async def _settle_subscription_seller(db, seller, gross, subscription_id, buyer_id):
    """Credit the already-locked, validated seller without historical backfill."""
    gross = clean_amount(gross)
    if gross is None:
        raise HTTPException(status_code=409, detail="Payment amount requires reconciliation")
    # Preserve this product's existing standard/Premium fee, independently of
    # other products' tier aliases or admin-configured commission policies.
    share = round(gross * (0.85 if seller.subscription_tier == 'premium' else 0.80), 2)
    ok, _balance, error = await add_credits(
        seller.id, share, 'photo_subscription_earning', db,
        description='Photo subscription earnings', reference_type='photo_subscription',
        reference_id=subscription_id, counterparty_id=buyer_id)
    if not ok:
        raise HTTPException(status_code=409, detail=error or "Could not credit subscription seller")
    return share


async def _completed_activation(tx, metadata, db):
    return await _read_completed_activation(tx, metadata, db, _sub_to_dict)


# ── Pydantic schemas ─────────────────────────────────────────

class PlanCreate(BaseModel):
    name: str = Field(..., max_length=100)
    interval: str = Field(..., pattern=r'^(weekly|monthly)$')
    price: float
    photos_included: int = 0
    videos_included: int = 0
    live_session_buyins: int = 0
    sessions_included: int = 0
    booking_discount_pct: float = 0.0
    on_demand_discount_pct: float = 0.0
    description: Optional[str] = None

class PlanUpdate(BaseModel):
    name: Optional[str] = None
    price: Optional[float] = None
    photos_included: Optional[int] = None
    videos_included: Optional[int] = None
    live_session_buyins: Optional[int] = None
    sessions_included: Optional[int] = None
    booking_discount_pct: Optional[float] = None
    on_demand_discount_pct: Optional[float] = None
    description: Optional[str] = None
    is_active: Optional[bool] = None

class SubscribeRequest(BaseModel):
    plan_id: str
    payment_method: str = 'credits'   # 'credits' or 'card'
    origin_url: Optional[str] = None


# ── Helper: validate pricing ─────────────────────────────────
def _validate_price(interval: str, price: float):
    minimum = MIN_WEEKLY_PRICE if interval == 'weekly' else MIN_MONTHLY_PRICE
    if price < minimum:
        raise HTTPException(
            status_code=400,
            detail=f"Minimum price for {interval} plans is ${minimum:.2f}"
        )
    if price > 9999:
        raise HTTPException(status_code=400, detail="Price exceeds maximum ($9,999)")


def _plan_to_dict(plan: PhotographerSubscriptionPlan, subscriber_count: int = 0):
    return {
        "id": plan.id,
        "photographer_id": plan.photographer_id,
        "name": plan.name,
        "interval": plan.interval,
        "price": plan.price,
        "is_active": plan.is_active,
        "photos_included": plan.photos_included,
        "videos_included": plan.videos_included,
        "live_session_buyins": plan.live_session_buyins,
        "sessions_included": plan.sessions_included,
        "booking_discount_pct": plan.booking_discount_pct,
        "on_demand_discount_pct": plan.on_demand_discount_pct,
        "description": plan.description,
        "subscriber_count": subscriber_count,
        "created_at": plan.created_at.isoformat() if plan.created_at else None,
        "updated_at": plan.updated_at.isoformat() if plan.updated_at else None,
    }


def _sub_to_dict(sub: SurferPhotoSubscription):
    return {
        "id": sub.id,
        "surfer_id": sub.surfer_id,
        "photographer_id": sub.photographer_id,
        "plan_id": sub.plan_id,
        "plan_name": sub.plan_name,
        "plan_interval": sub.plan_interval,
        "plan_price": sub.plan_price,
        "status": sub.status,
        "started_at": subscription_utc(sub.started_at).isoformat() if sub.started_at else None,
        "expires_at": subscription_utc(sub.expires_at).isoformat() if sub.expires_at else None,
        "access_active": subscription_has_access(sub),
        "photos_remaining": sub.photos_remaining,
        "videos_remaining": sub.videos_remaining,
        "live_session_buyins_remaining": sub.live_session_buyins_remaining,
        "sessions_remaining": sub.sessions_remaining,
        "booking_discount_pct": sub.booking_discount_pct,
        "on_demand_discount_pct": sub.on_demand_discount_pct,
        "amount_paid": sub.amount_paid,
        "payment_method": sub.payment_method,
        "created_at": sub.created_at.isoformat() if sub.created_at else None,
    }


# ══════════════════════════════════════════════════════════════
# PHOTOGRAPHER PLAN MANAGEMENT
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/plans/{photographer_id}")
async def get_plans(photographer_id: str, db: AsyncSession = Depends(get_db)):
    """Get a photographer's subscription plans (public — surfers call this too)."""
    result = await db.execute(
        select(PhotographerSubscriptionPlan)
        .where(PhotographerSubscriptionPlan.photographer_id == photographer_id)
        .order_by(PhotographerSubscriptionPlan.interval, PhotographerSubscriptionPlan.price)
    )
    plans = result.scalars().all()

    # Count active subscribers per plan
    out = []
    for plan in plans:
        count_q = await db.execute(
            select(SurferPhotoSubscription)
            .where(and_(
                SurferPhotoSubscription.plan_id == plan.id,
                *subscription_access_filters()
            ))
        )
        count = len(count_q.scalars().all())
        out.append(_plan_to_dict(plan, subscriber_count=count))
    return out


@router.post("/photo-subscriptions/plans")
async def create_plan(
    data: PlanCreate,
    photographer_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Photographer creates a new subscription plan."""
    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    # Verify photographer exists and has selling rights
    prof = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = prof.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    if photographer.role.value not in ('Photographer', 'Approved Pro'):
        raise HTTPException(status_code=403, detail="Only professional photographers can create subscription plans")

    # Subscription plans require a paid platform tier (Basic or Premium)
    tier = (photographer.subscription_tier or 'free').lower()
    if tier in ('free', ''):
        raise HTTPException(
            status_code=403,
            detail="Subscription plans are available for photographers on paid plans (Basic or Premium). Upgrade your account to unlock this feature."
        )

    _validate_price(data.interval, data.price)

    plan = PhotographerSubscriptionPlan(
        photographer_id=photographer_id,
        name=data.name,
        interval=data.interval,
        price=data.price,
        photos_included=data.photos_included,
        videos_included=data.videos_included,
        live_session_buyins=data.live_session_buyins,
        sessions_included=data.sessions_included,
        booking_discount_pct=min(data.booking_discount_pct, 100.0),
        on_demand_discount_pct=min(data.on_demand_discount_pct, 100.0),
        description=data.description,
    )
    db.add(plan)
    await db.commit()
    await db.refresh(plan)
    return _plan_to_dict(plan)


@router.patch("/photo-subscriptions/plans/{plan_id}")
async def update_plan(
    plan_id: str,
    data: PlanUpdate,
    photographer_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Photographer updates an existing plan."""
    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(
        select(PhotographerSubscriptionPlan).where(
            PhotographerSubscriptionPlan.id == plan_id,
            PhotographerSubscriptionPlan.photographer_id == photographer_id,
        )
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    updates = data.dict(exclude_unset=True)
    if 'price' in updates:
        _validate_price(plan.interval, updates['price'])
    if 'booking_discount_pct' in updates:
        updates['booking_discount_pct'] = min(updates['booking_discount_pct'], 100.0)
    if 'on_demand_discount_pct' in updates:
        updates['on_demand_discount_pct'] = min(updates['on_demand_discount_pct'], 100.0)

    for key, val in updates.items():
        setattr(plan, key, val)
    await db.commit()
    await db.refresh(plan)
    return _plan_to_dict(plan)


@router.delete("/photo-subscriptions/plans/{plan_id}")
async def deactivate_plan(
    plan_id: str,
    photographer_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Soft-deactivate a plan (existing subs stay active until expiry)."""
    if photographer_id != current_user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(
        select(PhotographerSubscriptionPlan).where(
            PhotographerSubscriptionPlan.id == plan_id,
            PhotographerSubscriptionPlan.photographer_id == photographer_id,
        )
    )
    plan = result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found")

    plan.is_active = False
    await db.commit()
    return {"success": True, "message": "Plan deactivated. Existing subscribers keep access until expiry."}


# ══════════════════════════════════════════════════════════════
# SURFER SUBSCRIBE / RENEW
# ══════════════════════════════════════════════════════════════

@router.post("/photo-subscriptions/subscribe")
async def subscribe_to_plan(
    data: SubscribeRequest,
    surfer_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Surfer subscribes (or renews) a photographer's plan via credits or card."""
    _require_caller(surfer_id, current_user_id)
    # Load plan
    plan_result = await db.execute(
        select(PhotographerSubscriptionPlan).where(
            PhotographerSubscriptionPlan.id == data.plan_id,
            PhotographerSubscriptionPlan.is_active == True,
        )
    )
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan not found or inactive")

    # Prevent subscribing to own plans before locking the two distinct parties.
    if surfer_id == plan.photographer_id:
        raise HTTPException(status_code=400, detail="Cannot subscribe to your own plan")
    surfer = await _lock_subscription_parties(db, surfer_id, plan.photographer_id)

    # Paid-through cancelled subscriptions still block a duplicate purchase.
    active_sub = await select_access_subscription(db, surfer_id, plan.photographer_id)
    if active_sub:
        await db.rollback()
        raise HTTPException(
            status_code=400,
            detail="You already have paid-through access with this photographer. Wait for it to expire before subscribing again."
        )

    # Calculate expiry
    now = datetime.now(timezone.utc)
    if plan.interval == 'weekly':
        expires_at = now + timedelta(weeks=1)
    else:
        expires_at = now + timedelta(days=30)

    price = clean_amount(plan.price)
    if price is None:
        raise HTTPException(status_code=409, detail="Plan price requires reconciliation")

    # ── Credit payment ──────────────────────────────────────
    if data.payment_method == 'credits':
        if (surfer.credit_balance or 0) < price:
            raise HTTPException(status_code=400, detail=f"Insufficient credits. Need ${price:.2f}")

        try:
            success, _, error = await deduct_credits(
                surfer_id, price, 'photo_subscription_payment', db,
                reference_type='photo_subscription_plan', reference_id=plan.id)
            if not success:
                raise HTTPException(status_code=400, detail=error)

            seller = await _subscription_seller(db, plan.photographer_id)
            sub = SurferPhotoSubscription(
                surfer_id=surfer_id,
                photographer_id=plan.photographer_id,
                plan_id=plan.id,
                plan_name=plan.name,
                plan_interval=plan.interval,
                plan_price=price,
                expires_at=expires_at,
                photos_remaining=plan.photos_included,
                videos_remaining=plan.videos_included,
                live_session_buyins_remaining=plan.live_session_buyins,
                sessions_remaining=plan.sessions_included,
                booking_discount_pct=plan.booking_discount_pct,
                on_demand_discount_pct=plan.on_demand_discount_pct,
                amount_paid=price,
                payment_method='credits',
            )
            db.add(sub)
            await db.flush()
            await _settle_subscription_seller(db, seller, price, sub.id, surfer_id)
            await db.commit()
            await db.refresh(sub)

            return {
                "success": True,
                "subscription": _sub_to_dict(sub),
                "remaining_credits": surfer.credit_balance,
                "message": f"Subscribed to {plan.name}!"
            }

        except Exception:
            await db.rollback()
            raise

    # ── Card payment (Stripe) ───────────────────────────────
    elif data.payment_method == 'card':
        if not STRIPE_API_KEY:
            await db.rollback()
            raise HTTPException(status_code=500, detail="Stripe not configured")
        terms = _freeze_plan_terms(plan, int(round(price * 100)))
        if terms is None:
            await db.rollback()
            raise HTTPException(status_code=409, detail="Plan terms require reconciliation")

        origin = data.origin_url or 'https://raw-surf.netlify.app'
        try:
            checkout = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{
                    'price_data': {
                        'currency': 'usd',
                        'unit_amount': int(round(price * 100)),
                        'product_data': {
                            'name': f"{plan.name} Subscription",
                            'description': f"{plan.interval.capitalize()} plan • {plan.photos_included} photos, {plan.videos_included} videos",
                        },
                    },
                    'quantity': 1,
                }],
                mode='payment',
                success_url=f"{origin}/bookings?tab=subscriptions&sub_payment=success&checkout_session_id={{CHECKOUT_SESSION_ID}}",
                cancel_url=f"{origin}/bookings?tab=subscriptions&sub_payment=cancelled",
                metadata={
                    "type": "photo_subscription",
                    "surfer_id": surfer_id,
                    "plan_id": plan.id,
                    "photographer_id": plan.photographer_id,
                },
            )
        except Exception as e:
            await db.rollback()
            logger.error(f"Stripe error: {e}")
            raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")

        # Store pending transaction
        await persist_pending_checkout(db, checkout.id, lambda: PaymentTransaction(
            user_id=surfer_id,
            session_id=checkout.id,
            amount=price,
            currency="usd",
            payment_status="pending",
            status="pending",
            transaction_metadata=json.dumps({
                "type": "photo_subscription",
                "plan_id": plan.id,
                "photographer_id": plan.photographer_id,
                "plan_terms": terms,
            })
        ))

        return {
            "success": True,
            "requires_payment": True,
            "checkout_url": checkout.url,
            "session_id": checkout.id,
        }
    else:
        raise HTTPException(status_code=400, detail="Invalid payment method. Use 'credits' or 'card'.")


@router.post("/photo-subscriptions/complete-card-payment")
async def complete_card_subscription(
    checkout_session_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Activate one paid checkout, or retain a terminal paid review outcome."""
    tx_result = await db.execute(select(PaymentTransaction).where(
        PaymentTransaction.session_id == checkout_session_id))
    tx = tx_result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    _require_caller(tx.user_id, current_user_id)
    meta = json.loads(tx.transaction_metadata or '{}')
    if meta.get('type') != 'photo_subscription':
        raise HTTPException(status_code=400, detail="Not a subscription payment")
    surfer_id, plan_id, photographer_id = tx.user_id, meta.get('plan_id'), meta.get('photographer_id')
    if not isinstance(photographer_id, str) or not photographer_id:
        raise HTTPException(status_code=409, detail="Payment seller requires reconciliation")

    try:
        await _lock_subscription_parties(db, surfer_id, photographer_id)
        # A waiting completion must observe the preceding activation/review commit.
        locked = await db.execute(select(PaymentTransaction).where(
            PaymentTransaction.id == tx.id).with_for_update().execution_options(populate_existing=True))
        tx = locked.scalar_one()
        refunded = _recorded_refund_response(tx)
        if refunded is not None:
            return refunded
        meta = json.loads(tx.transaction_metadata or '{}')
        if tx.status == 'review_required':
            return _activation_review_response(meta.get('activation_review_code', 'paid_overlap'))
        if tx.payment_status == 'completed':
            return await _completed_activation(tx, meta, db)

        if not STRIPE_API_KEY:
            raise HTTPException(status_code=500, detail="Stripe not configured")
        try:
            checkout = stripe.checkout.Session.retrieve(checkout_session_id)
        except stripe.error.StripeError as error:
            logger.error("Stripe verification error: %s", error)
            raise HTTPException(status_code=502, detail="Could not verify the payment")
        if checkout.payment_status != 'paid':
            raise HTTPException(status_code=400, detail="Payment not completed")
        paid_meta = checkout.metadata or {}
        if (paid_meta.get('type') != 'photo_subscription'
                or paid_meta.get('surfer_id') != surfer_id
                or paid_meta.get('plan_id') != plan_id
                or not isinstance(checkout.amount_total, int)
                or abs(checkout.amount_total - (tx.amount or 0) * 100) >= 1):
            raise HTTPException(status_code=400, detail="Payment does not match this subscription")

        if await select_access_subscription(db, surfer_id, photographer_id):
            return await _hold_paid_activation(tx, meta, db, 'paid_overlap')

        plan_result = await db.execute(select(PhotographerSubscriptionPlan).where(
            PhotographerSubscriptionPlan.id == plan_id))
        plan = plan_result.scalar_one_or_none()
        if 'plan_terms' in meta:
            terms = meta['plan_terms']
            if not _valid_plan_terms(terms, plan_id, photographer_id, checkout.amount_total):
                return await _hold_paid_activation(tx, meta, db, 'plan_terms_unavailable')
        else:
            # Legacy checkouts retain their current-plan fallback, without frozen historical benefits.
            terms = _freeze_plan_terms(plan, checkout.amount_total) if plan else None
            if terms is None:
                return await _hold_paid_activation(tx, meta, db, 'plan_terms_unavailable')

        claimed = await db.execute(update(PaymentTransaction).where(
            PaymentTransaction.id == tx.id, PaymentTransaction.payment_status != 'completed',
            PaymentTransaction.status != 'review_required',
            func.lower(func.trim(PaymentTransaction.payment_status)).notin_(('refunded', 'partially_refunded')),
            func.lower(func.trim(PaymentTransaction.status)).notin_(('refunded', 'partially_refunded')),
        ).values(payment_status='completed', status='completed')
          .execution_options(synchronize_session=False))
        if claimed.rowcount != 1:
            await db.refresh(tx)
            refunded = _recorded_refund_response(tx)
            if refunded is not None:
                return refunded
            if tx.status == 'review_required':
                return _activation_review_response(meta.get('activation_review_code', 'paid_overlap'))
            if tx.payment_status == 'completed':
                return await _completed_activation(tx, meta, db)
            raise HTTPException(status_code=409, detail="Payment activation changed; please retry")

        paid_amount = checkout.amount_total / 100
        now = datetime.now(timezone.utc)
        expires_at = now + (timedelta(weeks=1) if terms['interval'] == 'weekly' else timedelta(days=30))
        seller = await _subscription_seller(db, photographer_id)
        sub = SurferPhotoSubscription(
            surfer_id=surfer_id, photographer_id=photographer_id,
            plan_id=plan.id if plan else None, plan_name=terms['name'],
            plan_interval=terms['interval'], plan_price=paid_amount, expires_at=expires_at,
            photos_remaining=terms['photos_included'], videos_remaining=terms['videos_included'],
            live_session_buyins_remaining=terms['live_session_buyins'],
            sessions_remaining=terms['sessions_included'],
            booking_discount_pct=terms['booking_discount_pct'],
            on_demand_discount_pct=terms['on_demand_discount_pct'],
            amount_paid=paid_amount, payment_method='card', stripe_session_id=checkout_session_id,
        )
        db.add(sub)
        await db.flush()
        await _settle_subscription_seller(db, seller, paid_amount, sub.id, surfer_id)
        tx.payment_status = 'completed'
        tx.status = 'completed'
        await db.commit()
        await db.refresh(sub)
        return {'success': True, 'subscription': _sub_to_dict(sub), 'already_completed': False}
    except Exception:
        await db.rollback()
        raise


# ══════════════════════════════════════════════════════════════
# SURFER VIEW & MANAGE
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/my-subscriptions/{user_id}")
async def get_my_subscriptions(
    user_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Surfer views their active and recent subscriptions."""
    if current_user_id != user_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    # Expire any overdue subs first
    now = datetime.now(timezone.utc)
    overdue = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == user_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at <= now,
        ))
    )
    for sub in overdue.scalars().all():
        sub.status = 'expired'
    await db.commit()

    # Fetch all subs (active first, then recent expired)
    result = await db.execute(
        select(SurferPhotoSubscription)
        .where(SurferPhotoSubscription.surfer_id == user_id)
        .order_by(
            SurferPhotoSubscription.status.asc(),   # active < expired
            SurferPhotoSubscription.expires_at.desc()
        )
    )
    subs = result.scalars().all()

    # Enrich with photographer info
    out = []
    for sub in subs:
        d = _sub_to_dict(sub)
        phot = await db.execute(select(Profile).where(Profile.id == sub.photographer_id))
        p = phot.scalar_one_or_none()
        if p:
            d["photographer_name"] = p.full_name
            d["photographer_avatar"] = p.avatar_url
            d["photographer_username"] = p.username
        out.append(d)
    return out


@router.post("/photo-subscriptions/cancel/{subscription_id}")
async def cancel_subscription(
    subscription_id: str,
    surfer_id: str = Query(...),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Surfer cancels a subscription (keeps access until expiry)."""
    # Bound to the token, so the surfer_id filter below only ever finds the caller's own subscription.
    _require_caller(surfer_id, current_user_id)
    result = await db.execute(
        select(SurferPhotoSubscription).where(
            SurferPhotoSubscription.id == subscription_id,
            SurferPhotoSubscription.surfer_id == surfer_id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if sub.status != 'active' or not subscription_has_access(sub):
        raise HTTPException(status_code=400, detail="Subscription is already inactive")

    sub.status = 'cancelled'
    await db.commit()
    return {"success": True, "message": "Subscription cancelled. You keep access until expiry."}


# ══════════════════════════════════════════════════════════════
# PHOTOGRAPHER VIEW SUBSCRIBERS
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/my-subscribers/{photographer_id}")
async def get_my_subscribers(
    photographer_id: str,
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db),
):
    """Photographer sees who is subscribed to them."""
    if current_user_id != photographer_id:
        raise HTTPException(status_code=403, detail="Cannot act on behalf of another user")
    result = await db.execute(
        select(SurferPhotoSubscription)
        .where(and_(
            SurferPhotoSubscription.photographer_id == photographer_id,
            *subscription_access_filters(),
        ))
        .order_by(SurferPhotoSubscription.created_at.desc())
    )
    subs = result.scalars().all()

    out = []
    for sub in subs:
        d = _sub_to_dict(sub)
        surfer = await db.execute(select(Profile).where(Profile.id == sub.surfer_id))
        s = surfer.scalar_one_or_none()
        if s:
            d["surfer_name"] = s.full_name
            d["surfer_avatar"] = s.avatar_url
            d["surfer_username"] = s.username
        out.append(d)
    return {"subscribers": out, "total": len(out)}


# ══════════════════════════════════════════════════════════════
# QUOTA CHECK & USE (called by other services)
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/check-quota")
async def check_quota(
    surfer_id: str = Query(...),
    photographer_id: str = Query(...),
    quota_type: str = Query(...),   # 'photo', 'video', 'live_buyin', 'session'
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Check if surfer has remaining quota for a service from this photographer."""
    _require_caller(surfer_id, current_user_id)
    sub = await select_access_subscription(db, surfer_id, photographer_id)
    if not sub:
        return {"has_quota": False, "remaining": 0, "subscription_active": False}

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type)
    if not field:
        raise HTTPException(status_code=400, detail="Invalid quota_type")

    remaining = getattr(sub, field, 0)
    return {
        "has_quota": remaining > 0,
        "remaining": remaining,
        "subscription_active": True,
        "booking_discount_pct": sub.booking_discount_pct,
        "on_demand_discount_pct": sub.on_demand_discount_pct,
        "subscription_id": sub.id,
    }


@router.post("/photo-subscriptions/use-quota")
async def use_quota(
    surfer_id: str = Query(...),
    photographer_id: str = Query(...),
    quota_type: str = Query(...),
    quantity: int = Query(1, ge=1),
    current_user_id: str = Depends(get_current_user_id),
    db: AsyncSession = Depends(get_db)
):
    """Decrement a surfer's subscription quota (called internally on delivery)."""
    _require_caller(surfer_id, current_user_id)
    sub = await select_access_subscription(db, surfer_id, photographer_id)
    if not sub:
        raise HTTPException(status_code=404, detail="No active subscription found")

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type)
    if not field:
        raise HTTPException(status_code=400, detail="Invalid quota_type")

    current = getattr(sub, field, 0)
    if current < quantity:
        raise HTTPException(status_code=400, detail=f"Not enough {quota_type} quota remaining ({current})")

    setattr(sub, field, current - quantity)
    await db.commit()

    return {
        "success": True,
        "quota_type": quota_type,
        "used": quantity,
        "remaining": current - quantity,
    }


# ============================================================
# RE-EXPORTS - Standalone helpers extracted to photo_sub_helpers.py (v94 audit)
# ============================================================
from .photo_sub_helpers import try_use_subscription_quota  # noqa: F401
from .photo_sub_helpers import get_subscription_discount  # noqa: F401
from .photo_sub_helpers import check_quota_inline  # noqa: F401
