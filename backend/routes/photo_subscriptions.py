"""
Photo Subscriptions — Photographer ↔ Surfer recurring plans.
Photographers define weekly/monthly bundles; surfers subscribe via credits or card.
When subscription expires, surfer reverts to regular rates.
Minimum pricing: $5/week enforced server-side.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_
from pydantic import BaseModel, Field
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import os
import stripe
import json
import logging

from database import get_db
from models import (
    Profile, PhotographerSubscriptionPlan, SurferPhotoSubscription,
    PaymentTransaction
)

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# ── Constants ────────────────────────────────────────────────
MIN_WEEKLY_PRICE = 5.0
MIN_MONTHLY_PRICE = 15.0   # ~$3.75/week equivalent

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
        "started_at": sub.started_at.isoformat() if sub.started_at else None,
        "expires_at": sub.expires_at.isoformat() if sub.expires_at else None,
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
                SurferPhotoSubscription.status == 'active'
            ))
        )
        count = len(count_q.scalars().all())
        out.append(_plan_to_dict(plan, subscriber_count=count))
    return out


@router.post("/photo-subscriptions/plans")
async def create_plan(
    data: PlanCreate,
    photographer_id: str = Query(...),
    db: AsyncSession = Depends(get_db)
):
    """Photographer creates a new subscription plan."""
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
    db: AsyncSession = Depends(get_db)
):
    """Photographer updates an existing plan."""
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
    db: AsyncSession = Depends(get_db)
):
    """Soft-deactivate a plan (existing subs stay active until expiry)."""
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
    db: AsyncSession = Depends(get_db)
):
    """Surfer subscribes (or renews) a photographer's plan via credits or card."""
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

    # Load surfer
    surfer_result = await db.execute(select(Profile).where(Profile.id == surfer_id))
    surfer = surfer_result.scalar_one_or_none()
    if not surfer:
        raise HTTPException(status_code=404, detail="User not found")

    # Prevent subscribing to own plans
    if surfer_id == plan.photographer_id:
        raise HTTPException(status_code=400, detail="Cannot subscribe to your own plan")

    # Check for existing active sub with this photographer
    existing = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == plan.photographer_id,
            SurferPhotoSubscription.status == 'active',
        ))
    )
    active_sub = existing.scalar_one_or_none()
    if active_sub:
        raise HTTPException(
            status_code=400,
            detail="You already have an active subscription with this photographer. Wait for it to expire or cancel first."
        )

    # Calculate expiry
    now = datetime.now(timezone.utc)
    if plan.interval == 'weekly':
        expires_at = now + timedelta(weeks=1)
    else:
        expires_at = now + timedelta(days=30)

    price = plan.price

    # ── Credit payment ──────────────────────────────────────
    if data.payment_method == 'credits':
        if (surfer.credit_balance or 0) < price:
            raise HTTPException(status_code=400, detail=f"Insufficient credits. Need ${price:.2f}")

        surfer.credit_balance = (surfer.credit_balance or 0) - price

        # Platform commission to photographer (same rate as other services)
        photographer_result = await db.execute(
            select(Profile).where(Profile.id == plan.photographer_id)
        )
        photographer = photographer_result.scalar_one_or_none()
        if photographer:
            commission = 0.20 if (photographer.subscription_tier or 'free') != 'premium' else 0.15
            photographer_share = price * (1 - commission)
            photographer.withdrawable_credits = (photographer.withdrawable_credits or 0) + photographer_share

        sub = SurferPhotoSubscription(
            surfer_id=surfer_id,
            photographer_id=plan.photographer_id,
            plan_id=plan.id,
            plan_name=plan.name,
            plan_interval=plan.interval,
            plan_price=plan.price,
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
        await db.commit()
        await db.refresh(sub)

        return {
            "success": True,
            "subscription": _sub_to_dict(sub),
            "remaining_credits": surfer.credit_balance,
            "message": f"Subscribed to {plan.name}!"
        }

    # ── Card payment (Stripe) ───────────────────────────────
    elif data.payment_method == 'card':
        if not STRIPE_API_KEY:
            raise HTTPException(status_code=500, detail="Stripe not configured")

        origin = data.origin_url or 'https://raw-surf.netlify.app'
        try:
            checkout = stripe.checkout.Session.create(
                payment_method_types=['card'],
                line_items=[{
                    'price_data': {
                        'currency': 'usd',
                        'unit_amount': int(price * 100),
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
            logger.error(f"Stripe error: {e}")
            raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")

        # Store pending transaction
        tx = PaymentTransaction(
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
            })
        )
        db.add(tx)
        await db.commit()

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
    db: AsyncSession = Depends(get_db)
):
    """Complete subscription after successful Stripe card payment."""
    tx_result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == checkout_session_id)
    )
    tx = tx_result.scalar_one_or_none()
    if not tx:
        raise HTTPException(status_code=404, detail="Transaction not found")
    if tx.payment_status == 'completed':
        return {"success": True, "message": "Already activated"}

    meta = json.loads(tx.transaction_metadata) if tx.transaction_metadata else {}
    plan_id = meta.get('plan_id')
    surfer_id = tx.user_id
    photographer_id = meta.get('photographer_id')

    # Load plan
    plan_result = await db.execute(
        select(PhotographerSubscriptionPlan).where(PhotographerSubscriptionPlan.id == plan_id)
    )
    plan = plan_result.scalar_one_or_none()
    if not plan:
        raise HTTPException(status_code=404, detail="Plan no longer exists")

    now = datetime.now(timezone.utc)
    expires_at = now + (timedelta(weeks=1) if plan.interval == 'weekly' else timedelta(days=30))

    sub = SurferPhotoSubscription(
        surfer_id=surfer_id,
        photographer_id=photographer_id,
        plan_id=plan.id,
        plan_name=plan.name,
        plan_interval=plan.interval,
        plan_price=plan.price,
        expires_at=expires_at,
        photos_remaining=plan.photos_included,
        videos_remaining=plan.videos_included,
        live_session_buyins_remaining=plan.live_session_buyins,
        sessions_remaining=plan.sessions_included,
        booking_discount_pct=plan.booking_discount_pct,
        on_demand_discount_pct=plan.on_demand_discount_pct,
        amount_paid=tx.amount,
        payment_method='card',
        stripe_session_id=checkout_session_id,
    )
    db.add(sub)

    # Credit photographer
    phot_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = phot_result.scalar_one_or_none()
    if photographer:
        commission = 0.20 if (photographer.subscription_tier or 'free') != 'premium' else 0.15
        photographer.withdrawable_credits = (photographer.withdrawable_credits or 0) + tx.amount * (1 - commission)

    tx.payment_status = 'completed'
    tx.status = 'completed'
    await db.commit()
    await db.refresh(sub)

    return {"success": True, "subscription": _sub_to_dict(sub)}


# ══════════════════════════════════════════════════════════════
# SURFER VIEW & MANAGE
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/my-subscriptions/{user_id}")
async def get_my_subscriptions(user_id: str, db: AsyncSession = Depends(get_db)):
    """Surfer views their active and recent subscriptions."""
    # Expire any overdue subs first
    now = datetime.now(timezone.utc)
    overdue = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == user_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at < now,
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
    db: AsyncSession = Depends(get_db)
):
    """Surfer cancels a subscription (keeps access until expiry)."""
    result = await db.execute(
        select(SurferPhotoSubscription).where(
            SurferPhotoSubscription.id == subscription_id,
            SurferPhotoSubscription.surfer_id == surfer_id,
        )
    )
    sub = result.scalar_one_or_none()
    if not sub:
        raise HTTPException(status_code=404, detail="Subscription not found")
    if sub.status != 'active':
        raise HTTPException(status_code=400, detail="Subscription is already inactive")

    sub.status = 'cancelled'
    await db.commit()
    return {"success": True, "message": "Subscription cancelled. You keep access until expiry."}


# ══════════════════════════════════════════════════════════════
# PHOTOGRAPHER VIEW SUBSCRIBERS
# ══════════════════════════════════════════════════════════════

@router.get("/photo-subscriptions/my-subscribers/{photographer_id}")
async def get_my_subscribers(photographer_id: str, db: AsyncSession = Depends(get_db)):
    """Photographer sees who is subscribed to them."""
    result = await db.execute(
        select(SurferPhotoSubscription)
        .where(and_(
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
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
    db: AsyncSession = Depends(get_db)
):
    """Check if surfer has remaining quota for a service from this photographer."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
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
    db: AsyncSession = Depends(get_db)
):
    """Decrement a surfer's subscription quota (called internally on delivery)."""
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
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


# ══════════════════════════════════════════════════════════════
# STANDALONE HELPER — for gallery/booking code to call directly
# ══════════════════════════════════════════════════════════════

async def try_use_subscription_quota(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    quota_type: str,  # 'photo', 'video', 'live_buyin', 'session'
    quantity: int = 1,
) -> dict:
    """
    Check if surfer has an active subscription with photographer and decrement quota.
    Returns {"used": True, "remaining": N} if quota was consumed,
    or {"used": False} if no active subscription or no quota remaining.
    Does NOT commit — caller is responsible for committing the transaction.
    
    Usage from gallery.py:
        from routes.photo_subscriptions import try_use_subscription_quota
        result = await try_use_subscription_quota(db, buyer_id, photographer_id, 'photo')
        if result["used"]:
            # Photo is free for subscriber — skip credit deduction
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {"used": False, "subscription_active": False}

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type)
    if not field:
        return {"used": False, "reason": "invalid_type"}

    current = getattr(sub, field, 0)
    if current < quantity:
        return {"used": False, "remaining": current, "subscription_active": True}

    setattr(sub, field, current - quantity)
    return {
        "used": True,
        "remaining": current - quantity,
        "subscription_id": sub.id,
        "subscription_active": True,
        "booking_discount_pct": sub.booking_discount_pct,
        "on_demand_discount_pct": sub.on_demand_discount_pct,
    }


async def get_subscription_discount(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    service_type: str = 'booking',  # 'booking' or 'on_demand'
) -> float:
    """
    Get the active subscription discount percentage for a surfer-photographer pair.
    Returns 0.0 if no active subscription or no discount configured.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return 0.0
    if service_type == 'on_demand':
        return sub.on_demand_discount_pct or 0.0
    return sub.booking_discount_pct or 0.0


async def check_quota_inline(
    db: AsyncSession,
    surfer_id: str,
    photographer_id: str,
    quota_type: str,  # 'photo', 'video', 'live_buyin', 'session'
) -> dict:
    """
    Read-only subscription quota check (does NOT decrement).
    Used by pricing endpoints to hint subscription coverage to the frontend.
    """
    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(SurferPhotoSubscription).where(and_(
            SurferPhotoSubscription.surfer_id == surfer_id,
            SurferPhotoSubscription.photographer_id == photographer_id,
            SurferPhotoSubscription.status == 'active',
            SurferPhotoSubscription.expires_at > now,
        ))
    )
    sub = result.scalar_one_or_none()
    if not sub:
        return {
            "has_quota": False,
            "remaining": 0,
            "subscription_active": False,
            "booking_discount_pct": 0,
            "on_demand_discount_pct": 0,
        }

    field_map = {
        'photo': 'photos_remaining',
        'video': 'videos_remaining',
        'live_buyin': 'live_session_buyins_remaining',
        'session': 'sessions_remaining',
    }
    field = field_map.get(quota_type, 'photos_remaining')
    remaining = getattr(sub, field, 0)

    return {
        "has_quota": remaining > 0,
        "remaining": remaining,
        "subscription_active": True,
        "booking_discount_pct": sub.booking_discount_pct or 0,
        "on_demand_discount_pct": sub.on_demand_discount_pct or 0,
        "plan_name": sub.plan_name,
    }
