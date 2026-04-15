"""
IP Geolocation & Location Services
Provides fallback location when browser GPS is denied.
Includes Coastal Snap for inland IP addresses.
"""
from fastapi import APIRouter, Request, Query
import aiohttp
import logging
import math
from typing import Optional, Dict, Any

router = APIRouter()
logger = logging.getLogger(__name__)

# Free IP geolocation API
IP_API_URL = "http://ip-api.com/json/{ip}?fields=status,country,regionName,city,lat,lon,isp"

# OSM Overpass API for coastline queries
OVERPASS_API = "https://overpass-api.de/api/interpreter"

# Coastal points database (major coastal cities for fast lookup)
COASTAL_SNAP_POINTS = {
    # East Coast USA (city -> nearest beach coords)
    "Miami": (25.7617, -80.1218),
    "Fort Lauderdale": (26.1224, -80.1030),
    "West Palm Beach": (26.7153, -80.0534),
    "Cape Canaveral": (28.3922, -80.6077),
    "Cocoa Beach": (28.3200, -80.6076),
    "Melbourne FL": (28.0836, -80.6081),
    "Vero Beach": (27.6386, -80.3973),
    "Stuart": (27.1975, -80.2528),
    "Jacksonville": (30.3210, -81.3900),
    "Jacksonville Beach": (30.2947, -81.3931),
    "Daytona Beach": (29.2108, -81.0228),
    "New Smyrna Beach": (29.0258, -80.9270),
    "St Augustine": (29.9012, -81.3124),
    "Savannah": (32.0809, -80.8500),
    "Charleston": (32.7765, -79.9300),
    "Wilmington": (34.2104, -77.7900),
    "Virginia Beach": (36.8529, -75.9780),
    "Ocean City": (38.3365, -75.0849),
    "Atlantic City": (39.3643, -74.4229),
    "New York": (40.5834, -73.8212),  # Rockaway
    "Boston": (42.2808, -70.8860),  # Nantasket
    # West Coast USA
    "Los Angeles": (33.9425, -118.4081),  # Venice
    "San Diego": (32.7157, -117.1611),
    "San Francisco": (37.7595, -122.5107),  # Ocean Beach
    "Santa Cruz": (36.9741, -122.0308),
    "Portland": (45.8618, -123.9619),  # Cannon Beach
    "Seattle": (47.6205, -122.5025),
    # Hawaii
    "Honolulu": (21.2769, -157.8260),
    # Australia
    "Sydney": (33.8908, -151.2743),  # Bondi (note: negative for Southern Hemisphere)
    "Melbourne": (-37.8136, 144.9631),
    "Gold Coast": (-28.0167, 153.4000),
    # Europe
    "Lisbon": (38.6977, -9.4200),
    "Biarritz": (43.4831, -1.5586),
    # Indonesia
    "Denpasar": (-8.6500, 115.2167),  # Bali
}

# Cities that are known to be on the coast
COASTAL_CITIES = set([
    "Miami", "Fort Lauderdale", "West Palm Beach", "Jacksonville", "Daytona Beach",
    "Cocoa Beach", "Melbourne FL", "Melbourne", "Vero Beach", "Stuart", "Palm Beach", "Boca Raton",
    "Deerfield Beach", "Pompano Beach", "Hollywood", "Hallandale Beach", "Key West",
    "Cape Canaveral", "New Smyrna Beach", "St Augustine", "Jacksonville Beach",
    "Titusville", "Satellite Beach", "Indialantic", "Indian Harbour Beach",
    "San Diego", "Los Angeles", "Santa Monica", "Malibu", "Santa Cruz", "San Francisco",
    "Honolulu", "Sydney", "Gold Coast", "Lisbon", "Porto", "Biarritz", "Hossegor",
    "Denpasar", "Kuta", "Canggu", "Uluwatu", "Cape Town", "Rio de Janeiro"
])


def calculate_distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Calculate distance between two points using Haversine formula."""
    R = 6371  # Earth's radius in km
    
    lat1_rad = math.radians(lat1)
    lat2_rad = math.radians(lat2)
    delta_lat = math.radians(lat2 - lat1)
    delta_lon = math.radians(lon2 - lon1)
    
    a = math.sin(delta_lat/2)**2 + math.cos(lat1_rad) * math.cos(lat2_rad) * math.sin(delta_lon/2)**2
    c = 2 * math.atan2(math.sqrt(a), math.sqrt(1-a))
    
    return R * c


def is_likely_coastal(city: str, country: str = None) -> bool:
    """Quick check if a city is known to be coastal."""
    return city in COASTAL_CITIES


def get_nearest_coastal_snap(lat: float, lon: float, city: str = None) -> Optional[Dict[str, Any]]:
    """
    Find the nearest coastal snap point for an inland location.
    Returns None if already coastal or no snap point found.
    """
    # First check if this is a known coastal city
    if city and city in COASTAL_SNAP_POINTS:
        coastal_lat, coastal_lon = COASTAL_SNAP_POINTS[city]
        return {
            "latitude": coastal_lat,
            "longitude": coastal_lon,
            "snap_source": "city_database",
            "snap_city": city
        }
    
    # Find nearest coastal snap point
    nearest_point = None
    min_distance = float('inf')
    
    for snap_city, (snap_lat, snap_lon) in COASTAL_SNAP_POINTS.items():
        dist = calculate_distance_km(lat, lon, snap_lat, snap_lon)
        if dist < min_distance and dist < 500:  # Only consider within 500km
            min_distance = dist
            nearest_point = {
                "latitude": snap_lat,
                "longitude": snap_lon,
                "snap_source": "nearest_coastal_city",
                "snap_city": snap_city,
                "distance_km": round(dist, 1)
            }
    
    return nearest_point


@router.get("/location/ip-geolocation")
async def get_ip_geolocation(
    request: Request,
    coastal_snap: bool = Query(default=True, description="Snap inland locations to nearest coast"),
    last_city: Optional[str] = Query(default=None, description="Previous city for migration detection")
):
    """
    Get approximate location from IP address.
    Used as fallback when browser location is denied.
    
    Features:
    - City-level IP geolocation
    - Coastal Snap: If inland, snap to nearest coastline point
    - City Migration Detection: Detect if user moved to new city
    """
    # Get client IP
    client_ip = request.headers.get("X-Forwarded-For", "").split(",")[0].strip()
    if not client_ip:
        client_ip = request.client.host
    
    # Skip for localhost/private IPs
    if client_ip in ["127.0.0.1", "localhost"] or client_ip.startswith("10.") or client_ip.startswith("192.168."):
        # Return default location (Miami, FL) for development
        return {
            "success": True,
            "source": "default",
            "latitude": 25.7617,
            "longitude": -80.1218,  # Shifted slightly east (coastal)
            "city": "Miami",
            "region": "Florida",
            "country": "USA",
            "accuracy": "city",
            "is_coastal": True,
            "coastal_snapped": False,
            "city_changed": False,
            "note": "Using default location for development"
        }
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.get(IP_API_URL.format(ip=client_ip), timeout=aiohttp.ClientTimeout(total=5)) as response:
                if response.status == 200:
                    data = await response.json()
                    
                    if data.get("status") == "success":
                        ip_lat = data.get("lat")
                        ip_lon = data.get("lon")
                        city = data.get("city", "")
                        region = data.get("regionName", "")
                        country = data.get("country", "")
                        
                        # Check if city changed (migration detection)
                        city_changed = last_city is not None and last_city != city
                        
                        # Determine if location is coastal
                        is_coastal = is_likely_coastal(city, country)
                        
                        # Coastal Snap Logic
                        coastal_snapped = False
                        snap_info = None
                        final_lat = ip_lat
                        final_lon = ip_lon
                        
                        if coastal_snap and not is_coastal:
                            snap_info = get_nearest_coastal_snap(ip_lat, ip_lon, city)
                            if snap_info:
                                final_lat = snap_info["latitude"]
                                final_lon = snap_info["longitude"]
                                coastal_snapped = True
                        
                        response_data = {
                            "success": True,
                            "source": "ip",
                            "latitude": final_lat,
                            "longitude": final_lon,
                            "original_latitude": ip_lat if coastal_snapped else None,
                            "original_longitude": ip_lon if coastal_snapped else None,
                            "city": city,
                            "region": region,
                            "country": country,
                            "accuracy": "city",
                            "is_coastal": is_coastal or coastal_snapped,
                            "coastal_snapped": coastal_snapped,
                            "city_changed": city_changed,
                            "ip": client_ip
                        }
                        
                        if snap_info:
                            response_data["snap_info"] = snap_info
                        
                        if city_changed:
                            response_data["previous_city"] = last_city
                            response_data["migration_detected"] = True
                        
                        return response_data
        
        # Fallback if IP lookup fails
        return {
            "success": False,
            "error": "IP geolocation unavailable",
            "latitude": None,
            "longitude": None,
            "is_coastal": False,
            "coastal_snapped": False
        }
        
    except Exception as e:
        logger.error(f"IP geolocation error: {e}")
        return {
            "success": False,
            "error": str(e),
            "latitude": None,
            "longitude": None
        }


@router.post("/location/update-city")
async def update_user_city(
    request: Request,
    user_id: str = Query(...),
    city: str = Query(...),
    latitude: float = Query(...),
    longitude: float = Query(...)
):
    """
    Store user's current city for migration detection.
    Called on app initialization to track location changes.
    """
    # This would typically store in database, but for now we'll return success
    # The frontend will handle localStorage for session persistence
    return {
        "success": True,
        "stored": {
            "user_id": user_id,
            "city": city,
            "latitude": latitude,
            "longitude": longitude
        }
    }
