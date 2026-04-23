from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import os
import stripe
import json
import logging

from database import get_db
from models import Profile, PaymentTransaction, RoleEnum
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# Subscription packages with monthly and annual options
# Annual plans get 20% discount
SUBSCRIPTION_PACKAGES = {
    # Surfer Monthly
    'surfer_free': {'name': 'Surfer Free', 'price': 0.00, 'type': 'surfer', 'billing': 'monthly'},
    'surfer_basic': {'name': 'Surfer Basic', 'price': 1.99, 'type': 'surfer', 'billing': 'monthly'},
    'surfer_premium': {'name': 'Surfer Premium', 'price': 9.99, 'type': 'surfer', 'billing': 'monthly'},
    
    # Surfer Annual (20% discount)
    'surfer_basic_annual': {'name': 'Surfer Basic Annual', 'price': 19.10, 'type': 'surfer', 'billing': 'annual', 'monthly_equiv': 1.59},  # 1.99 * 12 * 0.8
    'surfer_premium_annual': {'name': 'Surfer Premium Annual', 'price': 95.90, 'type': 'surfer', 'billing': 'annual', 'monthly_equiv': 7.99},  # 9.99 * 12 * 0.8
    
    # Photographer Monthly
    'photographer_basic': {'name': 'Photographer Basic', 'price': 18.00, 'type': 'photographer', 'billing': 'monthly'},
    'photographer_premium': {'name': 'Photographer Premium', 'price': 30.00, 'type': 'photographer', 'billing': 'monthly'},
    
    # Photographer Annual (20% discount)
    'photographer_basic_annual': {'name': 'Photographer Basic Annual', 'price': 172.80, 'type': 'photographer', 'billing': 'annual', 'monthly_equiv': 14.40},  # 18 * 12 * 0.8
    'photographer_premium_annual': {'name': 'Photographer Premium Annual', 'price': 288.00, 'type': 'photographer', 'billing': 'annual', 'monthly_equiv': 24.00},  # 30 * 12 * 0.8
}

class SubscriptionCheckoutRequest(BaseModel):
    tier_id: str
    origin_url: str

class SubscriptionCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str

@router.get("/subscriptions/plans")
async def get_subscription_plans():
    """Get all available subscription plans"""
    plans = {
        "surfer": {
            "monthly": [
                {"id": "surfer_free", "name": "Free", "price": 0, "features": ["Basic surf tracking", "View public content"]},
                {"id": "surfer_basic", "name": "Basic", "price": 1.99, "features": ["10% session discount", "Location visibility (5mi)", "Priority support"]},
                {"id": "surfer_premium", "name": "Premium", "price": 9.99, "features": ["20% session discount", "Full location visibility", "Exclusive content", "Premium badge"]}
            ],
            "annual": [
                {"id": "surfer_basic_annual", "name": "Basic Annual", "price": 19.10, "monthly_equiv": 1.59, "savings": "20%", "features": ["All Basic features", "Save $4.78/year"]},
                {"id": "surfer_premium_annual", "name": "Premium Annual", "price": 95.90, "monthly_equiv": 7.99, "savings": "20%", "features": ["All Premium features", "Save $23.98/year"]}
            ]
        },
        "photographer": {
            "monthly": [
                {"id": "photographer_basic", "name": "Basic", "price": 18.00, "features": ["Up to 500 gallery photos", "Watermarked previews", "80% revenue share"]},
                {"id": "photographer_premium", "name": "Premium", "price": 30.00, "features": ["Unlimited gallery photos", "Priority placement", "85% revenue share", "Analytics dashboard"]}
            ],
            "annual": [
                {"id": "photographer_basic_annual", "name": "Basic Annual", "price": 172.80, "monthly_equiv": 14.40, "savings": "20%", "features": ["All Basic features", "Save $43.20/year"]},
                {"id": "photographer_premium_annual", "name": "Premium Annual", "price": 288.00, "monthly_equiv": 24.00, "savings": "20%", "features": ["All Premium features", "Save $72.00/year"]}
            ]
        }
    }
    return plans

@router.post("/subscriptions/checkout", response_model=SubscriptionCheckoutResponse)
async def create_subscription_checkout(
    data: SubscriptionCheckoutRequest, 
    user_id: str, 
    db: AsyncSession = Depends(get_db)
):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    if data.tier_id not in SUBSCRIPTION_PACKAGES:
        raise HTTPException(status_code=400, detail="Invalid subscription tier")
    
    package = SUBSCRIPTION_PACKAGES[data.tier_id]
    
    if package['price'] == 0:
        result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = result.scalar_one_or_none()
        if user:
            user.subscription_tier = 'free'
            await db.commit()
        return SubscriptionCheckoutResponse(checkout_url=f"{data.origin_url}/feed", session_id="free")
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Extract tier name (basic or premium) from tier_id
    tier_parts = data.tier_id.split('_')
    tier_name = tier_parts[1] if len(tier_parts) > 1 else 'basic'
    is_annual = 'annual' in data.tier_id
    billing_period = 'annual' if is_annual else 'monthly'
    
    # Build description
    if is_annual:
        monthly_equiv = package.get('monthly_equiv', package['price'] / 12)
        description = f"Annual subscription to Raw Surf {package['name']} (${monthly_equiv:.2f}/mo, 20% savings)"
    else:
        description = f"Monthly subscription to Raw Surf {package['name']}"
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(package['price'] * 100),
                    'product_data': {
                        'name': f"{package['name']} Subscription",
                        'description': description,
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=f"{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={tier_name}&billing={billing_period}",
            cancel_url=f"{data.origin_url}/{package['type']}-subscription",
            metadata={
                "user_id": user_id,
                "tier_id": data.tier_id,
                "tier_name": tier_name,
                "subscription_type": package['type'],
                "billing_period": billing_period
            }
        )
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")
    
    transaction = PaymentTransaction(
        user_id=user_id,
        session_id=checkout_session.id,
        amount=package['price'],
        currency="usd",
        payment_status="pending",
        status="pending",
        transaction_metadata=json.dumps({
            "type": "subscription",
            "tier_id": data.tier_id,
            "tier_name": tier_name,
            "subscription_type": package['type'],
            "billing_period": billing_period
        })
    )
    db.add(transaction)
    await db.commit()
    
    return SubscriptionCheckoutResponse(
        checkout_url=checkout_session.url,
        session_id=checkout_session.id
    )

@router.get("/subscriptions/status/{session_id}")
async def check_subscription_status(session_id: str, db: AsyncSession = Depends(get_db)):
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    if session_id == "free":
        return {"status": "completed", "tier": "free"}
    
    result = await db.execute(
        select(PaymentTransaction).where(PaymentTransaction.session_id == session_id)
    )
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail="Transaction not found")
    
    if transaction.payment_status == "completed":
        metadata = json.loads(transaction.transaction_metadata) if transaction.transaction_metadata else {}
        return {
            "status": "completed",
            "tier": metadata.get("tier_name", "unknown"),
            "message": "Subscription already activated"
        }
    
    try:
        checkout_session = stripe.checkout.Session.retrieve(session_id)
        payment_status = checkout_session.payment_status
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment verification error: {str(e)}")
    
    if payment_status == "paid":
        metadata = json.loads(transaction.transaction_metadata) if transaction.transaction_metadata else {}
        tier_name = metadata.get("tier_name", "basic")
        
        user_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
        user = user_result.scalar_one_or_none()
        if user:
            user.subscription_tier = tier_name
        
        transaction.payment_status = "completed"
        transaction.status = "completed"
        await db.commit()
        
        return {
            "status": "completed",
            "tier": tier_name,
            "message": f"Subscription activated: {tier_name}"
        }
    
    return {"status": payment_status, "tier": None}



# ============================================================
# ACCOUNT & BILLING HUB ENDPOINTS
# ============================================================

# Surfer Status values (Identity layer - separate from subscription)
SURFER_STATUSES = {
    "regular": {"name": "Regular Surfer", "elite_tier": None},
    "competitive": {"name": "Competitive Surfer", "elite_tier": "competitive"},
}

# ============================================================
# SUBSCRIPTION TIER DEFINITIONS - SINGLE SOURCE OF TRUTH (BACKEND)
# These MUST mirror frontend/src/config/subscriptionPlans.config.js
# WHOLE DOLLAR PRICING - 1 Credit = $1.00 (1:1 RATIO)
# ============================================================

# Surfer Subscription Tiers
SURFER_SUBSCRIPTION_TIERS = {
    "tier_1": {
        "id": "surfer_free",
        "name": "Free",
        "price": 0,
        "storage_gb": 5,
        "commission_rate": 0.25,
        "gold_pass": False,
        "is_ad_supported": True,
        "features": ["Profile & social features", "Book photo sessions", "5GB storage", "Ad-supported"]
    },
    "tier_2": {
        "id": "surfer_basic",
        "name": "Basic",
        "price": 5,  # OFFICIAL: $5 = 5 Credits
        "storage_gb": 50,
        "commission_rate": 0.20,
        "gold_pass": False,
        "is_ad_supported": False,
        "features": ["Ad-free experience", "50GB storage", "20% commission", "10% session discount"]
    },
    "tier_3": {
        "id": "surfer_premium",
        "name": "Premium",
        "price": 10,  # OFFICIAL: $10 = 10 Credits
        "storage_gb": -1,  # Unlimited
        "commission_rate": 0.15,
        "gold_pass": True,
        "is_ad_supported": False,
        "features": ["Unlimited storage", "15% commission", "Gold-Pass 2hr booking", "20% session discount"]
    }
}

# Grom Subscription Tiers (Parent-managed)
GROM_SUBSCRIPTION_TIERS = {
    "tier_1": {
        "id": "grom_free",
        "name": "Free",
        "price": 0,
        "storage_gb": 5,
        "is_ad_supported": True,
        "features": ["Profile & social (parent-approved)", "View tagged photos", "5GB storage", "Ad-supported"]
    },
    "tier_2": {
        "id": "grom_basic",
        "name": "Grom Basic",
        "price": 3,  # OFFICIAL: $3 = 3 Credits
        "storage_gb": 25,
        "is_ad_supported": False,
        "features": ["Ad-free experience", "25GB storage", "Competition tracking", "Grom Leaderboard"]
    },
    "tier_3": {
        "id": "grom_premium",
        "name": "Grom Premium",
        "price": 8,  # OFFICIAL: $8 = 8 Credits
        "storage_gb": -1,
        "is_ad_supported": False,
        "features": ["Unlimited storage", "Priority events", "Featured in Grom Rising", "Sponsor visibility"]
    }
}

# Photographer Subscription Tiers (NO FREE TIER - redirects to Hobbyist)
PHOTOGRAPHER_SUBSCRIPTION_TIERS = {
    "tier_2": {
        "id": "photographer_basic",
        "name": "Basic",
        "price": 18,  # OFFICIAL: $18 = 18 Credits
        "commission_rate": 0.20,
        "gold_pass": False,
        "is_ad_supported": False,
        "features": ["Unlimited storage", "20% commission", "Track surfers 5mi", "Set your prices"]
    },
    "tier_3": {
        "id": "photographer_premium",
        "name": "Premium",
        "price": 30,  # OFFICIAL: $30 = 30 Credits
        "commission_rate": 0.15,
        "gold_pass": True,
        "is_ad_supported": False,
        "features": ["15% commission", "Track surfers worldwide", "50 free AI credits/mo", "Priority placement"]
    }
}

# Grom Parent Subscription Tiers (NEW - Premium is Surfer Hybrid)
GROM_PARENT_SUBSCRIPTION_TIERS = {
    "tier_1": {
        "id": "grom_parent_free",
        "name": "Free",
        "price": 0,
        "is_ad_supported": True,
        "gold_pass": False,
        "features": ["Grom management dashboard", "Link & monitor Groms", "Book sessions", "Ad-supported"]
    },
    "tier_2": {
        "id": "grom_parent_basic",
        "name": "Basic",
        "price": 5,  # OFFICIAL: $5 = 5 Credits (Ad-Free)
        "is_ad_supported": False,
        "gold_pass": False,
        "features": ["Ad-free experience", "Priority notifications", "Grom progress reports"]
    },
    "tier_3": {
        "id": "grom_parent_premium",
        "name": "Premium",
        "price": 10,  # OFFICIAL: $10 = 10 Credits (Surfer Hybrid)
        "is_ad_supported": False,
        "gold_pass": True,
        "is_surfer_hybrid": True,
        "features": ["Gold-Pass 2hr booking", "Surfer Hybrid mode", "Advanced analytics", "Priority support"]
    }
}

# Hobbyist Photographer Tiers (Contribution-Only, NO Premium)
HOBBYIST_SUBSCRIPTION_TIERS = {
    "tier_1": {
        "id": "hobbyist_free",
        "name": "Free",
        "price": 0,
        "is_ad_supported": True,
        "contribution_only": True,
        "features": ["Upload & share photos", "Gear Credits earnings", "Support Groms & Causes", "Ad-supported"]
    },
    "tier_2": {
        "id": "hobbyist_basic",
        "name": "Basic",
        "price": 5,  # OFFICIAL: $5 = 5 Credits (Ad-Free)
        "is_ad_supported": False,
        "contribution_only": True,
        "features": ["Ad-free experience", "Priority in local searches", "Gear Credits earnings"]
    }
    # NO tier_3 - Hobbyists max out at Basic
}

# Helper to get tiers by role
def get_tiers_for_role(role: str) -> dict:
    """Get subscription tiers appropriate for user role"""
    photographer_roles = ['Photographer', 'Hobbyist', 'Approved Pro']
    grom_roles = ['Grom']
    
    if role in grom_roles:
        return GROM_SUBSCRIPTION_TIERS
    elif role in photographer_roles:
        return PHOTOGRAPHER_SUBSCRIPTION_TIERS
    return SURFER_SUBSCRIPTION_TIERS

# Gold-Pass booking window constant
GOLD_PASS_BOOKING_WINDOW_HOURS = 2

class SurferStatusToggleRequest(BaseModel):
    status: str  # "regular" or "competitive"

class SubscriptionTierRequest(BaseModel):
    tier_id: str  # "tier_1", "tier_2", "tier_3"
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
    
    # Determine current surfer status based on elite_tier
    current_status = "regular"
    if user.elite_tier in ["competitive", "pro_elite"]:
        current_status = "competitive"
    
    # Check if user is pending Pro vetting (applied for Pro but not yet approved)
    is_pending_pro = user.elite_tier == "competitive" and user.role.value in ["Surfer", "Comp Surfer"]
    is_approved_pro = user.is_approved_pro or user.role.value in ["Pro", "Approved Pro"]
    
    # Determine current tier from subscription_tier
    tier_map = {"free": "tier_1", "basic": "tier_2", "premium": "tier_3"}
    current_tier = tier_map.get(user.subscription_tier, "tier_1")
    
    # For Grom Parents, get linked Groms
    linked_groms = []
    if user.role.value == "Grom Parent":
        groms_result = await db.execute(
            select(Profile).where(Profile.parent_id == user_id)
        )
        groms = groms_result.scalars().all()
        for grom in groms:
            grom_tier = tier_map.get(grom.subscription_tier, "tier_1")
            linked_groms.append({
                "id": grom.id,
                "full_name": grom.full_name,
                "avatar_url": grom.avatar_url,
                "subscription_tier": grom.subscription_tier or "free",
                "tier_id": grom_tier,
                "elite_tier": grom.elite_tier
            })
    
    return {
        "user_id": user_id,
        "role": user.role.value,
        "email": user.email,
        "full_name": user.full_name,
        # Status (Identity layer)
        "current_status": current_status,
        "is_pending_pro": is_pending_pro,
        "is_approved_pro": is_approved_pro,
        "elite_tier": user.elite_tier,
        # Plan (Subscription layer)
        "subscription_tier": user.subscription_tier or "free",
        "current_tier_id": current_tier,
        "current_tier_details": get_tiers_for_role(user.role.value).get(current_tier),
        # Parent-specific
        "linked_groms": linked_groms,
        "is_active_surfer": user.is_active_surfer if hasattr(user, 'is_active_surfer') else False,
        # Available options - role-specific tiers (mirrors frontend config)
        "available_tiers": get_tiers_for_role(user.role.value),
        "available_statuses": SURFER_STATUSES
    }


@router.post("/subscriptions/toggle-status/{user_id}")
async def toggle_surfer_status(
    user_id: str,
    data: SurferStatusToggleRequest,
    db: AsyncSession = Depends(get_db)
):
    """Toggle between Regular and Competitive Surfer status (18+ only)"""
    if data.status not in SURFER_STATUSES:
        raise HTTPException(status_code=400, detail="Invalid status. Must be 'regular' or 'competitive'")
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Only surfer roles can toggle status (not Groms - they use grom_rising via Parent)
    surfer_roles = [RoleEnum.SURFER, RoleEnum.COMP_SURFER, RoleEnum.PRO]
    if user.role not in surfer_roles:
        raise HTTPException(status_code=403, detail="Only surfers can toggle competitive status")
    
    # Set elite_tier based on status
    status_config = SURFER_STATUSES[data.status]
    user.elite_tier = status_config["elite_tier"]
    
    # If switching to competitive, update role to Comp Surfer (unless already Pro)
    if data.status == "competitive" and user.role == RoleEnum.SURFER:
        user.role = RoleEnum.COMP_SURFER
    elif data.status == "regular" and user.role == RoleEnum.COMP_SURFER:
        user.role = RoleEnum.SURFER
        user.elite_tier = None
    
    await db.commit()
    
    return {
        "success": True,
        "new_status": data.status,
        "elite_tier": user.elite_tier,
        "role": user.role.value,
        "message": f"Status changed to {status_config['name']}"
    }


@router.post("/subscriptions/upgrade-tier/{user_id}")
async def upgrade_subscription_tier(
    user_id: str,
    data: SubscriptionTierRequest,
    db: AsyncSession = Depends(get_db)
):
    """Upgrade/downgrade subscription tier with Stripe checkout"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get role-specific tiers
    available_tiers = get_tiers_for_role(user.role.value)
    
    if data.tier_id not in available_tiers:
        raise HTTPException(status_code=400, detail="Invalid tier for your role")
    
    tier = available_tiers[data.tier_id]
    
    # Free tier - instant activation
    if tier["price"] == 0:
        user.subscription_tier = "free"
        await db.commit()
        return {
            "success": True,
            "checkout_url": None,
            "tier_id": data.tier_id,
            "message": "Switched to free tier"
        }
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(tier['price'] * 100),
                    'product_data': {
                        'name': f"{tier['name']} Plan",
                        'description': ", ".join(tier['features']),
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=f"{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={data.tier_id}",
            cancel_url=f"{data.origin_url}/settings",
            metadata={
                "user_id": user_id,
                "tier_id": data.tier_id,
                "plan_id": tier.get('id', data.tier_id),
                "subscription_type": "account_billing"
            }
        )
        
        # Store pending transaction
        transaction = PaymentTransaction(
            user_id=user_id,
            session_id=checkout_session.id,
            amount=tier['price'],
            currency="usd",
            payment_status="pending",
            status="pending",
            transaction_metadata=json.dumps({
                "type": "subscription_tier",
                "tier_id": data.tier_id
            })
        )
        db.add(transaction)
        await db.commit()
        
        return {
            "success": True,
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id,
            "tier_id": data.tier_id
        }
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")


@router.post("/subscriptions/grom-tier/{parent_id}")
async def update_grom_subscription(
    parent_id: str,
    data: GromSubscriptionRequest,
    db: AsyncSession = Depends(get_db)
):
    """Parent updates linked Grom's subscription tier"""
    # Verify parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    if not is_grom_parent_eligible(parent):
        raise HTTPException(status_code=403, detail="Only Grom Parents can manage Grom subscriptions")
    
    # Verify Grom is linked to this parent
    grom_result = await db.execute(
        select(Profile).where(
            Profile.id == data.grom_id,
            Profile.parent_id == parent_id
        )
    )
    grom = grom_result.scalar_one_or_none()
    if not grom:
        raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    
    # Use GROM-specific tiers
    if data.tier_id not in GROM_SUBSCRIPTION_TIERS:
        raise HTTPException(status_code=400, detail="Invalid Grom tier")
    
    tier = GROM_SUBSCRIPTION_TIERS[data.tier_id]
    
    # Free tier - instant activation
    if tier["price"] == 0:
        grom.subscription_tier = "free"
        grom.is_ad_supported = True  # Free tier = ads
        await db.commit()
        return {
            "success": True,
            "checkout_url": None,
            "grom_id": data.grom_id,
            "tier_id": data.tier_id,
            "message": "Grom switched to free tier"
        }
    
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail="Stripe not configured")
    
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{
                'price_data': {
                    'currency': 'usd',
                    'unit_amount': int(tier['price'] * 100),
                    'product_data': {
                        'name': f"{tier['name']} for {grom.full_name}",
                        'description': ", ".join(tier['features']),
                    },
                },
                'quantity': 1,
            }],
            mode='payment',
            success_url=f"{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={data.tier_id}&grom_id={data.grom_id}",
            cancel_url=f"{data.origin_url}/settings",
            metadata={
                "parent_id": parent_id,
                "grom_id": data.grom_id,
                "tier_id": data.tier_id,
                "plan_id": tier.get('id', data.tier_id),
                "subscription_type": "grom_subscription"
            }
        )
        
        transaction = PaymentTransaction(
            user_id=parent_id,
            session_id=checkout_session.id,
            amount=tier['price'],
            currency="usd",
            payment_status="pending",
            status="pending",
            transaction_metadata=json.dumps({
                "type": "grom_subscription",
                "grom_id": data.grom_id,
                "tier_id": data.tier_id
            })
        )
        db.add(transaction)
        await db.commit()
        
        return {
            "success": True,
            "checkout_url": checkout_session.url,
            "session_id": checkout_session.id,
            "grom_id": data.grom_id,
            "tier_id": data.tier_id
        }
    except stripe.error.StripeError as e:
        logger.error(f"Stripe error: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Payment error: {str(e)}")


@router.post("/subscriptions/parent-surfer-mode/{user_id}")
async def toggle_parent_surfer_mode(
    user_id: str,
    data: ParentSurferModeRequest,
    db: AsyncSession = Depends(get_db)
):
    """Toggle Active Surfer Mode for Grom Parents - adds athletic tracking"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if not is_grom_parent_eligible(user):
        raise HTTPException(status_code=403, detail="Only Grom Parents can enable Active Surfer Mode")
    
    # Store in profile metadata or add column
    # For now, we'll use a simple approach with existing fields
    # In production, add is_active_surfer column to Profile model
    
    # Update the user's metadata or create a dedicated field
    # Using skill_level field as a proxy indicator for now
    if data.active_surfer_mode:
        # Enable surfer tracking - set a marker
        user.skill_level = user.skill_level or "active_surfer"
    
    await db.commit()
    
    return {
        "success": True,
        "active_surfer_mode": data.active_surfer_mode,
        "message": "Active Surfer Mode " + ("enabled" if data.active_surfer_mode else "disabled")
    }


@router.post("/subscriptions/apply-pro/{user_id}")
async def apply_for_pro_vetting(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Apply for Pro Surfer/Photographer vetting - sets pending status"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Must be Competitive Surfer or Working Photographer to apply for Pro
    surfer_roles = [RoleEnum.COMP_SURFER]
    photographer_roles = [RoleEnum.PHOTOGRAPHER]
    
    if user.role not in surfer_roles + photographer_roles:
        raise HTTPException(
            status_code=403, 
            detail="Must be Competitive Surfer or Working Photographer to apply for Pro status"
        )
    
    # Mark as pending vetting (they keep Competitive features until vetted)
    # elite_tier stays as "competitive" but we track pending status
    if user.role in surfer_roles:
        user.elite_tier = "competitive"  # Keep competitive access while pending
    
    # In a full implementation, we'd create a VettingApplication record
    # For now, the admin can see users with competitive status and approve them
    
    await db.commit()
    
    return {
        "success": True,
        "status": "pending",
        "message": "Pro application submitted. You retain Competitive Surfer access while pending review.",
        "current_elite_tier": user.elite_tier
    }



# ============================================================
# STOKED CREDIT SUBSCRIPTION PAYMENT
# ============================================================

# Credit to USD conversion rate (1 Credit = $1.00 - SIMPLIFIED 1:1 RATIO)
CREDIT_TO_USD_RATE = 1  # 1 credit = $1

class CreditSubscriptionPaymentRequest(BaseModel):
    tier_id: str
    use_credits: bool = True

class GromCreditSubscriptionRequest(BaseModel):
    grom_id: str
    tier_id: str
    use_credits: bool = True


@router.post("/subscriptions/pay-with-credits/{user_id}")
async def pay_subscription_with_credits(
    user_id: str,
    data: CreditSubscriptionPaymentRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Pay for subscription upgrade using Stoked Credits
    Conversion: 100 Credits = $1.00
    """
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    # Get role-specific tiers
    available_tiers = get_tiers_for_role(user.role.value)
    
    if data.tier_id not in available_tiers:
        raise HTTPException(status_code=400, detail="Invalid tier for your role")
    
    tier = available_tiers[data.tier_id]
    
    # Free tier - no payment needed
    if tier["price"] == 0:
        user.subscription_tier = "free"
        user.is_ad_supported = True  # Free tier = ads
        await db.commit()
        return {
            "success": True,
            "tier_id": data.tier_id,
            "message": "Switched to free tier",
            "credits_used": 0
        }
    
    # Calculate credits required (1 credit = $1 - SIMPLIFIED 1:1 RATIO)
    credits_required = int(tier["price"] * CREDIT_TO_USD_RATE)
    current_balance = user.credit_balance or 0
    
    if current_balance < credits_required:
        # Insufficient balance - return details for UI to prompt top-up
        credits_needed = credits_required - current_balance
        dollars_needed = credits_needed / CREDIT_TO_USD_RATE
        
        return {
            "success": False,
            "insufficient_credits": True,
            "credits_required": credits_required,
            "current_balance": current_balance,
            "credits_needed": credits_needed,
            "dollars_needed": round(dollars_needed, 2),
            "message": f"Insufficient credits. You need {credits_needed} more credits (${dollars_needed:.2f}) to upgrade."
        }
    
    # Deduct credits and upgrade
    user.credit_balance -= credits_required
    
    # Map tier_id to subscription_tier string
    tier_to_subscription = {"tier_1": "free", "tier_2": "basic", "tier_3": "premium"}
    user.subscription_tier = tier_to_subscription.get(data.tier_id, "free")
    
    # ============ AD-FREE TOGGLE LOGIC ============
    # Any transaction > $0 = ad-free experience
    if tier["price"] > 0:
        user.is_ad_supported = False
    else:
        user.is_ad_supported = True
    
    # Log the transaction
    from models import CreditTransaction
    balance_before = (user.credit_balance or 0) + credits_required  # Balance before deduction
    credit_tx = CreditTransaction(
        user_id=user_id,
        amount=-credits_required,
        balance_before=balance_before,
        balance_after=user.credit_balance,
        transaction_type="subscription_payment",
        description=f"Subscription upgrade to {tier['name']}",
        reference_type="subscription",
        reference_id=data.tier_id
    )
    db.add(credit_tx)
    
    await db.commit()
    
    return {
        "success": True,
        "tier_id": data.tier_id,
        "new_tier": user.subscription_tier,
        "credits_used": credits_required,
        "new_balance": user.credit_balance,
        "message": f"Successfully upgraded to {tier['name']} using {credits_required} credits"
    }


@router.post("/subscriptions/grom-pay-with-credits/{parent_id}")
async def pay_grom_subscription_with_credits(
    parent_id: str,
    data: GromCreditSubscriptionRequest,
    db: AsyncSession = Depends(get_db)
):
    """
    Parent pays for Grom's subscription using Stoked Credits
    Hobbyists can direct their credits toward their Grom's subscription
    """
    # Verify parent
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    
    # Allow both Grom Parents and Hobbyist Photographers to pay for Groms
    allowed_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST]
    if parent.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Only Grom Parents or Hobbyists can pay for Grom subscriptions with credits")
    
    # Verify Grom is linked to this parent (for Grom Parents)
    # For Hobbyists, they can pay for any Grom they've supported
    grom_result = await db.execute(
        select(Profile).where(Profile.id == data.grom_id)
    )
    grom = grom_result.scalar_one_or_none()
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")
    
    # For Grom Parents, verify linkage
    if is_grom_parent_eligible(parent) and grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    
    # Get Grom-specific tiers
    if data.tier_id not in GROM_SUBSCRIPTION_TIERS:
        raise HTTPException(status_code=400, detail="Invalid Grom tier")
    
    tier = GROM_SUBSCRIPTION_TIERS[data.tier_id]
    
    # Free tier - no payment needed
    if tier["price"] == 0:
        grom.subscription_tier = "free"
        grom.is_ad_supported = True  # Free tier = ads
        await db.commit()
        return {
            "success": True,
            "grom_id": data.grom_id,
            "tier_id": data.tier_id,
            "message": "Grom switched to free tier",
            "credits_used": 0
        }
    
    # Calculate credits required
    credits_required = int(tier["price"] * CREDIT_TO_USD_RATE)
    current_balance = parent.credit_balance or 0
    
    if current_balance < credits_required:
        credits_needed = credits_required - current_balance
        dollars_needed = credits_needed / CREDIT_TO_USD_RATE
        
        return {
            "success": False,
            "insufficient_credits": True,
            "credits_required": credits_required,
            "current_balance": current_balance,
            "credits_needed": credits_needed,
            "dollars_needed": round(dollars_needed, 2),
            "message": f"Insufficient credits. You need {credits_needed} more credits (${dollars_needed:.2f}) to upgrade {grom.full_name}'s plan."
        }
    
    # Deduct from parent's balance and upgrade Grom
    parent.credit_balance -= credits_required
    
    tier_to_subscription = {"tier_1": "free", "tier_2": "basic", "tier_3": "premium"}
    grom.subscription_tier = tier_to_subscription.get(data.tier_id, "free")
    
    # ============ AD-FREE TOGGLE LOGIC ============
    # Any transaction > $0 = ad-free experience
    if tier["price"] > 0:
        grom.is_ad_supported = False
    else:
        grom.is_ad_supported = True
    
    # Log the transaction
    from models import CreditTransaction
    balance_before = (parent.credit_balance or 0) + credits_required
    credit_tx = CreditTransaction(
        user_id=parent_id,
        amount=-credits_required,
        balance_before=balance_before,
        balance_after=parent.credit_balance,
        transaction_type="grom_subscription_payment",
        description=f"Subscription upgrade for {grom.full_name} to {tier['name']}",
        reference_type="grom_subscription",
        reference_id=data.grom_id
    )
    db.add(credit_tx)
    
    await db.commit()
    
    return {
        "success": True,
        "grom_id": data.grom_id,
        "grom_name": grom.full_name,
        "tier_id": data.tier_id,
        "new_tier": grom.subscription_tier,
        "credits_used": credits_required,
        "parent_new_balance": parent.credit_balance,
        "message": f"Successfully upgraded {grom.full_name} to {tier['name']} using {credits_required} credits"
    }


@router.get("/subscriptions/credit-payment-info/{user_id}")
async def get_credit_payment_info(
    user_id: str,
    tier_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get credit payment information for a subscription tier"""
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    available_tiers = get_tiers_for_role(user.role.value)
    
    if tier_id not in available_tiers:
        raise HTTPException(status_code=400, detail="Invalid tier")
    
    tier = available_tiers[tier_id]
    credits_required = int(tier["price"] * CREDIT_TO_USD_RATE)
    current_balance = user.credit_balance or 0
    
    return {
        "tier_id": tier_id,
        "tier_name": tier["name"],
        "price_usd": tier["price"],
        "credits_required": credits_required,
        "current_balance": current_balance,
        "can_afford": current_balance >= credits_required,
        "credits_needed": max(0, credits_required - current_balance),
        "conversion_rate": f"{CREDIT_TO_USD_RATE} credits = $1.00"
    }
