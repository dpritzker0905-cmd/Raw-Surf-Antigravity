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


def _is_watermarked_url(url: Optional[str]) -> bool:
    """Check if a URL points to a watermarked preview image.
    Watermarked previews typically contain '_preview' in the filename.
    Condition reports are free public content and must never show watermarks."""
    if not url:
        return False
    return '_preview' in url.lower()


async def _auto_heal_report_media(report: ConditionReport, db) -> bool:
    """
    Auto-heal broken or watermarked media URLs on condition reports.
    
    Condition reports are FREE public content — they must NEVER show watermarks.
    This function fixes two classes of bad URLs:
    1. Broken local paths (e.g. /api/uploads/...)
    2. Watermarked preview URLs (containing '_preview' in the filename)
    
    Resolution strategy:
    1. Find the matching gallery item by media URL similarity
    2. Find gallery items linked via live_session_id
    3. Find latest gallery item for this photographer+spot
    4. Fall back to any recent gallery item from this photographer
    
    Returns True if any URLs were healed.
    Wrapped in try/except — MUST NEVER crash the parent endpoint.
    """
    try:
        media_broken = _is_broken_url(report.media_url)
        thumb_broken = _is_broken_url(report.thumbnail_url)
        media_watermarked = _is_watermarked_url(report.media_url)
        thumb_watermarked = _is_watermarked_url(report.thumbnail_url)
        
        needs_heal = media_broken or thumb_broken or media_watermarked or thumb_watermarked
        
        # If both URLs are valid and unwatermarked, nothing to do
        if not needs_heal:
            return False
        
        healed = False
        valid_url = None
        
        # Strategy 1: Match gallery item by URL pattern
        # If the media_url is a watermarked _preview, try to find the same
        # gallery item and use its original_url instead
        if media_watermarked and report.media_url:
            # Strip '_preview' suffix to find the base filename pattern
            base_pattern = report.media_url.replace('_preview', '').rsplit('.', 1)[0]
            if base_pattern:
                item_result = await db.execute(
                    select(GalleryItem).where(
                        GalleryItem.photographer_id == report.photographer_id,
                        GalleryItem.is_deleted == False,
                        GalleryItem.original_url.ilike(f"%{base_pattern.split('/')[-1]}%")
                    ).limit(1)
                )
                item = item_result.scalar_one_or_none()
                if item:
                    candidate = item.original_url or item.url_standard or item.url_web
                    if candidate and candidate.startswith('https://'):
                        valid_url = candidate
        
        # Strategy 2: Find gallery linked by live_session_id
        if not valid_url and report.live_session_id:
            # Try to find gallery items from the linked session
            item_result = await db.execute(
                select(GalleryItem).join(Gallery).where(
                    Gallery.live_session_id == report.live_session_id,
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
            
            # Fall back to gallery cover
            if not valid_url:
                gallery_result = await db.execute(
                    select(Gallery).where(
                        Gallery.live_session_id == report.live_session_id,
                        Gallery.photographer_id == report.photographer_id
                    ).limit(1)
                )
                gallery = gallery_result.scalar_one_or_none()
                if gallery and gallery.cover_image_url and gallery.cover_image_url.startswith('https://'):
                    # Only use cover if it's not watermarked
                    if not _is_watermarked_url(gallery.cover_image_url):
                        valid_url = gallery.cover_image_url
        
        # Strategy 3: Find gallery items by photographer+spot
        if not valid_url and report.spot_id:
            item_result = await db.execute(
                select(GalleryItem).join(Gallery).where(
                    Gallery.surf_spot_id == report.spot_id,
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
        
        # Strategy 4: Find any recent gallery item from this photographer
        if not valid_url:
            item_result = await db.execute(
                select(GalleryItem).where(
                    GalleryItem.photographer_id == report.photographer_id,
                    GalleryItem.is_deleted == False
                ).order_by(GalleryItem.created_at.desc()).limit(1)
            )
            item = item_result.scalar_one_or_none()
            if item:
                candidate = item.original_url or item.url_standard or item.url_web
                if candidate and candidate.startswith('https://'):
                    valid_url = candidate
        
        # Apply the healed URL
        if valid_url:
            if media_broken or media_watermarked:
                report.media_url = valid_url
                healed = True
            if thumb_broken or thumb_watermarked:
                report.thumbnail_url = valid_url
                healed = True
            
            if healed:
                cr_logger.info(
                    f"Auto-healed condition report {report.id}: "
                    f"resolved {'watermarked' if (media_watermarked or thumb_watermarked) else 'broken'} "
                    f"URLs to {valid_url[:60]}..."
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
    country: Optional[str] = Query(default=None, description="Filter by country (e.g. 'USA')"),
    state_province: Optional[str] = Query(default=None, description="Filter by state/province (e.g. 'Florida')"),
    city: Optional[str] = Query(default=None, description="Filter by city/area (e.g. 'Cocoa Beach')"),
    date_filter: Optional[str] = Query(default="today", description="Filter: 'today', 'yesterday', or 'archive'"),
    archive_date: Optional[str] = Query(default=None, description="ISO date for archive mode, e.g. '2026-04-15'"),
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    spot_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get condition reports feed for the Conditions Explorer tab.
    Supports date_filter for browsing today, yesterday, and archived reports.
    
    Params:
      - date_filter: 'today' (default), 'yesterday', or 'archive'
      - archive_date: ISO date string for archive mode (e.g. '2026-04-15')
      - spot_id: Optional filter to a specific surf spot
      - country, state_province, city: Hierarchical location filters via SurfSpot
    """
    from sqlalchemy import func
    
    now = datetime.now(timezone.utc)
    
    # Determine if we need a spot join for location filtering
    needs_spot_join = bool(country or state_province or city)
    
    # Build date range based on date_filter
    if date_filter == 'yesterday':
        # Yesterday: midnight-to-midnight in UTC
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        yesterday_start = today_start - timedelta(days=1)
        date_start = yesterday_start
        date_end = today_start
    elif date_filter == 'archive' and archive_date:
        # Specific archive date
        try:
            target_date = datetime.fromisoformat(archive_date).replace(tzinfo=timezone.utc)
        except (ValueError, TypeError):
            target_date = now.replace(hour=0, minute=0, second=0, microsecond=0) - timedelta(days=2)
        date_start = target_date.replace(hour=0, minute=0, second=0, microsecond=0)
        date_end = date_start + timedelta(days=1)
    else:
        # Default: today — only active, non-expired reports
        date_start = None
        date_end = None
    
    # Base query
    if date_start and date_end:
        # Historical mode: show ALL reports from the date range (ignore expiry)
        query = select(ConditionReport).where(
            and_(
                ConditionReport.created_at >= date_start,
                ConditionReport.created_at < date_end
            )
        ).options(
            selectinload(ConditionReport.photographer),
            selectinload(ConditionReport.spot)
        )
    else:
        # Today mode: only active, non-expired reports
        query = select(ConditionReport).where(
            and_(
                ConditionReport.is_expired.is_(False),
                ConditionReport.is_active.is_(True),
                ConditionReport.expires_at > now
            )
        ).options(
            selectinload(ConditionReport.photographer),
            selectinload(ConditionReport.spot)
        )
    
    # Filter by region if specified
    if region and region != "All":
        query = query.where(ConditionReport.region == region)
    
    # Filter by spot if specified
    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    
    # Hierarchical location filtering via SurfSpot join
    if needs_spot_join:
        query = query.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    # Order by distance if user location provided, otherwise by most recent
    if user_lat is not None and user_lng is not None:
        if not needs_spot_join:
            query = query.join(ConditionReport.spot, isouter=True)
        query = query.order_by(
            func.coalesce(
                func.abs(SurfSpot.latitude - user_lat) + func.abs(SurfSpot.longitude - user_lng),
                9999
            ),
            desc(ConditionReport.created_at)
        )
    else:
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
        
        # Check if this report has a linked gallery (via live_session_id)
        gallery_id = None
        gallery_item_count = 0
        if report.live_session_id:
            try:
                gallery_result = await db.execute(
                    select(Gallery.id, Gallery.item_count).where(
                        Gallery.live_session_id == report.live_session_id,
                        Gallery.is_public.is_(True)
                    ).limit(1)
                )
                gallery_row = gallery_result.first()
                if gallery_row:
                    gallery_id = gallery_row[0]
                    gallery_item_count = gallery_row[1] or 0
            except Exception:
                pass
        
        report_data = ConditionReportResponse(
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
        )
        
        # Extend with gallery link data (not in Pydantic model, added as dict)
        report_dict = report_data.dict()
        report_dict["gallery_id"] = gallery_id
        report_dict["gallery_item_count"] = gallery_item_count
        response_reports.append(report_dict)
    
    # Persist any healed URLs back to the database
    if any_healed:
        try:
            await db.commit()
        except Exception as e:
            cr_logger.warning(f"Failed to persist auto-healed URLs: {e}")
    
    # Get total count for pagination
    if date_start and date_end:
        count_query = select(ConditionReport).where(
            and_(
                ConditionReport.created_at >= date_start,
                ConditionReport.created_at < date_end
            )
        )
    else:
        count_query = select(ConditionReport).where(
            and_(
                ConditionReport.is_expired.is_(False),
                ConditionReport.is_active.is_(True),
                ConditionReport.expires_at > now
            )
        )
    if region and region != "All":
        count_query = count_query.where(ConditionReport.region == region)
    if spot_id:
        count_query = count_query.where(ConditionReport.spot_id == spot_id)
    if needs_spot_join:
        count_query = count_query.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            count_query = count_query.where(SurfSpot.country == country)
        if state_province:
            count_query = count_query.where(SurfSpot.state_province == state_province)
        if city:
            count_query = count_query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    count_result = await db.execute(count_query)
    total = len(count_result.scalars().all())
    
    return {
        "reports": response_reports,
        "total": total,
        "has_more": offset + limit < total,
        "date_filter": date_filter
    }


@router.get("/condition-reports/archive-dates")
async def get_archive_dates(
    spot_id: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    city: Optional[str] = None,
    limit: int = Query(default=30, le=90),
    db: AsyncSession = Depends(get_db)
):
    """
    Get dates that have condition reports for the archive browser.
    Returns the most recent N dates with activity, enabling the date picker
    to show which days have content.
    Supports hierarchical location filtering via SurfSpot join.
    """
    from sqlalchemy import func, cast, Date
    
    # Query distinct dates with report counts
    query = select(
        cast(ConditionReport.created_at, Date).label('report_date'),
        func.count(ConditionReport.id).label('report_count')
    ).group_by(
        cast(ConditionReport.created_at, Date)
    ).order_by(
        desc(cast(ConditionReport.created_at, Date))
    )
    
    if spot_id:
        query = query.where(ConditionReport.spot_id == spot_id)
    
    # Hierarchical location filtering
    if country or state_province or city:
        query = query.join(SurfSpot, ConditionReport.spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    # Exclude today (today is shown in the "Today" tab)
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    query = query.where(ConditionReport.created_at < today_start)
    
    query = query.limit(limit)
    
    result = await db.execute(query)
    rows = result.fetchall()
    
    # Also get gallery counts per date
    gallery_query = select(
        cast(Gallery.session_date, Date).label('gallery_date'),
        func.count(Gallery.id).label('gallery_count')
    ).where(
        Gallery.is_public.is_(True),
        Gallery.session_date.isnot(None),
        Gallery.session_date < today_start
    ).group_by(
        cast(Gallery.session_date, Date)
    ).order_by(
        desc(cast(Gallery.session_date, Date))
    ).limit(limit)
    
    if spot_id:
        gallery_query = gallery_query.where(Gallery.surf_spot_id == spot_id)
    
    gallery_result = await db.execute(gallery_query)
    gallery_rows = gallery_result.fetchall()
    gallery_map = {str(row.gallery_date): row.gallery_count for row in gallery_rows}
    
    dates = []
    for row in rows:
        date_str = str(row.report_date)
        dates.append({
            "date": date_str,
            "report_count": row.report_count,
            "gallery_count": gallery_map.get(date_str, 0)
        })
    
    return {"dates": dates}


@router.get("/condition-reports/public-galleries")
async def get_public_gallery_archive(
    spot_id: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    city: Optional[str] = None,
    date: Optional[str] = None,
    date_from: Optional[str] = None,
    date_to: Optional[str] = None,
    photographer_id: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """
    Get public session galleries for archive browsing.
    Returns galleries linked to public LiveSessions, enriched with conditions data.
    
    Params:
      - spot_id: Filter by surf spot
      - country, state_province, city: Hierarchical location filters via SurfSpot
      - date: Specific ISO date (e.g. '2026-04-15')
      - date_from / date_to: Date range
      - photographer_id: Filter by photographer
    """
    from sqlalchemy import func
    
    query = select(Gallery).where(
        Gallery.is_public.is_(True),
        Gallery.item_count > 0
    ).options(
        selectinload(Gallery.photographer),
        selectinload(Gallery.surf_spot),
        selectinload(Gallery.live_session)
    )
    
    if spot_id:
        query = query.where(Gallery.surf_spot_id == spot_id)
    
    # Hierarchical location filtering via SurfSpot join
    if country or state_province or city:
        query = query.join(SurfSpot, Gallery.surf_spot_id == SurfSpot.id)
        if country:
            query = query.where(SurfSpot.country == country)
        if state_province:
            query = query.where(SurfSpot.state_province == state_province)
        if city:
            query = query.where(
                or_(SurfSpot.secondary_city == city, SurfSpot.secondary_area == city)
            )
    
    if photographer_id:
        query = query.where(Gallery.photographer_id == photographer_id)
    
    # Date filtering
    if date:
        try:
            target = datetime.fromisoformat(date).replace(tzinfo=timezone.utc)
            day_start = target.replace(hour=0, minute=0, second=0, microsecond=0)
            day_end = day_start + timedelta(days=1)
            query = query.where(
                and_(
                    Gallery.session_date >= day_start,
                    Gallery.session_date < day_end
                )
            )
        except (ValueError, TypeError):
            pass
    elif date_from or date_to:
        if date_from:
            try:
                start = datetime.fromisoformat(date_from).replace(tzinfo=timezone.utc, hour=0, minute=0, second=0, microsecond=0)
                query = query.where(Gallery.session_date >= start)
            except (ValueError, TypeError):
                pass
        if date_to:
            try:
                end = datetime.fromisoformat(date_to).replace(tzinfo=timezone.utc, hour=23, minute=59, second=59)
                query = query.where(Gallery.session_date <= end)
            except (ValueError, TypeError):
                pass
    
    query = query.order_by(desc(Gallery.session_date)).offset(offset).limit(limit)
    
    result = await db.execute(query)
    galleries = result.scalars().all()
    
    # Fetch linked condition reports for conditions context
    gallery_session_ids = [g.live_session_id for g in galleries if g.live_session_id]
    conditions_map = {}
    if gallery_session_ids:
        cr_result = await db.execute(
            select(ConditionReport).where(
                ConditionReport.live_session_id.in_(gallery_session_ids)
            )
        )
        for cr in cr_result.scalars().all():
            conditions_map[cr.live_session_id] = cr
    
    response = []
    for gallery in galleries:
        photographer = gallery.photographer
        spot = gallery.surf_spot
        session = gallery.live_session
        cr = conditions_map.get(gallery.live_session_id)
        
        response.append({
            "id": gallery.id,
            "title": gallery.title,
            "cover_image_url": gallery.cover_image_url,
            "item_count": gallery.item_count or 0,
            "view_count": gallery.view_count or 0,
            "session_date": gallery.session_date.isoformat() if gallery.session_date else None,
            "created_at": gallery.created_at.isoformat() if gallery.created_at else None,
            "session_type": gallery.session_type,
            "is_for_sale": gallery.is_for_sale,
            # Photographer info
            "photographer_id": gallery.photographer_id,
            "photographer_name": photographer.full_name if photographer else None,
            "photographer_avatar": photographer.avatar_url if photographer else None,
            # Spot info
            "spot_id": gallery.surf_spot_id,
            "spot_name": spot.name if spot else None,
            "spot_region": spot.region if spot else None,
            # Conditions context (from linked condition report)
            "conditions": {
                "wave_height_ft": cr.wave_height_ft if cr else None,
                "conditions_label": cr.conditions_label if cr else None,
                "wind_conditions": cr.wind_conditions if cr else None,
                "crowd_level": cr.crowd_level if cr else None,
                "media_url": cr.media_url if cr else None,
            } if cr else None,
            # Session info
            "live_session_id": gallery.live_session_id,
            "session_duration_mins": session.duration_mins if session else None,
            "participant_count": session.participant_count if session else 0,
        })
    
    return {
        "galleries": response,
        "total": len(response),
        "has_more": len(response) == limit
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
