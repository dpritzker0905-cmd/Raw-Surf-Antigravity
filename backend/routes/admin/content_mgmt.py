"""
Admin Content Management & Tools
- Featured spots/photographers curation
- Homepage banner management
- SEO metadata editor
- Global search
- API key management
- Automated reports
"""
from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_, update, desc
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime, timezone, timedelta
import hashlib
import secrets

from database import get_db
from deps.admin_auth import get_current_admin
from models import (
    Profile, SurfSpot, Booking, GalleryItem,
    FeaturedContent, HomepageBanner, SpotSEOMetadata,
    AutomatedReport, APIKey, ChangelogEntry, RoleEnum
)
from routes.admin_moderation import log_audit

router = APIRouter()


# --- Pydantic Models ---
class CreateFeaturedContentRequest(BaseModel):
    content_type: str  # 'photographer', 'spot', 'gallery_item'
    content_id: str
    title: Optional[str] = None
    subtitle: Optional[str] = None
    placement: Optional[str] = "homepage"
    position: Optional[int] = 0

class CreateBannerRequest(BaseModel):
    title: str
    subtitle: Optional[str] = None
    image_url: Optional[str] = None
    cta_text: Optional[str] = None
    cta_url: Optional[str] = None
    target_roles: Optional[List[str]] = []
    start_at: Optional[str] = None
    end_at: Optional[str] = None

class UpdateSEORequest(BaseModel):
    meta_title: Optional[str] = None
    meta_description: Optional[str] = None
    og_title: Optional[str] = None
    og_description: Optional[str] = None
    og_image_url: Optional[str] = None
    keywords: Optional[List[str]] = []

class CreateAPIKeyRequest(BaseModel):
    name: str
    permissions: Optional[List[str]] = []
    rate_limit: Optional[int] = 1000
    expires_in_days: Optional[int] = None

class CreateReportRequest(BaseModel):
    name: str
    report_type: str
    schedule: str  # 'daily', 'weekly', 'monthly'
    recipient_emails: List[str]
    config: Optional[dict] = {}

class CreateChangelogRequest(BaseModel):
    version: str
    title: str
    summary: Optional[str] = None
    changes: Optional[List[dict]] = []  # [{type: 'feature', description: '...'}]
    is_major: Optional[bool] = False


# --- GLOBAL SEARCH ---
@router.get("/admin/search")
async def global_search(
    query: str,
    admin: Profile = Depends(get_current_admin),
    types: Optional[str] = None,  # comma-separated: 'users,bookings,spots'
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    """Global search across users, bookings, spots"""
    
    if len(query) < 2:
        raise HTTPException(status_code=400, detail="Query must be at least 2 characters")
    
    search_types = types.split(',') if types else ['users', 'bookings', 'spots']
    results = {}
    
    # Search users
    if 'users' in search_types:
        users = await db.execute(
            select(Profile.id, Profile.full_name, Profile.email, Profile.role)
            .where(or_(
                Profile.full_name.ilike(f"%{query}%"),
                Profile.email.ilike(f"%{query}%")
            ))
            .limit(limit)
        )
        results['users'] = [{
            "id": u[0],
            "name": u[1],
            "email": u[2],
            "role": u[3].value if u[3] else None,
            "type": "user"
        } for u in users.fetchall()]
    
    # Search bookings
    if 'bookings' in search_types:
        bookings = await db.execute(
            select(Booking.id, Booking.status, Booking.created_at)
            .where(Booking.id.ilike(f"%{query}%"))
            .limit(limit)
        )
        results['bookings'] = [{
            "id": b[0],
            "booking_id": b[0],
            "status": b[1],
            "created_at": b[2].isoformat() if b[2] else None,
            "type": "booking"
        } for b in bookings.fetchall()]
    
    # Search spots
    if 'spots' in search_types:
        spots = await db.execute(
            select(SurfSpot.id, SurfSpot.name, SurfSpot.region, SurfSpot.country)
            .where(or_(
                SurfSpot.name.ilike(f"%{query}%"),
                SurfSpot.region.ilike(f"%{query}%")
            ))
            .limit(limit)
        )
        results['spots'] = [{
            "id": s[0],
            "name": s[1],
            "region": s[2],
            "country": s[3],
            "type": "spot"
        } for s in spots.fetchall()]
    
    # Flatten for combined results
    all_results = []
    for type_name, items in results.items():
        all_results.extend(items)
    
    return {
        "query": query,
        "results": results,
        "combined": all_results[:limit],
        "total": len(all_results)
    }


# --- FEATURED CONTENT ---
@router.get("/admin/content/featured")
async def get_featured_content(
    admin: Profile = Depends(get_current_admin),
    placement: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get featured content"""
    
    query = select(FeaturedContent).where(FeaturedContent.is_active == True).order_by(FeaturedContent.position)
    if placement:
        query = query.where(FeaturedContent.placement == placement)
    
    result = await db.execute(query)
    featured = result.scalars().all()
    
    return {
        "featured": [{
            "id": f.id,
            "content_type": f.content_type,
            "content_id": f.content_id,
            "title": f.title,
            "subtitle": f.subtitle,
            "image_url": f.image_url,
            "placement": f.placement,
            "position": f.position,
            "is_active": f.is_active,
            "start_at": f.start_at.isoformat() if f.start_at else None,
            "end_at": f.end_at.isoformat() if f.end_at else None,
            "created_at": f.created_at.isoformat() if f.created_at else None
        } for f in featured]
    }


@router.post("/admin/content/featured")
async def create_featured_content(
    request: CreateFeaturedContentRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create featured content"""
    
    # Get content details for title/image
    title = request.title
    image_url = None
    
    if request.content_type == "photographer":
        user = await db.execute(select(Profile.full_name, Profile.avatar_url).where(Profile.id == request.content_id))
        user_info = user.fetchone()
        if user_info:
            title = title or user_info[0]
            image_url = user_info[1]
    elif request.content_type == "spot":
        spot = await db.execute(select(SurfSpot.name).where(SurfSpot.id == request.content_id))
        spot_info = spot.fetchone()
        if spot_info:
            title = title or spot_info[0]
    elif request.content_type == "gallery_item":
        item = await db.execute(select(GalleryItem.url, GalleryItem.thumbnail_url).where(GalleryItem.id == request.content_id))
        item_info = item.fetchone()
        if item_info:
            image_url = item_info[1] or item_info[0]
    
    featured = FeaturedContent(
        content_type=request.content_type,
        content_id=request.content_id,
        title=title,
        subtitle=request.subtitle,
        image_url=image_url,
        placement=request.placement or "homepage",
        position=request.position or 0,
        created_by=admin.id
    )
    
    db.add(featured)
    await log_audit(db, admin.id, "content", f"Featured {request.content_type}: {title}")
    await db.commit()
    
    return {"success": True, "featured_id": featured.id}


@router.delete("/admin/content/featured/{featured_id}")
async def remove_featured_content(
    featured_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Remove featured content"""
    
    await db.execute(
        update(FeaturedContent)
        .where(FeaturedContent.id == featured_id)
        .values(is_active=False)
    )
    await db.commit()
    
    return {"success": True}


# --- HOMEPAGE BANNERS ---
@router.get("/admin/content/banners")
async def get_homepage_banners(
    admin: Profile = Depends(get_current_admin),
    include_inactive: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Get homepage banners"""
    
    query = select(HomepageBanner).order_by(HomepageBanner.position)
    if not include_inactive:
        query = query.where(HomepageBanner.is_active == True)
    
    result = await db.execute(query)
    banners = result.scalars().all()
    
    return {
        "banners": [{
            "id": b.id,
            "title": b.title,
            "subtitle": b.subtitle,
            "image_url": b.image_url,
            "cta_text": b.cta_text,
            "cta_url": b.cta_url,
            "target_roles": b.target_roles or [],
            "position": b.position,
            "is_active": b.is_active,
            "impressions": b.impressions,
            "clicks": b.clicks,
            "ctr": round((b.clicks / b.impressions * 100) if b.impressions > 0 else 0, 2),
            "start_at": b.start_at.isoformat() if b.start_at else None,
            "end_at": b.end_at.isoformat() if b.end_at else None,
            "created_at": b.created_at.isoformat() if b.created_at else None
        } for b in banners]
    }


@router.post("/admin/content/banners")
async def create_banner(
    request: CreateBannerRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create homepage banner"""
    
    # Get max position
    max_pos = await db.execute(select(func.max(HomepageBanner.position)))
    position = (max_pos.scalar() or 0) + 1
    
    banner = HomepageBanner(
        title=request.title,
        subtitle=request.subtitle,
        image_url=request.image_url,
        cta_text=request.cta_text,
        cta_url=request.cta_url,
        target_roles=request.target_roles or [],
        position=position,
        start_at=datetime.fromisoformat(request.start_at) if request.start_at else None,
        end_at=datetime.fromisoformat(request.end_at) if request.end_at else None,
        created_by=admin.id
    )
    
    db.add(banner)
    await log_audit(db, admin.id, "content", f"Created banner: {request.title}")
    await db.commit()
    
    return {"success": True, "banner_id": banner.id}


@router.put("/admin/content/banners/{banner_id}/toggle")
async def toggle_banner(
    banner_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Toggle banner active status"""
    
    result = await db.execute(select(HomepageBanner).where(HomepageBanner.id == banner_id))
    banner = result.scalar_one_or_none()
    
    if not banner:
        raise HTTPException(status_code=404, detail="Banner not found")
    
    await db.execute(
        update(HomepageBanner)
        .where(HomepageBanner.id == banner_id)
        .values(is_active=not banner.is_active)
    )
    await db.commit()
    
    return {"success": True, "is_active": not banner.is_active}


# --- SEO METADATA ---
@router.get("/admin/content/seo/spots")
async def get_spots_seo(
    admin: Profile = Depends(get_current_admin),
    search: Optional[str] = None,
    limit: int = 20,
    offset: int = 0,
    db: AsyncSession = Depends(get_db)
):
    """Get spots with their SEO metadata, with pagination and search"""
    
    # Base query
    query = select(SurfSpot.id, SurfSpot.name, SurfSpot.region, SurfSpot.country)
    
    # Apply search filter
    if search and len(search) >= 2:
        search_term = f"%{search}%"
        query = query.where(or_(
            SurfSpot.name.ilike(search_term),
            SurfSpot.region.ilike(search_term),
            SurfSpot.country.ilike(search_term)
        ))
    
    # Get total count
    count_query = select(func.count()).select_from(query.subquery())
    total = (await db.execute(count_query)).scalar() or 0
    
    # Apply ordering and pagination
    spots = await db.execute(
        query.order_by(SurfSpot.name)
        .limit(limit)
        .offset(offset)
    )
    
    spots_data = []
    for s in spots.fetchall():
        seo = await db.execute(select(SpotSEOMetadata).where(SpotSEOMetadata.spot_id == s[0]))
        seo_data = seo.scalar_one_or_none()
        
        spots_data.append({
            "id": s[0],
            "name": s[1],
            "region": s[2],
            "country": s[3],
            "meta_title": seo_data.meta_title if seo_data else None,
            "meta_description": seo_data.meta_description if seo_data else None,
            "slug": seo_data.og_title if seo_data else None,  # Using og_title as slug for now
            "seo_score": 80 if seo_data and seo_data.meta_title and seo_data.meta_description else (50 if seo_data else 20),
            "has_seo": seo_data is not None
        })
    
    return {
        "spots": spots_data,
        "total": total,
        "limit": limit,
        "offset": offset
    }


@router.put("/admin/content/seo/spots/{spot_id}")
async def update_spot_seo(
    spot_id: str,
    request: UpdateSEORequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Update spot SEO metadata"""
    
    # Check if SEO record exists
    existing = await db.execute(select(SpotSEOMetadata).where(SpotSEOMetadata.spot_id == spot_id))
    seo = existing.scalar_one_or_none()
    
    if seo:
        await db.execute(
            update(SpotSEOMetadata)
            .where(SpotSEOMetadata.spot_id == spot_id)
            .values(
                meta_title=request.meta_title,
                meta_description=request.meta_description,
                og_title=request.og_title,
                og_description=request.og_description,
                og_image_url=request.og_image_url,
                keywords=request.keywords or [],
                updated_by=admin.id,
                updated_at=datetime.now(timezone.utc)
            )
        )
    else:
        new_seo = SpotSEOMetadata(
            spot_id=spot_id,
            meta_title=request.meta_title,
            meta_description=request.meta_description,
            og_title=request.og_title,
            og_description=request.og_description,
            og_image_url=request.og_image_url,
            keywords=request.keywords or [],
            updated_by=admin.id
        )
        db.add(new_seo)
    
    await db.commit()
    
    return {"success": True}


# --- API KEY MANAGEMENT ---
@router.get("/admin/tools/api-keys")
async def get_api_keys(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get all API keys"""
    
    result = await db.execute(select(APIKey).where(APIKey.is_active == True).order_by(desc(APIKey.created_at)))
    keys = result.scalars().all()
    
    return {
        "api_keys": [{
            "id": k.id,
            "name": k.name,
            "key_prefix": k.key_prefix,
            "permissions": k.permissions or [],
            "rate_limit": k.rate_limit,
            "is_active": k.is_active,
            "last_used_at": k.last_used_at.isoformat() if k.last_used_at else None,
            "usage_count": k.usage_count,
            "expires_at": k.expires_at.isoformat() if k.expires_at else None,
            "created_at": k.created_at.isoformat() if k.created_at else None
        } for k in keys]
    }


@router.post("/admin/tools/api-keys")
async def create_api_key(
    request: CreateAPIKeyRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a new API key"""
    
    # Generate key
    raw_key = secrets.token_urlsafe(32)
    key_prefix = raw_key[:8]
    key_hash = hashlib.sha256(raw_key.encode()).hexdigest()
    
    expires_at = None
    if request.expires_in_days:
        expires_at = datetime.now(timezone.utc) + timedelta(days=request.expires_in_days)
    
    api_key = APIKey(
        name=request.name,
        key_prefix=key_prefix,
        key_hash=key_hash,
        permissions=request.permissions or [],
        rate_limit=request.rate_limit or 1000,
        expires_at=expires_at,
        created_by=admin.id
    )
    
    db.add(api_key)
    await log_audit(db, admin.id, "api_key", f"Created API key: {request.name}")
    await db.commit()
    
    # Return the full key only once
    return {
        "success": True,
        "api_key_id": api_key.id,
        "api_key": raw_key,  # Only shown once!
        "key_prefix": key_prefix,
        "message": "Save this key now - it won't be shown again!"
    }


@router.delete("/admin/tools/api-keys/{key_id}")
async def revoke_api_key(
    key_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Revoke an API key"""
    
    await db.execute(
        update(APIKey)
        .where(APIKey.id == key_id)
        .values(is_active=False)
    )
    await log_audit(db, admin.id, "api_key", f"Revoked API key {key_id}")
    await db.commit()
    
    return {"success": True}


# --- AUTOMATED REPORTS ---
@router.get("/admin/tools/reports")
async def get_automated_reports(
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Get automated reports"""
    
    result = await db.execute(select(AutomatedReport).order_by(AutomatedReport.name))
    reports = result.scalars().all()
    
    return {
        "reports": [{
            "id": r.id,
            "name": r.name,
            "report_type": r.report_type,
            "schedule": r.schedule,
            "schedule_time": r.schedule_time,
            "recipient_emails": r.recipient_emails or [],
            "is_active": r.is_active,
            "last_sent_at": r.last_sent_at.isoformat() if r.last_sent_at else None,
            "last_error": r.last_error,
            "created_at": r.created_at.isoformat() if r.created_at else None
        } for r in reports]
    }


@router.post("/admin/tools/reports")
async def create_automated_report(
    request: CreateReportRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create an automated report"""
    
    report = AutomatedReport(
        name=request.name,
        report_type=request.report_type,
        schedule=request.schedule,
        recipient_emails=request.recipient_emails,
        config=request.config or {},
        created_by=admin.id
    )
    
    db.add(report)
    await db.commit()
    
    return {"success": True, "report_id": report.id}


@router.put("/admin/tools/reports/{report_id}/toggle")
async def toggle_report(
    report_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Toggle automated report active status"""
    
    result = await db.execute(select(AutomatedReport).where(AutomatedReport.id == report_id))
    report = result.scalar_one_or_none()
    
    if not report:
        raise HTTPException(status_code=404, detail="Report not found")
    
    await db.execute(
        update(AutomatedReport)
        .where(AutomatedReport.id == report_id)
        .values(is_active=not report.is_active)
    )
    await db.commit()
    
    return {"success": True, "is_active": not report.is_active}


# --- CHANGELOG ---
@router.get("/admin/tools/changelog")
async def get_changelog(
    admin: Profile = Depends(get_current_admin),
    include_unpublished: bool = False,
    db: AsyncSession = Depends(get_db)
):
    """Get changelog entries"""
    
    query = select(ChangelogEntry).order_by(desc(ChangelogEntry.created_at))
    if not include_unpublished:
        query = query.where(ChangelogEntry.is_published == True)
    
    result = await db.execute(query)
    entries = result.scalars().all()
    
    return {
        "changelog": [{
            "id": e.id,
            "version": e.version,
            "title": e.title,
            "summary": e.summary,
            "changes": e.changes or [],
            "is_published": e.is_published,
            "is_major": e.is_major,
            "published_at": e.published_at.isoformat() if e.published_at else None,
            "created_at": e.created_at.isoformat() if e.created_at else None
        } for e in entries]
    }


@router.post("/admin/tools/changelog")
async def create_changelog_entry(
    request: CreateChangelogRequest,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Create a changelog entry"""
    
    entry = ChangelogEntry(
        version=request.version,
        title=request.title,
        summary=request.summary,
        changes=request.changes or [],
        is_major=request.is_major or False,
        created_by=admin.id
    )
    
    db.add(entry)
    await db.commit()
    
    return {"success": True, "entry_id": entry.id}


@router.put("/admin/tools/changelog/{entry_id}/publish")
async def publish_changelog_entry(
    entry_id: str,
    admin: Profile = Depends(get_current_admin),
    db: AsyncSession = Depends(get_db)
):
    """Publish a changelog entry"""
    
    await db.execute(
        update(ChangelogEntry)
        .where(ChangelogEntry.id == entry_id)
        .values(
            is_published=True,
            published_at=datetime.now(timezone.utc)
        )
    )
    await db.commit()
    
    return {"success": True}


# User-facing changelog endpoint
@router.get("/changelog")
async def get_public_changelog(
    limit: int = 10,
    db: AsyncSession = Depends(get_db)
):
    """Get public changelog"""
    result = await db.execute(
        select(ChangelogEntry)
        .where(ChangelogEntry.is_published == True)
        .order_by(desc(ChangelogEntry.published_at))
        .limit(limit)
    )
    entries = result.scalars().all()
    
    return {
        "changelog": [{
            "version": e.version,
            "title": e.title,
            "summary": e.summary,
            "changes": e.changes or [],
            "is_major": e.is_major,
            "published_at": e.published_at.isoformat() if e.published_at else None
        } for e in entries]
    }
