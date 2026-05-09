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
from models import CreditTransaction
from core.security import get_user_id_from_jwt_or_query

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
    user_id: str = Depends(get_user_id_from_jwt_or_query), 
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


# ============================================================
# SUBSCRIPTION LIFECYCLE -- Status toggle, tier upgrade, grom mgmt, pro vetting
# Extracted to subscription_lifecycle.py (v97 audit)
# ============================================================
