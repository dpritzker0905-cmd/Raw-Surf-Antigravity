"""
Surf spots schemas — Pydantic models, helper functions, and shared utilities.
"""
from pydantic import BaseModel
from typing import Optional, List
from datetime import datetime
import math
from utils.geo import haversine_distance


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


def is_within_geofence(user_lat: float, user_lon: float, spot_lat: float, spot_lon: float, radius_miles: float) -> bool:
    """Check if a spot is within the user's visibility radius."""
    if radius_miles >= 999999:  # Premium/unlimited
        return True
    distance = haversine_distance(user_lat, user_lon, spot_lat, spot_lon)
    return distance <= radius_miles


# ============================================================
# Pydantic Response Models
# ============================================================

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
    is_within_geofence: bool = True
    distance_miles: Optional[float] = None


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
    spot_id: Optional[str] = None
    location: Optional[str] = None
    is_streaming: bool = False
    price_per_join: float = 25.0
    max_surfers: int = 10
    auto_accept: bool = True
    # Live Session Rates
    live_photo_price: Optional[float] = None
    photos_included: Optional[int] = None
    videos_included: Optional[int] = None
    general_photo_price: Optional[float] = None
    estimated_duration: Optional[int] = None
    # Resolution-based pricing
    photo_price_web: Optional[float] = None
    photo_price_standard: Optional[float] = None
    photo_price_high: Optional[float] = None
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
    is_live: bool
    session_price: float = 25.0


class ForceStartSessionRequest(BaseModel):
    photographer_id: str
    spot_id: str
    session_price: float = 25.0
    condition_media: Optional[str] = None
    condition_media_type: Optional[str] = None
    spot_notes: Optional[str] = None


class SimulateLiveResponse(BaseModel):
    success: bool
    message: str
    photographer_id: str
    photographer_name: Optional[str]
    spot_name: Optional[str]
    is_live: bool
    live_session_id: Optional[str] = None
