from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import httpx
import logging
import asyncio
from functools import lru_cache
import hashlib

from database import get_db
from models import Profile, SurfSpot, Post, ConditionReport, SurfReport

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

# ============ IN-MEMORY CACHE FOR MARINE CONDITIONS ============
# Cache with 10-minute TTL to reduce API calls
_conditions_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 600  # 10 minutes


def _get_cache_key(lat: float, lng: float, forecast_days: int) -> str:
    """Generate cache key for a location + forecast days combo"""
    # Round to 2 decimal places to group nearby coordinates
    lat_rounded = round(lat, 2)
    lng_rounded = round(lng, 2)
    return f"{lat_rounded}_{lng_rounded}_{forecast_days}"


def _get_cached_conditions(cache_key: str) -> Optional[Dict]:
    """Get cached conditions if not expired"""
    if cache_key in _conditions_cache:
        cached = _conditions_cache[cache_key]
        if datetime.now(timezone.utc) < cached.get("expires_at", datetime.min.replace(tzinfo=timezone.utc)):
            return cached.get("data")
    return None


def _set_cached_conditions(cache_key: str, data: Dict):
    """Cache conditions data with TTL"""
    _conditions_cache[cache_key] = {
        "data": data,
        "expires_at": datetime.now(timezone.utc) + timedelta(seconds=CACHE_TTL_SECONDS)
    }
    # Clean up old entries if cache gets too big
    if len(_conditions_cache) > 500:
        now = datetime.now(timezone.utc)
        expired_keys = [k for k, v in _conditions_cache.items() if v.get("expires_at", datetime.min.replace(tzinfo=timezone.utc)) < now]
        for k in expired_keys:
            del _conditions_cache[k]


async def fetch_marine_conditions(lat: float, lng: float, forecast_days: int) -> Optional[Dict]:
    """
    Fetch marine conditions from Open-Meteo with caching.
    Returns parsed conditions dict or None on error.
    """
    cache_key = _get_cache_key(lat, lng, forecast_days)
    
    # Check cache first
    cached = _get_cached_conditions(cache_key)
    if cached:
        logger.debug(f"[Cache HIT] Conditions for {lat},{lng}")
        return cached
    
    logger.debug(f"[Cache MISS] Fetching conditions for {lat},{lng}")
    
    try:
        async with httpx.AsyncClient(timeout=8.0) as client:
            response = await client.get(OPEN_METEO_MARINE_URL, params={
                "latitude": lat,
                "longitude": lng,
                "current": "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction",
                "daily": "wave_height_max,wave_direction_dominant,wave_period_max",
                "forecast_days": forecast_days,
                "timezone": "America/New_York"
            })
            
            if response.status_code == 200:
                data = response.json()
                _set_cached_conditions(cache_key, data)
                return data
            else:
                logger.warning(f"Open-Meteo API returned {response.status_code}")
                return None
    except Exception as e:
        logger.error(f"Error fetching marine conditions: {e}")
        return None

def get_conditions_label(wave_height_ft: float) -> str:
    if wave_height_ft < 1:
        return "Flat"
    elif wave_height_ft < 2:
        return "Ankle High"
    elif wave_height_ft < 3:
        return "Knee High"
    elif wave_height_ft < 4:
        return "Waist High"
    elif wave_height_ft < 5:
        return "Chest High"
    elif wave_height_ft < 6:
        return "Head High"
    elif wave_height_ft < 8:
        return "Overhead"
    elif wave_height_ft < 10:
        return "Double Overhead"
    else:
        return "Triple Overhead+"


@router.get("/explore/search")
async def explore_search(
    q: str,
    search_type: str = "all",
    limit: int = 20,
    db: AsyncSession = Depends(get_db)
):
    results = {
        "users": [],
        "spots": [],
        "posts": []
    }
    
    search_term = f"%{q}%"
    
    if search_type in ["all", "people"]:
        user_result = await db.execute(
            select(Profile)
            .where(
                or_(
                    Profile.full_name.ilike(search_term),
                    Profile.email.ilike(search_term),
                    Profile.location.ilike(search_term)
                )
            )
            .limit(limit)
        )
        users = user_result.scalars().all()
        results["users"] = [{
            "id": u.id,
            "full_name": u.full_name,
            "avatar_url": u.avatar_url,
            "role": u.role.value,
            "location": u.location,
            "is_verified": u.is_verified
        } for u in users]
    
    if search_type in ["all", "spots"]:
        spot_result = await db.execute(
            select(SurfSpot)
            .where(
                or_(
                    SurfSpot.name.ilike(search_term),
                    SurfSpot.region.ilike(search_term),
                    SurfSpot.description.ilike(search_term)
                )
            )
            .limit(limit)
        )
        spots = spot_result.scalars().all()
        results["spots"] = [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "difficulty": s.difficulty,
            "image_url": s.image_url,
            "latitude": s.latitude,
            "longitude": s.longitude
        } for s in spots]
    
    if search_type in ["all", "posts"]:
        post_result = await db.execute(
            select(Post)
            .options(selectinload(Post.author))
            .where(
                or_(
                    Post.caption.ilike(search_term),
                    Post.location.ilike(search_term)
                )
            )
            .order_by(Post.created_at.desc())
            .limit(limit)
        )
        posts = post_result.scalars().all()
        results["posts"] = [{
            "id": p.id,
            "image_url": p.media_url,
            "caption": p.caption,
            "location": p.location,
            "likes_count": p.likes_count,
            "author_name": p.author.full_name if p.author else None,
            "author_avatar": p.author.avatar_url if p.author else None,
            "created_at": p.created_at.isoformat()
        } for p in posts]
    
    return results

@router.get("/explore/trending")
async def get_trending(db: AsyncSession = Depends(get_db)):
    # Social Live Users - Users who are broadcasting live to followers (Instagram Live style)
    # This is DIFFERENT from photographers who are actively shooting at spots
    social_live_result = await db.execute(
        select(Profile)
        .where(Profile.is_live .is_(True))  # SOCIAL LIVE broadcasting, not is_shooting
        .limit(10)
    )
    social_live_users = social_live_result.scalars().all()
    
    spots_result = await db.execute(
        select(SurfSpot)
        .where(SurfSpot.is_active .is_(True))
        .limit(8)
    )
    popular_spots = spots_result.scalars().all()
    
    posts_result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .order_by(Post.likes_count.desc(), Post.created_at.desc())
        .limit(12)
    )
    trending_posts = posts_result.scalars().all()
    
    # Get latest tagged media for each popular spot
    spot_ids = [s.id for s in popular_spots]
    spot_thumbnails = {}
    
    if spot_ids:
        # Get the most recent post with media for each spot
        for spot in popular_spots:
            post_result = await db.execute(
                select(Post)
                .options(selectinload(Post.author))
                .where(
                    Post.spot_id == spot.id,
                    Post.media_url.isnot(None),
                    Post.media_url != ''
                )
                .order_by(Post.created_at.desc())
                .limit(1)
            )
            tagged_post = post_result.scalar_one_or_none()
            
            if tagged_post:
                spot_thumbnails[spot.id] = {
                    "media_url": tagged_post.media_url,
                    "media_type": tagged_post.media_type or 'image',
                    "thumbnail_url": tagged_post.thumbnail_url,
                    "contributor_name": tagged_post.author.full_name if tagged_post.author else None,
                    "contributor_avatar": tagged_post.author.avatar_url if tagged_post.author else None,
                    "contributor_role": tagged_post.author.role.value if tagged_post.author and tagged_post.author.role else 'surfer',
                    "caption": tagged_post.caption,
                    "post_id": tagged_post.id,
                    "created_at": tagged_post.created_at.isoformat() if tagged_post.created_at else None
                }
    
    return {
        # Renamed to "social_live_users" to be clear this is for social broadcasting
        "live_photographers": [{
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "is_live": p.is_live  # Social live status
        } for p in social_live_users],
        "popular_spots": [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "image_url": s.image_url,
            "difficulty": s.difficulty,
            "latitude": s.latitude,
            "longitude": s.longitude,
            # Dynamic thumbnail from latest tagged content
            "thumbnail": spot_thumbnails.get(s.id)
        } for s in popular_spots],
        "trending_posts": [{
            "id": p.id,
            "image_url": p.media_url,
            "caption": p.caption,
            "likes_count": p.likes_count,
            "author_name": p.author.full_name if p.author else None,
            "author_avatar": p.author.avatar_url if p.author else None
        } for p in trending_posts]
    }


@router.get("/explore/surf-spots")
async def get_surf_spots_with_conditions(
    region: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    subscription_tier: str = "free",
    db: AsyncSession = Depends(get_db)
):
    """
    Get surf spots with real-time conditions, forecasts, recent reports, and nearby photographers.
    Tiered forecast access: Free = 3 days, Paid = 7 days, Premium = 10 days.
    
    OPTIMIZED: Uses caching (10-min TTL) and parallel fetching for faster response.
    """
    # Get spots from database
    query = select(SurfSpot).where(SurfSpot.is_active .is_(True))
    
    if region and region != "All":
        query = query.where(SurfSpot.region == region)
    
    # Sort by distance if user location provided
    if user_lat and user_lng:
        query = query.order_by(
            func.abs(SurfSpot.latitude - user_lat) + func.abs(SurfSpot.longitude - user_lng)
        )
    else:
        query = query.order_by(SurfSpot.name)
    
    query = query.limit(limit)
    result = await db.execute(query)
    spots = result.scalars().all()
    
    # Determine forecast days based on subscription
    # TODAY = current conditions (not forecast)
    # FREE = 3 days AFTER today
    # PAID = 7 days AFTER today
    # PREMIUM = 10 days AFTER today
    # We fetch +1 day because Open-Meteo includes today, but we show today as "current"
    forecast_days_after_today = 3  # Free tier
    if subscription_tier in ['paid', 'basic']:
        forecast_days_after_today = 7
    elif subscription_tier in ['premium', 'pro', 'gold']:
        forecast_days_after_today = 10
    
    # Fetch +1 to include today's data for current conditions
    api_forecast_days = forecast_days_after_today + 1
    
    # ============ PARALLEL FETCH: Conditions for all spots at once ============
    async def fetch_spot_conditions(spot):
        """Fetch conditions for a single spot using cached helper"""
        data = await fetch_marine_conditions(spot.latitude, spot.longitude, api_forecast_days)
        return (spot.id, data)
    
    # Fetch all conditions in parallel
    conditions_tasks = [fetch_spot_conditions(spot) for spot in spots]
    conditions_results = await asyncio.gather(*conditions_tasks, return_exceptions=True)
    
    # Build conditions lookup map
    conditions_map = {}
    for result in conditions_results:
        if isinstance(result, tuple):
            spot_id, data = result
            conditions_map[spot_id] = data
    
    # ============ Build enriched spots with conditions ============
    enriched_spots = []
    
    # Batch fetch reports and photographers for all spots
    spot_ids = [spot.id for spot in spots]
    
    # Fetch recent reports for all spots
    reports_result = await db.execute(
        select(SurfReport)
        .where(SurfReport.spot_id.in_(spot_ids))
        .where(SurfReport.created_at > datetime.now(timezone.utc) - timedelta(hours=24))
        .order_by(desc(SurfReport.created_at))
    )
    all_reports = reports_result.scalars().all()
    
    # Group reports by spot_id
    reports_by_spot = {}
    for r in all_reports:
        if r.spot_id not in reports_by_spot:
            reports_by_spot[r.spot_id] = []
        if len(reports_by_spot[r.spot_id]) < 5:
            reports_by_spot[r.spot_id].append(r)
    
    # Fetch active photographers for all spots
    photographers_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id.in_(spot_ids))
        .where(Profile.is_shooting .is_(True))
    )
    all_photographers = photographers_result.scalars().all()
    
    # Group photographers by spot_id
    photographers_by_spot = {}
    for p in all_photographers:
        if p.current_spot_id not in photographers_by_spot:
            photographers_by_spot[p.current_spot_id] = []
        if len(photographers_by_spot[p.current_spot_id]) < 5:
            photographers_by_spot[p.current_spot_id].append(p)
    
    # ============ Fetch spot thumbnails from tagged posts ============
    thumbnails_by_spot = {}
    gallery_by_spot = {}
    if spot_ids:
        # Get the most recent posts with media for each spot (up to 5 for gallery rotation)
        for spot_id in spot_ids:
            post_result = await db.execute(
                select(Post)
                .options(selectinload(Post.author))
                .where(
                    Post.spot_id == spot_id,
                    Post.media_url.isnot(None),
                    Post.media_url != ''
                )
                .order_by(Post.created_at.desc())
                .limit(5)
            )
            tagged_posts = post_result.scalars().all()
            
            if tagged_posts:
                # First post is the primary thumbnail
                primary = tagged_posts[0]
                thumbnails_by_spot[spot_id] = {
                    "media_url": primary.media_url,
                    "media_type": primary.media_type or 'image',
                    "thumbnail_url": primary.thumbnail_url,
                    "contributor_name": primary.author.full_name if primary.author else None,
                    "contributor_role": primary.author.role.value if primary.author and primary.author.role else None
                }
                
                # Build gallery for photo rotation
                gallery_by_spot[spot_id] = [{
                    "media_url": p.media_url,
                    "media_type": p.media_type or 'image',
                    "thumbnail_url": p.thumbnail_url,
                    "contributor_name": p.author.full_name if p.author else None,
                    "contributor_avatar": p.author.avatar_url if p.author else None,
                    "contributor_role": p.author.role.value if p.author and p.author.role else None,
                    "post_id": p.id,
                    "created_at": p.created_at.isoformat() if p.created_at else None
                } for p in tagged_posts]
    
    # Now build the response for each spot
    for spot in spots:
        # Use thumbnail from tagged content if available, else fall back to spot.image_url
        thumbnail_data = thumbnails_by_spot.get(spot.id)
        display_image = thumbnail_data["media_url"] if thumbnail_data else spot.image_url
        
        spot_data = {
            "id": spot.id,
            "name": spot.name,
            "region": spot.region,
            "difficulty": spot.difficulty,
            "image_url": display_image,  # Use thumbnail if available
            "original_image_url": spot.image_url,  # Keep original for fallback
            "thumbnail": thumbnail_data,  # Full thumbnail data with contributor info
            "gallery": gallery_by_spot.get(spot.id, []),  # Multiple photos for rotation
            "latitude": spot.latitude,
            "longitude": spot.longitude,
            "description": spot.description,
            "wave_type": getattr(spot, 'wave_type', None),
            "best_tide": spot.best_tide,
            "best_swell": getattr(spot, 'best_swell', None),
            "current_conditions": None,
            "forecast": [],
            "recent_reports": [],
            "active_photographers": [],
            "forecast_days_allowed": forecast_days_after_today
        }
        
        # Parse conditions from cache/API response
        conditions_data = conditions_map.get(spot.id)
        if conditions_data:
            try:
                current = conditions_data.get("current", {})
                daily = conditions_data.get("daily", {})
                
                wave_height_m = current.get("wave_height", 0)
                wave_height_ft = round(wave_height_m * 3.28084, 1) if wave_height_m else 0
                
                swell_m = current.get("swell_wave_height", 0)
                swell_ft = round(swell_m * 3.28084, 1) if swell_m else 0
                
                # Today's current conditions (from "current" API, NOT forecast)
                spot_data["current_conditions"] = {
                    "wave_height_ft": wave_height_ft,
                    "wave_direction": current.get("wave_direction"),
                    "wave_period": current.get("wave_period"),
                    "swell_height_ft": swell_ft,
                    "swell_direction": current.get("swell_wave_direction"),
                    "label": get_conditions_label(wave_height_ft)
                }
                
                # Build forecast - SKIP today (index 0), start from tomorrow (index 1)
                dates = daily.get("time", [])
                wave_max = daily.get("wave_height_max", [])
                directions = daily.get("wave_direction_dominant", [])
                periods = daily.get("wave_period_max", [])
                
                # Start from index 1 (tomorrow) and take forecast_days_after_today items
                for i in range(1, min(len(dates), forecast_days_after_today + 1)):
                    date = dates[i]
                    max_m = wave_max[i] if i < len(wave_max) else 0
                    max_ft = round(max_m * 3.28084, 1) if max_m else 0
                    min_ft = round(max_ft * 0.6, 1)
                    
                    spot_data["forecast"].append({
                        "date": date,
                        "wave_height_min": min_ft,
                        "wave_height_max": max_ft,
                        "wave_direction": directions[i] if i < len(directions) else None,
                        "wave_period": periods[i] if i < len(periods) else None,
                        "label": get_conditions_label(max_ft)
                    })
            except Exception as e:
                logger.error(f"Error parsing conditions for {spot.name}: {e}")
        
        # Add recent reports (from batch query)
        spot_reports = reports_by_spot.get(spot.id, [])
        spot_data["recent_reports"] = [{
            "id": r.id,
            "wave_height": r.wave_height,
            "conditions": r.conditions,
            "crowd_level": r.crowd_level,
            "rating": r.rating,
            "created_at": r.created_at.isoformat() if r.created_at else None
        } for r in spot_reports]
        
        # Add active photographers (from batch query)
        spot_photographers = photographers_by_spot.get(spot.id, [])
        spot_data["active_photographers"] = [{
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "is_shooting": True,  # They're shooting at this spot
            "is_streaming": p.is_streaming,
            "is_on_demand": getattr(p, 'is_on_demand', False) or False,
            "session_price": p.session_price
        } for p in spot_photographers]
        
        enriched_spots.append(spot_data)
    
    # Get unique regions for filter
    regions_result = await db.execute(
        select(SurfSpot.region).distinct().where(SurfSpot.is_active .is_(True))
    )
    regions = [r[0] for r in regions_result.all() if r[0]]
    
    return {
        "spots": enriched_spots,
        "regions": sorted(regions),
        "forecast_days_allowed": forecast_days_after_today,
        "subscription_tier": subscription_tier,
        "cached": True  # Indicate response may be from cache
    }


@router.get("/explore/spot-details/{spot_id}")
async def get_spot_details(
    spot_id: str,
    subscription_tier: str = "free",
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed information about a specific surf spot including
    conditions, full forecast, reports, and content.
    """
    result = await db.execute(
        select(SurfSpot).where(SurfSpot.id == spot_id)
    )
    spot = result.scalar_one_or_none()
    
    if not spot:
        return {"error": "Spot not found"}
    
    # Determine forecast days AFTER today
    # TODAY = current conditions (not forecast)
    # FREE = 3 days AFTER today
    # PAID = 7 days AFTER today  
    # PREMIUM = 10 days AFTER today
    forecast_days_after_today = 3
    if subscription_tier in ['paid', 'basic']:
        forecast_days_after_today = 7
    elif subscription_tier in ['premium', 'pro', 'gold']:
        forecast_days_after_today = 10
    
    # Fetch +1 to include today's data for current conditions
    api_forecast_days = forecast_days_after_today + 1
    
    spot_data = {
        "id": spot.id,
        "name": spot.name,
        "region": spot.region,
        "difficulty": spot.difficulty,
        "image_url": spot.image_url,
        "latitude": spot.latitude,
        "longitude": spot.longitude,
        "description": spot.description,
        "wave_type": getattr(spot, 'wave_type', None),
        "best_tide": spot.best_tide,
        "best_swell": getattr(spot, 'best_swell', None),
        "current_conditions": None,
        "forecast": [],
        "forecast_days_allowed": forecast_days_after_today
    }
    
    # Fetch real-time conditions and forecast
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            response = await client.get(OPEN_METEO_MARINE_URL, params={
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "current": "wave_height,wave_direction,wave_period,swell_wave_height,swell_wave_direction",
                "daily": "wave_height_max,wave_direction_dominant,wave_period_max,swell_wave_height_max",
                "forecast_days": api_forecast_days,
                "timezone": "America/New_York"
            })
            
            if response.status_code == 200:
                data = response.json()
                current = data.get("current", {})
                daily = data.get("daily", {})
                
                wave_height_m = current.get("wave_height", 0)
                wave_height_ft = round(wave_height_m * 3.28084, 1) if wave_height_m else 0
                
                swell_m = current.get("swell_wave_height", 0)
                swell_ft = round(swell_m * 3.28084, 1) if swell_m else 0
                
                # Today's conditions from "current" API endpoint
                spot_data["current_conditions"] = {
                    "wave_height_ft": wave_height_ft,
                    "wave_direction": current.get("wave_direction"),
                    "wave_period": current.get("wave_period"),
                    "swell_height_ft": swell_ft,
                    "swell_direction": current.get("swell_wave_direction"),
                    "label": get_conditions_label(wave_height_ft),
                    "updated_at": datetime.now(timezone.utc).isoformat()
                }
                
                # Build forecast - SKIP today (index 0), start from tomorrow (index 1)
                dates = daily.get("time", [])
                wave_max = daily.get("wave_height_max", [])
                directions = daily.get("wave_direction_dominant", [])
                periods = daily.get("wave_period_max", [])
                swell_max = daily.get("swell_wave_height_max", [])
                
                for i in range(1, min(len(dates), forecast_days_after_today + 1)):
                    date = dates[i]
                    max_m = wave_max[i] if i < len(wave_max) else 0
                    max_ft = round(max_m * 3.28084, 1) if max_m else 0
                    min_ft = round(max_ft * 0.6, 1)
                    
                    swell_max_m = swell_max[i] if i < len(swell_max) else 0
                    swell_max_ft = round(swell_max_m * 3.28084, 1) if swell_max_m else 0
                    
                    spot_data["forecast"].append({
                        "date": date,
                        "wave_height_min": min_ft,
                        "wave_height_max": max_ft,
                        "wave_direction": directions[i] if i < len(directions) else None,
                        "wave_period": periods[i] if i < len(periods) else None,
                        "swell_height_ft": swell_max_ft,
                        "label": get_conditions_label(max_ft)
                    })
    except Exception as e:
        logger.error(f"Error fetching conditions for {spot.name}: {e}")
    
    # Get recent reports (last 48 hours)
    reports_result = await db.execute(
        select(SurfReport)
        .where(SurfReport.spot_id == spot_id)
        .where(SurfReport.created_at > datetime.now(timezone.utc) - timedelta(hours=48))
        .order_by(desc(SurfReport.created_at))
        .limit(10)
    )
    reports = reports_result.scalars().all()
    
    spot_data["recent_reports"] = [{
        "id": r.id,
        "wave_height": r.wave_height,
        "conditions": r.conditions,
        "crowd_level": r.crowd_level,
        "wind_direction": r.wind_direction,
        "rating": r.rating,
        "notes": r.notes,
        "created_at": r.created_at.isoformat() if r.created_at else None
    } for r in reports]
    
    # Get active photographers
    photographers_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id == spot_id)
        .where(Profile.is_shooting .is_(True))
    )
    photographers = photographers_result.scalars().all()
    
    # Only include photographers who are actually shooting at THIS spot
    spot_data["active_photographers"] = [{
        "id": p.id,
        "full_name": p.full_name,
        "avatar_url": p.avatar_url,
        "is_shooting": True,  # They're in this list because they're shooting here
        "is_streaming": p.is_streaming,
        "is_on_demand": getattr(p, 'is_on_demand', False) or False,
        "on_demand_hourly_rate": getattr(p, 'on_demand_hourly_rate', None),
        "session_price": p.session_price,
        "hourly_rate": p.hourly_rate,
        "booking_hourly_rate": getattr(p, 'booking_hourly_rate', None),
        "role": p.role.value if p.role else 'photographer',
        "current_spot_id": p.current_spot_id  # Include for verification
    } for p in photographers]
    
    # Get recent posts at this spot
    posts_result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(Post.spot_id == spot_id)
        .order_by(desc(Post.created_at))
        .limit(12)
    )
    posts = posts_result.scalars().all()
    
    spot_data["recent_posts"] = [{
        "id": p.id,
        "image_url": p.media_url,
        "caption": p.caption,
        "likes_count": p.likes_count,
        "author_name": p.author.full_name if p.author else None,
        "author_avatar": p.author.avatar_url if p.author else None
    } for p in posts]
    
    return spot_data
