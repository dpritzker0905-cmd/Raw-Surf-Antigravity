"""
P2 Admin Features: Revenue Dashboards, Promo Codes, Feature Flags, Notification Campaigns, Cohort Analysis
Delta sync with existing analytics infrastructure
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, desc, case, extract
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
from dateutil.relativedelta import relativedelta
import hashlib

from database import get_db
from models import (
    Profile, PromoCode, PromoCodeRedemption, FeatureFlag, NotificationCampaign,
    CohortAnalysis, PaymentTransaction, CreditTransaction, Booking, RoleEnum, AuditLog
)
from routes.admin_moderation import require_admin, log_audit

router = APIRouter()


# ============ REVENUE DASHBOARDS ============

@router.get("/admin/revenue/overview")
async def get_revenue_overview(
    admin_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Comprehensive revenue overview - GMV, Take Rate, MRR
    Delta sync: Adds to existing financial analytics
    """
    await require_admin(admin_id, db)
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    prev_start = start_date - timedelta(days=days)
    
    # GMV - Total transaction volume (from credit transactions)
    gmv_current = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(and_(
            CreditTransaction.amount < 0,  # Debits represent spending
            CreditTransaction.created_at >= start_date
        ))
    )
    gmv = gmv_current.scalar() or 0
    
    gmv_previous = await db.execute(
        select(func.sum(func.abs(CreditTransaction.amount)))
        .where(and_(
            CreditTransaction.amount < 0,
            CreditTransaction.created_at >= prev_start,
            CreditTransaction.created_at < start_date
        ))
    )
    gmv_prev = gmv_previous.scalar() or 0
    
    # Platform Revenue (our cut - assume 15% average take rate)
    # In reality, this would be calculated from actual platform fees
    take_rate = 0.15
    platform_revenue = gmv * take_rate
    
    # MRR - Monthly Recurring Revenue (from subscriptions)
    # Get active subscriptions
    mrr_result = await db.execute(
        select(func.sum(
            case(
                (Profile.subscription_tier == 'tier_2', 10.0),
                (Profile.subscription_tier == 'tier_3', 25.0),
                else_=0
            )
        ))
        .where(Profile.subscription_tier.in_(['tier_2', 'tier_3']))
    )
    mrr = mrr_result.scalar() or 0
    
    # Revenue breakdown by type - use CreditTransaction.transaction_type
    revenue_by_type = await db.execute(
        select(
            CreditTransaction.transaction_type,
            func.sum(func.abs(CreditTransaction.amount)).label('total'),
            func.count(CreditTransaction.id).label('count')
        )
        .where(and_(
            CreditTransaction.amount < 0,  # Debits (user spending)
            CreditTransaction.created_at >= start_date
        ))
        .group_by(CreditTransaction.transaction_type)
    )
    
    breakdown = {}
    for row in revenue_by_type.fetchall():
        breakdown[row.transaction_type or 'other'] = {
            'revenue': float(row.total or 0),
            'transactions': row.count
        }
    
    # Daily revenue trend
    daily_trend = await db.execute(
        select(
            func.date(CreditTransaction.created_at).label('date'),
            func.sum(func.abs(CreditTransaction.amount)).label('total')
        )
        .where(and_(
            CreditTransaction.amount < 0,  # Debits
            CreditTransaction.created_at >= start_date
        ))
        .group_by(func.date(CreditTransaction.created_at))
        .order_by(func.date(CreditTransaction.created_at))
    )
    
    trend = [{"date": str(row.date), "revenue": float(row.total or 0)} for row in daily_trend.fetchall()]
    
    return {
        "period_days": days,
        "gmv": round(gmv, 2),
        "gmv_change": round(((gmv - gmv_prev) / gmv_prev * 100) if gmv_prev > 0 else 0, 1),
        "platform_revenue": round(platform_revenue, 2),
        "take_rate": take_rate * 100,
        "mrr": round(mrr, 2),
        "breakdown_by_type": breakdown,
        "daily_trend": trend
    }


@router.get("/admin/revenue/cohort")
async def get_cohort_analysis(
    admin_id: str,
    months: int = 6,
    cohort_type: str = "signup",
    db: AsyncSession = Depends(get_db)
):
    """
    Cohort retention and revenue analysis
    Shows user retention and LTV by signup month
    """
    await require_admin(admin_id, db)
    
    # Generate cohort data for the last N months
    cohorts = []
    now = datetime.now(timezone.utc)
    
    for i in range(months):
        cohort_start = (now - relativedelta(months=i)).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        cohort_end = (cohort_start + relativedelta(months=1))
        cohort_month = cohort_start.strftime("%Y-%m")
        
        # Get cohort size (users who signed up in this month)
        cohort_users = await db.execute(
            select(Profile.id)
            .where(and_(
                Profile.created_at >= cohort_start,
                Profile.created_at < cohort_end
            ))
        )
        user_ids = [row[0] for row in cohort_users.fetchall()]
        cohort_size = len(user_ids)
        
        if cohort_size == 0:
            continue
        
        # Calculate retention for each subsequent month
        retention = {"month_0": 100}  # 100% at signup
        revenue = {"month_0": 0}
        
        for month_offset in range(1, min(i + 1, 12)):  # Up to 12 months
            check_start = cohort_start + relativedelta(months=month_offset)
            check_end = check_start + relativedelta(months=1)
            
            # Active users (had any activity) in this month
            if user_ids:
                active_result = await db.execute(
                    select(func.count(func.distinct(PaymentTransaction.user_id)))
                    .where(and_(
                        PaymentTransaction.user_id.in_(user_ids),
                        PaymentTransaction.created_at >= check_start,
                        PaymentTransaction.created_at < check_end
                    ))
                )
                active_count = active_result.scalar() or 0
                retention[f"month_{month_offset}"] = round((active_count / cohort_size) * 100, 1)
                
                # Revenue from this cohort in this month
                rev_result = await db.execute(
                    select(func.sum(PaymentTransaction.amount))
                    .where(and_(
                        PaymentTransaction.user_id.in_(user_ids),
                        PaymentTransaction.payment_status == 'completed',
                        PaymentTransaction.created_at >= check_start,
                        PaymentTransaction.created_at < check_end
                    ))
                )
                revenue[f"month_{month_offset}"] = round(float(rev_result.scalar() or 0), 2)
        
        cohorts.append({
            "cohort_month": cohort_month,
            "cohort_size": cohort_size,
            "retention": retention,
            "revenue": revenue
        })
    
    return {"cohorts": cohorts, "cohort_type": cohort_type}


# ============ PROMO CODES ============

class CreatePromoCodeRequest(BaseModel):
    code: str
    code_type: str  # percentage, fixed_amount, free_credits, first_booking
    discount_value: float
    max_uses: Optional[int] = None
    max_uses_per_user: int = 1
    valid_from: Optional[str] = None
    valid_until: Optional[str] = None
    min_purchase_amount: Optional[float] = None
    applicable_to: Optional[List[str]] = []
    target_user_roles: Optional[List[str]] = []
    campaign_name: Optional[str] = None
    campaign_source: Optional[str] = None


@router.get("/admin/promo-codes")
async def get_promo_codes(
    admin_id: str,
    is_active: Optional[bool] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get all promo codes with usage stats"""
    await require_admin(admin_id, db)
    
    query = select(PromoCode)
    if is_active is not None:
        query = query.where(PromoCode.is_active == is_active)
    query = query.order_by(desc(PromoCode.created_at)).limit(limit)
    
    result = await db.execute(query)
    codes = result.scalars().all()
    
    # Get total revenue from promo codes
    total_discount = await db.execute(
        select(func.sum(PromoCodeRedemption.discount_applied))
    )
    
    return {
        "promo_codes": [{
            "id": c.id,
            "code": c.code,
            "code_type": c.code_type,
            "discount_value": c.discount_value,
            "current_uses": c.current_uses,
            "max_uses": c.max_uses,
            "is_active": c.is_active,
            "valid_from": c.valid_from.isoformat() if c.valid_from else None,
            "valid_until": c.valid_until.isoformat() if c.valid_until else None,
            "campaign_name": c.campaign_name,
            "created_at": c.created_at.isoformat() if c.created_at else None
        } for c in codes],
        "total_discount_given": round(total_discount.scalar() or 0, 2)
    }


@router.post("/admin/promo-codes")
async def create_promo_code(
    data: CreatePromoCodeRequest,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new promo code"""
    admin = await require_admin(admin_id, db)
    
    # Check for duplicate code
    existing = await db.execute(
        select(PromoCode).where(PromoCode.code == data.code.upper())
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Promo code already exists")
    
    promo = PromoCode(
        code=data.code.upper(),
        code_type=data.code_type,
        discount_value=data.discount_value,
        max_uses=data.max_uses,
        max_uses_per_user=data.max_uses_per_user,
        valid_from=datetime.fromisoformat(data.valid_from) if data.valid_from else datetime.now(timezone.utc),
        valid_until=datetime.fromisoformat(data.valid_until) if data.valid_until else None,
        min_purchase_amount=data.min_purchase_amount,
        applicable_to=data.applicable_to or [],
        target_user_roles=data.target_user_roles or [],
        campaign_name=data.campaign_name,
        campaign_source=data.campaign_source,
        created_by=admin_id
    )
    db.add(promo)
    
    await log_audit(
        db, admin_id, "admin", "promo_code_created",
        f"Created promo code: {data.code.upper()}",
        "promo_code", promo.id, None,
        extra_data={"code_type": data.code_type, "discount": data.discount_value}
    )
    
    await db.commit()
    
    return {"id": promo.id, "code": promo.code, "status": "created"}


@router.put("/admin/promo-codes/{code_id}/toggle")
async def toggle_promo_code(
    code_id: str,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Activate/deactivate a promo code"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(PromoCode).where(PromoCode.id == code_id))
    promo = result.scalar_one_or_none()
    
    if not promo:
        raise HTTPException(status_code=404, detail="Promo code not found")
    
    promo.is_active = not promo.is_active
    
    await log_audit(
        db, admin_id, "admin", "promo_code_toggled",
        f"Promo code {promo.code} {'activated' if promo.is_active else 'deactivated'}",
        "promo_code", code_id, None
    )
    
    await db.commit()
    
    return {"code": promo.code, "is_active": promo.is_active}


@router.post("/promo-codes/validate")
async def validate_promo_code(
    code: str,
    user_id: str,
    purchase_amount: Optional[float] = None,
    product_type: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Validate a promo code for a user (user-facing)"""
    result = await db.execute(
        select(PromoCode).where(PromoCode.code == code.upper())
    )
    promo = result.scalar_one_or_none()
    
    if not promo:
        return {"valid": False, "error": "Invalid promo code"}
    
    if not promo.is_active:
        return {"valid": False, "error": "This promo code is no longer active"}
    
    now = datetime.now(timezone.utc)
    if promo.valid_from and now < promo.valid_from:
        return {"valid": False, "error": "This promo code is not yet valid"}
    
    if promo.valid_until and now > promo.valid_until:
        return {"valid": False, "error": "This promo code has expired"}
    
    if promo.max_uses and promo.current_uses >= promo.max_uses:
        return {"valid": False, "error": "This promo code has reached its usage limit"}
    
    # Check user's usage
    user_redemptions = await db.execute(
        select(func.count(PromoCodeRedemption.id))
        .where(and_(
            PromoCodeRedemption.promo_code_id == promo.id,
            PromoCodeRedemption.user_id == user_id
        ))
    )
    if user_redemptions.scalar() >= promo.max_uses_per_user:
        return {"valid": False, "error": "You have already used this promo code"}
    
    # Check minimum purchase
    if promo.min_purchase_amount and purchase_amount and purchase_amount < promo.min_purchase_amount:
        return {"valid": False, "error": f"Minimum purchase of ${promo.min_purchase_amount} required"}
    
    # Check applicable products
    if promo.applicable_to and product_type and product_type not in promo.applicable_to:
        return {"valid": False, "error": "This promo code is not applicable to this purchase"}
    
    # Calculate discount
    discount = 0
    if promo.code_type == 'percentage':
        discount = (purchase_amount or 0) * (promo.discount_value / 100)
    elif promo.code_type == 'fixed_amount':
        discount = promo.discount_value
    elif promo.code_type == 'free_credits':
        discount = promo.discount_value  # Credits to add
    
    return {
        "valid": True,
        "code": promo.code,
        "code_type": promo.code_type,
        "discount_value": promo.discount_value,
        "calculated_discount": round(discount, 2),
        "promo_id": promo.id
    }


# ============ FEATURE FLAGS ============

class CreateFeatureFlagRequest(BaseModel):
    key: str
    name: str
    description: Optional[str] = None
    is_enabled: bool = False
    rollout_percentage: int = 0
    target_roles: Optional[List[str]] = []
    is_experiment: bool = False
    experiment_variants: Optional[List[dict]] = []
    category: Optional[str] = None


@router.get("/admin/feature-flags")
async def get_feature_flags(
    admin_id: str,
    category: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get all feature flags"""
    await require_admin(admin_id, db)
    
    query = select(FeatureFlag)
    if category:
        query = query.where(FeatureFlag.category == category)
    query = query.order_by(FeatureFlag.key)
    
    result = await db.execute(query)
    flags = result.scalars().all()
    
    return {
        "feature_flags": [{
            "id": f.id,
            "key": f.key,
            "name": f.name,
            "description": f.description,
            "is_enabled": f.is_enabled,
            "rollout_percentage": f.rollout_percentage,
            "target_roles": f.target_roles,
            "is_experiment": f.is_experiment,
            "experiment_variants": f.experiment_variants,
            "kill_switch_enabled": f.kill_switch_enabled,
            "category": f.category,
            "updated_at": f.updated_at.isoformat() if f.updated_at else None
        } for f in flags]
    }


@router.post("/admin/feature-flags")
async def create_feature_flag(
    data: CreateFeatureFlagRequest,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new feature flag"""
    admin = await require_admin(admin_id, db)
    
    # Check for duplicate key
    existing = await db.execute(
        select(FeatureFlag).where(FeatureFlag.key == data.key)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Feature flag key already exists")
    
    flag = FeatureFlag(
        key=data.key,
        name=data.name,
        description=data.description,
        is_enabled=data.is_enabled,
        rollout_percentage=data.rollout_percentage,
        target_roles=data.target_roles or [],
        is_experiment=data.is_experiment,
        experiment_variants=data.experiment_variants or [],
        category=data.category,
        created_by=admin_id
    )
    db.add(flag)
    
    await log_audit(
        db, admin_id, "admin", "feature_flag_created",
        f"Created feature flag: {data.key}",
        "feature_flag", flag.id, None
    )
    
    await db.commit()
    
    return {"id": flag.id, "key": flag.key, "status": "created"}


@router.put("/admin/feature-flags/{flag_id}")
async def update_feature_flag(
    flag_id: str,
    admin_id: str,
    is_enabled: Optional[bool] = None,
    rollout_percentage: Optional[int] = None,
    kill_switch: Optional[bool] = None,
    db: AsyncSession = Depends(get_db)
):
    """Update a feature flag"""
    await require_admin(admin_id, db)
    
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.id == flag_id))
    flag = result.scalar_one_or_none()
    
    if not flag:
        raise HTTPException(status_code=404, detail="Feature flag not found")
    
    old_values = {"is_enabled": flag.is_enabled, "rollout_percentage": flag.rollout_percentage}
    
    if is_enabled is not None:
        flag.is_enabled = is_enabled
    if rollout_percentage is not None:
        flag.rollout_percentage = max(0, min(100, rollout_percentage))
    if kill_switch is not None:
        flag.kill_switch_enabled = kill_switch
        if kill_switch:
            flag.is_enabled = False  # Kill switch disables the flag
    
    await log_audit(
        db, admin_id, "admin", "feature_flag_updated",
        f"Updated feature flag: {flag.key}",
        "feature_flag", flag.id, None,
        old_value=old_values,
        new_value={"is_enabled": flag.is_enabled, "rollout_percentage": flag.rollout_percentage}
    )
    
    await db.commit()
    
    return {"key": flag.key, "is_enabled": flag.is_enabled, "rollout_percentage": flag.rollout_percentage}


@router.get("/feature-flags/check")
async def check_feature_flag(
    key: str,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Check if a feature flag is enabled for a user (user-facing)
    Uses consistent hashing for percentage rollouts
    """
    result = await db.execute(select(FeatureFlag).where(FeatureFlag.key == key))
    flag = result.scalar_one_or_none()
    
    if not flag:
        return {"enabled": False, "reason": "flag_not_found"}
    
    if flag.kill_switch_enabled:
        return {"enabled": False, "reason": "kill_switch"}
    
    if not flag.is_enabled:
        return {"enabled": False, "reason": "disabled"}
    
    # Check if user is in specific target list
    if user_id and flag.target_user_ids and user_id in flag.target_user_ids:
        return {"enabled": True, "reason": "targeted_user"}
    
    # Check if user is excluded
    if user_id and flag.exclude_user_ids and user_id in flag.exclude_user_ids:
        return {"enabled": False, "reason": "excluded"}
    
    # Check role targeting
    if user_id and flag.target_roles:
        user_result = await db.execute(select(Profile.role).where(Profile.id == user_id))
        user_role = user_result.scalar_one_or_none()
        if user_role and user_role.value in flag.target_roles:
            return {"enabled": True, "reason": "role_targeted"}
    
    # Percentage rollout using consistent hashing
    if flag.rollout_percentage < 100 and user_id:
        hash_input = f"{flag.key}:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16) % 100
        if hash_value >= flag.rollout_percentage:
            return {"enabled": False, "reason": "rollout_percentage"}
    
    # Handle experiments
    if flag.is_experiment and flag.experiment_variants and user_id:
        hash_input = f"{flag.key}:variant:{user_id}"
        hash_value = int(hashlib.md5(hash_input.encode()).hexdigest(), 16) % 100
        
        cumulative = 0
        for variant in flag.experiment_variants:
            cumulative += variant.get('weight', 0)
            if hash_value < cumulative:
                return {"enabled": True, "variant": variant.get('name'), "reason": "experiment"}
    
    return {"enabled": True, "reason": "enabled"}


# ============ NOTIFICATION CAMPAIGNS ============

class CreateCampaignRequest(BaseModel):
    name: str
    description: Optional[str] = None
    title: str
    body: str
    image_url: Optional[str] = None
    action_url: Optional[str] = None
    target_all_users: bool = False
    target_roles: Optional[List[str]] = []
    target_segments: Optional[List[str]] = []
    scheduled_at: Optional[str] = None


@router.get("/admin/notification-campaigns")
async def get_notification_campaigns(
    admin_id: str,
    status: Optional[str] = None,
    limit: int = 50,
    db: AsyncSession = Depends(get_db)
):
    """Get all notification campaigns"""
    await require_admin(admin_id, db)
    
    query = select(NotificationCampaign)
    if status:
        query = query.where(NotificationCampaign.status == status)
    query = query.order_by(desc(NotificationCampaign.created_at)).limit(limit)
    
    result = await db.execute(query)
    campaigns = result.scalars().all()
    
    return {
        "campaigns": [{
            "id": c.id,
            "name": c.name,
            "title": c.title,
            "body": c.body[:100] + "..." if len(c.body) > 100 else c.body,
            "status": c.status,
            "target_all_users": c.target_all_users,
            "target_roles": c.target_roles,
            "target_segments": c.target_segments,
            "scheduled_at": c.scheduled_at.isoformat() if c.scheduled_at else None,
            "sent_at": c.sent_at.isoformat() if c.sent_at else None,
            "stats": {
                "targeted": c.total_targeted,
                "sent": c.total_sent,
                "delivered": c.total_delivered,
                "opened": c.total_opened,
                "clicked": c.total_clicked,
                "open_rate": round((c.total_opened / c.total_sent * 100) if c.total_sent > 0 else 0, 1),
                "click_rate": round((c.total_clicked / c.total_opened * 100) if c.total_opened > 0 else 0, 1)
            },
            "created_at": c.created_at.isoformat() if c.created_at else None
        } for c in campaigns]
    }


@router.post("/admin/notification-campaigns")
async def create_notification_campaign(
    data: CreateCampaignRequest,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new notification campaign"""
    admin = await require_admin(admin_id, db)
    
    campaign = NotificationCampaign(
        name=data.name,
        description=data.description,
        title=data.title,
        body=data.body,
        image_url=data.image_url,
        action_url=data.action_url,
        target_all_users=data.target_all_users,
        target_roles=data.target_roles or [],
        target_segments=data.target_segments or [],
        scheduled_at=datetime.fromisoformat(data.scheduled_at) if data.scheduled_at else None,
        status='draft' if not data.scheduled_at else 'scheduled',
        created_by=admin_id
    )
    db.add(campaign)
    
    # Calculate target audience size
    if data.target_all_users:
        count_result = await db.execute(select(func.count(Profile.id)))
        campaign.total_targeted = count_result.scalar() or 0
    elif data.target_roles:
        count_result = await db.execute(
            select(func.count(Profile.id))
            .where(Profile.role.in_([RoleEnum(r) for r in data.target_roles if r in [e.value for e in RoleEnum]]))
        )
        campaign.total_targeted = count_result.scalar() or 0
    
    await log_audit(
        db, admin_id, "admin", "notification_campaign_created",
        f"Created notification campaign: {data.name}",
        "notification_campaign", campaign.id, None
    )
    
    await db.commit()
    
    return {"id": campaign.id, "name": campaign.name, "status": campaign.status}


@router.post("/admin/notification-campaigns/{campaign_id}/send")
async def send_notification_campaign(
    campaign_id: str,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Send a notification campaign immediately"""
    await require_admin(admin_id, db)
    
    result = await db.execute(
        select(NotificationCampaign).where(NotificationCampaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    if campaign.status == 'sent':
        raise HTTPException(status_code=400, detail="Campaign already sent")
    
    # In production, this would trigger actual push notification sending
    # For now, we'll mark it as sent and update stats
    campaign.status = 'sent'
    campaign.sent_at = datetime.now(timezone.utc)
    campaign.total_sent = campaign.total_targeted  # Simulated
    campaign.total_delivered = int(campaign.total_targeted * 0.95)  # 95% delivery rate simulated
    
    await log_audit(
        db, admin_id, "admin", "notification_campaign_sent",
        f"Sent notification campaign: {campaign.name} to {campaign.total_targeted} users",
        "notification_campaign", campaign.id, None
    )
    
    await db.commit()
    
    return {
        "status": "sent",
        "total_sent": campaign.total_sent,
        "total_delivered": campaign.total_delivered
    }


@router.put("/admin/notification-campaigns/{campaign_id}/cancel")
async def cancel_notification_campaign(
    campaign_id: str,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Cancel a scheduled notification campaign"""
    await require_admin(admin_id, db)
    
    result = await db.execute(
        select(NotificationCampaign).where(NotificationCampaign.id == campaign_id)
    )
    campaign = result.scalar_one_or_none()
    
    if not campaign:
        raise HTTPException(status_code=404, detail="Campaign not found")
    
    if campaign.status not in ['draft', 'scheduled']:
        raise HTTPException(status_code=400, detail="Can only cancel draft or scheduled campaigns")
    
    campaign.status = 'cancelled'
    
    await db.commit()
    
    return {"status": "cancelled"}


# ============ FUNNEL ANALYTICS (Enhanced) ============

@router.get("/admin/funnel/detailed")
async def get_detailed_funnel(
    admin_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """
    Detailed booking funnel with drop-off analysis
    Delta sync: Enhances existing funnel endpoint
    """
    await require_admin(admin_id, db)
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Funnel stages:
    # 1. Profile views (estimated from activity)
    # 2. Gallery views
    # 3. Add to cart / Booking initiated
    # 4. Checkout started
    # 5. Payment completed
    
    # Get booking stats by status
    booking_stats = await db.execute(
        select(
            Booking.status,
            func.count(Booking.id).label('count')
        )
        .where(Booking.created_at >= start_date)
        .group_by(Booking.status)
    )
    
    stats_by_status = {row.status: row.count for row in booking_stats.fetchall()}
    
    # Calculate funnel
    total_initiated = sum(stats_by_status.values())
    confirmed = stats_by_status.get('confirmed', 0) + stats_by_status.get('completed', 0)
    completed = stats_by_status.get('completed', 0)
    cancelled = stats_by_status.get('cancelled', 0)
    pending = stats_by_status.get('pending', 0)
    
    # Payment transactions
    payments = await db.execute(
        select(func.count(PaymentTransaction.id))
        .where(and_(
            PaymentTransaction.payment_status == 'completed',
            PaymentTransaction.created_at >= start_date
        ))
    )
    successful_payments = payments.scalar() or 0
    
    funnel = [
        {
            "stage": "Bookings Initiated",
            "count": total_initiated,
            "conversion_rate": 100
        },
        {
            "stage": "Bookings Confirmed",
            "count": confirmed,
            "conversion_rate": round((confirmed / total_initiated * 100) if total_initiated > 0 else 0, 1),
            "drop_off": total_initiated - confirmed
        },
        {
            "stage": "Payments Completed",
            "count": successful_payments,
            "conversion_rate": round((successful_payments / total_initiated * 100) if total_initiated > 0 else 0, 1),
            "drop_off": confirmed - successful_payments
        },
        {
            "stage": "Sessions Completed",
            "count": completed,
            "conversion_rate": round((completed / total_initiated * 100) if total_initiated > 0 else 0, 1),
            "drop_off": successful_payments - completed
        }
    ]
    
    # Drop-off reasons (simulated - would need actual tracking)
    drop_off_reasons = {
        "payment_failed": stats_by_status.get('payment_failed', 0),
        "user_cancelled": cancelled,
        "photographer_cancelled": stats_by_status.get('photographer_cancelled', 0),
        "expired": stats_by_status.get('expired', 0),
        "no_show": stats_by_status.get('no_show', 0)
    }
    
    return {
        "period_days": days,
        "funnel": funnel,
        "overall_conversion_rate": round((completed / total_initiated * 100) if total_initiated > 0 else 0, 1),
        "drop_off_reasons": drop_off_reasons,
        "booking_stats": stats_by_status
    }
