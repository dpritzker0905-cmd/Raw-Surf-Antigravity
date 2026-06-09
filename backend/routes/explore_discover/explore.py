from fastapi import APIRouter, Depends, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, or_, desc, text, case
from sqlalchemy.orm import selectinload
from typing import Optional, List, Dict, Any
from datetime import datetime, timezone, timedelta
import httpx
import logging
import asyncio
import time
from functools import lru_cache
import hashlib
import json

from database import get_db
from models import Profile, SurfSpot, Post, ConditionReport, SurfReport, CheckIn, RoleEnum
from core.security import get_optional_user_id

# Weather pipeline point resolution
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

point_sampler = PointSampler()
open_meteo_provider = OpenMeteoProvider()
point_resolution_service = PointResolutionService(
    sampler=point_sampler,
    provider=open_meteo_provider
)

router = APIRouter()
logger = logging.getLogger(__name__)

OPEN_METEO_MARINE_URL = "https://marine-api.open-meteo.com/v1/marine"

# ============ IN-MEMORY CACHE FOR MARINE CONDITIONS ============
# Cache with 10-minute TTL to reduce API calls
_conditions_cache: Dict[str, Dict[str, Any]] = {}
CACHE_TTL_SECONDS = 600  # 10 minutes

# ============ RESPONSE-LEVEL CACHE FOR SURF SPOTS ============
# Caches the entire /explore/surf-spots response for 5 minutes
# to eliminate redundant DB queries when multiple users browse simultaneously
_surf_spots_response_cache: Dict[str, Dict[str, Any]] = {}
SURF_SPOTS_CACHE_TTL = 300  # 5 minutes


def _get_cache_key(lat: float, lng: float, forecast_days: int, model: str = "GFS") -> str:
    """Generate cache key for a location + forecast days + model combo"""
    # Round to 2 decimal places to group nearby coordinates
    lat_rounded = round(lat, 2)
    lng_rounded = round(lng, 2)
    return f"{lat_rounded}_{lng_rounded}_{forecast_days}_{model.upper()}"


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


async def fetch_marine_conditions(lat: float, lng: float, forecast_days: int, model: str = "GFS") -> Optional[Dict]:
    """
    Fetch marine conditions using PointResolutionService with L1 caching.
    Returns conformed conditions dict or None on error.
    """
    cache_key = _get_cache_key(lat, lng, forecast_days, model)
    
    # Check cache first
    cached = _get_cached_conditions(cache_key)
    if cached:
        logger.debug(f"[Cache HIT] Conditions for {lat},{lng} ({model})")
        return cached
    
    logger.debug(f"[Cache MISS] Fetching conditions for {lat},{lng} ({model})")
    
    try:
        data = await point_resolution_service.resolve_spot_conditions(
            model=model, lat=lat, lng=lng, forecast_days=forecast_days
        )
        if data:
            _set_cached_conditions(cache_key, data)
            return data
        return None
    except Exception as e:
        logger.error(f"Error resolving marine conditions via service: {e}")
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
        # ── Multi-signal ranked search ──────────────────────────────
        # Priority: exact name > name starts-with > name contains >
        #           city match > area match > region > state > description
        #
        # This ensures "Cocoa Beach" returns "Cocoa Beach Pier" (name match)
        # before "Central Florida" (region match that merely contains Cocoa Beach spots).
        starts_term = f"{q}%"       # name starts with search term
        contains_term = f"%{q}%"    # name/field contains search term

        relevance = case(
            # Tier 1: Name starts with search term (best match)
            (SurfSpot.name.ilike(starts_term), 1),
            # Tier 2: Name contains search term anywhere
            (SurfSpot.name.ilike(contains_term), 2),
            # Tier 3: City match — user likely searching by city name
            (SurfSpot.secondary_city.ilike(contains_term), 3),
            # Tier 4: Area match (e.g., "Space Coast")
            (SurfSpot.secondary_area.ilike(contains_term), 4),
            # Tier 5: Region match (e.g., "Central Florida")
            (SurfSpot.region.ilike(contains_term), 5),
            # Tier 6: State / Country match
            (SurfSpot.state_province.ilike(contains_term), 6),
            (SurfSpot.country.ilike(contains_term), 7),
            # Tier 7: Description mention (weakest signal)
            (SurfSpot.description.ilike(contains_term), 8),
            else_=9
        )
        spot_result = await db.execute(
            select(SurfSpot)
            .where(
                or_(
                    SurfSpot.name.ilike(contains_term),
                    SurfSpot.secondary_city.ilike(contains_term),
                    SurfSpot.secondary_area.ilike(contains_term),
                    SurfSpot.region.ilike(contains_term),
                    SurfSpot.state_province.ilike(contains_term),
                    SurfSpot.country.ilike(contains_term),
                    SurfSpot.description.ilike(contains_term)
                )
            )
            .order_by(relevance, SurfSpot.name)
            .limit(limit)
        )
        spots = spot_result.scalars().all()
        results["spots"] = [{
            "id": s.id,
            "name": s.name,
            "region": s.region,
            "secondary_city": s.secondary_city,
            "secondary_area": s.secondary_area,
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
async def get_trending(
    viewer_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user_id: Optional[str] = Depends(get_optional_user_id)
):
    # Resolve the active viewer
    active_viewer_id = viewer_id or current_user_id

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
    
    # Fetch top 50 recent posts with media for algorithmic ranking
    posts_result = await db.execute(
        select(Post)
        .options(selectinload(Post.author))
        .where(
            Post.media_url.isnot(None),
            Post.media_url != ''
        )
        .order_by(Post.created_at.desc())
        .limit(50)
    )
    all_recent_posts = posts_result.scalars().all()
    
    # Fetch active viewer check-in history if logged in
    viewer_spot_ids = set()
    if active_viewer_id:
        check_ins_query = (
            select(CheckIn.spot_id)
            .where(CheckIn.user_id == active_viewer_id)
            .where(CheckIn.spot_id.isnot(None))
        )
        check_ins_result = await db.execute(check_ins_query)
        viewer_spot_ids = set(check_ins_result.scalars().all())

    # Multi-signal Ranking Score Engine
    now = datetime.now(timezone.utc)
    scored_posts = []
    
    for post in all_recent_posts:
        # Timezone-aware created_at calculation
        created_at = post.created_at
        if created_at.tzinfo is None:
            created_at = created_at.replace(tzinfo=timezone.utc)
            
        time_diff = now - created_at
        hours_since_creation = time_diff.total_seconds() / 3600.0
        if hours_since_creation < 0:
            hours_since_creation = 0.0
            
        # Signal 1: Blended Engagement with Time Decay
        likes = post.likes_count or 0
        comments = post.comments_count or 0
        base_score = likes + (3 * comments) + 1
        time_decay = (hours_since_creation + 2.0) ** 1.8
        score = base_score / time_decay
        
        # Signal 2: Role Boosting Heuristics
        if post.author and post.author.role:
            role = post.author.role
            if role == RoleEnum.PRO or role.value == "Pro":
                score *= 1.5
            elif role == RoleEnum.APPROVED_PRO or role.value == "Approved Pro":
                score *= 1.3
            elif role == RoleEnum.PHOTOGRAPHER or role.value == "Photographer":
                score *= 1.15
            elif role in {RoleEnum.SHOP, RoleEnum.SCHOOL, RoleEnum.COACH, RoleEnum.RESORT, RoleEnum.WAVE_POOL, RoleEnum.SHAPER, RoleEnum.DESTINATION} or role.value in {"Shop", "School", "Coach", "Resort", "Wave Pool", "Shaper", "Destination"}:
                score *= 1.1
                
        # Signal 3: Spot Affinity / Check-in Proximity Boosting
        if post.spot_id and post.spot_id in viewer_spot_ids:
            score *= 1.4
            
        scored_posts.append((score, post))
        
    # Sort descending by calculated score and return the top 12 trending posts
    scored_posts.sort(key=lambda x: x[0], reverse=True)
    trending_posts = [p for score, p in scored_posts[:12]]
    
    # Get latest tagged media for all popular spots in ONE batched query (not N+1)
    spot_ids = [s.id for s in popular_spots]
    spot_thumbnails = {}
    
    if spot_ids:
        # Single batched query: Get the most recent post with media for all spots at once
        # Uses a window function (ROW_NUMBER) to rank posts per spot, then filters to top 1
        post_result = await db.execute(
            select(Post)
            .options(selectinload(Post.author))
            .where(
                Post.spot_id.in_(spot_ids),
                Post.media_url.isnot(None),
                Post.media_url != ''
            )
            .order_by(Post.spot_id, Post.created_at.desc())
        )
        all_tagged_posts = post_result.scalars().all()
        
        # Group by spot_id and take only the first (most recent) per spot
        seen_spots = set()
        for post in all_tagged_posts:
            if post.spot_id not in seen_spots:
                seen_spots.add(post.spot_id)
                spot_thumbnails[post.spot_id] = {
                    "media_url": post.media_url,
                    "media_type": post.media_type or 'image',
                    "thumbnail_url": post.thumbnail_url,
                    "contributor_name": post.author.full_name if post.author else None,
                    "contributor_avatar": post.author.avatar_url if post.author else None,
                    "contributor_role": post.author.role.value if post.author and post.author.role else 'surfer',
                    "caption": post.caption,
                    "post_id": post.id,
                    "created_at": post.created_at.isoformat() if post.created_at else None
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
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    limit: int = Query(default=20, le=50),
    user_lat: Optional[float] = None,
    user_lng: Optional[float] = None,
    subscription_tier: str = "free",
    model: str = Query("GFS", pattern="^(GFS|ICON|EURO)$"),
    db: AsyncSession = Depends(get_db)
):
    """
    Get surf spots with real-time conditions, forecasts, recent reports, and nearby photographers.
    Tiered forecast access: Free = 3 days, Paid = 7 days, Premium = 10 days.
    
    Supports filtering by region, country, and/or state_province for location hierarchy browsing.
    OPTIMIZED: Uses response caching (5-min TTL), batched queries, and parallel fetching.
    """
    # ============ CHECK RESPONSE CACHE ============
    cache_key = f"surf_spots_{region}_{country}_{state_province}_{limit}_{user_lat}_{user_lng}_{subscription_tier}_{model.upper()}"
    now = time.time()
    if cache_key in _surf_spots_response_cache:
        cached = _surf_spots_response_cache[cache_key]
        if now < cached.get("expires_at", 0):
            logger.debug(f"[Cache HIT] Surf spots response for {cache_key}")
            return cached["data"]
    
    # Get spots from database
    query = select(SurfSpot).where(SurfSpot.is_active .is_(True))
    
    if country and country != "All":
        query = query.where(SurfSpot.country == country)
    if state_province and state_province != "All":
        query = query.where(SurfSpot.state_province == state_province)
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
    
    # Always fetch 10 days from the API so we can show locked previews
    # for upselling lower-tier users. The frontend uses forecast_days_allowed
    # to determine which days are unlocked vs locked.
    max_forecast_days = 10
    api_forecast_days = max_forecast_days + 1  # +1 because index 0 is today
    
    # ============ PARALLEL FETCH: Conditions for all spots at once ============
    async def fetch_spot_conditions(spot):
        """Fetch conditions for a single spot using cached helper"""
        data = await fetch_marine_conditions(spot.latitude, spot.longitude, api_forecast_days, model)
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
    # Two separate queries: live-shooting AND on-demand available
    shooting_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id.in_(spot_ids))
        .where(Profile.is_shooting .is_(True))
    )
    shooting_photographers = shooting_result.scalars().all()
    
    on_demand_result = await db.execute(
        select(Profile)
        .where(Profile.current_spot_id.in_(spot_ids))
        .where(Profile.on_demand_available .is_(True))
        .where(Profile.is_shooting .is_(False))  # NOT already in live session
    )
    on_demand_photographers = on_demand_result.scalars().all()
    
    # Group all photographers by spot_id with status flag
    photographers_by_spot = {}
    for p in shooting_photographers:
        if p.current_spot_id not in photographers_by_spot:
            photographers_by_spot[p.current_spot_id] = []
        if len(photographers_by_spot[p.current_spot_id]) < 10:
            photographers_by_spot[p.current_spot_id].append((p, 'live_shooting'))
    for p in on_demand_photographers:
        if p.current_spot_id not in photographers_by_spot:
            photographers_by_spot[p.current_spot_id] = []
        if len(photographers_by_spot[p.current_spot_id]) < 10:
            photographers_by_spot[p.current_spot_id].append((p, 'on_demand'))
    
    # ============ Fetch spot thumbnails from tagged posts (BATCHED - not N+1) ============
    thumbnails_by_spot = {}
    gallery_by_spot = {}
    if spot_ids:
        # Single batched query: Get recent posts with media for ALL spots at once
        post_result = await db.execute(
            select(Post)
            .options(selectinload(Post.author))
            .where(
                Post.spot_id.in_(spot_ids),
                Post.media_url.isnot(None),
                Post.media_url != ''
            )
            .order_by(Post.spot_id, Post.created_at.desc())
        )
        all_posts = post_result.scalars().all()
        
        # Group posts by spot_id and take top 5 per spot (in-memory grouping)
        posts_by_spot: Dict[str, list] = {}
        for p in all_posts:
            if p.spot_id not in posts_by_spot:
                posts_by_spot[p.spot_id] = []
            if len(posts_by_spot[p.spot_id]) < 5:
                posts_by_spot[p.spot_id].append(p)
        
        # Build thumbnails and gallery from grouped data
        for spot_id, tagged_posts in posts_by_spot.items():
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
            spot_data["current_conditions"] = conditions_data.get("current_conditions")
            spot_data["forecast"] = conditions_data.get("forecast", [])
        
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
        
        # Add active photographers (from batch query) with status differentiation
        spot_photographers = photographers_by_spot.get(spot.id, [])
        spot_data["active_photographers"] = [{
            "id": p.id,
            "full_name": p.full_name,
            "avatar_url": p.avatar_url,
            "is_shooting": status == 'live_shooting',
            "is_streaming": p.is_streaming,
            "is_on_demand": status == 'on_demand',
            "status": status,  # 'live_shooting' or 'on_demand'
            "session_price": p.session_price,
            "on_demand_hourly_rate": getattr(p, 'on_demand_hourly_rate', None),
            "role": p.role.value if p.role else 'photographer'
        } for p, status in spot_photographers]
        
        enriched_spots.append(spot_data)
    
    # Get unique regions for filter
    regions_result = await db.execute(
        select(SurfSpot.region).distinct().where(SurfSpot.is_active .is_(True))
    )
    regions = [r[0] for r in regions_result.all() if r[0]]
    
    response_data = {
        "spots": enriched_spots,
        "regions": sorted(regions),
        "forecast_days_allowed": forecast_days_after_today,
        "subscription_tier": subscription_tier,
        "cached": False
    }
    
    # ============ CACHE THE RESPONSE ============
    _surf_spots_response_cache[cache_key] = {
        "data": response_data,
        "expires_at": time.time() + SURF_SPOTS_CACHE_TTL
    }
    # Evict old cache entries if cache grows too large
    if len(_surf_spots_response_cache) > 100:
        expired = [k for k, v in _surf_spots_response_cache.items() if time.time() > v.get("expires_at", 0)]
        for k in expired:
            del _surf_spots_response_cache[k]
    
    return response_data



# ============================================================
# RE-EXPORTS - Extracted to spot_details.py (v92 audit)
# ============================================================
from .spot_details import get_spot_details  # noqa: F401
