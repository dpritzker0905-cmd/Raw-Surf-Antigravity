"""
Subscription Lifecycle — Status toggle, tier upgrade, grom management, pro vetting.
Extracted from subscriptions.py (v97 audit) for LOC governance.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional
import os, stripe, json, logging

from database import get_db
from models import Profile, PaymentTransaction, RoleEnum
from utils.grom_parent import is_grom_parent_eligible
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# Import tier configs from parent module
from routes.subscriptions_billing.subscriptions import (
    SURFER_STATUSES, get_tiers_for_role,
    GROM_SUBSCRIPTION_TIERS, GOLD_PASS_BOOKING_WINDOW_HOURS
)


class SurferStatusToggleRequest(BaseModel):
    status: str

class SubscriptionTierRequest(BaseModel):
    tier_id: str
    origin_url: str

class GromSubscriptionRequest(BaseModel):
    grom_id: str
    tier_id: str
    origin_url: str

class ParentSurferModeRequest(BaseModel):
    active_surfer_mode: bool


@router.get("/subscriptions/account-billing/{user_id}")
async def get_account_billing_status(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get user's current subscription and status for the Account & Billing hub"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    current_status = "regular"
    if user.elite_tier in ["competitive", "pro_elite"]:
        current_status = "competitive"
    is_pending_pro = user.elite_tier == "competitive" and user.role.value in ["Surfer", "Comp Surfer"]
    is_approved_pro = user.is_approved_pro or user.role.value in ["Pro", "Approved Pro"]
    tier_map = {"free": "tier_1", "basic": "tier_2", "premium": "tier_3"}
    current_tier = tier_map.get(user.subscription_tier, "tier_1")
    linked_groms = []
    if user.role.value == "Grom Parent":
        groms_result = await db.execute(select(Profile).where(Profile.parent_id == user_id))
        for grom in groms_result.scalars().all():
            grom_tier = tier_map.get(grom.subscription_tier, "tier_1")
            linked_groms.append({"id": grom.id, "full_name": grom.full_name,
                "avatar_url": grom.avatar_url, "subscription_tier": grom.subscription_tier or "free",
                "tier_id": grom_tier, "elite_tier": grom.elite_tier})
    return {
        "user_id": user_id, "role": user.role.value, "email": user.email,
        "full_name": user.full_name, "current_status": current_status,
        "is_pending_pro": is_pending_pro, "is_approved_pro": is_approved_pro,
        "elite_tier": user.elite_tier, "subscription_tier": user.subscription_tier or "free",
        "current_tier_id": current_tier,
        "current_tier_details": get_tiers_for_role(user.role.value).get(current_tier),
        "linked_groms": linked_groms,
        "is_active_surfer": user.is_active_surfer if hasattr(user, 'is_active_surfer') else False,
        "available_tiers": get_tiers_for_role(user.role.value),
        "available_statuses": SURFER_STATUSES
    }


@router.post("/subscriptions/toggle-status/{user_id}")
async def toggle_surfer_status(user_id: str, data: SurferStatusToggleRequest, db: AsyncSession = Depends(get_db)):
    """Toggle between Regular and Competitive Surfer status"""
    if data.status not in SURFER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status")
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    surfer_roles = [RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]
    if user.role not in surfer_roles:
        raise HTTPException(status_code=403, detail="Only surfers can toggle competitive status")
    status_config = SURFER_STATUSES[data.status]
    user.elite_tier = status_config["elite_tier"]
    if data.status == "competitive" and user.role == RoleEnum.SURFER:
        user.role = RoleEnum.COMP_SURFER
    elif data.status == "regular" and user.role == RoleEnum.COMP_SURFER:
        user.role = RoleEnum.SURFER
        user.elite_tier = None
    await db.commit()
    return {"success": True, "new_status": data.status, "elite_tier": user.elite_tier,
            "role": user.role.value, "message": f"Status changed to {status_config['name']}"}


@router.post("/subscriptions/upgrade-tier/{user_id}")
async def upgrade_subscription_tier(user_id: str, data: SubscriptionTierRequest, db: AsyncSession = Depends(get_db)):
    """Upgrade/downgrade subscription tier with Stripe checkout"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    available_tiers = get_tiers_for_role(user.role.value)
    if data.tier_id not in available_tiers:
        raise HTTPException(status_code=400, detail="Invalid tier for your role")
    tier = available_tiers[data.tier_id]
    if tier["price"] == 0:
        user.subscription_tier = "free"
        await db.commit()
        return {"success": True, "checkout_url": None, "tier_id": data.tier_id, "message": "Switched to free tier"}
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{'price_data': {'currency': 'usd', 'unit_amount': int(tier['price'] * 100),
                'product_data': {'name': f"{tier['name']} Plan", 'description': ", ".join(tier['features'])}},
                'quantity': 1}],
            mode='payment',
            success_url=f"{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={data.tier_id}",
            cancel_url=f"{data.origin_url}/settings",
            metadata={"user_id": user_id, "tier_id": data.tier_id, "plan_id": tier.get('id', data.tier_id),
                       "subscription_type": "account_billing"})
        db.add(PaymentTransaction(user_id=user_id, session_id=checkout_session.id, amount=tier['price'],
            currency="usd", payment_status="pending", status="pending",
            transaction_metadata=json.dumps({"type": "subscription_tier", "tier_id": data.tier_id})))
        await db.commit()
        return {"success": True, "checkout_url": checkout_session.url,
                "session_id": checkout_session.id, "tier_id": data.tier_id}
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")


@router.post("/subscriptions/grom-tier/{parent_id}")
async def update_grom_subscription(parent_id: str, data: GromSubscriptionRequest, db: AsyncSession = Depends(get_db)):
    """Parent updates linked Grom's subscription tier"""
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can manage Grom subscriptions")
    grom_result = await db.execute(select(Profile).where(Profile.id == data.grom_id, Profile.parent_id == parent_id))
    grom = grom_result.scalar_one_or_none()
    if not grom:
        raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    if data.tier_id not in GROM_SUBSCRIPTION_TIERS:
        raise HTTPException(status_code=400, detail="Invalid Grom tier")
    tier = GROM_SUBSCRIPTION_TIERS[data.tier_id]
    if tier["price"] == 0:
        grom.subscription_tier = "free"
        grom.is_ad_supported = True
        await db.commit()
        return {"success": True, "checkout_url": None, "grom_id": data.grom_id,
                "tier_id": data.tier_id, "message": "Grom switched to free tier"}
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{'price_data': {'currency': 'usd', 'unit_amount': int(tier['price'] * 100),
                'product_data': {'name': f"{tier['name']} for {grom.full_name}",
                                 'description': ", ".join(tier['features'])}}, 'quantity': 1}],
            mode='payment',
            success_url=f"{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={data.tier_id}&grom_id={data.grom_id}",
            cancel_url=f"{data.origin_url}/settings",
            metadata={"parent_id": parent_id, "grom_id": data.grom_id, "tier_id": data.tier_id,
                       "plan_id": tier.get('id', data.tier_id), "subscription_type": "grom_subscription"})
        db.add(PaymentTransaction(user_id=parent_id, session_id=checkout_session.id, amount=tier['price'],
            currency="usd", payment_status="pending", status="pending",
            transaction_metadata=json.dumps({"type": "grom_subscription", "grom_id": data.grom_id, "tier_id": data.tier_id})))
        await db.commit()
        return {"success": True, "checkout_url": checkout_session.url,
                "session_id": checkout_session.id, "grom_id": data.grom_id, "tier_id": data.tier_id}
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")


@router.post("/subscriptions/parent-surfer-mode/{user_id}")
async def toggle_parent_surfer_mode(user_id: str, data: ParentSurferModeRequest, db: AsyncSession = Depends(get_db)):
    """Toggle Active Surfer Mode for Grom Parents"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if not is_grom_parent_eligible(user):
        raise HTTPException(status_code=403, detail="Only Grom Parents can enable Active Surfer Mode")
    if data.active_surfer_mode:
        user.skill_level = user.skill_level or "active_surfer"
    await db.commit()
    return {"success": True, "active_surfer_mode": data.active_surfer_mode,
            "message": "Active Surfer Mode " + ("enabled" if data.active_surfer_mode else "disabled")}


@router.post("/subscriptions/apply-pro/{user_id}")
async def apply_for_pro_vetting(user_id: str, db: AsyncSession = Depends(get_db)):
    """Apply for Pro Surfer/Photographer vetting"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    if user.role not in [RoleEnum.COMP_SURFER, RoleEnum.PHOTOGRAPHER]:
        raise HTTPException(status_code=403, detail="Must be Competitive Surfer or Working Photographer to apply")
    if user.role == RoleEnum.COMP_SURFER:
        user.elite_tier = "competitive"
    await db.commit()
    return {"success": True, "status": "pending",
            "message": "Pro application submitted. You retain Competitive Surfer access while pending review.",
            "current_elite_tier": user.elite_tier}
