"""
Condition Reports API - Professional condition reports from photographers
Feeds into the Conditions Explorer tab in the Explore page
"""
from fastapi import APIRouter, Depends, HTTPException, Query, BackgroundTasks
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, desc
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timedelta, timezone

from database import get_db
from models import Profile, SurfSpot, ConditionReport, Story, Post, LiveSession, RoleEnum, Gallery, GalleryItem
from websocket_manager import broadcast_new_condition_report

import logging
cr_logger = logging.getLogger(__name__)

router = APIRouter()

# Report duration - 24 hours (like stories)
REPORT_DURATION_HOURS = 24


def _is_broken_url(url: Optional[str]) -> bool:
    """Check if a URL is a broken local/ephemeral path that won't resolve in production."""
    if not url or not url.strip():
        return True
    return url.startswith('/api/uploads/') or url.startswith('/uploads/')


async def _auto_heal_report_media(report: ConditionReport, db) -> bool:
    """
    Auto-heal broken media URLs on condition reports by resolving from linked galleries.
    
    When a condition report's media_url or thumbnail_url is a stale local path
    (e.g. /api/uploads/...), attempt to resolve a valid Supabase URL from:
    1. The linked gallery's cover_image_url (via live_session_id)
    2. The latest gallery item preview for that photographer+spot
    
    Returns True if any URLs were healed.
    Wrapped in try/except — MUST NEVER crash the parent endpoint.
    """
    try:
        media_broken = _is_broken_url(report.media_url)
        thumb_broken = _is_broken_url(report.thumbnail_url)
        
        # If both URLs are valid (start with https://), nothing to heal
        if not media_broken and not thumb_broken:
            return False
        
        healed = False
        valid_url = None
        
        # Strategy 1: Find gallery linked by live_session_id
        if report.live_session_id:
            gallery_result = await db.execute(
                select(Gallery).where(
                    Gallery.live_session_id == report.live_session_id,
                    Gallery.photographer_id == report.photographer_id
                ).limit(1)
            )
            gallery = gallery_result.scalar_one_or_none()
            if gallery and gallery.cover_image_url and gallery.cover_image_url.startswith('https://'):
                valid_url = gallery.cover_image_url
        
        # Strategy 2: Find any gallery by photographer+spot with a valid cover
        if not valid_url and report.spot_id:
            gallery_result = await db.execute(
                select(Gallery).where(
                    Gallery.photographer_id == report.photographer_id,
                    Gallery.surf_spot_id == report.spot_id
                ).order_by(Gallery.created_at.desc()).limit(1)
            )
            gallery = gallery_result.scalar_one_or_none()
            if gallery and gallery.cover_image_url and gallery.cover_image_url.startswith('https://'):
                valid_url = gallery.cover_image_url
        
        # Strategy 3: Find latest gallery item with valid preview URL for this photographer
        if not valid_url:
            item_result = await db.execute(
                select(GalleryItem).where(
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.preview_url or item.thumbnail_url
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
        
        # Apply the healed URL
        if valid_url:
            if media_broken:
                report.media_url = valid_url
                healed = True
            if thumb_broken:
                report.thumbnail_url = valid_url
                healed = True
            
            if healed:
                cr_logger.info(
                    f"Auto-healed condition report {report.id}: "
                    f"resolved broken URLs to {valid_url[:60]}..."
                )
        
        return healed
    except Exception as e:
        cr_logger.warning(f"Auto-heal failed for report {report.id}: {e}")
        return False

# Available regions for filtering
SURF_REGIONS = [
    "North Shore",
    "South Shore",
    "East Coast",
    "West Coast",
    "Gold Coast",
    "SoCal",
    "NorCal",
    "Baja",
    "Central America",
    "Hawaii",
    "Caribbean",
    "Europe",
    "Indonesia",
    "Australia",
    "Japan",
    "Other"
]


class ConditionReportCreate(BaseModel):
    media_url: str
    media_type: str = 'image'
    thumbnail_url: Optional[str] = None
    caption: Optional[str] = None
    spot_id: Optional[str] = None
    spot_name: Optional[str] = None
    region: Optional[str] = None
    wave_height_ft: Optional[float] = None
    conditions_label: Optional[str] = None
    wind_conditions: Optional[str] = None
    crowd_level: Optional[str] = None
    latitude: Optional[float] = None
    longitude: Optional[float] = None


class ConditionReportResponse(BaseModel):
    id: str
    photographer_id: str
    photographer_name: Optional[str]
    photographer_avatar: Optional[str]
    photographer_role: str
    spot_id: Optional[str]
    spot_name: Optional[str]
    region: Optional[str]
    media_url: str
    media_type: str
    thumbnail_url: Optional[str]
    caption: Optional[str]
    wave_height_ft: Optional[float]
    conditions_label: Optional[str]
    wind_conditions: Optional[str]
    crowd_level: Optional[str]
    view_count: int
    is_active: bool
    is_photographer_live: bool = False  # True ONLY when photographer has an active live session right now
    created_at: datetime
    expires_at: datetime
    time_ago: str


def get_time_ago(created_at: datetime) -> str:
    """Convert datetime to human-readable time ago string"""
    now = datetime.now(timezone.utc)
    diff = now - created_at
    
    if diff.total_seconds() < 60:
        return "Just now"
    elif diff.total_seconds() < 3600:
        minutes = int(diff.total_seconds() / 60)
        return f"{minutes}m ago"
    elif diff.total_seconds() < 86400:
        hours = int(diff.total_seconds() / 3600)
        return f"{hours}h ago"
    else:
        days = int(diff.total_seconds() / 86400)
        return f"{days}d ago"


@router.get("/condition-reports/regions")
async def get_regions():
    """Get list of available surf regions for filtering"""
    return {"regions": SURF_REGIONS}


@router.get("/condition-reports/feed")
async def get_condition_reports_feed(
    region: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get condition reports feed for the Conditions Explorer tab.
    Only returns active, non-expired reports from photographers who are/were actively shooting.
    Supports nearby sorting when user_lat/user_lng provided.
    """
    from sqlalchemy import func
    
    # Base query - only active, non-expired reports
    now = datetime.now(timezone.utc)
    query = select(ConditionReport).where(
        and_(
            ConditionReport.is_expired.is_(False),
            ConditionReport.expires_at > now
        )
    ).options(
        selectinload(ConditionReport.photographer),
        selectinload(ConditionReport.spot)
    )
    
    # Filter by region if specified
    if region and region != "All":
        query = query.where(ConditionReport.region == region)
    
    # Order by distance if user location provided, otherwise by most recent
    if user_lat is not None and user_lng is not None:
        # Sort by distance using latitude/longitude from the spot
        query = query.join(ConditionReport.spot, isouter=True)
        query = query.order_by(
            func.coalesce(
                func.abs(SurfSpot.latitude - user_lat) + func.abs(SurfSpot.longitude - user_lng),
                9999  # Push reports without spots to the end
            ),
            desc(ConditionReport.created_at)
        )
    else:
        # Order by most recent
        query = query.order_by(desc(ConditionReport.created_at))
    
    # Pagination
    query = query.offset(offset).limit(limit)
    
    result = await db.execute(query)
    reports = result.scalars().all()
    
    # Format response
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
    
    # Get total count for pagination
    count_query = select(ConditionReport).where(
        and_(
            ConditionReport.is_expired.is_(False),
            ConditionReport.expires_at > now
        )
    )
    if region and region != "All":
        count_query = count_query.where(ConditionReport.region == region)
    
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())
    
    return {
        "reports": response_reports,
        "total": total,
        "has_more": offset + limit < total
    }


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
    query = select(ConditionReport).where(
        ConditionReport.spot_id == spot_id
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


@router.delete("/condition-reports/cleanup/orphaned")
async def cleanup_orphaned_condition_reports(
    photographer_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Clean up orphaned condition reports for a photographer.
    Deletes reports whose linked gallery (via live_session_id) no longer exists.
    """
    # Verify photographer exists
    prof = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = prof.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get all condition reports for this photographer
    reports_result = await db.execute(
        select(ConditionReport).where(
            ConditionReport.photographer_id == photographer_id
        )
    )
    reports = reports_result.scalars().all()
    
    deleted = 0
    for report in reports:
        is_orphaned = False
        
        # Check if the linked live session's gallery still exists
        if report.live_session_id:
            gallery_check = await db.execute(
                select(Gallery.id).where(Gallery.live_session_id == report.live_session_id)
            )
            if not gallery_check.scalar_one_or_none():
                is_orphaned = True
        
        if is_orphaned:
            await db.delete(report)
            deleted += 1
    
    if deleted > 0:
        await db.commit()
    
    cr_logger.info(f"Cleaned up {deleted} orphaned condition reports for photographer {photographer_id}")
    
    return {
        "message": f"Cleaned up {deleted} orphaned condition reports",
        "deleted_count": deleted
    }


# ── Admin Moderation ─────────────────────────────────────────────────
# Allows admins to remove any condition report (questionable content,
# stale orphans, etc.) bypassing photographer ownership checks.
# Secured via JWT admin auth — same pattern as admin_content_mod.py.

from deps.admin_auth import get_current_admin


@router.delete("/admin/condition-reports/{report_id}")
async def admin_remove_condition_report(
    report_id: str,
    reason: Optional[str] = Query(None, description="Reason for removal"),
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """
    Admin-only: Remove any condition report.
    Use this to take down questionable, inappropriate, or stale content.
    """
    result = await db.execute(
        select(ConditionReport).where(ConditionReport.id == report_id)
    )
    report = result.scalar_one_or_none()

    if not report:
        raise HTTPException(status_code=404, detail="Condition report not found")

    photographer_id = report.photographer_id
    spot_id = report.spot_id

    await db.delete(report)
    await db.commit()

    cr_logger.info(
        f"ADMIN ACTION: Condition report {report_id} deleted by admin {admin.id} "
        f"(photographer={photographer_id}, spot={spot_id}, reason={reason or 'none'})"
    )

    return {
        "success": True,
        "message": "Condition report removed by admin",
        "report_id": report_id,
        "admin_id": admin.id,
        "reason": reason
    }


@router.get("/admin/condition-reports")
async def admin_list_condition_reports(
    admin: Profile = Depends(get_current_admin),
    spot_id: Optional[str] = None,
    photographer_id: Optional[str] = None,
    active_only: bool = True,
    limit: int = 50,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Admin-only: List all condition reports with optional filters.
    Useful for reviewing content across the platform.
    """
    query = select(ConditionReport).order_by(desc(ConditionReport.created_at))

    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    if photographer_id:
        query = query.where(ConditionReport.photographer_id == photographer_id)
    if active_only:
        query = query.where(ConditionReport.is_active == True)

    result = await db.execute(query.limit(limit).offset(offset))
    reports = result.scalars().all()

    return {
        "reports": [{
            "id": r.id,
            "photographer_id": r.photographer_id,
            "spot_id": r.spot_id,
            "media_url": r.media_url,
            "media_type": r.media_type,
            "caption": r.caption,
            "is_active": r.is_active,
            "created_at": r.created_at.isoformat() if r.created_at else None,
            "expires_at": r.expires_at.isoformat() if r.expires_at else None,
        } for r in reports],
        "total": len(reports)
    }
