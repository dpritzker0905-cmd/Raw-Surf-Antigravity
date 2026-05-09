"""
subscriptions_credits.py — Stoked Credit subscription payment endpoints.
Extracted from subscriptions.py (v88 decomposition).
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from pydantic import BaseModel
from database import get_db
from models import Profile, RoleEnum
from utils.grom_parent import is_grom_parent_eligible
from .subscriptions import get_tiers_for_role, GROM_SUBSCRIPTION_TIERS

router = APIRouter()
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
    user_id: str, data: CreditSubscriptionPaymentRequest, db: AsyncSession = Depends(get_db)
):
    """Pay for subscription upgrade using Stoked Credits."""
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
        user.is_ad_supported = True
        await db.commit()
        return {"success": True, "tier_id": data.tier_id, "message": "Switched to free tier", "credits_used": 0}
    credits_required = int(tier["price"] * CREDIT_TO_USD_RATE)
    current_balance = user.credit_balance or 0
    if current_balance < credits_required:
        credits_needed = credits_required - current_balance
        dollars_needed = credits_needed / CREDIT_TO_USD_RATE
        return {
            "success": False, "insufficient_credits": True,
            "credits_required": credits_required, "current_balance": current_balance,
            "credits_needed": credits_needed, "dollars_needed": round(dollars_needed, 2),
            "message": f"Insufficient credits. You need {credits_needed} more credits (${dollars_needed:.2f}) to upgrade."
        }
    user.credit_balance -= credits_required
    tier_to_subscription = {"tier_1": "free", "tier_2": "basic", "tier_3": "premium"}
    user.subscription_tier = tier_to_subscription.get(data.tier_id, "free")
    if tier["price"] > 0:
        user.is_ad_supported = False
    else:
        user.is_ad_supported = True
    from models import CreditTransaction
    balance_before = (user.credit_balance or 0) + credits_required
    credit_tx = CreditTransaction(
        user_id=user_id, amount=-credits_required,
        balance_before=balance_before, balance_after=user.credit_balance,
        transaction_type="subscription_payment",
        description=f"Subscription upgrade to {tier['name']}",
        reference_type="subscription", reference_id=data.tier_id
    )
    db.add(credit_tx)
    await db.commit()
    return {
        "success": True, "tier_id": data.tier_id, "new_tier": user.subscription_tier,
        "credits_used": credits_required, "new_balance": user.credit_balance,
        "message": f"Successfully upgraded to {tier['name']} using {credits_required} credits"
    }


@router.post("/subscriptions/grom-pay-with-credits/{parent_id}")
async def pay_grom_subscription_with_credits(
    parent_id: str, data: GromCreditSubscriptionRequest, db: AsyncSession = Depends(get_db)
):
    """Parent pays for Grom's subscription using Stoked Credits."""
    parent_result = await db.execute(select(Profile).where(Profile.id == parent_id))
    parent = parent_result.scalar_one_or_none()
    if not parent:
        raise HTTPException(status_code=404, detail="Parent not found")
    allowed_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST]
    if parent.role not in allowed_roles:
        raise HTTPException(status_code=403, detail="Only Grom Parents or Hobbyists can pay for Grom subscriptions with credits")
    grom_result = await db.execute(select(Profile).where(Profile.id == data.grom_id))
    grom = grom_result.scalar_one_or_none()
    if not grom:
        raise HTTPException(status_code=404, detail="Grom not found")
    if grom.role != RoleEnum.GROM:
        raise HTTPException(status_code=400, detail="Target user is not a Grom")
    if is_grom_parent_eligible(parent) and grom.parent_id != parent_id:
        raise HTTPException(status_code=403, detail="Grom is not linked to this parent")
    if data.tier_id not in GROM_SUBSCRIPTION_TIERS:
        raise HTTPException(status_code=400, detail="Invalid Grom tier")
    tier = GROM_SUBSCRIPTION_TIERS[data.tier_id]
    if tier["price"] == 0:
        grom.subscription_tier = "free"
        grom.is_ad_supported = True
        await db.commit()
        return {"success": True, "grom_id": data.grom_id, "tier_id": data.tier_id, "message": "Grom switched to free tier", "credits_used": 0}
    credits_required = int(tier["price"] * CREDIT_TO_USD_RATE)
    current_balance = parent.credit_balance or 0
    if current_balance < credits_required:
        credits_needed = credits_required - current_balance
        dollars_needed = credits_needed / CREDIT_TO_USD_RATE
        return {
            "success": False, "insufficient_credits": True,
            "credits_required": credits_required, "current_balance": current_balance,
            "credits_needed": credits_needed, "dollars_needed": round(dollars_needed, 2),
            "message": f"Insufficient credits. You need {credits_needed} more credits (${dollars_needed:.2f}) to upgrade {grom.full_name}'s plan."
        }
    parent.credit_balance -= credits_required
    tier_to_subscription = {"tier_1": "free", "tier_2": "basic", "tier_3": "premium"}
    grom.subscription_tier = tier_to_subscription.get(data.tier_id, "free")
    if tier["price"] > 0:
        grom.is_ad_supported = False
    else:
        grom.is_ad_supported = True
    from models import CreditTransaction
    balance_before = (parent.credit_balance or 0) + credits_required
    credit_tx = CreditTransaction(
        user_id=parent_id, amount=-credits_required,
        balance_before=balance_before, balance_after=parent.credit_balance,
        transaction_type="grom_subscription_payment",
        description=f"Subscription upgrade for {grom.full_name} to {tier['name']}",
        reference_type="grom_subscription", reference_id=data.grom_id
    )
    db.add(credit_tx)
    await db.commit()
    return {
        "success": True, "grom_id": data.grom_id, "grom_name": grom.full_name,
        "tier_id": data.tier_id, "new_tier": grom.subscription_tier,
        "credits_used": credits_required, "parent_new_balance": parent.credit_balance,
        "message": f"Successfully upgraded {grom.full_name} to {tier['name']} using {credits_required} credits"
    }


@router.get("/subscriptions/credit-payment-info/{user_id}")
async def get_credit_payment_info(user_id: str, tier_id: str, db: AsyncSession = Depends(get_db)):
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
        "tier_id": tier_id, "tier_name": tier["name"], "price_usd": tier["price"],
        "credits_required": credits_required, "current_balance": current_balance,
        "can_afford": current_balance >= credits_required,
        "credits_needed": max(0, credits_required - current_balance),
        "conversion_rate": f"{CREDIT_TO_USD_RATE} credits = $1.00"
    }
