"""
Admin Content Moderation Queue
- AI-assisted photo/video review
- Bulk approve/reject
- Flagged content queue
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, update, desc, delete
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, ContentModerationItem, ContentModerationStatusEnum,
    GalleryItem, Post, ConditionReport
)
from routes.admin_moderation import log_audit

router = APIRouter()


class ModerateContentRequest(BaseModel):
    action: str  # 'approve', 'reject', 'escalate'
    rejection_reason: Optional[str] = None

class BulkModerateRequest(BaseModel):
    item_ids: List[str]
    action: str  # 'approve', 'reject'
    rejection_reason: Optional[str] = None


@router.get("/admin/content-moderation/queue")
async def get_moderation_queue(
    admin: Profile = Depends(get_current_admin),
    status: Optional[str] = "pending",
    content_type: Optional[str] = None,
    ai_flagged: Optional[bool] = None,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get content moderation queue with filters"""
    
    query = select(ContentModerationItem).order_by(
        desc(ContentModerationItem.ai_flagged),
        desc(ContentModerationItem.flag_count),
        ContentModerationItem.created_at
    )
    
    if status and status != 'all':
        query = query.where(ContentModerationItem.status == ContentModerationStatusEnum(status))
    if content_type and content_type != 'all':
        query = query.where(ContentModerationItem.content_type == content_type)
    if ai_flagged is not None:
        query = query.where(ContentModerationItem.ai_flagged == ai_flagged)
    
    # Get total
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0
    
    result = await db.execute(query.limit(limit).offset(offset))
    items = result.scalars().all()
    
    queue_data = []
    for item in items:
        user = await db.execute(select(Profile.full_name, Profile.email).where(Profile.id == item.user_id))
        user_info = user.fetchone()
        
        queue_data.append({
            "id": item.id,
            "content_type": item.content_type,
            "content_id": item.content_id,
            "content_url": item.content_url,
            "content_preview": item.content_preview,
            "user_id": item.user_id,
            "user_name": user_info[0] if user_info else None,
            "user_email": user_info[1] if user_info else None,
            "status": item.status.value if item.status else None,
            "ai_flagged": item.ai_flagged,
            "ai_confidence": item.ai_confidence,
            "ai_categories": item.ai_categories or [],
            "flagged_by": item.flagged_by,
            "flag_count": item.flag_count,
            "created_at": item.created_at.isoformat() if item.created_at else None
        })
    
    return {
        "items": queue_data,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.post("/admin/content-moderation/{item_id}/moderate")
async def moderate_content(
    item_id: str,
    request: ModerateContentRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Approve, reject, or escalate a content item"""
    
    result = await db.execute(select(ContentModerationItem).where(ContentModerationItem.id == item_id))
    item = result.scalar_one_or_none()
    
    if not item:
        raise HTTPException(status_code=404, detail="Item not found")
    
    status_map = {
        "approve": ContentModerationStatusEnum.APPROVED,
        "reject": ContentModerationStatusEnum.REJECTED,
        "escalate": ContentModerationStatusEnum.ESCALATED,
        "delete": ContentModerationStatusEnum.REJECTED  # delete = hard reject
    }
    
    new_status = status_map.get(request.action)
    if not new_status:
        raise HTTPException(status_code=400, detail="Invalid action")
    
    # If rejecting or deleting, remove the original content first
    if request.action in ("reject", "delete"):
        if item.content_type == "gallery_item":
            await db.execute(
                update(GalleryItem)
                .where(GalleryItem.id == item.content_id)
                .values(is_hidden=True)
            )
        elif item.content_type == "post":
            await db.execute(
                update(Post)
                .where(Post.id == item.content_id)
                .values(is_hidden=True)
            )
        elif item.content_type == "condition_report":
            # Hard-delete the condition report — setting is_active=False is not
            # sufficient because orphaned reports can still appear through
            # various query paths. Permanent removal is the correct action.
            await db.execute(
                delete(ConditionReport)
                .where(ConditionReport.id == item.content_id)
            )
        
        # Hard-delete the moderation queue entry itself so it never
        # reappears in any status filter (pending, rejected, etc.)
        await log_audit(db, admin.id, "content_moderation", f"{request.action} content {item.content_type}:{item.content_id}")
        await db.execute(
            delete(ContentModerationItem)
            .where(ContentModerationItem.id == item_id)
        )
        await db.commit()
        return {"success": True, "message": f"Content permanently removed"}
    
    # For approve / escalate — update status only
    await db.execute(
        update(ContentModerationItem)
        .where(ContentModerationItem.id == item_id)
        .values(
            status=new_status,
            reviewed_by=admin.id,
            reviewed_at=datetime.now(timezone.utc),
            rejection_reason=request.rejection_reason if request.action == "reject" else None
        )
    )
    
    await log_audit(db, admin.id, "content_moderation", f"{request.action} content {item.content_type}:{item.content_id}")
    await db.commit()
    
    return {"success": True, "message": f"Content {request.action}d"}


@router.post("/admin/content-moderation/bulk-moderate")
async def bulk_moderate_content(
    request: BulkModerateRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Bulk approve or reject multiple content items"""
    
    if request.action not in ["approve", "reject"]:
        raise HTTPException(status_code=400, detail="Bulk action must be 'approve' or 'reject'")
    
    if request.action == "reject":
        # For rejection: hard-delete original content, then hard-delete moderation entries
        items = await db.execute(
            select(ContentModerationItem)
            .where(ContentModerationItem.id.in_(request.item_ids))
        )
        for item in items.scalars().all():
            if item.content_type == "gallery_item":
                await db.execute(update(GalleryItem).where(GalleryItem.id == item.content_id).values(is_hidden=True))
            elif item.content_type == "post":
                await db.execute(update(Post).where(Post.id == item.content_id).values(is_hidden=True))
            elif item.content_type == "condition_report":
                # Hard-delete the condition report entirely
                await db.execute(
                    delete(ConditionReport).where(ConditionReport.id == item.content_id)
                )
        
        # Hard-delete all moderation queue entries so they never reappear
        await db.execute(
            delete(ContentModerationItem)
            .where(ContentModerationItem.id.in_(request.item_ids))
        )
    else:
        # For approval: update status only
        await db.execute(
            update(ContentModerationItem)
            .where(ContentModerationItem.id.in_(request.item_ids))
            .values(
                status=ContentModerationStatusEnum.APPROVED,
                reviewed_by=admin.id,
                reviewed_at=datetime.now(timezone.utc)
            )
        )
    
    await log_audit(db, admin.id, "content_moderation", f"bulk_{request.action} {len(request.item_ids)} items")
    await db.commit()
    
    return {"success": True, "processed": len(request.item_ids)}


@router.get("/admin/content-moderation/stats")
async def get_moderation_stats(
    admin: Profile = Depends(get_current_admin),
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get content moderation statistics"""
    
    start_date = datetime.now(timezone.utc) - timedelta(days=days)
    
    # Pending count
    pending = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(ContentModerationItem.status == ContentModerationStatusEnum.PENDING)
    )
    pending_count = pending.scalar() or 0
    
    # Reviewed in period
    reviewed = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(and_(
            ContentModerationItem.reviewed_at >= start_date,
            ContentModerationItem.status != ContentModerationStatusEnum.PENDING
        ))
    )
    reviewed_count = reviewed.scalar() or 0
    
    # Approved vs rejected
    approved = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(and_(
            ContentModerationItem.reviewed_at >= start_date,
            ContentModerationItem.status == ContentModerationStatusEnum.APPROVED
        ))
    )
    approved_count = approved.scalar() or 0
    
    rejected = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(and_(
            ContentModerationItem.reviewed_at >= start_date,
            ContentModerationItem.status == ContentModerationStatusEnum.REJECTED
        ))
    )
    rejected_count = rejected.scalar() or 0
    
    # AI flagged accuracy (flagged items that were rejected)
    ai_flagged_total = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(and_(
            ContentModerationItem.reviewed_at >= start_date,
            ContentModerationItem.ai_flagged == True
        ))
    )
    ai_total = ai_flagged_total.scalar() or 0
    
    ai_true_positive = await db.execute(
        select(func.count(ContentModerationItem.id))
        .where(and_(
            ContentModerationItem.reviewed_at >= start_date,
            ContentModerationItem.ai_flagged == True,
            ContentModerationItem.status == ContentModerationStatusEnum.REJECTED
        ))
    )
    ai_correct = ai_true_positive.scalar() or 0
    
    # By content type
    by_type = await db.execute(
        select(ContentModerationItem.content_type, func.count(ContentModerationItem.id))
        .where(ContentModerationItem.created_at >= start_date)
        .group_by(ContentModerationItem.content_type)
    )
    type_breakdown = {row[0]: row[1] for row in by_type.fetchall()}
    
    return {
        "period_days": days,
        "pending_count": pending_count,
        "reviewed_count": reviewed_count,
        "approved_count": approved_count,
        "rejected_count": rejected_count,
        "approval_rate": round((approved_count / reviewed_count * 100) if reviewed_count > 0 else 0, 1),
        "ai_accuracy": round((ai_correct / ai_total * 100) if ai_total > 0 else 0, 1),
        "by_content_type": type_breakdown
    }


class FlagContentRequest(BaseModel):
    content_type: str
    content_id: str
    reporter_id: Optional[str] = None
    reason: Optional[str] = None
    flagged_by: str = "user_report"
    ai_categories: Optional[List[str]] = None
    ai_confidence: Optional[float] = None


# Endpoint to flag content for moderation (from user reports or auto)
@router.post("/content/flag")
async def flag_content_for_moderation(
    request: FlagContentRequest,
    db: AsyncSession = Depends(get_db)
):
    """Flag content for moderation review"""
    content_type = request.content_type
    content_id = request.content_id
    flagged_by = request.flagged_by or "user_report"
    ai_categories = request.ai_categories
    ai_confidence = request.ai_confidence

    # Check if already in queue
    existing = await db.execute(
        select(ContentModerationItem)
        .where(and_(
            ContentModerationItem.content_type == content_type,
            ContentModerationItem.content_id == content_id,
            ContentModerationItem.status == ContentModerationStatusEnum.PENDING
        ))
    )
    existing_item = existing.scalar_one_or_none()
    
    if existing_item:
        # Increment flag count
        await db.execute(
            update(ContentModerationItem)
            .where(ContentModerationItem.id == existing_item.id)
            .values(flag_count=existing_item.flag_count + 1)
        )
        await db.commit()
        return {"success": True, "message": "Already reported", "detail": "You have already reported this content"}
    
    # Get content details
    content_url = None
    content_preview = None
    user_id = None
    
    if content_type == "gallery_item":
        item = await db.execute(select(GalleryItem).where(GalleryItem.id == content_id))
        gallery_item = item.scalar_one_or_none()
        if gallery_item:
            content_url = gallery_item.url
            content_preview = gallery_item.thumbnail_url or gallery_item.url
            user_id = gallery_item.photographer_id
    elif content_type == "post":
        item = await db.execute(select(Post).where(Post.id == content_id))
        post = item.scalar_one_or_none()
        if post:
            content_preview = post.content[:200] if post.content else None
            user_id = post.user_id
    elif content_type == "condition_report":
        item = await db.execute(select(ConditionReport).where(ConditionReport.id == content_id))
        cr = item.scalar_one_or_none()
        if cr:
            content_url = cr.media_url
            content_preview = cr.thumbnail_url or cr.media_url
            user_id = cr.photographer_id
    
    if not user_id:
        raise HTTPException(status_code=404, detail="Content not found")
    
    moderation_item = ContentModerationItem(
        content_type=content_type,
        content_id=content_id,
        content_url=content_url,
        content_preview=content_preview,
        user_id=user_id,
        flagged_by=flagged_by,
        ai_flagged=flagged_by == "auto",
        ai_confidence=ai_confidence,
        ai_categories=ai_categories or []
    )
    
    db.add(moderation_item)
    await db.commit()
    
    return {"success": True, "moderation_id": moderation_item.id}


@router.delete("/admin/condition-reports/{report_id}")
async def admin_delete_condition_report(
    report_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin direct-delete a condition report by ID.
    Also purges any associated moderation queue entries.
    This is a nuclear option that bypasses the moderation queue.
    """
    # Delete associated moderation items first
    await db.execute(
        delete(ContentModerationItem)
        .where(
            ContentModerationItem.content_type == "condition_report",
            ContentModerationItem.content_id == report_id
        )
    )
    
    # Hard-delete the condition report
    result = await db.execute(
        delete(ConditionReport)
        .where(ConditionReport.id == report_id)
    )
    
    await log_audit(db, admin.id, "content_moderation", f"admin_delete condition_report:{report_id}")
    await db.commit()
    
    return {"success": True, "deleted": result.rowcount > 0, "report_id": report_id}


@router.post("/admin/condition-reports/purge-orphans")
async def purge_orphan_condition_reports(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Mass-delete all condition reports that have no linked live session.
    Also purges all associated moderation queue entries.
    These are 'ghost' reports that should never have existed.
    """
    # Find all condition reports with no live_session_id
    orphan_result = await db.execute(
        select(ConditionReport.id).where(
            ConditionReport.live_session_id.is_(None)
        )
    )
    orphan_ids = [r[0] for r in orphan_result.all()]
    
    if not orphan_ids:
        return {"success": True, "purged": 0, "message": "No orphan reports found"}
    
    # Delete all associated moderation items
    await db.execute(
        delete(ContentModerationItem)
        .where(
            ContentModerationItem.content_type == "condition_report",
            ContentModerationItem.content_id.in_(orphan_ids)
        )
    )
    
    # Hard-delete all orphaned condition reports
    await db.execute(
        delete(ConditionReport)
        .where(ConditionReport.id.in_(orphan_ids))
    )
    
    await log_audit(db, admin.id, "content_moderation", f"purge_orphan_condition_reports count={len(orphan_ids)}")
    await db.commit()
    
    return {"success": True, "purged": len(orphan_ids), "message": f"Purged {len(orphan_ids)} orphan condition reports"}
