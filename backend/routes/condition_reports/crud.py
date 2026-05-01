"""Condition reports CRUD — create, spot reports, detail, deactivate, delete, update media."""
from pydantic import BaseModel
from fastapi import Depends, HTTPException, Query, APIRouter
from sqlalchemy import and_, desc, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload
from database import get_db
from datetime import datetime, timedelta, timezone
from typing import Optional
from models import ConditionReport, LiveSession, Post, Profile, RoleEnum, SurfSpot

from .schemas import ConditionReportCreate
router = APIRouter()
@router.post("/condition-reports")
async def create_condition_report(
    photographer_id: str,
    data: ConditionReportCreate,
    db: AsyncSession = Depends(get_db)
):
    """
    Create a new condition report. Called automatically when photographer goes live
    or can be created manually.
    
    This will also:
    1. Create a Story with BLUE ring
    2. Create a Post on photographer's feed
    3. Pin to the map (via spot_id)
    """
    # Verify photographer
    result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Verify photographer role
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if photographer.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can create condition reports")
    
    # Get spot info if spot_id provided
    spot = None
    region = data.region
    spot_name = data.spot_name
    latitude = data.latitude
    longitude = data.longitude
    
    if data.spot_id:
        spot_result = await db.execute(
            select(SurfSpot).where(SurfSpot.id == data.spot_id)
        )
        spot = spot_result.scalar_one_or_none()
        if spot:
            region = region or spot.region
            spot_name = spot_name or spot.name
            latitude = latitude or spot.latitude
            longitude = longitude or spot.longitude
    
    # Set expiration (24 hours)
    expires_at = datetime.now(timezone.utc) + timedelta(hours=REPORT_DURATION_HOURS)
    
    # 1. Create the condition report
    condition_report = ConditionReport(
        photographer_id=photographer_id,
        spot_id=data.spot_id,
        media_url=data.media_url,
        media_type=data.media_type,
        thumbnail_url=data.thumbnail_url,
        caption=data.caption,
        spot_name=spot_name,
        region=region,
        wave_height_ft=data.wave_height_ft,
        conditions_label=data.conditions_label,
        wind_conditions=data.wind_conditions,
        crowd_level=data.crowd_level,
        latitude=latitude,
        longitude=longitude,
        expires_at=expires_at,
        is_active=True
    )
    db.add(condition_report)
    
    # 2. Create a Story (will have BLUE ring for new/unseen)
    story = Story(
        author_id=photographer_id,
        spot_id=data.spot_id,
        media_url=data.media_url,
        media_type=data.media_type,
        caption=data.caption,
        story_type='photographer',
        is_live_report=True,
        latitude=latitude,
        longitude=longitude,
        location_name=spot_name,
        expires_at=expires_at
    )
    db.add(story)
    await db.flush()  # Get story ID
    
    # Link story to condition report
    condition_report.story_id = story.id
    
    # 3. Create a Post on photographer's feed
    post = Post(
        author_id=photographer_id,
        caption=data.caption or f"📷 Live conditions at {spot_name or 'surf spot'}",
        media_url=data.media_url,
        media_type=data.media_type,
        thumbnail_url=data.thumbnail_url,
        spot_id=data.spot_id,
        location=spot_name,
        latitude=latitude,
        longitude=longitude
    )
    db.add(post)
    await db.flush()
    
    # Link post to condition report
    condition_report.post_id = post.id
    
    await db.commit()
    await db.refresh(condition_report)
    
    # Broadcast new condition report via WebSocket
    await broadcast_new_condition_report({
        "id": condition_report.id,
        "photographer_id": condition_report.photographer_id,
        "photographer_name": photographer.full_name,
        "photographer_avatar": photographer.avatar_url,
        "spot_name": spot_name,
        "region": data.region,
        "media_url": data.media_url,
        "media_type": data.media_type,
        "caption": data.caption,
        "wave_height_ft": data.wave_height_ft,
        "conditions_label": data.conditions_label,
        "wind_conditions": data.wind_conditions,
        "crowd_level": data.crowd_level,
        "created_at": condition_report.created_at.isoformat() if condition_report.created_at else None
    })
    
    return {
        "success": True,
        "condition_report_id": condition_report.id,
        "story_id": story.id,
        "post_id": post.id,
        "message": "Condition report created and posted to story, feed, and conditions explorer"
    }


@router.get("/condition-reports/spot/{spot_id}")
async def get_condition_reports_for_spot(
    spot_id: str,
    limit: int = Query(default=10, le=50),
    include_expired: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """
    Get condition reports for a specific surf spot.
    Used by SpotHub to display the Reports tab.
    Returns both active and optionally expired reports.
    """
    now = datetime.now(timezone.utc)
    
    # Build query for this spot's condition reports
    # Only return active reports (is_active=False means admin-rejected or deactivated)
    query = select(ConditionReport).where(
        and_(
            ConditionReport.spot_id == spot_id,
            ConditionReport.is_active.is_(True)
        )
    ).options(
        selectinload(ConditionReport.photographer),
        selectinload(ConditionReport.spot)
    )
    
    if not include_expired:
        # Show reports that are either:
        # 1. Recently created (within 48h) — natural condition reports
        # 2. Still active (expires_at in the future) — manually pushed reports from older sessions
        query = query.where(
            or_(
                ConditionReport.created_at > now - timedelta(hours=48),
                ConditionReport.expires_at > now
            )
        )
    
    query = query.order_by(desc(ConditionReport.created_at)).limit(limit)
    
    result = await db.execute(query)
    reports = result.scalars().all()
    
    response_reports = []
    any_healed = False
    
    # Batch-check which photographers are currently in an active live session
    photographer_ids = list(set(r.photographer_id for r in reports))
    live_photographer_ids = set()
    if photographer_ids:
        try:
            live_result = await db.execute(
                select(LiveSession.photographer_id).where(
                    LiveSession.photographer_id.in_(photographer_ids),
                    LiveSession.status == 'active'
                )
            )
            live_photographer_ids = set(row[0] for row in live_result.fetchall())
        except Exception as e:
            cr_logger.warning(f"Failed to check live session status: {e}")
    
    for report in reports:
        # Auto-heal broken media URLs from linked galleries
        if await _auto_heal_report_media(report, db):
            any_healed = True
        
        photographer = report.photographer
        response_reports.append(ConditionReportResponse(
            id=report.id,
            photographer_id=report.photographer_id,
            photographer_name=photographer.full_name if photographer else None,
            photographer_avatar=photographer.avatar_url if photographer else None,
            photographer_role=photographer.role.value if photographer else "Unknown",
            spot_id=report.spot_id,
            spot_name=report.spot_name or (report.spot.name if report.spot else None),
            region=report.region or (report.spot.region if report.spot else None),
            media_url=report.media_url,
            media_type=report.media_type,
            thumbnail_url=report.thumbnail_url,
            caption=report.caption,
            wave_height_ft=report.wave_height_ft,
            conditions_label=report.conditions_label,
            wind_conditions=report.wind_conditions,
            crowd_level=report.crowd_level,
            view_count=report.view_count,
            is_active=report.is_active,
            is_photographer_live=report.photographer_id in live_photographer_ids,
            created_at=report.created_at,
            expires_at=report.expires_at,
            time_ago=get_time_ago(report.created_at)
        ))
    
    # Persist any healed URLs back to the database
    if any_healed:
        try:
            await db.commit()
        except Exception as e:
            cr_logger.warning(f"Failed to persist auto-healed URLs: {e}")
    
    return {
        "reports": response_reports,
        "total": len(response_reports),
        "spot_id": spot_id
    }


@router.get("/condition-reports/{report_id}")
async def get_condition_report(
    report_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get a single condition report by ID"""
    result = await db.execute(
        select(ConditionReport)
        .where(ConditionReport.id == report_id)
        .options(
            selectinload(ConditionReport.photographer),
            selectinload(ConditionReport.spot)
        )
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")
    
    # Increment view count
    if viewer_id and viewer_id != report.photographer_id:
        report.view_count += 1
        await db.commit()
    
    photographer = report.photographer
    
    return ConditionReportResponse(
        id=report.id,
        photographer_id=report.photographer_id,
        photographer_name=photographer.full_name if photographer else None,
        photographer_avatar=photographer.avatar_url if photographer else None,
        photographer_role=photographer.role.value if photographer else "Unknown",
        spot_id=report.spot_id,
        spot_name=report.spot_name or (report.spot.name if report.spot else None),
        region=report.region or (report.spot.region if report.spot else None),
        media_url=report.media_url,
        media_type=report.media_type,
        thumbnail_url=report.thumbnail_url,
        caption=report.caption,
        wave_height_ft=report.wave_height_ft,
        conditions_label=report.conditions_label,
        wind_conditions=report.wind_conditions,
        crowd_level=report.crowd_level,
        view_count=report.view_count,
        is_active=report.is_active,
        created_at=report.created_at,
        expires_at=report.expires_at,
        time_ago=get_time_ago(report.created_at)
    )


@router.patch("/condition-reports/{report_id}/deactivate")
async def deactivate_condition_report(
    report_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Deactivate a condition report when photographer ends session"""
    result = await db.execute(
        select(ConditionReport).where(ConditionReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")
    
    if report.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    report.is_active = False
    await db.commit()
    
    return {"success": True, "message": "Condition report deactivated"}


@router.delete("/condition-reports/{report_id}")
async def delete_condition_report(
    report_id: str,
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a condition report"""
    result = await db.execute(
        select(ConditionReport).where(ConditionReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")
    
    if report.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    await db.delete(report)
    await db.commit()
    
    return {"success": True, "message": "Condition report deleted"}


class UpdateConditionReportMedia(BaseModel):
    media_url: Optional[str] = None
    thumbnail_url: Optional[str] = None


@router.patch("/condition-reports/{report_id}/update-media")
async def update_condition_report_media(
    report_id: str,
    photographer_id: str,
    data: UpdateConditionReportMedia,
    db: AsyncSession = Depends(get_db)
):
    """
    Update the media/thumbnail URLs on a condition report.
    Used when gallery thumbnails are swapped and need to propagate
    to the linked condition report.
    """
    result = await db.execute(
        select(ConditionReport).where(ConditionReport.id == report_id)
    )
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")
    
    if report.photographer_id != photographer_id:
        raise HTTPException(status_code=403, detail="Not authorized")
    
    updated = {}
    if data.media_url:
        old_val = report.media_url
        report.media_url = data.media_url
        updated["media_url"] = {"old": old_val, "new": data.media_url}
    
    if data.thumbnail_url:
        old_val = report.thumbnail_url
        report.thumbnail_url = data.thumbnail_url
        updated["thumbnail_url"] = {"old": old_val, "new": data.thumbnail_url}
    
    if not updated:
        return {"message": "No changes provided", "report_id": report_id}
    
    await db.commit()
    
    cr_logger.info(f"Condition report {report_id} media updated: {updated}")
    
    return {
        "success": True,
        "report_id": report_id,
        "updated": updated,
        "message": "Condition report media updated successfully"
    }


