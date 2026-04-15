"""
MIAMI DE-DUPLICATION & GLOBAL EXPANSION
- Clean up duplicate South Beach pins
- Add New Jersey spots
- Add Virginia/Mid-Atlantic spots
- Add Mexico spots
- Add Brazil spots
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, delete
from database import async_session_maker
from models import SurfSpot
from uuid import uuid4

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# MIAMI DE-DUPLICATION
# Keep distinct jetty/street peaks, merge generic "South Beach" entries
# =============================================================================

MIAMI_PINS_TO_DELETE = [
    "South Beach Miami",  # Generic, duplicate
    "South Beach",  # Generic, duplicate
]

MIAMI_UNIFIED_PEAK = {
    "South Beach Penrod": {
        "lat": 25.766, "lon": -80.129,  # Unified Surfline peak at Penrod/1st-5th area
        "region": "Miami Beach", "state": "Florida", "country": "USA",
        "source": "Surfline unified takeoff zone"
    },
}

# Keep these as distinct peaks:
# - South Beach 5th Street
# - South Beach 1st Street
# - South Beach 21st Street
# - South Beach Park (Boca) - different location entirely

# =============================================================================
# NEW JERSEY SPOTS
# =============================================================================

NEW_JERSEY_SPOTS = {
    # Monmouth County - North
    "Manasquan Inlet": {
        "lat": 40.105, "lon": -74.028,  # Jetty end offshore
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "advanced",
        "surfline_id": "5842041f4e65fad6a7708856"
    },
    "Manasquan Beach": {
        "lat": 40.113, "lon": -74.032,  # Beach break
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Belmar 16th Avenue": {
        "lat": 40.168, "lon": -74.020,  # 16th Ave offshore
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Belmar 8th Avenue": {
        "lat": 40.178, "lon": -74.018,  # Jetty break
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Asbury Park": {
        "lat": 40.218, "lon": -73.998,  # Beach break
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Long Branch": {
        "lat": 40.298, "lon": -73.978,  # Beach break
        "region": "Monmouth County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    
    # Ocean County - Central
    "Bay Head": {
        "lat": 40.068, "lon": -74.048,  # Rocky jetty
        "region": "Ocean County", "state": "New Jersey", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Point Pleasant Beach": {
        "lat": 40.088, "lon": -74.038,  # Beach/jetty
        "region": "Ocean County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Casino Pier": {
        "lat": 39.940, "lon": -74.068,  # Seaside Heights pier
        "region": "Ocean County", "state": "New Jersey", "country": "USA",
        "spot_type": "pier_break", "difficulty": "intermediate",
        "surfline_id": "5842041f4e65fad6a7708857"
    },
    "Seaside Park": {
        "lat": 39.920, "lon": -74.070,  # Beach break
        "region": "Ocean County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Cape May County - South
    "Avalon": {
        "lat": 39.098, "lon": -74.718,  # Beach break
        "region": "Cape May County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Stone Harbor": {
        "lat": 39.048, "lon": -74.758,  # Beach break
        "region": "Cape May County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Wildwood Crest": {
        "lat": 38.978, "lon": -74.818,  # Beach break
        "region": "Cape May County", "state": "New Jersey", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
}

# =============================================================================
# VIRGINIA / MID-ATLANTIC
# =============================================================================

VIRGINIA_SPOTS = {
    "1st Street Jetty": {
        "lat": 36.825, "lon": -75.965,  # Rudee Inlet north jetty offshore
        "region": "Virginia Beach", "state": "Virginia", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
        "surfline_id": "584204214e65fad6a7709ce7"
    },
    "Virginia Beach Pier": {
        "lat": 36.858, "lon": -75.975,  # Pier offshore
        "region": "Virginia Beach", "state": "Virginia", "country": "USA",
        "spot_type": "pier_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "42nd Street Virginia Beach": {
        "lat": 36.868, "lon": -75.978,  # 42nd St offshore
        "region": "Virginia Beach", "state": "Virginia", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Croatan": {
        "lat": 36.818, "lon": -75.962,  # South VB
        "region": "Virginia Beach", "state": "Virginia", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Sandbridge": {
        "lat": 36.728, "lon": -75.948,  # Sandbridge offshore
        "region": "Virginia Beach", "state": "Virginia", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
}

# =============================================================================
# MEXICO
# =============================================================================

MEXICO_SPOTS = {
    # Baja California Sur
    "Todos Santos": {
        "lat": 23.448, "lon": -110.228,  # Main break offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Cerritos": {
        "lat": 23.318, "lon": -110.198,  # Beach break offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "San Pedrito": {
        "lat": 23.468, "lon": -110.238,  # Reef break offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "reef_break", "difficulty": "advanced",
        "surfline_id": None
    },
    "Zippers": {
        "lat": 22.988, "lon": -109.758,  # Costa Azul offshore
        "region": "Los Cabos", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Old Mans": {
        "lat": 22.978, "lon": -109.748,  # Costa Azul beginner
        "region": "Los Cabos", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Nayarit
    "Sayulita": {
        "lat": 20.878, "lon": -105.448,  # Main beach offshore
        "region": "Nayarit", "state": "Nayarit", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Punta Sayulita": {
        "lat": 20.888, "lon": -105.458,  # Point break offshore
        "region": "Nayarit", "state": "Nayarit", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "San Pancho": {
        "lat": 20.918, "lon": -105.438,  # Beach break
        "region": "Nayarit", "state": "Nayarit", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Punta Mita": {
        "lat": 20.778, "lon": -105.528,  # Point break
        "region": "Nayarit", "state": "Nayarit", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    
    # Oaxaca
    "Puerto Escondido - Zicatela": {
        "lat": 15.858, "lon": -97.068,  # Mexican Pipeline offshore
        "region": "Oaxaca", "state": "Oaxaca", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "expert",
        "surfline_id": None
    },
    "Puerto Escondido - La Punta": {
        "lat": 15.848, "lon": -97.058,  # Left point offshore
        "region": "Oaxaca", "state": "Oaxaca", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Puerto Escondido - Carrizalillo": {
        "lat": 15.868, "lon": -97.078,  # Beginner bay
        "region": "Oaxaca", "state": "Oaxaca", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
}

# =============================================================================
# BRAZIL
# =============================================================================

BRAZIL_SPOTS = {
    # Rio de Janeiro State
    "Arpoador": {
        "lat": -22.988, "lon": -43.188,  # Famous right point offshore
        "region": "Rio de Janeiro", "state": "Rio de Janeiro", "country": "Brazil",
        "spot_type": "point_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Prainha": {
        "lat": -23.038, "lon": -43.508,  # Beach break offshore
        "region": "Rio de Janeiro", "state": "Rio de Janeiro", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Grumari": {
        "lat": -23.048, "lon": -43.528,  # Beach break
        "region": "Rio de Janeiro", "state": "Rio de Janeiro", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Barra da Tijuca": {
        "lat": -23.008, "lon": -43.368,  # Beach break
        "region": "Rio de Janeiro", "state": "Rio de Janeiro", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Sao Paulo State
    "Maresias": {
        "lat": -23.788, "lon": -45.568,  # Famous beach break
        "region": "Sao Paulo", "state": "Sao Paulo", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Ubatuba": {
        "lat": -23.458, "lon": -45.088,  # Beach break
        "region": "Sao Paulo", "state": "Sao Paulo", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    "Guaruja": {
        "lat": -24.008, "lon": -46.268,  # Beach break
        "region": "Sao Paulo", "state": "Sao Paulo", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Santa Catarina State
    "Florianopolis - Joaquina": {
        "lat": -27.628, "lon": -48.448,  # Famous competition beach
        "region": "Florianopolis", "state": "Santa Catarina", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Florianopolis - Mole": {
        "lat": -27.598, "lon": -48.438,  # Beach break
        "region": "Florianopolis", "state": "Santa Catarina", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "surfline_id": None
    },
    "Florianopolis - Campeche": {
        "lat": -27.688, "lon": -48.478,  # Beach break
        "region": "Florianopolis", "state": "Santa Catarina", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "beginner",
        "surfline_id": None
    },
    
    # Fernando de Noronha
    "Fernando de Noronha - Cacimba do Padre": {
        "lat": -3.858, "lon": -32.418,  # Iconic Brazilian wave
        "region": "Fernando de Noronha", "state": "Pernambuco", "country": "Brazil",
        "spot_type": "beach_break", "difficulty": "advanced",
        "surfline_id": None
    },
}


async def add_or_update_spot(db, name: str, data: dict) -> str:
    """Add new spot or update existing."""
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
    """Run de-duplication and global expansion."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0, "deleted": 0}
        
        logger.info("="*70)
        logger.info("MIAMI DE-DUPLICATION & GLOBAL EXPANSION")
        logger.info("="*70)
        
        # 1. Delete duplicate South Beach pins
        logger.info("\n--- MIAMI DE-DUPLICATION ---")
        for name in MIAMI_PINS_TO_DELETE:
            result = await db.execute(
                delete(SurfSpot).where(SurfSpot.name == name)
            )
            if result.rowcount > 0:
                logger.info(f"  DELETED: {name}")
                stats["deleted"] += 1
        
        # Add unified peak
        for name, data in MIAMI_UNIFIED_PEAK.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
                logger.info(f"  ADDED: {name}")
        
        # 2. New Jersey
        logger.info("\n--- NEW JERSEY ---")
        for name, data in NEW_JERSEY_SPOTS.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            logger.info(f"  {name}: {result}")
        
        # 3. Virginia
        logger.info("\n--- VIRGINIA ---")
        for name, data in VIRGINIA_SPOTS.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            logger.info(f"  {name}: {result}")
        
        # 4. Mexico
        logger.info("\n--- MEXICO ---")
        for name, data in MEXICO_SPOTS.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            logger.info(f"  {name}: {result}")
        
        # 5. Brazil
        logger.info("\n--- BRAZIL ---")
        for name, data in BRAZIL_SPOTS.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            logger.info(f"  {name}: {result}")
        
        await db.commit()
        
        logger.info("\n" + "="*70)
        logger.info("EXPANSION COMPLETE")
        logger.info(f"Deleted: {stats['deleted']}, Added: {stats['added']}, Updated: {stats['updated']}")
        logger.info("="*70)
        
        return stats


async def main():
    stats = await run_expansion()
    print(f"\nDone! Deleted {stats['deleted']}, Added {stats['added']}, Updated {stats['updated']}")


if __name__ == "__main__":
    asyncio.run(main())
