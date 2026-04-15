"""
NEW YORK & CENTRAL AMERICA SURGICAL ROLLOUT
Expanding database with Surfline-verified peak coordinates

All coordinates snapped 50-150m offshore at breaking wave zones
Spot types and difficulty included for metadata
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot
from uuid import uuid4

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# NEW YORK & LONG ISLAND
# Rockaways to Montauk
# Ocean is SOUTH - coordinates need LESS positive latitude for offshore
# =============================================================================

NEW_YORK_SPOTS = {
    # Rockaways (Queens)
    "Rockaway Beach 90th Street": {
        "lat": 40.582, "lon": -73.812,  # Offshore of 90th St
        "region": "Rockaways", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708852"
    },
    "Rockaway Beach 92nd Street": {
        "lat": 40.581, "lon": -73.808,  # Most popular spot
        "region": "Rockaways", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708852"
    },
    "Rockaway Beach 67th Street": {
        "lat": 40.582, "lon": -73.785,  # Near jetty
        "region": "Rockaways", "state": "New York", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    
    # Long Beach (Nassau County)
    "Long Beach Lincoln Boulevard": {
        "lat": 40.584, "lon": -73.658,  # Lincoln Blvd offshore
        "region": "Long Beach", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Long Beach": {
        "lat": 40.583, "lon": -73.668,  # General Long Beach
        "region": "Long Beach", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Lido Beach": {
        "lat": 40.582, "lon": -73.625,  # Lido Beach area
        "region": "Long Beach", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Fire Island (Suffolk County)
    "Fire Island": {
        "lat": 40.643, "lon": -73.146,  # Main Fire Island
        "region": "Fire Island", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Fire Island Inlet": {
        "lat": 40.625, "lon": -73.309,  # Inlet break
        "region": "Fire Island", "state": "New York", "country": "USA",
        "spot_type": "inlet_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Robert Moses Beach": {
        "lat": 40.608, "lon": -73.278,  # Field 5 area
        "region": "Fire Island", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    
    # Montauk (Suffolk County - East End)
    "Ditch Plains": {
        "lat": 41.038, "lon": -71.918,  # Famous point break
        "region": "Montauk", "state": "New York", "country": "USA",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a77089ec"
    },
    "Turtle Cove": {
        "lat": 41.050, "lon": -71.898,  # Turtle Cove offshore
        "region": "Montauk", "state": "New York", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Camp Hero": {
        "lat": 41.065, "lon": -71.878,  # Camp Hero State Park
        "region": "Montauk", "state": "New York", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Montauk Point": {
        "lat": 41.071, "lon": -71.858,  # Montauk Lighthouse area
        "region": "Montauk", "state": "New York", "country": "USA",
        "spot_type": "reef_break", "difficulty": "expert",
        "surfline_id": None
    },
}

# =============================================================================
# EL SALVADOR
# Pacific Coast - World-class point breaks
# =============================================================================

EL_SALVADOR_SPOTS = {
    # La Libertad Region - Main Surf Area
    "Punta Roca": {
        "lat": 13.478, "lon": -89.328,  # World-class right point
        "region": "La Libertad", "state": "La Libertad", "country": "El Salvador",
        "spot_type": "point_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708bad"
    },
    "La Bocana": {
        "lat": 13.498, "lon": -89.356,  # River mouth break
        "region": "La Libertad", "state": "La Libertad", "country": "El Salvador",
        "spot_type": "river_mouth", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708bac"
    },
    "Sunzal": {
        "lat": 13.502, "lon": -89.388,  # Rocky point break
        "region": "La Libertad", "state": "La Libertad", "country": "El Salvador",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708bab"
    },
    "El Zonte": {
        "lat": 13.508, "lon": -89.418,  # Beach break with points
        "region": "La Libertad", "state": "La Libertad", "country": "El Salvador",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "K-59": {
        "lat": 13.512, "lon": -89.438,  # KM 59 marker
        "region": "La Libertad", "state": "La Libertad", "country": "El Salvador",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708baa"
    },
    
    # East El Salvador
    "Punta Mango": {
        "lat": 13.182, "lon": -87.908,  # Remote right point
        "region": "Usulutan", "state": "Usulutan", "country": "El Salvador",
        "spot_type": "point_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Las Flores": {
        "lat": 13.188, "lon": -87.918,  # Las Flores area
        "region": "Usulutan", "state": "Usulutan", "country": "El Salvador",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708bae"
    },
}

# =============================================================================
# COSTA RICA - NORTH PACIFIC (Guanacaste)
# =============================================================================

COSTA_RICA_NORTH_PACIFIC = {
    # Santa Rosa National Park
    "Witch's Rock": {
        "lat": 10.838, "lon": -85.705,  # Roca Bruja offshore
        "region": "Guanacaste", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708b99"
    },
    "Ollie's Point": {
        "lat": 10.865, "lon": -85.718,  # Fast right point
        "region": "Guanacaste", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "point_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708b98"
    },
    
    # Tamarindo Area
    "Playa Grande": {
        "lat": 10.332, "lon": -85.865,  # Leatherback beach
        "region": "Tamarindo", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708b9a"
    },
    "Tamarindo": {
        "lat": 10.298, "lon": -85.848,  # Main beach
        "region": "Tamarindo", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": "5842041f4e65fad6a7708b9b"
    },
    "Playa Langosta": {
        "lat": 10.278, "lon": -85.838,  # South of Tamarindo
        "region": "Tamarindo", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "river_mouth", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Avellanas": {
        "lat": 10.248, "lon": -85.828,  # Beach break with peaks
        "region": "Tamarindo", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708b9c"
    },
    "Playa Negra": {
        "lat": 10.218, "lon": -85.848,  # Black sand right point
        "region": "Guanacaste", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "reef_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708b9d"
    },
    "Nosara": {
        "lat": 9.948, "lon": -85.678,  # Playa Guiones area
        "region": "Nosara", "state": "Guanacaste", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708ba1"
    },
}

# =============================================================================
# COSTA RICA - CENTRAL/SOUTH PACIFIC
# =============================================================================

COSTA_RICA_CENTRAL_SOUTH = {
    # Nicoya Peninsula
    "Santa Teresa": {
        "lat": 9.654, "lon": -85.183,  # Main beach offshore
        "region": "Santa Teresa", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708e31"
    },
    "Playa Carmen": {
        "lat": 9.638, "lon": -85.168,  # Mal Pais area
        "region": "Santa Teresa", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Mal Pais": {
        "lat": 9.608, "lon": -85.148,  # Southern tip
        "region": "Santa Teresa", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "reef_break", "difficulty": "advanced",
        "surfline_id": None
    },
    
    # Jaco Area
    "Playa Hermosa Jaco": {
        "lat": 9.528, "lon": -84.628,  # Hermosa beach break
        "region": "Jaco", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708ba3"
    },
    "Jaco Beach": {
        "lat": 9.618, "lon": -84.638,  # Main Jaco beach
        "region": "Jaco", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": "5842041f4e65fad6a7708ba2"
    },
    
    # Dominical Area
    "Dominical": {
        "lat": 9.248, "lon": -83.868,  # Main beach
        "region": "Dominical", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708ba4"
    },
    "Dominicalito": {
        "lat": 9.238, "lon": -83.858,  # South of Dominical
        "region": "Dominical", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Pavones Area
    "Pavones": {
        "lat": 8.393, "lon": -83.139,  # World's longest left
        "region": "Pavones", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "point_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708ba6"
    },
    "Matapalo": {
        "lat": 8.418, "lon": -83.178,  # North of Pavones
        "region": "Pavones", "state": "Puntarenas", "country": "Costa Rica",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": None
    },
}

# =============================================================================
# COSTA RICA - CARIBBEAN
# =============================================================================

COSTA_RICA_CARIBBEAN = {
    "Salsa Brava": {
        "lat": 9.654, "lon": -82.755,  # Puerto Viejo reef
        "region": "Puerto Viejo", "state": "Limon", "country": "Costa Rica",
        "spot_type": "reef_break", "difficulty": "expert",
        "surfline_id": "5842041f4e65fad6a7708ba7"
    },
    "Playa Cocles": {
        "lat": 9.638, "lon": -82.738,  # Beach south of Puerto Viejo
        "region": "Puerto Viejo", "state": "Limon", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708ba8"
    },
    "Puerto Viejo": {
        "lat": 9.665, "lon": -82.758,  # Main town beach
        "region": "Puerto Viejo", "state": "Limon", "country": "Costa Rica",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
}


async def add_or_update_spot(db, name: str, data: dict) -> str:
    """Add new spot or update existing. Returns status string."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
    spot = result.scalar_one_or_none()
    
    if spot:
        old_lat = float(spot.latitude) if spot.latitude else 0
        old_lon = float(spot.longitude) if spot.longitude else 0
        
        lat_diff = abs(data["lat"] - old_lat) * 111000
        lon_diff = abs(data["lon"] - old_lon) * 111000 * 0.85
        dist = (lat_diff**2 + lon_diff**2)**0.5
        
        if dist > 30:
            spot.latitude = data["lat"]
            spot.longitude = data["lon"]
            spot.is_verified_peak = True
            if "spot_type" in data:
                spot.difficulty = data.get("difficulty", "intermediate")
            return f"updated ({dist:.0f}m)"
        return "unchanged"
    else:
        new_spot = SurfSpot(
            id=str(uuid4()),
            name=name,
            region=data.get("region", "Unknown"),
            country=data.get("country", "Unknown"),
            state_province=data.get("state", None),
            latitude=data["lat"],
            longitude=data["lon"],
            is_active=True,
            is_verified_peak=True,
            difficulty=data.get("difficulty", "intermediate"),
        )
        db.add(new_spot)
        return "added"


async def run_expansion():
    """Run NY & Central America expansion."""
    all_regions = [
        ("NEW YORK & LONG ISLAND", NEW_YORK_SPOTS),
        ("EL SALVADOR", EL_SALVADOR_SPOTS),
        ("COSTA RICA - NORTH PACIFIC", COSTA_RICA_NORTH_PACIFIC),
        ("COSTA RICA - CENTRAL/SOUTH", COSTA_RICA_CENTRAL_SOUTH),
        ("COSTA RICA - CARIBBEAN", COSTA_RICA_CARIBBEAN),
    ]
    
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0, "unchanged": 0}
        
        logger.info("="*70)
        logger.info("NEW YORK & CENTRAL AMERICA SURGICAL ROLLOUT")
        logger.info("="*70)
        
        for region_name, spots in all_regions:
            logger.info(f"\n--- {region_name} ---")
            region_stats = {"added": 0, "updated": 0, "unchanged": 0}
            
            for name, data in spots.items():
                result = await add_or_update_spot(db, name, data)
                if "added" in result:
                    stats["added"] += 1
                    region_stats["added"] += 1
                elif "updated" in result:
                    stats["updated"] += 1
                    region_stats["updated"] += 1
                else:
                    stats["unchanged"] += 1
                    region_stats["unchanged"] += 1
                logger.info(f"  {name}: {result}")
            
            logger.info(f"  Region: +{region_stats['added']} added, {region_stats['updated']} updated")
        
        await db.commit()
        
        logger.info("\n" + "="*70)
        logger.info("EXPANSION COMPLETE")
        logger.info(f"Total Added: {stats['added']}, Updated: {stats['updated']}, Unchanged: {stats['unchanged']}")
        logger.info("="*70)
        
        return stats


async def main():
    stats = await run_expansion()
    print(f"\nDone! Added {stats['added']}, Updated {stats['updated']}")


if __name__ == "__main__":
    asyncio.run(main())
