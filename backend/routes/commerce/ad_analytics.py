"""
Ad Analytics & Approval Queue
Extracted from ad_controls.py (v97 audit) for LOC governance.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from typing import Optional
from datetime import datetime, timezone
import logging

from database import get_db
from deps.admin_auth import get_current_admin
from models import Profile, CreditTransaction, Notification

logger = logging.getLogger(__name__)
router = APIRouter()


async def _create_ad_notification(db, user_id, ntype, title, body, data=None):
    import json as jl
    db.add(Notification(user_id=user_id, type=ntype, title=title, body=body,
                        data=jl.dumps(data) if data else None, is_read=False))


async def _get_cfg(db):
    from routes.commerce.ad_controls import get_ad_config
    return await get_ad_config(db)


async def _save_cfg(config, admin_id, db):
    from routes.commerce.ad_controls import save_ad_config
    return await save_ad_config(config, admin_id, db)


@router.get("/ads/my-analytics")
async def get_user_ad_analytics(user_id: str, db: AsyncSession = Depends(get_db)):
    """Get analytics for user's submitted ads"""
    config = await _get_cfg(db)
    variants = config.get("variants", [])
    my_ads = [v for v in variants if v.get("submitted_by") == user_id]
    approved_ads = [a for a in my_ads if a.get("approval_status") == "approved"]
    total_impressions = sum(a.get("impressions", 0) for a in approved_ads)
    total_clicks = sum(a.get("clicks", 0) for a in approved_ads)
    ctr = (total_clicks / total_impressions * 100) if total_impressions > 0 else 0
    per_ad_stats = []
    for ad in approved_ads:
        imp = ad.get("impressions", 0)
        clk = ad.get("clicks", 0)
        per_ad_stats.append({"id": ad.get("id"), "headline": ad.get("headline"),
            "impressions": imp, "clicks": clk,
            "ctr": (clk / imp * 100) if imp > 0 else 0,
            "budget": ad.get("budget_credits", 0)})
    return {"total_impressions": total_impressions, "total_clicks": total_clicks,
            "ctr": ctr, "total_spent": sum(a.get("budget_credits", 0) for a in my_ads),
            "active_ads": len(approved_ads), "per_ad_stats": per_ad_stats}


@router.delete("/ads/my-submissions/{ad_id}")
async def cancel_ad_submission(ad_id: str, user_id: str, db: AsyncSession = Depends(get_db)):
    """Cancel a pending ad and get refund"""
    config = await _get_cfg(db)
    variants = config.get("variants", [])
    ad_index, ad = None, None
    for i, v in enumerate(variants):
        if v.get("id") == ad_id:
            ad_index, ad = i, v
            break
    if ad is None:
        raise HTTPException(status_code=404, detail="Ad not found")
    if ad.get("submitted_by") != user_id:
        raise HTTPException(status_code=403, detail="You can only cancel your own ads")
    if ad.get("approval_status") != "pending":
        raise HTTPException(status_code=400, detail="Can only cancel pending ads")
    result = await db.execute(select(Profile).where(Profile.id == user_id))
    user = result.scalar_one_or_none()
    refund_amount = ad.get("budget_credits", 0)
    if user and refund_amount > 0:
        user.credit_balance = (user.credit_balance or 0) + refund_amount
        db.add(CreditTransaction(user_id=user_id, amount=refund_amount,
            balance_before=(user.credit_balance or 0) - refund_amount,
            balance_after=user.credit_balance, transaction_type="ad_refund",
            description=f"Ad cancelled: {ad.get('headline', '')[:30]}...",
            reference_type="ad_cancellation", reference_id=ad_id))
    variants.pop(ad_index)
    config["variants"] = variants
    await _save_cfg(config, user_id, db)
    await db.commit()
    return {"success": True, "message": "Ad cancelled and credits refunded", "refund_amount": refund_amount}


@router.get("/admin/ads/queue")
async def get_ad_approval_queue(admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Get pending ads waiting for approval"""
    config = await _get_cfg(db)
    variants = config.get("variants", [])
    pending = [v for v in variants if v.get("approval_status") == "pending"]
    approved = [v for v in variants if v.get("approval_status") == "approved"]
    rejected = [v for v in variants if v.get("approval_status") == "rejected"]
    return {"pending": pending, "approved": approved, "rejected": rejected,
            "counts": {"pending": len(pending), "approved": len(approved), "rejected": len(rejected)}}


@router.post("/admin/ads/queue/{ad_id}/approve")
async def approve_ad(ad_id: str, admin: Profile = Depends(get_current_admin), db: AsyncSession = Depends(get_db)):
    """Approve a pending ad submission"""
    config = await _get_cfg(db)
    variants = config.get("variants", [])
    found, ad = False, None
    for variant in variants:
        if variant.get("id") == ad_id:
            variant["approval_status"] = "approved"
            variant["is_active"] = True
            variant["approved_at"] = datetime.now(timezone.utc).isoformat()
            variant["approved_by"] = admin.id
            ad, found = variant, True
            break
    if not found:
        raise HTTPException(status_code=404, detail="Ad not found")
    config["variants"] = variants
    await _save_cfg(config, admin.id, db)
    submitter_id = ad.get("submitted_by")
    if submitter_id:
        await _create_ad_notification(db, submitter_id, "ad_approved", "Your Ad is Now Live!",
            f'Your ad "{ad.get("headline", "")[:30]}..." has been approved and is now running.',
            {"ad_id": ad_id, "action": "approved"})
        await db.commit()
    return {"success": True, "message": "Ad approved and now active"}


@router.post("/admin/ads/queue/{ad_id}/reject")
async def reject_ad(ad_id: str, admin: Profile = Depends(get_current_admin),
                     reason: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    """Reject a pending ad submission and refund credits"""
    config = await _get_cfg(db)
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
    submitter_id = ad.get("submitted_by")
    refund_amount = ad.get("budget_credits", 0)
    if submitter_id and refund_amount > 0:
        sub_result = await db.execute(select(Profile).where(Profile.id == submitter_id))
        submitter = sub_result.scalar_one_or_none()
        if submitter:
            submitter.credit_balance = (submitter.credit_balance or 0) + refund_amount
            db.add(CreditTransaction(user_id=submitter_id, amount=refund_amount,
                balance_before=(submitter.credit_balance or 0) - refund_amount,
                balance_after=submitter.credit_balance, transaction_type="ad_refund",
                description=f"Ad rejected: {reason or 'Policy violation'}",
                reference_type="ad_rejection", reference_id=ad_id))
    config["variants"] = variants
    await _save_cfg(config, admin.id, db)
    if submitter_id:
        msg = f'Your ad "{ad.get("headline", "")[:30]}..." was not approved.'
        if reason:
            msg += f' Reason: {reason}'
        msg += f' ${refund_amount} has been refunded to your balance.'
        await _create_ad_notification(db, submitter_id, "ad_rejected", "Ad Not Approved",
            msg, {"ad_id": ad_id, "action": "rejected", "reason": reason, "refund": refund_amount})
    await db.commit()
    return {"success": True, "message": "Ad rejected and credits refunded", "refund_amount": refund_amount}
