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
from decimal import Decimal, InvalidOperation

from database import get_db
from utils.checkout_recovery import persist_pending_checkout
from models import Profile, PaymentTransaction, RoleEnum
from utils.grom_parent import is_grom_parent_eligible
from models import CreditTransaction
from core.security import get_user_id_from_jwt_or_query

router = APIRouter()
logger = logging.getLogger(__name__)

STRIPE_API_KEY = os.environ.get('STRIPE_SECRET_KEY') or os.environ.get('STRIPE_API_KEY')
if STRIPE_API_KEY:
    stripe.api_key = STRIPE_API_KEY

# Checkout prices come from the same admin configuration exposed to signup.
# Annual checkout retains the existing 20 percent discount policy.
TIER_NAMES = {'tier_1': 'free', 'tier_2': 'basic', 'tier_3': 'premium'}
ROLE_PRICING_KEYS = {
    'Surfer': 'surfer', 'Comp Surfer': 'comp_surfer', 'Pro': 'comp_surfer',
    'Photographer': 'photographer', 'Approved Pro': 'approved_pro_photographer',
    'Hobbyist': 'hobbyist', 'Grom': 'grom', 'Grom Parent': 'grom_parent',
}


def _subscription_packages(pricing):
    packages = {}
    for role_key in ('surfer', 'photographer', 'approved_pro_photographer'):
        role = pricing.get(role_key, {})
        for tier_id, tier in role.get('tiers', {}).items():
            tier_name = TIER_NAMES.get(tier_id)
            if tier_name is None:
                continue
            price = round(float(tier['price']), 2)
            package = dict(tier, price=price, tier_id=tier_id, tier_name=tier_name,
                           type='surfer' if role_key == 'surfer' else 'photographer',
                           role_key=role_key, billing='monthly')
            packages[tier['id']] = package
            if price > 0:
                annual_price = round(price * 12 * 0.8, 2)
                packages[tier['id'] + '_annual'] = dict(
                    package, id=tier['id'] + '_annual', name=tier['name'] + ' Annual',
                    price=annual_price, billing='annual', monthly_equiv=round(annual_price / 12, 2),
                    savings=round(price * 12 - annual_price, 2), original_monthly=price)
    return packages


async def _configured_packages(db):
    from routes.commerce.pricing_config import get_active_pricing_config
    return _subscription_packages(await get_active_pricing_config(db))


async def get_configured_tiers_for_role(role, db):
    from routes.commerce.pricing_config import get_active_pricing_config
    pricing = await get_active_pricing_config(db)
    role_key = ROLE_PRICING_KEYS.get(role, 'surfer')
    configured = pricing.get(role_key, {}).get('tiers', {})
    base = get_tiers_for_role(role)
    return {tier_id: dict(base.get(tier_id, {}), **dict(tier, price=round(float(tier['price']), 2)))
            for tier_id, tier in configured.items()}


def _checkout_receipt(tier_id, tier_name, amount, billing_period='monthly'):
    return {'version': 1, 'tier_id': tier_id, 'tier_name': tier_name,
            'amount_cents': int(round(amount * 100)), 'billing_period': billing_period}


def _recorded_tier(metadata):
    receipt = metadata.get('receipt') or {}
    if receipt:
        tier = receipt.get('tier_name')
    else:
        tier = metadata.get('tier_name')
        if tier is None:
            tier_id = metadata.get('tier_id')
            tier = TIER_NAMES.get(tier_id)
            if tier is None:
                # Explicit signup IDs, including historical verified-Pro IDs.
                ids = {f'{prefix}_{name}{suffix}': name
                       for prefix in ('surfer', 'photographer', 'approved_pro', 'verified_pro')
                       for name in ('free', 'basic', 'premium') for suffix in ('', '_annual')}
                tier = ids.get(tier_id)
    if tier not in ('free', 'basic', 'premium'):
        raise HTTPException(status_code=409, detail='Subscription tier needs reconciliation')
    return tier


class SubscriptionCheckoutRequest(BaseModel):
    tier_id: str
    origin_url: str


class SubscriptionCheckoutResponse(BaseModel):
    checkout_url: str
    session_id: str
    tier: Optional[str] = None


@router.get('/subscriptions/plans')
async def get_subscription_plans(db: AsyncSession = Depends(get_db)):
    plans = {role: {'monthly': [], 'annual': []}
             for role in ('surfer', 'photographer', 'approved_pro_photographer')}
    for package in (await _configured_packages(db)).values():
        plans[package['role_key']][package['billing']].append(package)
    return plans


@router.post('/subscriptions/checkout', response_model=SubscriptionCheckoutResponse)
async def create_subscription_checkout(
    data: SubscriptionCheckoutRequest,
    user_id: str = Depends(get_user_id_from_jwt_or_query),
    db: AsyncSession = Depends(get_db),
):
    packages = await _configured_packages(db)
    if data.tier_id not in packages:
        raise HTTPException(status_code=400, detail='Invalid subscription tier')
    package = packages[data.tier_id]
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    tier_name = package['tier_name']
    if package['price'] == 0:
        user.subscription_tier = tier_name
        await db.commit()
        return SubscriptionCheckoutResponse(checkout_url=f'{data.origin_url}/feed', session_id='free', tier=tier_name)
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail='Stripe not configured')
    billing_period = package['billing']
    receipt = _checkout_receipt(data.tier_id, tier_name, package['price'], billing_period)
    try:
        checkout_session = stripe.checkout.Session.create(
            payment_method_types=['card'],
            line_items=[{'price_data': {
                'currency': 'usd', 'unit_amount': receipt['amount_cents'],
                'product_data': {'name': f"{package['name']} Subscription",
                                 'description': f"{billing_period.capitalize()} subscription"},
            }, 'quantity': 1}],
            mode='payment',
            success_url=f'{data.origin_url}/subscription/success?session_id={{CHECKOUT_SESSION_ID}}&tier={tier_name}&billing={billing_period}',
            cancel_url=f"{data.origin_url}/{package['type']}-subscription",
            metadata={'user_id': user_id, 'tier_id': data.tier_id, 'tier_name': tier_name,
                      'subscription_type': package['type'], 'billing_period': billing_period},
        )
    except stripe.error.StripeError as error:
        logger.error('Stripe checkout failed: %s', error)
        raise HTTPException(status_code=500, detail='Subscription checkout failed')
    await persist_pending_checkout(db, checkout_session.id, lambda: PaymentTransaction(
        user_id=user_id, session_id=checkout_session.id, amount=package['price'],
        currency='usd', payment_status='pending', status='pending',
        transaction_metadata=json.dumps({
            'type': 'subscription', 'tier_id': data.tier_id, 'tier_name': tier_name,
            'subscription_type': package['type'], 'billing_period': billing_period, 'receipt': receipt,
        }),
    ))
    return SubscriptionCheckoutResponse(checkout_url=checkout_session.url, session_id=checkout_session.id, tier=tier_name)


def _grom_receipt_cents(amount):
    try:
        cents = Decimal(str(amount)) * 100
        if not cents.is_finite() or cents <= 0 or cents != cents.to_integral_value():
            raise ValueError('Invalid cents')
        return int(cents)
    except (InvalidOperation, ValueError, TypeError):
        raise HTTPException(status_code=409, detail='Grom receipt amount needs reconciliation')


async def _complete_grom_card(transaction, metadata, session_id, db):
    """Fulfill the stored child receipt without changing the paying parent's plan."""
    try:
        statuses = {str(value or '').strip().lower() for value in
                    (transaction.payment_status, transaction.status)}
        if statuses & {'refunded', 'partially_refunded'}:
            return {'status': 'refunded', 'subscription_type': 'grom_subscription'}
        child_id, tier_id = metadata.get('grom_id'), metadata.get('tier_id')
        tier = GROM_SUBSCRIPTION_TIERS.get(tier_id)
        if not isinstance(child_id, str) or not child_id or tier is None:
            raise HTTPException(status_code=409, detail='Grom receipt target needs reconciliation')
        parties = await db.execute(select(Profile).where(
            Profile.id.in_(sorted({transaction.user_id, child_id})))
            .order_by(Profile.id).with_for_update().execution_options(populate_existing=True))
        by_id = {profile.id: profile for profile in parties.scalars().all()}
        parent, child = by_id.get(transaction.user_id), by_id.get(child_id)
        if (parent is None or not is_grom_parent_eligible(parent) or child is None
                or child.role != RoleEnum.GROM or child.parent_id != transaction.user_id
                or child.parent_link_approved is not True):
            raise HTTPException(status_code=409, detail='Grom recipient needs reconciliation')
        tier_name = TIER_NAMES[tier_id]
        answer = {'status': 'completed', 'tier': tier_name, 'subscription_type': 'grom_subscription',
                  'grom_id': child_id, 'current_tier': child.subscription_tier or 'free'}
        amount_cents = _grom_receipt_cents(transaction.amount)
        currency = str(transaction.currency or '').lower()
        if currency != 'usd':
            raise HTTPException(status_code=409, detail='Grom receipt currency needs reconciliation')
        receipt = metadata.get('receipt')
        if 'receipt' in metadata:
            expected = {'version': 1, 'type': 'grom_subscription', 'parent_id': transaction.user_id,
                        'grom_id': child_id, 'tier_id': tier_id, 'tier_name': tier_name,
                        'amount_cents': amount_cents, 'currency': currency, 'is_ad_supported': False}
            if (not isinstance(receipt, dict) or any(receipt.get(k) != v for k, v in expected.items())
                    or type(receipt.get('version')) is not int or type(receipt.get('amount_cents')) is not int
                    or receipt.get('is_ad_supported') is not False):
                raise HTTPException(status_code=409, detail='Grom receipt terms need reconciliation')
        if transaction.payment_status == 'completed':
            # Never reapply an old tier after a subsequent child plan change.
            return answer
        if not STRIPE_API_KEY:
            raise HTTPException(status_code=500, detail='Stripe not configured')
        try:
            checkout = stripe.checkout.Session.retrieve(session_id)
        except stripe.error.StripeError:
            raise HTTPException(status_code=502, detail='Grom payment verification unavailable')
        if checkout.payment_status != 'paid':
            return {'status': checkout.payment_status, 'tier': None,
                    'subscription_type': 'grom_subscription'}
        paid_metadata = checkout.metadata or {}
        if (type(checkout.amount_total) is not int or checkout.amount_total != amount_cents
                or str(checkout.currency or '').lower() != currency
                or paid_metadata.get('parent_id') != transaction.user_id
                or paid_metadata.get('grom_id') != child_id or paid_metadata.get('tier_id') != tier_id
                or paid_metadata.get('subscription_type') != 'grom_subscription'):
            raise HTTPException(status_code=409, detail='Grom payment receipt needs reconciliation')
        child.subscription_tier = tier_name
        child.is_ad_supported = False
        transaction.payment_status = 'completed'
        transaction.status = 'completed'
        await db.commit()
        return {**answer, 'current_tier': tier_name}
    except Exception:
        await db.rollback()
        raise


@router.get('/subscriptions/status/{session_id}')
async def check_subscription_status(session_id: str, db: AsyncSession = Depends(get_db)):
    if session_id == 'free':
        return {'status': 'completed', 'tier': 'free'}
    result = await db.execute(select(PaymentTransaction).where(
        PaymentTransaction.session_id == session_id).with_for_update())
    transaction = result.scalar_one_or_none()
    if not transaction:
        raise HTTPException(status_code=404, detail='Transaction not found')
    metadata = json.loads(transaction.transaction_metadata or '{}')
    if metadata.get('type') == 'grom_subscription':
        return await _complete_grom_card(transaction, metadata, session_id, db)
    tier_name = _recorded_tier(metadata)
    if transaction.payment_status == 'completed':
        return {'status': 'completed', 'tier': tier_name, 'message': 'Subscription already activated'}
    if not STRIPE_API_KEY:
        raise HTTPException(status_code=500, detail='Stripe not configured')
    try:
        checkout_session = stripe.checkout.Session.retrieve(session_id)
    except stripe.error.StripeError as error:
        logger.error('Stripe retrieval failed: %s', error)
        raise HTTPException(status_code=500, detail='Payment verification error')
    if checkout_session.payment_status != 'paid':
        return {'status': checkout_session.payment_status, 'tier': None}
    receipt = metadata.get('receipt')
    if receipt and (receipt.get('amount_cents') != int(round(transaction.amount * 100))
                    or checkout_session.amount_total != receipt['amount_cents']):
        raise HTTPException(status_code=409, detail='Subscription receipt needs reconciliation')
    user_result = await db.execute(select(Profile).where(Profile.id == transaction.user_id))
    user = user_result.scalar_one_or_none()
    if not user:
        raise HTTPException(status_code=404, detail='User not found')
    user.subscription_tier = tier_name
    transaction.payment_status = 'completed'
    transaction.status = 'completed'
    await db.commit()
    return {'status': 'completed', 'tier': tier_name, 'message': f'Subscription activated: {tier_name}'}


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
