from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from pydantic import BaseModel
from typing import List, Optional
from datetime import datetime, timezone, date
import math
import logging

from database import get_db
from models import Profile, SurfSpot, RoleEnum, LiveSession, SpotRefinement, SpotOfTheDay, Booking
from utils.grom_parent import is_grom_parent_eligible

router = APIRouter()
logger = logging.getLogger(__name__)


# ============================================================
# COASTLINE OFFSET ALGORITHM
# ============================================================

def calculate_seaward_offset(lat: float, lon: float, offset_meters: float = 100) -> tuple:
    """
    Calculate a seaward offset for inland pins.
    Uses approximate bearing toward nearest coastline.
    For now, uses a simple eastward/westward offset based on hemisphere.
    
    Args:
        lat: Original latitude
        lon: Original longitude
        offset_meters: Distance to move seaward (default 100m)
    
    Returns:
        (new_lat, new_lon) tuple
    """
    # Convert offset to degrees (approximate)
    # 1 degree latitude ≈ 111km
    # 1 degree longitude varies by latitude
    lat_offset = offset_meters / 111000
    lon_offset = offset_meters / (111000 * math.cos(math.radians(lat)))
    
    # Determine direction based on location
    # East Coast USA: shift east (toward Atlantic)
    # West Coast USA: shift west (toward Pacific)
    # Australia East: shift east
    # Indonesia: shift south (toward Indian Ocean)
    
    # Simple heuristic based on longitude
    if lon > -100 and lon < -60:  # East Coast Americas
        new_lon = lon + lon_offset
        new_lat = lat
    elif lon > -130 and lon <= -100:  # West Coast Americas
        new_lon = lon - lon_offset
        new_lat = lat
    elif lon > 100 and lon < 160:  # Australia/Indo East
        new_lon = lon + lon_offset
        new_lat = lat
    elif lon > 90 and lon <= 100:  # Indonesia West
        new_lon = lon
        new_lat = lat - lat_offset
    else:
        # Default: slight offset toward equator
        new_lon = lon
        new_lat = lat - (lat_offset if lat > 0 else -lat_offset)
    
    return (round(new_lat, 6), round(new_lon, 6))


# ============================================================
# PRIVACY SHIELD - Visibility Radius Logic
# ============================================================

def get_visibility_radius(subscription_tier: str) -> float:
    """
    Returns visibility radius in miles based on subscription tier.
    Privacy Shield: Users can only see live photographer data within their radius.
    """
    TIER_RADIUS = {
        # Free tier - 1 mile radius
        None: 1.0,
        "": 1.0,
        "free": 1.0,
        # Basic tier ($5-$18) - 10 mile radius
        "basic": 10.0,
        "starter": 10.0,
        # Premium tier ($10-$30) - Unlimited (use large number)
        "premium": 999999.0,
        "pro": 999999.0,
        "gold": 999999.0,
        "unlimited": 999999.0,
    }
    return TIER_RADIUS.get(subscription_tier.lower() if subscription_tier else None, 1.0)


def haversine_distance(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """
    Calculate the great circle distance between two points on earth (in miles).
    Used for Privacy Shield geofencing.
    """
    R = 3959  # Earth's radius in miles
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat / 2) ** 2 + \
        math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon / 2) ** 2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))
    
    return R * c


def is_within_geofence(user_lat: float, user_lon: float, spot_lat: float, spot_lon: float, radius_miles: float) -> bool:
    """Check if a spot is within the user's visibility radius."""
    if radius_miles >= 999999:  # Premium/unlimited
        return True
    distance = haversine_distance(user_lat, user_lon, spot_lat, spot_lon)
    return distance <= radius_miles

class SurfSpotResponse(BaseModel):
    id: str
    name: str
    region: Optional[str]
    latitude: float
    longitude: float
    description: Optional[str]
    difficulty: Optional[str]
    best_tide: Optional[str]
    best_swell: Optional[str]
    image_url: Optional[str]
    is_active: bool
    active_photographers_count: int = 0
    # Global fields
    country: Optional[str] = None
    state_province: Optional[str] = None
    wave_type: Optional[str] = None
    # Privacy Shield fields
    is_within_geofence: bool = True  # True if user can see live data
    distance_miles: Optional[float] = None  # Distance from user

class LivePhotographerResponse(BaseModel):
    id: str
    full_name: Optional[str]
    avatar_url: Optional[str]
    is_shooting: bool = False
    is_streaming: bool = False
    current_spot_id: Optional[str]
    current_spot_name: Optional[str]
    shooting_started_at: Optional[datetime]
    last_story_url: Optional[str]
    session_price: Optional[float]
    latitude: Optional[float]
    longitude: Optional[float]
    # Additional pricing fields for Jump In flow
    live_buyin_price: Optional[float] = None
    live_photo_price: Optional[float] = None
    photo_package_size: Optional[int] = None
    photo_price_standard: Optional[float] = None
    gallery_photo_price: Optional[float] = None

class GoLiveRequest(BaseModel):
    spot_id: Optional[str] = None  # Surf spot ID (optional - can use location name instead)
    location: Optional[str] = None  # Custom location name
    is_streaming: bool = False
    price_per_join: float = 25.0
    max_surfers: int = 10
    auto_accept: bool = True
    # Live Session Rates (for gallery pricing override & savings display)
    live_photo_price: Optional[float] = None      # Session-specific photo price
    photos_included: Optional[int] = None         # Photos included in buy-in
    general_photo_price: Optional[float] = None   # Reference: photographer's general price
    estimated_duration: Optional[int] = None      # Estimated session duration in hours
    # Resolution-based pricing (MANDATORY for all workflows)
    photo_price_web: Optional[float] = None       # Web-res (social media optimized)
    photo_price_standard: Optional[float] = None  # Standard digital delivery
    photo_price_high: Optional[float] = None      # High-res (print quality)
    # Condition capture
    spot_notes: Optional[str] = None

class StopLiveRequest(BaseModel):
    story_url: Optional[str] = None

class SpotImageUpdate(BaseModel):
    image_url: str

# Admin simulation models
class SimulateLiveRequest(BaseModel):
    photographer_id: str
    spot_id: str
    is_live: bool  # True to go live, False to stop
    session_price: float = 25.0

class ForceStartSessionRequest(BaseModel):
    photographer_id: str
    spot_id: str
    session_price: float = 25.0
    condition_media: Optional[str] = None  # Base64 encoded media
    condition_media_type: Optional[str] = None  # 'photo' or 'video'
    spot_notes: Optional[str] = None

class SimulateLiveResponse(BaseModel):
    success: bool
    message: str
    photographer_id: str
    photographer_name: Optional[str]
    spot_name: Optional[str]
    is_live: bool
    live_session_id: Optional[str] = None

@router.get("/surf-spots", response_model=List[SurfSpotResponse])
async def get_surf_spots(
    region: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    user_lat: Optional[float] = Query(None, description="User latitude for geofencing"),
    user_lon: Optional[float] = Query(None, description="User longitude for geofencing"),
    user_id: Optional[str] = Query(None, description="User ID to determine subscription tier"),
    viewport_only: bool = Query(False, description="Only return spots in viewport"),
    min_lat: Optional[float] = None,
    max_lat: Optional[float] = None,
    min_lon: Optional[float] = None,
    max_lon: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get surf spots with Privacy Shield geofencing.
    - If user_lat/lon provided, calculates distance and applies visibility rules
    - active_photographers_count is only shown if within geofence
    """
    query = select(SurfSpot).where(SurfSpot.is_active.is_(True))
    
    # Filter by region or country
    if region:
        query = query.where(SurfSpot.region == region)
    if country:
        query = query.where(SurfSpot.country == country)
    if state_province:
        query = query.where(SurfSpot.state_province == state_province)
    
    # Viewport filtering for map performance
    if viewport_only and all([min_lat, max_lat, min_lon, max_lon]):
        query = query.where(
            and_(
                SurfSpot.latitude >= min_lat,
                SurfSpot.latitude <= max_lat,
                SurfSpot.longitude >= min_lon,
                SurfSpot.longitude <= max_lon
            )
        )
    
    result = await db.execute(query.order_by(SurfSpot.name))
    spots = result.scalars().all()
    
    # Get user's subscription tier for Privacy Shield
    visibility_radius = 1.0  # Default to free tier
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            visibility_radius = get_visibility_radius(user.subscription_tier)
    
    # OPTIMIZATION: Batch query for active photographer counts (fixes N+1 query problem)
    # Get all spot IDs that have active photographers in a single query
    active_counts_query = await db.execute(
        select(Profile.current_spot_id, func.count(Profile.id).label('count'))
        .where(Profile.is_shooting.is_(True))
        .where(Profile.current_spot_id.isnot(None))
        .group_by(Profile.current_spot_id)
    )
    active_counts = {str(row[0]): row[1] for row in active_counts_query.fetchall()}
    
    spot_responses = []
    for spot in spots:
        # Calculate distance if user location provided
        distance = None
        within_geofence = True
        
        if user_lat is not None and user_lon is not None:
            distance = haversine_distance(user_lat, user_lon, spot.latitude, spot.longitude)
            within_geofence = is_within_geofence(user_lat, user_lon, spot.latitude, spot.longitude, visibility_radius)
        
        # Privacy Shield: ALWAYS get photographer count (for upsell "3 Pros Shooting Now")
        # Use the pre-fetched counts instead of individual queries
        active_count = active_counts.get(str(spot.id), 0)
        
        spot_responses.append(SurfSpotResponse(
            id=spot.id,
            name=spot.name,
            region=spot.region,
            latitude=spot.latitude,
            longitude=spot.longitude,
            description=spot.description,
            difficulty=spot.difficulty,
            best_tide=spot.best_tide,
            best_swell=spot.best_swell,
            image_url=spot.image_url,
            is_active=spot.is_active,
            active_photographers_count=active_count,
            country=spot.country,
            state_province=spot.state_province,
            wave_type=spot.wave_type,
            is_within_geofence=within_geofence,
            distance_miles=round(distance, 2) if distance is not None else None
        ))
    
    return spot_responses


@router.get("/surf-spots/locations")
async def get_surf_spot_locations(
    db: AsyncSession = Depends(get_db)
):
    """
    Get unique countries and states/provinces for location filtering.
    Returns a hierarchical structure for dropdowns.
    """
    # Get unique countries with count
    countries_query = await db.execute(
        select(
            SurfSpot.country,
            func.count(SurfSpot.id).label('spot_count')
        )
        .where(SurfSpot.is_active.is_(True))
        .where(SurfSpot.country.isnot(None))
        .group_by(SurfSpot.country)
        .order_by(SurfSpot.country)
    )
    countries = countries_query.fetchall()
    
    # Get states/provinces grouped by country
    states_query = await db.execute(
        select(
            SurfSpot.country,
            SurfSpot.state_province,
            func.count(SurfSpot.id).label('spot_count')
        )
        .where(SurfSpot.is_active.is_(True))
        .where(SurfSpot.country.isnot(None))
        .where(SurfSpot.state_province.isnot(None))
        .group_by(SurfSpot.country, SurfSpot.state_province)
        .order_by(SurfSpot.country, SurfSpot.state_province)
    )
    states = states_query.fetchall()
    
    # Build hierarchical response
    location_map = {}
    for country, count in countries:
        if country:
            location_map[country] = {
                "name": country,
                "spot_count": count,
                "states": []
            }
    
    for country, state, count in states:
        if country and state and country in location_map:
            location_map[country]["states"].append({
                "name": state,
                "spot_count": count
            })
    
    return {
        "countries": list(location_map.values()),
        "total_countries": len(location_map)
    }


@router.get("/surf-spots/nearby")
async def get_nearby_spots(
    latitude: float,
    longitude: float,
    radius_miles: float = 15.0,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get surf spots within radius of given location with Privacy Shield"""
    result = await db.execute(
        select(SurfSpot).where(SurfSpot.is_active.is_(True))
    )
    all_spots = result.scalars().all()
    
    # Get user's visibility radius
    visibility_radius = 1.0
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            visibility_radius = get_visibility_radius(user.subscription_tier)
    
    nearby = []
    for spot in all_spots:
        if spot.latitude is None or spot.longitude is None:
            continue
            
        distance = haversine_distance(latitude, longitude, spot.latitude, spot.longitude)
        
        if distance <= radius_miles:
            within_geofence = distance <= visibility_radius
            
            # Privacy Shield: Only count photographers if within geofence
            active_count = 0
            if within_geofence:
                count_result = await db.execute(
                    select(func.count(Profile.id))
                    .where(Profile.current_spot_id == spot.id)
                    .where(Profile.is_shooting.is_(True))
                )
                active_count = count_result.scalar() or 0
            
            nearby.append({
                "id": str(spot.id),
                "name": spot.name,
                "region": spot.region,
                "city": spot.region,
                "country": spot.country,
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "distance_miles": round(distance, 2),
                "description": spot.description,
                "difficulty": spot.difficulty,
                "image_url": spot.image_url,
                "active_photographers_count": active_count,
                "is_within_geofence": within_geofence
            })
    
    # Sort by distance
    nearby.sort(key=lambda x: x["distance_miles"])
    
    return nearby


@router.get("/surf-spots/{spot_id}")
async def get_surf_spot(
    spot_id: str,
    user_lat: Optional[float] = Query(None),
    user_lon: Optional[float] = Query(None),
    user_id: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Get detailed spot info with Privacy Shield.
    Returns active_photographers list only if user is within geofence.
    """
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    # Calculate geofence
    visibility_radius = 1.0
    distance = None
    within_geofence = True
    
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            visibility_radius = get_visibility_radius(user.subscription_tier)
    
    if user_lat is not None and user_lon is not None:
        distance = haversine_distance(user_lat, user_lon, spot.latitude, spot.longitude)
        within_geofence = is_within_geofence(user_lat, user_lon, spot.latitude, spot.longitude, visibility_radius)
    
    # Privacy Shield: ALWAYS get photographer COUNT (for upsell "X Pros Shooting Now")
    # But photographer LIST and breathing_status only returned if within_geofence
    count_result = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.current_spot_id == spot.id)
        .where(Profile.is_shooting.is_(True))
    )
    active_count = count_result.scalar() or 0
    
    active_photographers = []
    live_conditions_report = None
    breathing_status = False
    open_bookings = []
    
    if within_geofence:
        # Get actual photographer list - only when in range
        photog_result = await db.execute(
            select(Profile)
            .where(Profile.current_spot_id == spot.id)
            .where(Profile.is_shooting.is_(True))
        )
        photographers = photog_result.scalars().all()
        
        for p in photographers:
            active_photographers.append({
                "id": p.id,
                "full_name": p.full_name,
                "avatar_url": p.avatar_url,
                "session_price": p.session_price,
                "is_streaming": p.is_streaming
            })
        
        # Only show live conditions and breathing status when in range
        breathing_status = active_count > 0
        live_conditions_report = spot.last_conditions_report if hasattr(spot, 'last_conditions_report') else None
        
        # Get open bookings at or near this spot
        # These are bookings with split_mode='open_nearby' that have open slots
        now = datetime.now(timezone.utc)
        booking_result = await db.execute(
            select(Booking)
            .where(
                and_(
                    Booking.split_mode == 'open_nearby',
                    Booking.status.in_(['Pending', 'Confirmed']),
                    Booking.session_date > now,
                    # Check if near this spot (within 5 miles of spot coordinates)
                    or_(
                        Booking.surf_spot_id == spot.id,  # Exact spot match
                        and_(
                            Booking.latitude.isnot(None),
                            Booking.longitude.isnot(None)
                        )  # Has coordinates - will filter by distance
                    )
                )
            )
            .options(selectinload(Booking.photographer), selectinload(Booking.participants))
            .order_by(Booking.session_date.asc())
            .limit(5)
        )
        bookings = booking_result.scalars().all()
        
        for booking in bookings:
            # If booking has coordinates, check distance
            if booking.latitude and booking.longitude:
                booking_distance = haversine_distance(
                    spot.latitude, spot.longitude,
                    booking.latitude, booking.longitude
                )
                if booking_distance > (booking.proximity_radius or 5.0):
                    continue  # Skip if too far from this spot
            
            # Check if there are open spots
            active_participants = len([p for p in booking.participants if p.status in ['pending', 'confirmed']])
            spots_left = booking.max_participants - active_participants
            
            if spots_left > 0:
                open_bookings.append({
                    "id": booking.id,
                    "photographer_name": booking.photographer.full_name if booking.photographer else None,
                    "photographer_avatar": booking.photographer.avatar_url if booking.photographer else None,
                    "location": booking.location,
                    "session_date": booking.session_date.isoformat(),
                    "price_per_person": booking.price_per_person,
                    "spots_left": spots_left,
                    "max_participants": booking.max_participants,
                    "invite_code": booking.invite_code
                })
    
    return {
        "id": spot.id,
        "name": spot.name,
        "region": spot.region,
        "latitude": spot.latitude,
        "longitude": spot.longitude,
        "description": spot.description,
        "difficulty": spot.difficulty,
        "best_tide": spot.best_tide,
        "best_swell": spot.best_swell,
        "image_url": spot.image_url,
        "is_active": spot.is_active,
        "country": spot.country,
        "state_province": spot.state_province,
        "wave_type": spot.wave_type,
        "active_photographers_count": active_count,  # ALWAYS returned for upsell
        "active_photographers": active_photographers if within_geofence else [],  # Empty list when out of range
        "live_conditions_report": live_conditions_report,  # null when out of range
        "breathing_status": breathing_status,  # false when out of range
        "is_within_geofence": within_geofence,
        "distance_miles": round(distance, 2) if distance is not None else None,
        "visibility_radius_miles": visibility_radius,
        "upgrade_required": not within_geofence,
        "open_bookings": open_bookings,  # Open-to-nearby bookings at this spot
        "open_bookings_count": len(open_bookings)  # Count for pin badge
    }


@router.get("/live-photographers", response_model=List[LivePhotographerResponse])
async def get_live_photographers(spot_id: Optional[str] = None, db: AsyncSession = Depends(get_db)):
    query = select(Profile).where(Profile.is_shooting.is_(True))
    if spot_id:
        query = query.where(Profile.current_spot_id == spot_id)
    
    result = await db.execute(query.options(selectinload(Profile.current_spot)))
    photographers = result.scalars().all()
    
    return [LivePhotographerResponse(
        id=p.id,
        full_name=p.full_name,
        avatar_url=p.avatar_url,
        is_shooting=p.is_shooting or False,
        is_streaming=p.is_streaming or False,
        current_spot_id=p.current_spot_id,
        current_spot_name=p.current_spot.name if p.current_spot else None,
        shooting_started_at=p.shooting_started_at,
        last_story_url=p.last_story_url,
        session_price=p.session_price,
        latitude=p.current_spot.latitude if p.current_spot else None,
        longitude=p.current_spot.longitude if p.current_spot else None,
        # Additional pricing fields for Jump In flow
        live_buyin_price=p.live_buyin_price,
        live_photo_price=p.live_photo_price,
        photo_package_size=p.photo_package_size,
        photo_price_standard=p.photo_price_standard,
        gallery_photo_price=p.photo_price_standard  # Use standard as gallery reference
    ) for p in photographers]

@router.post("/photographers/{profile_id}/go-live")
async def photographer_go_live(profile_id: str, data: GoLiveRequest, db: AsyncSession = Depends(get_db)):
    """Start a live shooting session with session-specific pricing"""
    from models import LiveSession  # Import LiveSession for creating session record
    import math
    
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    if profile.role not in photographer_roles:
        raise HTTPException(status_code=403, detail="Only photographers can go live")
    
    # ============ ROLE-BASED PERMISSION CHECK ============
    # Grom Parent: NO Live Sessions, NO On-Demand
    if is_grom_parent_eligible(profile):
        raise HTTPException(
            status_code=403, 
            detail="Grom Parents cannot start Live Sessions. Gallery and Bookings access only."
        )
    
    # Hobbyist: Can do Live Sessions ONLY if no other photographers are nearby (0.1 mile radius)
    if profile.role == RoleEnum.HOBBYIST and profile.on_demand_latitude and profile.on_demand_longitude:
        mile_threshold = 0.1  # 0.1 mile = ~528 feet
        lat_range = mile_threshold / 69.0
        lon_range = mile_threshold / (69.0 * math.cos(math.radians(profile.on_demand_latitude)))
        
        nearby_query = await db.execute(
            select(Profile).where(
                and_(
                    Profile.is_shooting.is_(True),
                    Profile.role.in_([RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]),
                    Profile.id != profile_id,
                    Profile.on_demand_latitude.isnot(None),
                    Profile.on_demand_longitude.isnot(None)
                )
            )
        )
        nearby_photographers = nearby_query.scalars().all()
        
        for nearby_pro in nearby_photographers:
            if nearby_pro.on_demand_latitude and nearby_pro.on_demand_longitude:
                lat_diff = abs(profile.on_demand_latitude - nearby_pro.on_demand_latitude)
                lon_diff = abs(profile.on_demand_longitude - nearby_pro.on_demand_longitude)
                
                if lat_diff <= lat_range and lon_diff <= lon_range:
                    raise HTTPException(
                        status_code=403,
                        detail="A Pro photographer is active within 0.1 miles of your location. Hobbyists can only go live when no Pro photographers are nearby."
                    )
    
    # Handle spot lookup
    spot = None
    spot_name = data.location or "Unknown Location"
    spot_id = data.spot_id
    
    if data.spot_id:
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == data.spot_id))
        spot = spot_result.scalar_one_or_none()
        if spot:
            spot_name = spot.name
        else:
            spot_id = None  # Invalid spot ID, clear it
    
    # Use resolution pricing from request, or fall back to profile defaults
    session_price_web = data.photo_price_web or profile.photo_price_web or 3.0
    session_price_standard = data.photo_price_standard or profile.photo_price_standard or 5.0
    session_price_high = data.photo_price_high or profile.photo_price_high or 10.0
    
    # Create LiveSession record with session-specific pricing
    live_session = LiveSession(
        photographer_id=profile_id,
        surf_spot_id=spot_id,
        location_name=spot_name,
        buyin_price=data.price_per_join,
        photo_price=profile.live_photo_price or 5.0,
        # Session-specific pricing (for Live Savings display)
        session_photo_price=data.live_photo_price or profile.live_photo_price or 5.0,
        photos_included=data.photos_included or 3,
        general_photo_price=data.general_photo_price or profile.photo_price_standard or 10.0,
        # Resolution-based pricing for this session
        session_price_web=session_price_web,
        session_price_standard=session_price_standard,
        session_price_high=session_price_high,
        max_surfers=data.max_surfers or 10,
        estimated_duration_hours=data.estimated_duration or 2,
        participant_count=0,
        total_earnings=0.0,
        started_at=datetime.now(timezone.utc),
        status='active'
    )
    db.add(live_session)
    await db.flush()
    
    # Update photographer profile
    profile.is_shooting = True
    profile.is_streaming = data.is_streaming
    profile.current_spot_id = spot_id
    profile.shooting_started_at = datetime.now(timezone.utc)
    profile.session_price = data.price_per_join
    
    await db.commit()
    await db.refresh(profile)
    
    # Calculate savings for response
    session_photo_price = live_session.session_photo_price or 5.0
    general_photo_price = live_session.general_photo_price or 10.0
    savings_per_photo = general_photo_price - session_photo_price
    
    return {
        "message": f"Now shooting at {spot_name}",
        "is_shooting": profile.is_shooting,
        "is_streaming": profile.is_streaming,
        "spot_name": spot_name,
        "started_at": profile.shooting_started_at.isoformat(),
        "live_session_id": live_session.id,
        "live_session_rates": {
            "buyin_price": live_session.buyin_price,
            "live_photo_price": session_photo_price,
            "photos_included": live_session.photos_included,
            "general_photo_price": general_photo_price,
            "savings_per_photo": savings_per_photo,
            "max_surfers": live_session.max_surfers,
            # Resolution pricing for surfer checkout
            "resolution_pricing": {
                "web": session_price_web,
                "standard": session_price_standard,
                "high": session_price_high
            }
        }
    }

@router.post("/photographers/{profile_id}/stop-live")
async def photographer_stop_live(profile_id: str, data: StopLiveRequest, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if profile.is_streaming and data.story_url:
        profile.last_story_url = data.story_url
    
    profile.is_shooting = False
    profile.is_streaming = False
    profile.current_spot_id = None
    profile.shooting_started_at = None
    
    await db.commit()
    
    return {"message": "Stopped shooting", "is_shooting": False}

@router.post("/photographers/{profile_id}/toggle-streaming")
async def toggle_streaming(profile_id: str, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(Profile).where(Profile.id == profile_id))
    profile = result.scalar_one_or_none()
    if not profile:
        raise HTTPException(status_code=404, detail="Profile not found")
    
    if not profile.is_shooting:
        raise HTTPException(status_code=400, detail="Must be shooting to toggle streaming")
    
    profile.is_streaming = not profile.is_streaming
    await db.commit()
    
    return {"is_streaming": profile.is_streaming}

@router.patch("/surf-spots/{spot_id}/image")
async def update_spot_image(spot_id: str, data: SpotImageUpdate, db: AsyncSession = Depends(get_db)):
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    spot.image_url = data.image_url
    await db.commit()
    
    return {"message": "Spot image updated", "spot_id": spot_id}

@router.post("/seed-florida-spots")
async def seed_florida_spots(db: AsyncSession = Depends(get_db)):
    # Accurate coastal coordinates for Florida surf spots (referenced from Surfline)
    florida_spots = [
        # Northeast Florida - Coordinates on the actual beach/ocean
        {"name": "Jacksonville Beach Pier", "region": "Northeast Florida", "latitude": 30.2950, "longitude": -81.3906, "difficulty": "Beginner-Intermediate", "description": "Consistent beach break near the pier"},
        {"name": "Atlantic Beach", "region": "Northeast Florida", "latitude": 30.3347, "longitude": -81.3963, "difficulty": "Beginner-Intermediate", "description": "Mellow waves, good for longboarding"},
        {"name": "St. Augustine Beach", "region": "Northeast Florida", "latitude": 29.8542, "longitude": -81.2680, "difficulty": "Beginner-Intermediate", "description": "Historic area with fun beach breaks"},
        
        # Central Florida - Prime surf zone
        {"name": "Sebastian Inlet", "region": "Central Florida", "latitude": 27.8603, "longitude": -80.4473, "difficulty": "Advanced", "description": "Florida's premier surf spot, powerful waves"},
        {"name": "Cocoa Beach Pier", "region": "Central Florida", "latitude": 28.3655, "longitude": -80.5995, "difficulty": "Beginner-Intermediate", "description": "Iconic pier with consistent waves"},
        {"name": "New Smyrna Beach Inlet", "region": "Central Florida", "latitude": 29.0288, "longitude": -80.8895, "difficulty": "Intermediate-Advanced", "description": "Quality waves, shark capital of the world"},
        {"name": "Ponce Inlet", "region": "Central Florida", "latitude": 29.0964, "longitude": -80.9370, "difficulty": "Intermediate", "description": "Jetty break with good shape"},
        {"name": "Playalinda Beach", "region": "Central Florida", "latitude": 28.6650, "longitude": -80.6130, "difficulty": "Intermediate", "description": "Natural beach near Kennedy Space Center"},
        
        # Treasure Coast
        {"name": "Fort Pierce Inlet", "region": "Treasure Coast", "latitude": 27.4750, "longitude": -80.2878, "difficulty": "Intermediate-Advanced", "description": "Reliable jetty break"},
        {"name": "Stuart Beach", "region": "Treasure Coast", "latitude": 27.1892, "longitude": -80.1567, "difficulty": "Beginner-Intermediate", "description": "Mellow beach break"},
        {"name": "Reef Road", "region": "Treasure Coast", "latitude": 26.7167, "longitude": -80.0300, "difficulty": "Advanced", "description": "Palm Beach's premier reef break"},
        
        # Southeast Florida
        {"name": "Jupiter Inlet", "region": "Southeast Florida", "latitude": 26.9456, "longitude": -80.0636, "difficulty": "Intermediate", "description": "Jetty waves with good shape"},
        {"name": "Lake Worth Pier", "region": "Southeast Florida", "latitude": 26.6145, "longitude": -80.0325, "difficulty": "Beginner-Intermediate", "description": "Consistent pier break"},
        {"name": "Deerfield Beach", "region": "Southeast Florida", "latitude": 26.3188, "longitude": -80.0695, "difficulty": "Beginner", "description": "Gentle waves, good for beginners"},
        {"name": "Pompano Beach Pier", "region": "Southeast Florida", "latitude": 26.2378, "longitude": -80.0805, "difficulty": "Beginner-Intermediate", "description": "Pier break with parking"},
        
        # Miami Area
        {"name": "South Beach", "region": "Miami", "latitude": 25.7835, "longitude": -80.1250, "difficulty": "Beginner", "description": "Small waves in the art deco district"},
        {"name": "Haulover Beach", "region": "Miami", "latitude": 25.9030, "longitude": -80.1180, "difficulty": "Beginner-Intermediate", "description": "Inlet provides better shape"},
    ]
    
    existing = await db.execute(select(func.count(SurfSpot.id)))
    if existing.scalar() > 0:
        return {"message": "Spots already seeded", "count": existing.scalar()}
    
    for spot_data in florida_spots:
        spot = SurfSpot(**spot_data)
        db.add(spot)
    
    await db.commit()
    return {"message": f"Seeded {len(florida_spots)} Florida surf spots"}

@router.post("/surf-spots/update-coordinates")
async def update_surf_spot_coordinates(db: AsyncSession = Depends(get_db)):
    """Update existing surf spots with corrected coastal coordinates"""
    # Corrected coordinates - positions spots on actual beaches, not inland
    coordinate_updates = {
        "Jacksonville Beach Pier": {"latitude": 30.2950, "longitude": -81.3906},
        "Atlantic Beach": {"latitude": 30.3347, "longitude": -81.3963},
        "St. Augustine Beach": {"latitude": 29.8542, "longitude": -81.2680},
        "Sebastian Inlet": {"latitude": 27.8603, "longitude": -80.4473},
        "Cocoa Beach Pier": {"latitude": 28.3655, "longitude": -80.5995},
        "New Smyrna Beach Inlet": {"latitude": 29.0288, "longitude": -80.8895},
        "Ponce Inlet": {"latitude": 29.0964, "longitude": -80.9370},
        "Playalinda Beach": {"latitude": 28.6650, "longitude": -80.6130},
        "Fort Pierce Inlet": {"latitude": 27.4750, "longitude": -80.2878},
        "Stuart Beach": {"latitude": 27.1892, "longitude": -80.1567},
        "Reef Road": {"latitude": 26.7167, "longitude": -80.0300},
        "Jupiter Inlet": {"latitude": 26.9456, "longitude": -80.0636},
        "Lake Worth Pier": {"latitude": 26.6145, "longitude": -80.0325},
        "Deerfield Beach": {"latitude": 26.3188, "longitude": -80.0695},
        "Pompano Beach Pier": {"latitude": 26.2378, "longitude": -80.0805},
        "South Beach": {"latitude": 25.7835, "longitude": -80.1250},
        "Haulover Beach": {"latitude": 25.9030, "longitude": -80.1180},
    }
    
    updated = 0
    for spot_name, coords in coordinate_updates.items():
        result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_name))
        spot = result.scalar_one_or_none()
        if spot:
            spot.latitude = coords["latitude"]
            spot.longitude = coords["longitude"]
            updated += 1
    
    await db.commit()
    return {"message": f"Updated coordinates for {updated} surf spots", "updated_count": updated}


@router.post("/surf-spots/seed-images")
async def seed_spot_images(db: AsyncSession = Depends(get_db)):
    spot_images = {
        "Jacksonville Beach Pier": "https://images.unsplash.com/photo-1507525428034-b723cf961d3e?w=800",
        "Atlantic Beach": "https://images.unsplash.com/photo-1505142468610-359e7d316be0?w=800",
        "St. Augustine Beach": "https://images.unsplash.com/photo-1520454974749-611b7248ffdb?w=800",
        "Sebastian Inlet": "https://images.unsplash.com/photo-1502680390469-be75c86b636f?w=800",
        "Cocoa Beach Pier": "https://images.unsplash.com/photo-1519046904884-53103b34b206?w=800",
        "New Smyrna Beach Inlet": "https://images.unsplash.com/photo-1455729552865-3658a5d39692?w=800",
        "Ponce Inlet": "https://images.unsplash.com/photo-1416949929422-a1d9c8fe84af?w=800",
        "Playalinda Beach": "https://images.unsplash.com/photo-1473496169904-658ba7c44d8a?w=800",
        "Fort Pierce Inlet": "https://images.unsplash.com/photo-1509914398892-963f53e6e2f1?w=800",
        "Stuart Beach": "https://images.unsplash.com/photo-1498837167922-ddd27525d352?w=800",
        "Reef Road": "https://images.unsplash.com/photo-1484291470158-b8f8d608850d?w=800",
        "Jupiter Inlet": "https://images.unsplash.com/photo-1471922694854-ff1b63b20054?w=800",
        "Lake Worth Pier": "https://images.unsplash.com/photo-1510414842594-a61c69b5ae57?w=800",
        "Deerfield Beach": "https://images.unsplash.com/photo-1535262412227-85541e910204?w=800",
        "Pompano Beach Pier": "https://images.unsplash.com/photo-1504681869696-d977211a5f4c?w=800",
        "South Beach": "https://images.unsplash.com/photo-1533106497176-45ae19e68ba2?w=800",
        "Haulover Beach": "https://images.unsplash.com/photo-1495954222046-2c427ecb546d?w=800",
    }
    
    updated = 0
    for spot_name, image_url in spot_images.items():
        result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_name))
        spot = result.scalar_one_or_none()
        if spot and not spot.image_url:
            spot.image_url = image_url
            updated += 1
    
    await db.commit()
    return {"message": f"Updated {updated} spot images"}


# ============ ADMIN: Simulate Live Photographers ============
@router.post("/admin/simulate-live", response_model=SimulateLiveResponse)
async def simulate_photographer_live(data: SimulateLiveRequest, db: AsyncSession = Depends(get_db)):
    """
    Admin endpoint to simulate a photographer going live or stopping.
    This bypasses the normal go-live flow for testing purposes.
    """
    # Get photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == data.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Get spot
    spot_result = await db.execute(
        select(SurfSpot).where(SurfSpot.id == data.spot_id)
    )
    spot = spot_result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    if data.is_live:
        # Start a shooting session (professional work, NOT social live)
        photographer.is_shooting = True
        # NOTE: is_live is for SOCIAL broadcasting only, not shooting sessions
        # photographer.is_live should remain unchanged
        photographer.shooting_started_at = datetime.now(timezone.utc)
        photographer.current_spot_id = spot.id
        photographer.location = spot.name
        photographer.session_price = data.session_price
        
        message = f"{photographer.full_name} is now shooting at {spot.name}"
    else:
        # Stop shooting session
        photographer.is_shooting = False
        # Don't touch is_live - that's separate from shooting
        photographer.shooting_started_at = None
        photographer.current_spot_id = None
        photographer.location = None
        photographer.session_price = None
        
        message = f"{photographer.full_name} has stopped shooting"
    
    await db.commit()
    await db.refresh(photographer)
    
    return SimulateLiveResponse(
        success=True,
        message=message,
        photographer_id=photographer.id,
        photographer_name=photographer.full_name,
        spot_name=spot.name if data.is_live else None,
        is_live=photographer.is_shooting or False
    )

@router.get("/admin/photographers")
async def get_all_photographers(db: AsyncSession = Depends(get_db)):
    """Get all photographers for admin panel"""
    photographer_roles = [RoleEnum.GROM_PARENT, RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO]
    
    result = await db.execute(
        select(Profile)
        .where(Profile.role.in_(photographer_roles))
        .options(selectinload(Profile.current_spot))
        .order_by(Profile.full_name)
    )
    photographers = result.scalars().all()
    
    return [{
        "id": p.id,
        "full_name": p.full_name,
        "email": p.email,
        "role": p.role.value if p.role else None,
        "avatar_url": p.avatar_url,
        "is_shooting": p.is_shooting or False,
        "current_spot_id": p.current_spot_id,
        "current_spot_name": p.current_spot.name if p.current_spot else None,
        "session_price": p.session_price,
        "shooting_started_at": p.shooting_started_at.isoformat() if p.shooting_started_at else None
    } for p in photographers]


# ============ ADMIN: Force Start/End Live Session ============
@router.post("/admin/force-start-session")
async def admin_force_start_session(data: ForceStartSessionRequest, db: AsyncSession = Depends(get_db)):
    """
    Admin endpoint to force-start a live session for a photographer.
    Creates a real LiveSession record that behaves exactly like a user-initiated session.
    """
    # Get photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == data.photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Check if already shooting
    if photographer.is_shooting:
        raise HTTPException(status_code=400, detail=f"{photographer.full_name} is already in a live session")
    
    # Get spot
    spot_result = await db.execute(
        select(SurfSpot).where(SurfSpot.id == data.spot_id)
    )
    spot = spot_result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Surf spot not found")
    
    # Create LiveSession record (exactly like normal go-live flow)
    live_session = LiveSession(
        photographer_id=data.photographer_id,
        surf_spot_id=spot.id,
        location_name=spot.name,
        buyin_price=data.session_price,
        photo_price=5.0,
        session_photo_price=5.0,
        photos_included=3,
        general_photo_price=10.0,
        max_surfers=10,
        estimated_duration_hours=2,
        participant_count=0,
        total_earnings=0.0,
        started_at=datetime.now(timezone.utc),
        status='active'
    )
    db.add(live_session)
    await db.flush()
    
    # Update photographer status - SHOOTING only, not social live
    photographer.is_shooting = True
    # NOTE: is_live is for SOCIAL broadcasting only, don't set it here
    photographer.shooting_started_at = datetime.now(timezone.utc)
    photographer.current_spot_id = spot.id
    photographer.location = spot.name
    photographer.session_price = data.session_price
    
    await db.commit()
    await db.refresh(photographer)
    await db.refresh(live_session)
    
    return {
        "success": True,
        "message": f"🔴 FORCE STARTED: {photographer.full_name} is now LIVE at {spot.name}",
        "photographer_id": photographer.id,
        "photographer_name": photographer.full_name,
        "spot_name": spot.name,
        "is_live": True,
        "live_session_id": live_session.id,
        "started_at": photographer.shooting_started_at.isoformat()
    }

@router.post("/admin/force-end-session/{photographer_id}")
async def admin_force_end_session(photographer_id: str, db: AsyncSession = Depends(get_db)):
    """
    Admin endpoint to force-end a live session for a photographer.
    Properly closes the LiveSession record and removes from map.
    """
    # Get photographer
    photographer_result = await db.execute(
        select(Profile).where(Profile.id == photographer_id)
    )
    photographer = photographer_result.scalar_one_or_none()
    
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    spot_name = photographer.location or "Unknown"
    
    # Find and close ALL active LiveSessions for this photographer (cleanup stale records)
    session_result = await db.execute(
        select(LiveSession)
        .where(LiveSession.photographer_id == photographer_id)
        .where(LiveSession.status == 'active')
    )
    live_sessions = session_result.scalars().all()
    
    for session in live_sessions:
        session.status = 'completed'
        session.ended_at = datetime.now(timezone.utc)
    
    # Update photographer status regardless of current state
    photographer.is_shooting = False
    photographer.is_live = False
    photographer.shooting_started_at = None
    photographer.current_spot_id = None
    photographer.location = None
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"⏹️ FORCE ENDED: {photographer.full_name}'s session at {spot_name}",
        "photographer_id": photographer.id,
        "photographer_name": photographer.full_name,
        "is_live": False,
        "sessions_closed": len(live_sessions)
    }

@router.get("/admin/active-sessions")
async def get_admin_active_sessions(db: AsyncSession = Depends(get_db)):
    """Get all active live sessions for admin panel - only shows sessions where photographer is actually shooting"""
    # Get photographers who are actually shooting
    shooting_result = await db.execute(
        select(Profile)
        .where(Profile.is_shooting.is_(True))
        .options(selectinload(Profile.current_spot))
    )
    shooting_photographers = shooting_result.scalars().all()
    
    sessions = []
    for p in shooting_photographers:
        # Try to find the active LiveSession
        session_result = await db.execute(
            select(LiveSession)
            .where(LiveSession.photographer_id == p.id)
            .where(LiveSession.status == 'active')
            .order_by(LiveSession.started_at.desc())
            .limit(1)
        )
        live_session = session_result.scalar_one_or_none()
        
        sessions.append({
            "id": live_session.id if live_session else p.id,
            "photographer_id": p.id,
            "photographer_name": p.full_name,
            "photographer_avatar": p.avatar_url,
            "spot_id": p.current_spot_id,
            "spot_name": p.location or (p.current_spot.name if p.current_spot else "Unknown"),
            "started_at": p.shooting_started_at.isoformat() if p.shooting_started_at else None,
            "participant_count": live_session.participant_count if live_session else 0,
            "total_earnings": float(live_session.total_earnings or 0) if live_session else 0,
            "buyin_price": float(p.session_price or 25)
        })
    
    return sessions


@router.post("/admin/cleanup-stale-sessions")
async def cleanup_stale_sessions(db: AsyncSession = Depends(get_db)):
    """
    Admin endpoint to cleanup stale LiveSession records.
    Closes all 'active' sessions where the photographer is not actually shooting.
    """
    # Get all active sessions
    result = await db.execute(
        select(LiveSession)
        .where(LiveSession.status == 'active')
        .options(selectinload(LiveSession.photographer))
    )
    active_sessions = result.scalars().all()
    
    closed_count = 0
    for session in active_sessions:
        # Check if photographer is actually shooting
        if not session.photographer or not session.photographer.is_shooting:
            session.status = 'completed'
            session.ended_at = datetime.now(timezone.utc)
            closed_count += 1
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Cleaned up {closed_count} stale sessions",
        "closed_count": closed_count
    }



# ============================================================
# ADMIN SPOT MANAGEMENT
# ============================================================

@router.get("/admin/spots/stats")
async def get_spot_stats(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get global spot statistics for admin dashboard."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Total spots
    total_result = await db.execute(select(func.count(SurfSpot.id)))
    total = total_result.scalar()
    
    # By country
    country_result = await db.execute(
        select(SurfSpot.country, func.count(SurfSpot.id))
        .group_by(SurfSpot.country)
        .order_by(func.count(SurfSpot.id).desc())
    )
    by_country = [{"country": c or "Unknown", "count": cnt} for c, cnt in country_result.all()]
    
    # By tier
    tier_result = await db.execute(
        select(SurfSpot.import_tier, func.count(SurfSpot.id))
        .group_by(SurfSpot.import_tier)
    )
    by_tier = {f"tier_{t or 1}": cnt for t, cnt in tier_result.all()}
    
    return {
        "total_spots": total,
        "by_country": by_country,
        "by_tier": by_tier
    }


@router.post("/admin/spots/import")
async def trigger_spot_import(
    admin_id: str,
    tier: int = Query(default=0, description="Import tier: 0=all, 1=East Coast, 2=West Coast/Islands, 3=Global"),
    include_osm: bool = Query(default=False, description="Include OSM Overpass data"),
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger import of surf spots for a specific tier.
    - Tier 0: Import all curated spots
    - Tier 1: East Coast USA
    - Tier 2: West Coast, Hawaii, Puerto Rico  
    - Tier 3: Global (Australia, Indonesia, Europe, etc.)
    - include_osm: Also fetch from OSM Overpass API (slower)
    """
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from scripts.import_global_spots import import_curated_spots, import_osm_spots, CURATED_SPOTS
    
    # Filter curated spots by tier if specified
    if tier > 0:
        # Filter the CURATED_SPOTS by tier before importing
        original_spots = CURATED_SPOTS.copy()
        filtered_spots = [s for s in CURATED_SPOTS if s.get("tier") == tier]
        
        # Temporarily replace and restore
        import scripts.import_global_spots as import_module
        import_module.CURATED_SPOTS = filtered_spots
        curated_count = await import_curated_spots(db)
        import_module.CURATED_SPOTS = original_spots
    else:
        curated_count = await import_curated_spots(db)
    
    osm_count = 0
    if include_osm and tier > 0:
        osm_count = await import_osm_spots(db, tier)
    
    total = curated_count + osm_count
    
    tier_names = {0: "All", 1: "East Coast USA", 2: "West Coast & Islands", 3: "Global"}
    
    return {
        "success": True,
        "imported_curated": curated_count,
        "imported_osm": osm_count,
        "total_imported": total,
        "tier": tier,
        "tier_name": tier_names.get(tier, f"Tier {tier}"),
        "message": f"Imported {total} spots for {tier_names.get(tier, f'Tier {tier}')}"
    }


class CreateSpotRequest(BaseModel):
    name: str
    country: Optional[str] = None
    state_province: Optional[str] = None
    region: Optional[str] = None
    wave_type: Optional[str] = None
    latitude: float
    longitude: float
    difficulty: Optional[str] = None
    override_land_warning: Optional[bool] = False

@router.post("/admin/spots/create")
async def create_spot(
    data: CreateSpotRequest,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Create a new surf spot (admin only)."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Create spot
    spot = SurfSpot(
        name=data.name,
        country=data.country,
        state_province=data.state_province,
        region=data.region,
        wave_type=data.wave_type,
        latitude=data.latitude,
        longitude=data.longitude,
        difficulty=data.difficulty,
        is_active=True,
        is_verified_peak=True,
        accuracy_flag='verified',
        verified_by=admin_id,
        verified_at=datetime.now(timezone.utc)
    )
    
    db.add(spot)
    await db.commit()
    await db.refresh(spot)
    
    return {"success": True, "message": f"Created spot: {spot.name}", "spot_id": spot.id}


@router.put("/admin/spots/{spot_id}")
async def update_spot(
    spot_id: str,
    admin_id: str,
    name: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    region: Optional[str] = None,
    wave_type: Optional[str] = None,
    latitude: Optional[float] = None,
    longitude: Optional[float] = None,
    is_active: Optional[bool] = None,
    is_verified_peak: Optional[bool] = None,
    db: AsyncSession = Depends(get_db)
):
    """Update a surf spot (admin only)."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates if being modified for the first time
    if (latitude is not None or longitude is not None) and not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Update fields
    if name is not None:
        spot.name = name
    if country is not None:
        spot.country = country
    if state_province is not None:
        spot.state_province = state_province
    if region is not None:
        spot.region = region
    if wave_type is not None:
        spot.wave_type = wave_type
    if latitude is not None:
        spot.latitude = latitude
    if longitude is not None:
        spot.longitude = longitude
    if is_active is not None:
        spot.is_active = is_active
    if is_verified_peak is not None:
        spot.is_verified_peak = is_verified_peak
        if is_verified_peak:
            spot.accuracy_flag = 'verified'
            spot.verified_by = admin_id
            spot.verified_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {"success": True, "message": f"Updated spot: {spot.name}"}


@router.delete("/admin/spots/{spot_id}")
async def delete_spot(
    spot_id: str,
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Delete a surf spot (admin only)."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    await db.delete(spot)
    await db.commit()
    
    return {"success": True, "message": f"Deleted spot: {spot.name}"}



# ============================================================
# PHOTOGRAPHER SPOT REFINEMENT (Crowdsourced)
# ============================================================

@router.post("/spots/{spot_id}/refine-location")
async def refine_spot_location(
    spot_id: str,
    photographer_id: str,
    new_latitude: float,
    new_longitude: float,
    db: AsyncSession = Depends(get_db)
):
    """
    Photographer submits a location refinement for a spot.
    If 3+ verified photographers agree, queues for admin approval.
    """
    # Verify photographer exists and is a valid role
    result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    if photographer.role not in [RoleEnum.HOBBYIST, RoleEnum.PHOTOGRAPHER, RoleEnum.APPROVED_PRO, RoleEnum.ADMIN]:
        raise HTTPException(status_code=403, detail="Only photographers can refine spot locations")
    
    # Verify spot exists
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Check if this photographer already refined this spot
    existing = await db.execute(
        select(SpotRefinement).where(
            SpotRefinement.spot_id == spot_id,
            SpotRefinement.photographer_id == photographer_id,
            SpotRefinement.status == 'pending'
        )
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="You already have a pending refinement for this spot")
    
    # Create refinement
    refinement = SpotRefinement(
        spot_id=spot_id,
        photographer_id=photographer_id,
        proposed_latitude=new_latitude,
        proposed_longitude=new_longitude,
        status='pending'
    )
    db.add(refinement)
    
    # Update spot refinement count
    spot.refinement_count = (spot.refinement_count or 0) + 1
    spot.last_refined_at = datetime.now(timezone.utc)
    
    # Check if 3+ photographers have proposed similar coordinates (within 50m)
    similar_refinements = await db.execute(
        select(SpotRefinement).where(
            SpotRefinement.spot_id == spot_id,
            SpotRefinement.status == 'pending'
        )
    )
    pending = similar_refinements.scalars().all()
    
    # Group refinements that are within 50m of each other
    THRESHOLD_METERS = 50
    for ref in pending:
        distance = haversine_distance(
            new_latitude, new_longitude,
            ref.proposed_latitude, ref.proposed_longitude
        ) * 1609.34  # Convert miles to meters
        
        if distance <= THRESHOLD_METERS:
            # Found similar refinement
            similar_count = 1
            for other_ref in pending:
                if other_ref.id != ref.id:
                    other_dist = haversine_distance(
                        ref.proposed_latitude, ref.proposed_longitude,
                        other_ref.proposed_latitude, other_ref.proposed_longitude
                    ) * 1609.34
                    if other_dist <= THRESHOLD_METERS:
                        similar_count += 1
            
            if similar_count >= 3:
                # Mark spot for crowdsourced update
                spot.accuracy_flag = 'crowdsourced_pending'
                logger.info(f"Spot {spot_id} has 3+ similar refinements, queued for admin review")
    
    await db.commit()
    
    return {
        "success": True,
        "message": "Location refinement submitted",
        "refinement_count": spot.refinement_count
    }


@router.get("/admin/spots/refinement-queue")
async def get_refinement_queue(
    admin_id: str,
    db: AsyncSession = Depends(get_db)
):
    """Get spots with pending refinements for admin review."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get spots with crowdsourced_pending flag or pending refinements
    result = await db.execute(
        select(SurfSpot).where(
            or_(
                SurfSpot.accuracy_flag == 'crowdsourced_pending',
                SurfSpot.refinement_count >= 3
            )
        )
    )
    spots = result.scalars().all()
    
    queue = []
    for spot in spots:
        # Get pending refinements for this spot
        ref_result = await db.execute(
            select(SpotRefinement).where(
                SpotRefinement.spot_id == spot.id,
                SpotRefinement.status == 'pending'
            )
        )
        refinements = ref_result.scalars().all()
        
        queue.append({
            "spot_id": spot.id,
            "spot_name": spot.name,
            "current_lat": spot.latitude,
            "current_lon": spot.longitude,
            "accuracy_flag": spot.accuracy_flag,
            "refinement_count": spot.refinement_count,
            "pending_refinements": [
                {
                    "id": r.id,
                    "proposed_lat": r.proposed_latitude,
                    "proposed_lon": r.proposed_longitude,
                    "photographer_id": r.photographer_id,
                    "created_at": r.created_at.isoformat()
                }
                for r in refinements
            ]
        })
    
    return {"queue": queue, "count": len(queue)}


@router.post("/admin/spots/{spot_id}/apply-refinement")
async def apply_spot_refinement(
    spot_id: str,
    admin_id: str,
    new_latitude: float,
    new_longitude: float,
    db: AsyncSession = Depends(get_db)
):
    """Admin applies a refinement to update spot location."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates
    if not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Apply new coordinates
    spot.latitude = new_latitude
    spot.longitude = new_longitude
    spot.is_verified_peak = True
    spot.accuracy_flag = 'verified'
    spot.verified_by = admin_id
    spot.verified_at = datetime.now(timezone.utc)
    
    # Clear pending refinements
    await db.execute(
        SpotRefinement.__table__.update()
        .where(SpotRefinement.spot_id == spot_id)
        .values(status='approved', reviewed_at=datetime.now(timezone.utc), reviewed_by=admin_id)
    )
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Spot {spot.name} updated and verified",
        "new_coordinates": {"lat": new_latitude, "lon": new_longitude}
    }


@router.post("/admin/spots/{spot_id}/offset-seaward")
async def offset_spot_seaward(
    spot_id: str,
    admin_id: str,
    offset_meters: float = 100,
    db: AsyncSession = Depends(get_db)
):
    """Automatically offset a spot seaward using the coastline algorithm."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    # Get spot
    result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Store original coordinates
    if not spot.original_latitude:
        spot.original_latitude = spot.latitude
        spot.original_longitude = spot.longitude
    
    # Calculate seaward offset
    new_lat, new_lon = calculate_seaward_offset(spot.latitude, spot.longitude, offset_meters)
    
    # Apply offset
    spot.latitude = new_lat
    spot.longitude = new_lon
    spot.accuracy_flag = 'offset_adjusted'
    spot.verified_by = admin_id
    spot.verified_at = datetime.now(timezone.utc)
    
    await db.commit()
    
    return {
        "success": True,
        "message": f"Spot offset {offset_meters}m seaward",
        "original": {"lat": spot.original_latitude, "lon": spot.original_longitude},
        "new": {"lat": new_lat, "lon": new_lon}
    }



# ============================================================
# SPOT OF THE DAY - SOCIAL DISCOVERY ENGINE
# ============================================================

@router.get("/spot-of-the-day")
async def get_spot_of_the_day(
    region: Optional[str] = None,
    user_lat: Optional[float] = None,
    user_lon: Optional[float] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get the Spot of the Day for a region or nearby location.
    Returns the best spot based on:
    - Epic/Good conditions reported by photographers
    - High photographer activity
    - Trending/popular spots
    """
    today = date.today()
    
    # Try to find existing spot of the day
    query = select(SpotOfTheDay).where(SpotOfTheDay.date == today)
    if region:
        query = query.where(SpotOfTheDay.region == region)
    
    result = await db.execute(query.order_by(SpotOfTheDay.created_at.desc()))
    sotd = result.scalar_one_or_none()
    
    if sotd:
        # Get full spot details
        spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == sotd.spot_id))
        spot = spot_result.scalar_one_or_none()
        
        photographer = None
        if sotd.featured_photographer_id:
            p_result = await db.execute(select(Profile).where(Profile.id == sotd.featured_photographer_id))
            photographer = p_result.scalar_one_or_none()
        
        return {
            "has_spot_of_the_day": True,
            "spot": {
                "id": spot.id,
                "name": spot.name,
                "region": spot.region,
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "wave_type": spot.wave_type
            } if spot else None,
            "reason": sotd.reason,
            "rating": sotd.rating,
            "featured_photo_url": sotd.featured_photo_url,
            "featured_photographer": {
                "id": photographer.id,
                "full_name": photographer.full_name,
                "avatar_url": photographer.avatar_url
            } if photographer else None,
            "active_photographers": sotd.active_photographers,
            "wave_height": sotd.wave_height,
            "wind_conditions": sotd.wind_conditions,
            "expires_at": sotd.expires_at.isoformat() if sotd.expires_at else None
        }
    
    # No spot of the day set - calculate one based on activity
    # Find spot with most active photographers in the region
    query = (
        select(SurfSpot, func.count(Profile.id).label('photographer_count'))
        .outerjoin(Profile, and_(Profile.current_spot_id == SurfSpot.id, Profile.is_shooting.is_(True)))
        .group_by(SurfSpot.id)
        .order_by(func.count(Profile.id).desc())
        .limit(1)
    )
    
    if region:
        query = query.where(SurfSpot.region == region)
    
    result = await db.execute(query)
    row = result.first()
    
    if row:
        spot, count = row
        return {
            "has_spot_of_the_day": count > 0,
            "spot": {
                "id": spot.id,
                "name": spot.name,
                "region": spot.region,
                "latitude": spot.latitude,
                "longitude": spot.longitude,
                "wave_type": spot.wave_type
            },
            "reason": "high_activity" if count > 0 else "default",
            "rating": None,
            "featured_photo_url": None,
            "featured_photographer": None,
            "active_photographers": count,
            "wave_height": None,
            "wind_conditions": None,
            "expires_at": None,
            "is_calculated": True  # Not manually set
        }
    
    return {"has_spot_of_the_day": False}


@router.post("/spot-of-the-day/trigger")
async def trigger_spot_of_the_day(
    spot_id: str,
    photographer_id: str,
    rating: str = Query(..., description="FLAT, POOR, FAIR, GOOD, or EPIC"),
    photo_url: Optional[str] = None,
    wave_height: Optional[str] = None,
    wind_conditions: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Trigger a Spot of the Day based on photographer activity.
    Called when a photographer uploads a high-rating conditions photo.
    """
    # Validate spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Validate photographer
    photog_result = await db.execute(select(Profile).where(Profile.id == photographer_id))
    photographer = photog_result.scalar_one_or_none()
    if not photographer:
        raise HTTPException(status_code=404, detail="Photographer not found")
    
    # Only trigger for GOOD or EPIC ratings
    valid_ratings = ['GOOD', 'GOOD_TO_EPIC', 'EPIC']
    if rating.upper() not in valid_ratings:
        return {
            "triggered": False,
            "reason": f"Rating must be one of {valid_ratings} to trigger Spot of the Day"
        }
    
    today = date.today()
    
    # Check if already exists for this region today
    existing = await db.execute(
        select(SpotOfTheDay).where(
            SpotOfTheDay.region == spot.region,
            SpotOfTheDay.date == today
        )
    )
    if existing.scalar_one_or_none():
        return {
            "triggered": False,
            "reason": "Spot of the Day already set for this region today"
        }
    
    # Count active photographers at this spot
    count_result = await db.execute(
        select(func.count(Profile.id))
        .where(Profile.current_spot_id == spot_id)
        .where(Profile.is_shooting.is_(True))
    )
    active_count = count_result.scalar() or 0
    
    # Create Spot of the Day
    sotd = SpotOfTheDay(
        spot_id=spot_id,
        region=spot.region,
        date=today,
        reason='epic_conditions' if rating.upper() == 'EPIC' else 'good_conditions',
        rating=rating.upper(),
        featured_photo_url=photo_url,
        featured_photographer_id=photographer_id,
        active_photographers=active_count,
        wave_height=wave_height,
        wind_conditions=wind_conditions,
        expires_at=datetime.now(timezone.utc).replace(hour=23, minute=59, second=59)
    )
    
    db.add(sotd)
    await db.commit()
    
    logger.info(f"Spot of the Day triggered: {spot.name} ({spot.region}) - {rating}")
    
    return {
        "triggered": True,
        "spot_of_the_day": {
            "spot_name": spot.name,
            "region": spot.region,
            "rating": rating.upper(),
            "featured_photographer": photographer.full_name,
            "expires_at": sotd.expires_at.isoformat()
        }
    }


@router.get("/admin/spot-of-the-day/history")
async def get_spot_of_the_day_history(
    admin_id: str,
    days: int = 30,
    db: AsyncSession = Depends(get_db)
):
    """Get Spot of the Day history for admin review."""
    # Verify admin
    result = await db.execute(select(Profile).where(Profile.id == admin_id))
    admin = result.scalar_one_or_none()
    if not admin or not admin.is_admin:
        raise HTTPException(status_code=403, detail="Admin access required")
    
    from_date = date.today() - datetime.timedelta(days=days)
    
    result = await db.execute(
        select(SpotOfTheDay)
        .where(SpotOfTheDay.date >= from_date)
        .order_by(SpotOfTheDay.date.desc())
    )
    history = result.scalars().all()
    
    return {
        "history": [
            {
                "date": s.date.isoformat(),
                "region": s.region,
                "spot_id": s.spot_id,
                "reason": s.reason,
                "rating": s.rating,
                "active_photographers": s.active_photographers
            }
            for s in history
        ]
    }


# ============================================================
# SURF CONDITIONS AUTO-FETCH
# ============================================================

@router.get("/surf-conditions")
async def get_surf_conditions(
    latitude: Optional[float] = Query(None),
    longitude: Optional[float] = Query(None),
    spot_id: Optional[str] = Query(None),
    spot_name: Optional[str] = Query(None),
    db: AsyncSession = Depends(get_db)
):
    """
    Auto-fetch surf conditions from Open-Meteo Marine API + NOAA Tides
    
    Provide either:
    - latitude & longitude: Direct coordinates
    - spot_id: Get coordinates from database spot
    - spot_name: Try to match known spot by name
    """
    from services.surf_conditions import (
        get_full_conditions, 
        get_conditions_for_spot,
        SPOT_COORDINATES
    )
    
    noaa_station = None
    
    # If spot_id provided, get coordinates from database
    if spot_id:
        result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
        spot = result.scalar_one_or_none()
        if spot and spot.latitude and spot.longitude:
            latitude = spot.latitude
            longitude = spot.longitude
            spot_name = spot.name
    
    # If spot_name matches a known spot, get NOAA station
    if spot_name:
        normalized = spot_name.lower().replace(" ", "_").replace("-", "_").replace(",", "")
        for key, info in SPOT_COORDINATES.items():
            if key in normalized or normalized in key or info["name"].lower() in spot_name.lower():
                noaa_station = info.get("noaa_station")
                break
    
    # If we have coordinates, fetch conditions
    if latitude is not None and longitude is not None:
        conditions = await get_full_conditions(latitude, longitude, spot_name, noaa_station)
        return conditions
    
    # If spot_name provided, try to match known spot
    if spot_name:
        conditions = await get_conditions_for_spot(spot_name)
        return conditions
    
    raise HTTPException(
        status_code=400, 
        detail="Provide either latitude/longitude, spot_id, or spot_name"
    )


@router.get("/surf-conditions/known-spots")
async def get_known_spots():
    """Get list of spots with known coordinates for auto-conditions"""
    from services.surf_conditions import SPOT_COORDINATES
    
    return {
        "spots": [
            {
                "key": key,
                "name": info["name"],
                "lat": info["lat"],
                "lon": info["lon"]
            }
            for key, info in SPOT_COORDINATES.items()
        ]
    }


# ============ LIVE SHOOTING PULSE - Spot Hub Integration ============


class LiveShootingPulseResponse(BaseModel):
    spot_id: str
    has_live_photographers: bool
    live_photographers: List[dict]
    total_live: int


@router.get("/surf-spots/{spot_id}/live-shooting-pulse")
async def get_spot_live_shooting_pulse(
    spot_id: str,
    viewer_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """
    Get live shooting photographers at a specific spot.
    
    Permission-based visibility:
    - Only users who have subscribed to live alerts for this photographer
    - OR users who are within 2 miles of the spot
    - OR users who follow the photographer
    - Returns empty if viewer has no permission to see pulse
    """
    from models import PhotographerAlertSubscription, Follow
    
    # Get the spot
    spot_result = await db.execute(select(SurfSpot).where(SurfSpot.id == spot_id))
    spot = spot_result.scalar_one_or_none()
    
    if not spot:
        raise HTTPException(status_code=404, detail="Spot not found")
    
    # Get active live sessions at this spot with photographer info
    active_sessions_result = await db.execute(
        select(LiveSession)
        .where(
            and_(
                LiveSession.status == 'active',
                LiveSession.surf_spot_id == spot_id
            )
        )
        .options(selectinload(LiveSession.photographer))
    )
    active_sessions = list(active_sessions_result.scalars().all())
    
    # Permission check: determine which photographers the viewer can see
    visible_sessions = []
    
    for session in active_sessions:
        photographer = session.photographer
        if not photographer:
            continue
        
        can_see = False
        
        # Check 1: Approved Pro is always visible (even to anonymous)
        if photographer.role == RoleEnum.APPROVED_PRO:
            can_see = True
        
        # For authenticated viewers, check more permissions
        if not can_see and viewer_id:
            # Check 2: Is viewer subscribed to live alerts from this photographer?
            sub_result = await db.execute(
                select(PhotographerAlertSubscription).where(
                    PhotographerAlertSubscription.user_id == viewer_id,
                    PhotographerAlertSubscription.photographer_id == photographer.id,
                    PhotographerAlertSubscription.alert_type == 'live_shooting',
                    PhotographerAlertSubscription.is_active == True
                )
            )
            if sub_result.scalar_one_or_none():
                can_see = True
            
            # Check 3: Does viewer follow this photographer?
            if not can_see:
                follow_result = await db.execute(
                    select(Follow).where(
                        Follow.follower_id == viewer_id,
                        Follow.following_id == photographer.id
                    )
                )
                if follow_result.scalar_one_or_none():
                    can_see = True
            
            # Check 4: Is viewer within 2 miles of the spot?
            if not can_see:
                viewer_result = await db.execute(select(Profile).where(Profile.id == viewer_id))
                viewer = viewer_result.scalar_one_or_none()
                if viewer and hasattr(viewer, 'on_demand_latitude') and viewer.on_demand_latitude:
                    if spot.latitude and spot.longitude:
                        lat_diff = abs(viewer.on_demand_latitude - spot.latitude)
                        lon_diff = abs(viewer.on_demand_longitude - spot.longitude)
                        if lat_diff < 0.03 and lon_diff < 0.03:  # ~2 miles
                            can_see = True
        
        if can_see:
            visible_sessions.append(session)
    
    # Build response
    live_data = []
    for session in visible_sessions:
        p = session.photographer
        if not p:
            continue
            
        live_data.append({
            "photographer_id": p.id,
            "photographer_name": p.full_name,
            "avatar_url": p.avatar_url,
            "role": p.role.value if p.role else "Photographer",
            "is_approved_pro": p.role == RoleEnum.APPROVED_PRO,
            "session_id": session.id,
            "started_at": session.started_at.isoformat() if session.started_at else None,
            "photo_count": session.photo_count or 0,
            "participant_count": session.participant_count or 0,
            "session_pricing": {
                "web": session.session_price_web or p.photo_price_web,
                "standard": session.session_price_standard or p.photo_price_standard,
                "high": session.session_price_high or p.photo_price_high
            }
        })
    
    return {
        "spot_id": spot_id,
        "spot_name": spot.name,
        "has_live_photographers": len(live_data) > 0,
        "live_photographers": live_data,
        "total_live": len(live_data),
        "pulse_active": len(live_data) > 0  # For frontend animation trigger
    }
