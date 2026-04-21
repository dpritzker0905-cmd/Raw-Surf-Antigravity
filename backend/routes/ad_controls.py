"""
God Mode Ad Controls - Admin UI for managing ad configuration
Allows admins to configure ad frequency, content, and targeting.
Now using PostgreSQL for persistent storage.
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, update
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone
import json
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, AdConfig as AdConfigModel, CreditTransaction, Notification

logger = logging.getLogger(__name__)

router = APIRouter()


# ============================================================
# NOTIFICATION HELPER
# ============================================================

async def create_ad_notification(
    db: AsyncSession,
    user_id: str,
    notification_type: str,
    title: str,
    body: str,
    data: dict = None
):
    """Create a notification for ad status changes"""
    import json as json_lib
    notification = Notification(
        user_id=user_id,
        type=notification_type,
        title=title,
        body=body,
        data=json_lib.dumps(data) if data else None,
        is_read=False
    )
    db.add(notification)
    # Don't commit here - let the calling function handle the transaction
    logger.info(f"Created notification for user {user_id}: {title}")


# ============================================================
# PYDANTIC MODELS
# ============================================================

class AdVariant(BaseModel):
    id: str
    type: str  # 'upgrade', 'promo', 'sponsored'
    headline: str
    description: str
    cta: str
    cta_link: str
    gradient: str
    is_active: bool = True
    priority: int = 0
    target_roles: List[str] = []
    # User submission fields (optional)
    image_url: Optional[str] = None
    approval_status: Optional[str] = None  # 'pending', 'approved', 'rejected'
    submitted_by: Optional[str] = None
    submitted_by_name: Optional[str] = None
    submitted_at: Optional[str] = None
    budget_credits: Optional[int] = None
    impressions: Optional[int] = 0
    clicks: Optional[int] = 0


class AdConfigSchema(BaseModel):
    frequency: int = 6
    min_posts_before_first_ad: int = 3
    max_ads_per_session: int = 5
    variants: List[AdVariant] = []
    show_in_feed: bool = True
    show_in_explore: bool = True
    show_in_messages: bool = False


class UserAdSubmission(BaseModel):
    headline: str
    description: str
    cta: str
    cta_link: str
    ad_type: str = "sponsored"
    target_roles: List[str] = []
    image_url: Optional[str] = None
    video_url: Optional[str] = None
    thumbnail_url: Optional[str] = None
    media_type: Optional[str] = None  # 'image' or 'video'
    budget_credits: int = 10


# Default ad configuration
DEFAULT_AD_CONFIG = {
    "frequency": 6,
    "min_posts_before_first_ad": 3,
    "max_ads_per_session": 5,
    "show_in_feed": True,
    "show_in_explore": True,
    "show_in_messages": False,
    "variants": [
        {
            "id": "upgrade_pro",
            "type": "upgrade",
            "headline": "Go Ad-Free with Pro",
            "description": "Support Raw Surf and unlock premium features. Remove all ads and get priority booking.",
            "cta": "Upgrade Now",
            "cta_link": "/settings?tab=billing",
            "gradient": "from-cyan-500 to-blue-600",
            "is_active": True,
            "priority": 1,
            "target_roles": []
        },
        {
            "id": "gold_pass",
            "type": "upgrade",
            "headline": "Get the Gold Pass",
            "description": "Unlimited sessions, priority access to Pro photographers, and zero ads.",
            "cta": "Learn More",
            "cta_link": "/settings?tab=billing",
            "gradient": "from-yellow-500 to-orange-500",
            "is_active": True,
            "priority": 2,
            "target_roles": []
        },
        {
            "id": "credits_promo",
            "type": "promo",
            "headline": "Top Up Your Stoked Credits",
            "description": "Load up on credits and never miss a session. Any purchase removes ads!",
            "cta": "Add Credits",
            "cta_link": "/wallet",
            "gradient": "from-emerald-500 to-cyan-500",
            "is_active": True,
            "priority": 3,
            "target_roles": []
        }
    ],
    "analytics": {
        "total_impressions": 0,
        "total_clicks": 0,
        "conversions": 0
    },
    "updated_at": None,
    "updated_by": None
}


# ============================================================
# DATABASE HELPER FUNCTIONS
# ============================================================

async def get_ad_config(db: AsyncSession) -> dict:
    """Get the current active ad configuration from database"""
    result = await db.execute(
        select(AdConfigModel).where(AdConfigModel.is_active.is_(True))
    )
    config_row = result.scalar_one_or_none()
    
    if config_row:
        return config_row.config_data.copy()
    
    # No config exists - return default
    return DEFAULT_AD_CONFIG.copy()


async def save_ad_config(config: dict, admin_id: str, db: AsyncSession) -> dict:
    """Save ad configuration to database"""
    # Update metadata
    config["updated_at"] = datetime.now(timezone.utc).isoformat()
    config["updated_by"] = admin_id
    
    # Check if active config exists
    result = await db.execute(
        select(AdConfigModel).where(AdConfigModel.is_active.is_(True))
    )
    existing = result.scalar_one_or_none()
    
    if existing:
        # Update existing config
        existing.config_data = config
        existing.updated_by = admin_id
        existing.updated_at = datetime.now(timezone.utc)
        existing.version = (existing.version or 1) + 1
    else:
        # Create new config
        new_config = AdConfigModel(
            config_data=config,
            updated_by=admin.id,
            is_active=True,
            version=1
        )
        db.add(new_config)
    
    await db.commit()
    logger.info(f"Ad config saved to database by {admin_id}")
    return config


# ============================================================
# ENDPOINTS
# ============================================================

@router.get("/admin/ads/config")
async def get_ad_configuration(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get current ad configuration (God Mode only)"""
    config = await get_ad_config(db)
    return {"config": config}


@router.put("/admin/ads/config")
async def update_ad_configuration(
    admin: Profile = Depends(get_current_admin),
    config: AdConfigSchema,
    db: AsyncSession = Depends(get_db)
):
    """Update ad configuration (God Mode only)"""
    config_dict = config.model_dump()
    saved_config = await save_ad_config(config_dict, admin.id, db)
    
    logger.info(f"Ad config updated by admin {admin.id}")
    return {"success": True, "config": saved_config}


@router.patch("/admin/ads/frequency")
async def update_ad_frequency(
    admin: Profile = Depends(get_current_admin),
    frequency: int,
    db: AsyncSession = Depends(get_db)
):
    """Quick update ad frequency"""
    if frequency < 3 or frequency > 20:
        raise HTTPException(status_code=400, detail="Frequency must be between 3 and 20")
    
    config = await get_ad_config(db)
    config["frequency"] = frequency
    await save_ad_config(config, admin.id, db)
    
    return {"success": True, "frequency": frequency}


@router.patch("/admin/ads/variant/{variant_id}/toggle")
async def toggle_ad_variant(
    variant_id: str,
    admin: Profile = Depends(get_current_admin),
    is_active: bool,
    db: AsyncSession = Depends(get_db)
):
    """Enable/disable a specific ad variant"""
    config = await get_ad_config(db)
    
    found = False
    for variant in config.get("variants", []):
        if variant["id"] == variant_id:
            variant["is_active"] = is_active
            found = True
            break
    
    if not found:
        raise HTTPException(status_code=404, detail="Variant not found")
    
    await save_ad_config(config, admin.id, db)
    return {"success": True, "variant_id": variant_id, "is_active": is_active}


@router.post("/admin/ads/variant")
async def add_ad_variant(
    admin: Profile = Depends(get_current_admin),
    variant: AdVariant,
    db: AsyncSession = Depends(get_db)
):
    """Add a new ad variant"""
    config = await get_ad_config(db)
    
    for existing in config.get("variants", []):
        if existing["id"] == variant.id:
            raise HTTPException(status_code=400, detail="Variant ID already exists")
    
    config["variants"].append(variant.model_dump())
    await save_ad_config(config, admin.id, db)
    
    return {"success": True, "variant": variant.model_dump()}


@router.delete("/admin/ads/variant/{variant_id}")
async def delete_ad_variant(
    variant_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Delete an ad variant"""
    config = await get_ad_config(db)
    
    original_len = len(config.get("variants", []))
    config["variants"] = [v for v in config.get("variants", []) if v["id"] != variant_id]
    
    if len(config["variants"]) == original_len:
        raise HTTPException(status_code=404, detail="Variant not found")
    
    await save_ad_config(config, admin.id, db)
    return {"success": True, "deleted_id": variant_id}


@router.get("/admin/ads/analytics")
async def get_ad_analytics(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get ad performance analytics"""
    config = await get_ad_config(db)
    
    # Count ad-supported users
    from sqlalchemy import func
    ad_users_result = await db.execute(
        select(func.count(Profile.id)).where(Profile.is_ad_supported.is_(True))
    )
    ad_supported_count = ad_users_result.scalar() or 0
    
    total_users_result = await db.execute(select(func.count(Profile.id)))
    total_users = total_users_result.scalar() or 0
    
    return {
        "analytics": config.get("analytics", {}),
        "ad_supported_users": ad_supported_count,
        "total_users": total_users,
        "ad_free_users": total_users - ad_supported_count,
        "active_variants": len([v for v in config.get("variants", []) if v.get("is_active")]),
        "total_variants": len(config.get("variants", []))
    }


@router.post("/ads/impression")
async def track_ad_impression(
    variant_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Track an ad impression (called from frontend)"""
    try:
        config = await get_ad_config(db)
        
        if "analytics" not in config:
            config["analytics"] = {"total_impressions": 0, "total_clicks": 0, "conversions": 0}
        
        config["analytics"]["total_impressions"] = config["analytics"].get("total_impressions", 0) + 1
        await save_ad_config(config, "system", db)
        
        return {"tracked": True}
    except Exception as e:
        logger.warning(f"Failed to track ad impression: {e}")
        return {"tracked": True}


@router.post("/ads/click")
async def track_ad_click(
    variant_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Track an ad click (called from frontend)"""
    try:
        config = await get_ad_config(db)
        
        if "analytics" not in config:
            config["analytics"] = {"total_impressions": 0, "total_clicks": 0, "conversions": 0}
        
        config["analytics"]["total_clicks"] = config["analytics"].get("total_clicks", 0) + 1
        await save_ad_config(config, "system", db)
        
        return {"tracked": True}
    except Exception as e:
        logger.warning(f"Failed to track ad click: {e}")
        return {"tracked": True}


@router.get("/ads/config")
async def get_public_ad_config(
    db: AsyncSession = Depends(get_db)
):
    """Get active ad config for frontend (public)"""
    config = await get_ad_config(db)
    
    return {
        "frequency": config.get("frequency", 6),
        "min_posts_before_first_ad": config.get("min_posts_before_first_ad", 3),
        "show_in_feed": config.get("show_in_feed", True),
        "show_in_explore": config.get("show_in_explore", True),
        "variants": [
            {
                "id": v["id"],
                "type": v["type"],
                "headline": v["headline"],
                "description": v["description"],
                "cta": v["cta"],
                "cta_link": v["cta_link"],
                "gradient": v["gradient"],
                "target_roles": v.get("target_roles", [])
            }
            for v in config.get("variants", [])
            if v.get("is_active", True) and v.get("approval_status") != "pending"
        ]
    }


# ============================================================
# USER AD SUBMISSION (Self-Serve Ad Engine)
# ============================================================

@router.post("/ads/submit")
async def submit_user_ad(
    user_id: str,
    data: UserAdSubmission,
    db: AsyncSession = Depends(get_db)
):
    """
    User submits an ad creative for approval.
    Deducts credits from user balance and adds to approval queue.
    """
    import uuid
    
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    if not user:
        raise HTTPException(status_code=404, detail="User not found")
    
    if (user.credit_balance or 0) < data.budget_credits:
        raise HTTPException(
            status_code=400, 
            detail=f"Insufficient credits. You have ${user.credit_balance or 0}, need ${data.budget_credits}"
        )
    
    # Deduct credits
    user.credit_balance = (user.credit_balance or 0) - data.budget_credits
    
    ad_id = f"user_ad_{uuid.uuid4().hex[:8]}"
    
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    new_ad = {
        "id": ad_id,
        "type": data.ad_type,
        "headline": data.headline,
        "description": data.description,
        "cta": data.cta,
        "cta_link": data.cta_link,
        "image_url": data.image_url,
        "video_url": data.video_url,
        "thumbnail_url": data.thumbnail_url,
        "media_type": data.media_type or ("video" if data.video_url else "image" if data.image_url else None),
        "gradient": "from-purple-500/20 to-pink-500/20",
        "is_active": False,
        "priority": 0,
        "target_roles": data.target_roles,
        "approval_status": "pending",
        "submitted_by": user_id,
        "submitted_by_name": user.full_name,
        "submitted_at": datetime.now(timezone.utc).isoformat(),
        "budget_credits": data.budget_credits,
        "impressions": 0,
        "clicks": 0
    }
    
    variants.append(new_ad)
    config["variants"] = variants
    
    await save_ad_config(config, user_id, db)
    
    # Log credit transaction
    tx = CreditTransaction(
        user_id=user_id,
        amount=-data.budget_credits,
        balance_before=(user.credit_balance or 0) + data.budget_credits,
        balance_after=user.credit_balance,
        transaction_type="ad_purchase",
        description=f"Ad submission: {data.headline[:30]}...",
        reference_type="ad_submission",
        reference_id=ad_id
    )
    db.add(tx)
    await db.commit()
    
    return {
        "success": True,
        "ad_id": ad_id,
        "message": "Ad submitted for approval",
        "credits_spent": data.budget_credits,
        "new_balance": user.credit_balance
    }


@router.get("/ads/my-submissions")
async def get_my_ad_submissions(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get user's submitted ads and their status"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    my_ads = [v for v in variants if v.get("submitted_by") == user_id]
    
    return {
        "ads": my_ads,
        "counts": {
            "pending": len([a for a in my_ads if a.get("approval_status") == "pending"]),
            "approved": len([a for a in my_ads if a.get("approval_status") == "approved"]),
            "rejected": len([a for a in my_ads if a.get("approval_status") == "rejected"])
        }
    }


@router.get("/ads/my-analytics")
async def get_user_ad_analytics(
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get analytics for user's submitted ads (impressions, clicks, CTR)"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    # Get user's approved ads
    my_ads = [v for v in variants if v.get("submitted_by") == user_id]
    approved_ads = [a for a in my_ads if a.get("approval_status") == "approved"]
    
    # Calculate totals
    total_impressions = sum(a.get("impressions", 0) for a in approved_ads)
    total_clicks = sum(a.get("clicks", 0) for a in approved_ads)
    total_spent = sum(a.get("budget_credits", 0) for a in my_ads)
    
    # Calculate CTR
    ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    
    # Per-ad stats
    per_ad_stats = []
    for ad in approved_ads:
        impressions = ad.get("impressions", 0)
        clicks = ad.get("clicks", 0)
        ad_ctr = (clicks / impressions * 100) if impressions > 0 else 0
        per_ad_stats.append({
            "id": ad.get("id"),
            "headline": ad.get("headline"),
            "impressions": impressions,
            "clicks": clicks,
            "ctr": ad_ctr,
            "budget": ad.get("budget_credits", 0)
        })
    
    return {
        "total_impressions": total_impressions,
        "total_clicks": total_clicks,
        "ctr": ctr,
        "total_spent": total_spent,
        "active_ads": len(approved_ads),
        "per_ad_stats": per_ad_stats
    }


@router.delete("/ads/my-submissions/{ad_id}")
async def cancel_ad_submission(
    ad_id: str,
    user_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Cancel a pending ad and get refund"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    ad_index = None
    ad = None
    for i, v in enumerate(variants):
        if v.get("id") == ad_id:
            ad_index = i
            ad = v
            break
    
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    
    if ad.get("submitted_by") != user_id:
        raise HTTPException(status_code=403, detail="You can only cancel your own ads")
    
    if ad.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending ads")
    
    # Refund credits
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    
    refund_amount = ad.get("budget_credits", 0)
    if user and refund_amount > 0:
        user.credit_balance = (user.credit_balance or 0) + refund_amount
        
        tx = CreditTransaction(
            user_id=user_id,
            amount=refund_amount,
            balance_before=(user.credit_balance or 0) - refund_amount,
            balance_after=user.credit_balance,
            transaction_type="ad_refund",
            description=f"Ad cancelled: {ad.get('headline', '')[:30]}...",
            reference_type="ad_cancellation",
            reference_id=ad_id
        )
        db.add(tx)
    
    variants.pop(ad_index)
    config["variants"] = variants
    await save_ad_config(config, user_id, db)
    await db.commit()
    
    return {
        "success": True,
        "message": "Ad cancelled and credits refunded",
        "refund_amount": refund_amount
    }


# ============================================================
# ADMIN AD APPROVAL QUEUE
# ============================================================

@router.get("/admin/ads/queue")
async def get_ad_approval_queue(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get pending ads waiting for approval"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    pending = [v for v in variants if v.get("approval_status") == "pending"]
    approved = [v for v in variants if v.get("approval_status") == "approved"]
    rejected = [v for v in variants if v.get("approval_status") == "rejected"]
    
    return {
        "pending": pending,
        "approved": approved,
        "rejected": rejected,
        "counts": {
            "pending": len(pending),
            "approved": len(approved),
            "rejected": len(rejected)
        }
    }


@router.post("/admin/ads/queue/{ad_id}/approve")
async def approve_ad(
    ad_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Approve a pending ad submission"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    found = False
    ad = None
    for variant in variants:
        if variant.get("id") == ad_id:
            variant["approval_status"] = "approved"
            variant["is_active"] = True
            variant["approved_at"] = datetime.now(timezone.utc).isoformat()
            variant["approved_by"] = admin.id
            ad = variant
            found = True
            break
    
    if not found:
        raise HTTPException(status_code=404, detail="Ad not found")
    
    config["variants"] = variants
    await save_ad_config(config, admin.id, db)
    
    # Send push notification to the ad submitter
    submitter_id = ad.get("submitted_by")
    if submitter_id:
        await create_ad_notification(
            db=db,
            user_id=submitter_id,
            notification_type="ad_approved",
            title="Your Ad is Now Live!",
            body=f'Your ad "{ad.get("headline", "")[:30]}..." has been approved and is now running.',
            data={"ad_id": ad_id, "action": "approved"}
        )
        await db.commit()
    
    return {"success": True, "message": "Ad approved and now active"}


@router.post("/admin/ads/queue/{ad_id}/reject")
async def reject_ad(
    ad_id: str,
    admin: Profile = Depends(get_current_admin),
    reason: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Reject a pending ad submission and refund credits"""
    config = await get_ad_config(db)
    variants = config.get("variants", [])
    
    ad = None
    for variant in variants:
        if variant.get("id") == ad_id:
            variant["approval_status"] = "rejected"
            variant["is_active"] = False
            variant["rejected_at"] = datetime.now(timezone.utc).isoformat()
            variant["rejected_by"] = admin.id
            variant["rejection_reason"] = reason
            ad = variant
            break
    
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    
    # Refund credits to the user
    submitter_id = ad.get("submitted_by")
    refund_amount = ad.get("budget_credits", 0)
    
    if submitter_id and refund_amount > 0:
        submitter_result = await db.execute(select(Profile).where(Profile.id == submitter_id))
        submitter = submitter_result.scalar_one_or_none()
        
        if submitter:
            submitter.credit_balance = (submitter.credit_balance or 0) + refund_amount
            
            tx = CreditTransaction(
                user_id=submitter_id,
                amount=refund_amount,
                balance_before=(submitter.credit_balance or 0) - refund_amount,
                balance_after=submitter.credit_balance,
                transaction_type="ad_refund",
                description=f"Ad rejected: {reason or 'Policy violation'}",
                reference_type="ad_rejection",
                reference_id=ad_id
            )
            db.add(tx)
    
    config["variants"] = variants
    await save_ad_config(config, admin.id, db)
    
    # Send push notification to the ad submitter about rejection
    if submitter_id:
        rejection_msg = f'Your ad "{ad.get("headline", "")[:30]}..." was not approved.'
        if reason:
            rejection_msg += f' Reason: {reason}'
        rejection_msg += f' ${refund_amount} has been refunded to your balance.'
        
        await create_ad_notification(
            db=db,
            user_id=submitter_id,
            notification_type="ad_rejected",
            title="Ad Not Approved",
            body=rejection_msg,
            data={"ad_id": ad_id, "action": "rejected", "reason": reason, "refund": refund_amount}
        )
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Ad rejected and credits refunded",
        "refund_amount": refund_amount
    }
