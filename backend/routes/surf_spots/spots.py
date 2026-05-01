"""
Surf spots core — list, locations hierarchy, nearby, and spot detail endpoints.
"""
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, func, and_, or_
from sqlalchemy.orm import selectinload
from typing import List, Optional
from datetime import datetime, timezone
import logging

from database import get_db
from models import Profile, SurfSpot, Booking
from core.security import get_optional_user_id_from_jwt_or_query
from utils.geo import haversine_distance
from .schemas import SurfSpotResponse, get_visibility_radius, is_within_geofence

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/surf-spots", response_model=List[SurfSpotResponse])
async def get_surf_spots(
    region: Optional[str] = None,
    country: Optional[str] = None,
    state_province: Optional[str] = None,
    user_lat: Optional[float] = Query(None, description="User latitude for geofencing"),
    user_lon: Optional[float] = Query(None, description="User longitude for geofencing"),
    user_id: Optional[str] = Depends(get_optional_user_id_from_jwt_or_query),
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
    
    if region:
        query = query.where(SurfSpot.region == region)
    if country:
        query = query.where(SurfSpot.country == country)
    if state_province:
        query = query.where(SurfSpot.state_province == state_province)
    
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
    visibility_radius = 1.0
    if user_id:
        user_result = await db.execute(select(Profile).where(Profile.id == user_id))
        user = user_result.scalar_one_or_none()
        if user:
            visibility_radius = get_visibility_radius(user.subscription_tier)
    
    # OPTIMIZATION: Batch query for active photographer counts (fixes N+1 query problem)
    active_counts_query = await db.execute(
        select(Profile.current_spot_id, func.count(Profile.id).label('count'))
        .where(Profile.is_shooting.is_(True))
        .where(Profile.current_spot_id.isnot(None))
        .group_by(Profile.current_spot_id)
    )
    active_counts = {str(row[0]): row[1] for row in active_counts_query.fetchall()}
    
    spot_responses = []
    for spot in spots:
        distance = None
        within_geofence = True
        
        if user_lat is not None and user_lon is not None:
            distance = haversine_distance(user_lat, user_lon, spot.latitude, spot.longitude)
            within_geofence = is_within_geofence(user_lat, user_lon, spot.latitude, spot.longitude, visibility_radius)
        
        active_count = active_counts.get(str(spot.id), 0)
        
        spot_responses.append(SurfSpotResponse(
            id=spot.id, name=spot.name, region=spot.region,
            latitude=spot.latitude, longitude=spot.longitude,
            description=spot.description, difficulty=spot.difficulty,
            best_tide=spot.best_tide, best_swell=spot.best_swell,
            image_url=spot.image_url, is_active=spot.is_active,
            active_photographers_count=active_count,
            country=spot.country, state_province=spot.state_province,
            wave_type=spot.wave_type, is_within_geofence=within_geofence,
            distance_miles=round(distance, 2) if distance is not None else None
        ))
    
    return spot_responses


@router.get("/surf-spots/locations")
async def get_surf_spot_locations(db: AsyncSession = Depends(get_db)):
    """
    Get unique countries, states/provinces, and city/area regions for location filtering.
    Returns a three-level hierarchical structure: Country → State/Province → City/Area.
    """
    # Get unique countries with count + avg coordinates for map thumbnails
    countries_query = await db.execute(
        select(
            SurfSpot.country,
            func.count(SurfSpot.id).label('spot_count'),
            func.avg(SurfSpot.latitude).label('avg_lat'),
            func.avg(SurfSpot.longitude).label('avg_lng')
        )
        .where(SurfSpot.is_active.is_(True))
        .where(SurfSpot.country.isnot(None))
        .group_by(SurfSpot.country)
        .order_by(SurfSpot.country)
    )
    countries = countries_query.fetchall()

    states_query = await db.execute(
        select(
            SurfSpot.country, SurfSpot.state_province,
            func.count(SurfSpot.id).label('spot_count'),
            func.avg(SurfSpot.latitude).label('avg_lat'),
            func.avg(SurfSpot.longitude).label('avg_lng')
        )
        .where(SurfSpot.is_active.is_(True))
        .where(SurfSpot.country.isnot(None))
        .where(SurfSpot.state_province.isnot(None))
        .group_by(SurfSpot.country, SurfSpot.state_province)
        .order_by(SurfSpot.country, SurfSpot.state_province)
    )
    states = states_query.fetchall()

    cities_query = await db.execute(
        select(
            SurfSpot.country, SurfSpot.state_province, SurfSpot.region,
            func.count(SurfSpot.id).label('spot_count'),
            func.avg(SurfSpot.latitude).label('avg_lat'),
            func.avg(SurfSpot.longitude).label('avg_lng')
        )
        .where(SurfSpot.is_active.is_(True))
        .where(SurfSpot.country.isnot(None))
        .where(SurfSpot.region.isnot(None))
        .group_by(SurfSpot.country, SurfSpot.state_province, SurfSpot.region)
        .order_by(SurfSpot.country, SurfSpot.state_province, SurfSpot.region)
    )
    cities = cities_query.fetchall()

    # Build hierarchical response
    location_map = {}
    for country, count, avg_lat, avg_lng in countries:
        if country:
            location_map[country] = {
                "name": country, "spot_count": count,
                "latitude": round(float(avg_lat), 4) if avg_lat else None,
                "longitude": round(float(avg_lng), 4) if avg_lng else None,
                "states": []
            }

    state_map = {}
    for country, state, count, avg_lat, avg_lng in states:
        if country and state and country in location_map:
            state_entry = {
                "name": state, "spot_count": count,
                "latitude": round(float(avg_lat), 4) if avg_lat else None,
                "longitude": round(float(avg_lng), 4) if avg_lng else None,
                "cities": []
            }
            location_map[country]["states"].append(state_entry)
            state_map[(country, state)] = state_entry

    for country, state, region, count, avg_lat, avg_lng in cities:
        if not (country and region):
            continue
        key = (country, state) if state else None
        if key and key in state_map:
            state_map[key]["cities"].append({
                "name": region, "spot_count": count,
                "latitude": round(float(avg_lat), 4) if avg_lat else None,
                "longitude": round(float(avg_lng), 4) if avg_lng else None
            })
        elif country in location_map:
            virtual_key = (country, None)
            if virtual_key not in state_map:
                virtual_state = {
                    "name": country, "spot_count": 0,
                    "latitude": location_map[country].get("latitude"),
                    "longitude": location_map[country].get("longitude"),
                    "cities": [], "is_virtual": True
                }
                location_map[country]["states"].append(virtual_state)
                state_map[virtual_key] = virtual_state
            state_map[virtual_key]["cities"].append({
                "name": region, "spot_count": count,
                "latitude": round(float(avg_lat), 4) if avg_lat else None,
                "longitude": round(float(avg_lng), 4) if avg_lng else None
            })
            state_map[virtual_key]["spot_count"] += count

    for country_data in location_map.values():
        real_states = [s for s in country_data["states"] if not s.get("is_virtual")]
        country_data["has_states"] = len(real_states) > 0

    return {"countries": list(location_map.values()), "total_countries": len(location_map)}


@router.get("/surf-spots/nearby")
async def get_nearby_spots(
    latitude: float, longitude: float,
    radius_miles: float = 15.0,
    user_id: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
):
    """Get surf spots within radius of given location with Privacy Shield"""
    result = await db.execute(select(SurfSpot).where(SurfSpot.is_active.is_(True)))
    all_spots = result.scalars().all()
    
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
            active_count = 0
            if within_geofence:
                count_result = await db.execute(
                    select(func.count(Profile.id))
                    .where(Profile.current_spot_id == spot.id)
                    .where(Profile.is_shooting.is_(True))
                )
                active_count = count_result.scalar() or 0
            nearby.append({
                "id": str(spot.id), "name": spot.name, "region": spot.region,
                "city": spot.region, "country": spot.country,
                "latitude": spot.latitude, "longitude": spot.longitude,
                "distance_miles": round(distance, 2),
                "description": spot.description, "difficulty": spot.difficulty,
                "image_url": spot.image_url,
                "active_photographers_count": active_count,
                "is_within_geofence": within_geofence
            })
    
    nearby.sort(key=lambda x: x["distance_miles"])
    return nearby


@router.get("/surf-spots/{spot_id}")
async def get_surf_spot(
    spot_id: str,
    user_lat: Optional[float] = Query(None),
    user_lon: Optional[float] = Query(None),
    user_id: Optional[str] = Depends(get_optional_user_id_from_jwt_or_query),
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
        photog_result = await db.execute(
            select(Profile)
            .where(Profile.current_spot_id == spot.id)
            .where(Profile.is_shooting.is_(True))
        )
        photographers = photog_result.scalars().all()
        for p in photographers:
            active_photographers.append({
                "id": p.id, "full_name": p.full_name,
                "avatar_url": p.avatar_url, "session_price": p.session_price,
                "is_streaming": p.is_streaming
            })
        
        breathing_status = active_count > 0
        live_conditions_report = spot.last_conditions_report if hasattr(spot, 'last_conditions_report') else None
        
        # Get open bookings at or near this spot
        now = datetime.now(timezone.utc)
        booking_result = await db.execute(
            select(Booking)
            .where(
                and_(
                    Booking.split_mode == 'open_nearby',
                    Booking.status.in_(['Pending', 'Confirmed']),
                    Booking.session_date > now,
                    or_(
                        Booking.surf_spot_id == spot.id,
                        and_(Booking.latitude.isnot(None), Booking.longitude.isnot(None))
                    )
                )
            )
            .options(selectinload(Booking.photographer), selectinload(Booking.participants))
            .order_by(Booking.session_date.asc())
            .limit(5)
        )
        bookings = booking_result.scalars().all()
        
        for booking in bookings:
            if booking.latitude and booking.longitude:
                booking_distance = haversine_distance(
                    spot.latitude, spot.longitude, booking.latitude, booking.longitude
                )
                if booking_distance > (booking.proximity_radius or 5.0):
                    continue
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
        "id": spot.id, "name": spot.name, "region": spot.region,
        "latitude": spot.latitude, "longitude": spot.longitude,
        "description": spot.description, "difficulty": spot.difficulty,
        "best_tide": spot.best_tide, "best_swell": spot.best_swell,
        "image_url": spot.image_url, "is_active": spot.is_active,
        "country": spot.country, "state_province": spot.state_province,
        "wave_type": spot.wave_type,
        "active_photographers_count": active_count,
        "active_photographers": active_photographers if within_geofence else [],
        "live_conditions_report": live_conditions_report,
        "breathing_status": breathing_status,
        "is_within_geofence": within_geofence,
        "distance_miles": round(distance, 2) if distance is not None else None,
        "visibility_radius_miles": visibility_radius,
        "upgrade_required": not within_geofence,
        "open_bookings": open_bookings,
        "open_bookings_count": len(open_bookings)
    }
