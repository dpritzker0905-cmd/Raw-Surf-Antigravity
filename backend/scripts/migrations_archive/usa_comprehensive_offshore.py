"""
USA COMPREHENSIVE OFFSHORE FIX
State by state, county by county precision coordinates.
All spots pushed into the water based on coastline orientation.

COASTLINE RULES:
- Pacific Coast (CA, OR, WA): Ocean to WEST = MORE negative longitude
- Atlantic Coast (East Coast): Ocean to EAST = LESS negative longitude
- Gulf Coast (TX): Ocean to SOUTH/EAST = varies
- Hawaii: Ocean surrounds = generally WEST/SOUTH into Pacific
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# CALIFORNIA - Pacific Ocean to WEST (MORE negative longitude)
# Shoreline roughly -117.2 to -124.4, offshore = -117.25 to -124.45
# =============================================================================
CALIFORNIA_OFFSHORE = {
    # San Diego County - shoreline ~-117.25
    "Blacks Beach": (32.8895, -117.268),
    "Windansea": (32.8305, -117.284),
    "La Jolla Shores": (32.8558, -117.262),
    "Mission Beach": (32.7692, -117.256),
    "Ocean Beach SD": (32.7495, -117.258),
    "Pacific Beach": (32.7982, -117.260),
    "Sunset Cliffs": (32.7212, -117.260),
    "Imperial Beach": (32.5792, -117.138),
    
    # Orange County - shoreline ~-117.85 to -117.95
    "Trestles": (33.3825, -117.598),
    "Lower Trestles": (33.3828, -117.598),
    "Upper Trestles": (33.3853, -117.595),
    "San Onofre": (33.3728, -117.576),
    "Salt Creek": (33.4678, -117.730),
    "The Wedge": (33.5928, -117.890),
    "Newport Beach": (33.6108, -117.942),
    "Newport Point": (33.5952, -117.890),
    "54th Street Newport": (33.6032, -117.900),
    "Huntington Beach Pier": (33.6548, -118.012),
    
    # Los Angeles County - shoreline ~-118.4 to -118.8
    "El Porto": (33.8978, -118.428),
    "Hermosa Beach": (33.8622, -118.412),
    "Manhattan Beach Pier": (33.8852, -118.420),
    "Redondo Beach": (33.8508, -118.402),
    "Venice Breakwater": (33.9898, -118.480),
    "Malibu": (34.0358, -118.688),
    "Malibu First Point": (34.0368, -118.688),
    "Malibu Second Point": (34.0365, -118.690),
    "Malibu Third Point": (34.0360, -118.692),
    "Topanga": (34.0388, -118.598),
    "Zuma Beach": (34.0158, -118.830),
    "County Line": (34.0522, -118.962),
    
    # Ventura County - shoreline ~-119.2 to -119.5
    "C Street Ventura": (34.2738, -119.298),
    "Emma Wood": (34.2995, -119.350),
    "Mondos": (34.3288, -119.388),
    "Rincon": (34.3742, -119.488),
    "Rincon Point": (34.3745, -119.488),
    
    # Santa Barbara County - shoreline ~-119.7 to -120.6
    "Leadbetter Beach": (34.4038, -119.708),
    "Sands Beach": (34.4428, -119.890),
    "Jalama Beach": (34.5122, -120.512),
    
    # Central Coast - shoreline ~-120.6 to -121.9
    "Pismo Beach Pier": (35.1428, -120.652),
    "Morro Bay": (35.3668, -120.872),
    "Cayucos Pier": (35.4438, -120.912),
    "Big Sur - Andrew Molera": (36.2878, -121.868),
    "Carmel Beach": (36.5518, -121.938),
    "Moss Landing": (36.8068, -121.800),
    
    # Santa Cruz - shoreline ~-122.0
    "Santa Cruz": (36.9648, -122.032),
    "Steamer Lane": (36.9518, -122.038),
    "Pleasure Point": (36.9628, -121.985),
    "The Hook": (36.9608, -121.982),
    "Capitola": (36.9722, -121.960),
    
    # San Francisco Bay Area - shoreline ~-122.5
    "Pacifica - Linda Mar": (37.5958, -122.512),
    "Ocean Beach SF": (37.7608, -122.522),
    "Four Mile Beach": (37.0188, -122.190),
    "Davenport Landing": (37.0138, -122.200),
    "Waddell Creek": (37.0988, -122.288),
    
    # North Coast - shoreline ~-122.7 to -124.4
    "Bolinas": (37.9108, -122.702),
    "Stinson Beach": (37.9008, -122.658),
    "Mavericks": (37.4922, -122.508),
}

# =============================================================================
# HAWAII - Ocean surrounds, generally push SOUTH/WEST
# =============================================================================
HAWAII_OFFSHORE = {
    # Oahu North Shore - ocean to NORTH, push north (more positive lat) and west
    "Pipeline": (21.6658, -158.058),
    "Backdoor": (21.6660, -158.056),
    "Off The Wall": (21.6668, -158.056),
    "Sunset Beach": (21.6798, -158.048),
    "Rocky Point": (21.6718, -158.052),
    "Velzyland": (21.6852, -158.035),
    "Waimea Bay": (21.6432, -158.072),
    "Chuns Reef": (21.6128, -158.092),
    "Laniakea": (21.6198, -158.088),
    "Haleiwa": (21.5982, -118.112),
    "Log Cabins": (21.6728, -158.050),
    
    # Oahu South Shore - ocean to SOUTH
    "Ala Moana Bowls": (21.2858, -157.862),
    "Diamond Head": (21.2548, -157.812),
    "Waikiki - Queens": (21.2678, -157.835),
    "Sandy Beach": (21.2858, -157.678),
    "Makapuu": (21.3098, -157.668),
    
    # Maui
    "Honolua Bay": (21.0155, -156.648),
    "Hookipa": (20.9365, -156.362),
    "Jaws (Peahi)": (20.9435, -156.292),
    
    # Big Island
    "Banyans": (19.6415, -156.002),
    "Pine Trees": (19.7852, -156.062),
    
    # Kauai
    "Hanalei Bay": (22.2102, -159.515),
    "Tunnels": (22.2265, -159.562),
    "Poipu Beach": (21.8785, -159.462),
}

# =============================================================================
# OREGON - Pacific Ocean to WEST (MORE negative longitude)
# Shoreline ~-124.0 to -124.1
# =============================================================================
OREGON_OFFSHORE = {
    "Cannon Beach": (45.8628, -123.978),
    "Indian Beach": (45.9228, -123.998),
    "Short Sands": (45.7625, -123.978),
    "Seaside Cove": (45.9918, -123.948),
    "Agate Beach": (44.6662, -124.082),
    "Otter Rock": (44.7518, -124.088),
    "Florence Jetties": (43.9688, -124.128),
}

# =============================================================================
# WASHINGTON - Pacific Ocean to WEST (MORE negative longitude)
# Shoreline ~-124.1 to -124.7
# =============================================================================
WASHINGTON_OFFSHORE = {
    "Westport Jetty": (46.9078, -124.125),
    "Westport - Halfmoon Bay": (46.8898, -124.138),
    "Long Beach": (46.3528, -124.075),
    "La Push - First Beach": (47.9088, -124.658),
    "La Push - Second Beach": (47.9008, -124.652),
    "Rialto Beach": (47.9215, -124.662),
}

# =============================================================================
# TEXAS - Gulf of Mexico to SOUTH/EAST
# Push SOUTH (more negative lat) and slightly EAST
# =============================================================================
TEXAS_OFFSHORE = {
    "Galveston - 61st Street": (29.2548, -94.858),
    "Surfside Beach": (28.9348, -95.298),
    "Port Aransas - Horace Caldwell Pier": (27.8168, -97.068),
    "South Padre Island": (26.0668, -97.168),
}

# =============================================================================
# EAST COAST - Atlantic Ocean to EAST (LESS negative longitude)
# Already fixed Florida, now fix rest of East Coast
# =============================================================================
EAST_COAST_OFFSHORE = {
    # Maine - shoreline ~-70.3
    "Higgins Beach": (43.5578, -70.218),
    "Old Orchard Beach": (43.5162, -70.358),
    
    # New Hampshire - shoreline ~-70.82
    "Hampton Beach": (42.9088, -70.798),
    
    # Massachusetts - shoreline ~-70.0 to -70.1
    "Cape Cod - Coast Guard Beach": (41.8558, -69.928),
    "Nantucket": (41.2848, -70.078),
    
    # Rhode Island - shoreline ~-71.4
    "Narragansett": (41.4308, -71.438),
    "Newport": (41.4728, -71.318),
    
    # New York - shoreline ~-73.6 to -74.0
    "Rockaway Beach": (40.5848, -73.798),
    "Long Beach NY": (40.5888, -73.638),
    "Montauk": (41.0368, -71.918),
    
    # New Jersey - shoreline ~-73.9 to -75.0
    "Sandy Hook": (40.4595, -73.978),
    "Asbury Park": (40.2212, -73.978),
    "Long Beach Island": (39.6638, -74.138),
    "Cape May": (38.9362, -74.888),
    
    # Maryland - shoreline ~-75.08
    "Ocean City Maryland": (38.3378, -75.068),
    
    # Virginia - shoreline ~-75.96
    "Virginia Beach": (36.8538, -75.948),
    
    # North Carolina - shoreline ~-75.5 to -77.8
    "Outer Banks - Cape Hatteras": (35.2345, -75.508),
    "Wrightsville Beach": (34.2118, -77.768),
    
    # South Carolina - shoreline ~-79.9
    "Folly Beach": (32.6538, -79.918),
}

# =============================================================================
# PUERTO RICO - Atlantic/Caribbean to NORTH and WEST
# North coast: push NORTH (more positive lat)
# West coast (Rincon): push WEST (more negative lon)
# =============================================================================
PUERTO_RICO_OFFSHORE = {
    # West Coast (Rincon area) - Caribbean to WEST
    "Rincon PR": (18.3408, -67.278),
    "Rincon - Domes": (18.3562, -67.285),
    "Rincon - Indicators": (18.3542, -67.285),
    "Rincon - Maria's": (18.3478, -67.282),
    "Rincon - Tres Palmas": (18.3445, -67.280),
    
    # Northwest (Aguadilla) - Atlantic to NORTH/WEST  
    "Aguadilla - Gas Chambers": (18.4782, -67.158),
    "Aguadilla - Wilderness": (18.4628, -67.162),
    "Jobos Beach": (18.4905, -67.098),
    
    # Northeast - Atlantic to NORTH
    "Aviones": (18.4122, -66.042),
    "La Pared": (18.1902, -65.748),
}


async def apply_usa_offshore():
    """Apply offshore fixes to all USA spots."""
    async with async_session_maker() as db:
        all_spots = {
            **CALIFORNIA_OFFSHORE,
            **HAWAII_OFFSHORE,
            **OREGON_OFFSHORE,
            **WASHINGTON_OFFSHORE,
            **TEXAS_OFFSHORE,
            **EAST_COAST_OFFSHORE,
            **PUERTO_RICO_OFFSHORE,
        }
        
        fixed = 0
        not_found = []
        
        for name, (lat, lon) in all_spots.items():
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
            spot = result.scalar_one_or_none()
            
            if spot:
                old_lat = float(spot.latitude) if spot.latitude else 0
                old_lon = float(spot.longitude) if spot.longitude else 0
                
                if abs(old_lat - lat) > 0.001 or abs(old_lon - lon) > 0.001:
                    spot.latitude = lat
                    spot.longitude = lon
                    spot.is_verified_peak = True
                    logger.info(f"FIXED: {name} -> ({lat}, {lon})")
                    fixed += 1
            else:
                not_found.append(name)
        
        await db.commit()
        logger.info(f"\nTotal fixed: {fixed}")
        logger.info(f"Not found: {len(not_found)}")
        if not_found:
            logger.info(f"Missing: {not_found[:10]}...")
        
        return fixed


async def main():
    logger.info("="*60)
    logger.info("USA COMPREHENSIVE OFFSHORE FIX")
    logger.info("="*60)
    
    fixed = await apply_usa_offshore()
    
    # Final stats
    async with async_session_maker() as db:
        result = await db.execute(
            select(SurfSpot).where(SurfSpot.country == 'USA')
        )
        usa_spots = result.scalars().all()
        verified = sum(1 for s in usa_spots if s.is_verified_peak)
        
        logger.info(f"\nUSA Stats: {verified}/{len(usa_spots)} verified")


if __name__ == "__main__":
    asyncio.run(main())
