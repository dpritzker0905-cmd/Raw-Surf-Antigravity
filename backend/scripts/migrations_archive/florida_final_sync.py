"""
FLORIDA FINAL SYNC - CAM-ANCHOR RESEARCH
Using Surfline's camera/report angles to find exact offshore peak coordinates.

Iteration 144 - Ground Truth Sync
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
# BREVARD COUNTY SURGICAL SPLITS
# Satellite Beach area - split into distinct offshore peaks
# =============================================================================

BREVARD_SPLITS = {
    # RC's - reef peak (Surfline ID: 5842041f4e65fad6a7708aba)
    "RC's": {
        "lat": 28.182, "lon": -80.593,  # User specified
        "region": "Satellite Beach", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708aba - reef peak",
        "surfline_id": "5842041f4e65fad6a7708aba"
    },
    # Hightower Park - offshore bar (Surfline ID: 584204214e65fad6a7709cbd)
    "Hightower Park": {
        "lat": 28.163, "lon": -80.590,  # User specified - offshore from parking
        "region": "Satellite Beach", "state": "Florida",
        "source": "Surfline 584204214e65fad6a7709cbd - breaking bar",
        "surfline_id": "584204214e65fad6a7709cbd"
    },
    # Pelican Beach Park - offshore of pavilions
    "Pelican Beach Park": {
        "lat": 28.151, "lon": -80.591,  # User specified
        "region": "Satellite Beach", "state": "Florida",
        "source": "Offshore of pavilions",
        "surfline_id": None
    },
}

# =============================================================================
# BREVARD / INDIAN RIVER FIXES
# Moving from park roads/neighborhoods to water
# =============================================================================

BREVARD_FIXES = {
    # Melbourne Beach / Spessard Holland - from park road to water
    "Spessard Holland": {
        "lat": 28.024, "lon": -80.551,  # User specified
        "region": "Melbourne Beach", "state": "Florida",
        "source": "User specified - from park road to water"
    },
    # Paradise Beach - from neighborhood to offshore peak
    "Paradise Beach": {
        "lat": 28.123, "lon": -80.575,  # User specified
        "region": "Indialantic", "state": "Florida",
        "source": "User specified - from neighborhood to offshore peak"
    },
    # Satellite Beach - update to RC's area
    "Satellite Beach": {
        "lat": 28.175, "lon": -80.592,  # General area for legacy spot
        "region": "Satellite Beach", "state": "Florida",
        "source": "Updated to RC's area"
    },
}

# =============================================================================
# PALM BEACH COUNTY FIXES
# =============================================================================

PALM_BEACH_FIXES = {
    # Reef Road - from residential to big wave offshore peak
    "Reef Road": {
        "lat": 26.784, "lon": -80.033,  # User specified - "Big Wave" peak
        "region": "Palm Beach", "state": "Florida",
        "source": "User specified - Big Wave peak offshore of south jetty",
        "surfline_id": "5842041f4e65fad6a7708879"
    },
    # Jupiter Inlet
    "Jupiter Inlet": {
        "lat": 26.944, "lon": -80.065,  # Offshore of inlet
        "region": "Jupiter", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708b77 - inlet peak",
        "surfline_id": "5842041f4e65fad6a7708b77"
    },
    # Pump House / The Pumphouse
    "Pump House": {
        "lat": 26.935, "lon": -80.055,  # Singer Island area
        "region": "Palm Beach Shores", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708af8",
        "surfline_id": "5842041f4e65fad6a7708af8"
    },
}

# =============================================================================
# MIAMI-DADE EXPANSION
# Adding missing high-value spots
# =============================================================================

MIAMI_DADE_EXPANSION = {
    # Haulover Inlet - North Jetty
    "Haulover Inlet North Jetty": {
        "lat": 25.905, "lon": -80.118,  # North jetty tip
        "region": "Miami Beach", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708ad9 - north jetty",
        "surfline_id": "5842041f4e65fad6a7708ad9"
    },
    # Haulover Inlet - South Jetty
    "Haulover Inlet South Jetty": {
        "lat": 25.898, "lon": -80.120,  # South jetty tip
        "region": "Miami Beach", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708ad8 - south jetty",
        "surfline_id": "5842041f4e65fad6a7708ad8"
    },
    # South Beach - 5th Street
    "South Beach 5th Street": {
        "lat": 25.773, "lon": -80.127,  # 5th St offshore
        "region": "Miami Beach", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708ad6 - 5th St peak",
        "surfline_id": "5842041f4e65fad6a7708ad6"
    },
    # South Beach - 1st Street
    "South Beach 1st Street": {
        "lat": 25.765, "lon": -80.130,  # 1st St offshore - South Pointe area
        "region": "Miami Beach", "state": "Florida",
        "source": "South Pointe / 1st St offshore",
        "surfline_id": None
    },
    # South Beach main
    "South Beach": {
        "lat": 25.782, "lon": -80.125,  # General South Beach
        "region": "Miami Beach", "state": "Florida",
        "source": "Surfline 5842041f4e65fad6a7708ac1 - main beach",
        "surfline_id": "5842041f4e65fad6a7708ac1"
    },
    # 21st Street
    "South Beach 21st Street": {
        "lat": 25.793, "lon": -80.120,  # 21st St offshore
        "region": "Miami Beach", "state": "Florida",
        "source": "21st St break offshore",
        "surfline_id": None
    },
    # Penrod Park area
    "Penrod Park": {
        "lat": 25.778, "lon": -80.126,  # Penrod area
        "region": "Miami Beach", "state": "Florida",
        "source": "Penrod Park offshore",
        "surfline_id": None
    },
}


async def add_or_update_spot(db, name: str, data: dict) -> str:
    """Add new spot or update existing. Returns 'added', 'updated', or 'unchanged'."""
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
            region=data.get("region", "Florida"),
            country="USA",
            state_province=data.get("state", "Florida"),
            latitude=data["lat"],
            longitude=data["lon"],
            is_active=True,
            is_verified_peak=True,
            difficulty="intermediate",
        )
        db.add(new_spot)
        return "added"


async def run_florida_final_sync():
    """Run the complete Florida Final Sync."""
    async with async_session_maker() as db:
        logger.info("="*70)
        logger.info("FLORIDA FINAL SYNC - CAM-ANCHOR RESEARCH")
        logger.info("Iteration 144 - Ground Truth Sync")
        logger.info("="*70)
        
        stats = {"added": 0, "updated": 0, "unchanged": 0}
        
        # 1. Brevard Splits
        logger.info("\n--- BREVARD COUNTY SPLITS ---")
        for name, data in BREVARD_SPLITS.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1
            logger.info(f"  {name}: {result}")
        
        # 2. Brevard Fixes
        logger.info("\n--- BREVARD / INDIAN RIVER FIXES ---")
        for name, data in BREVARD_FIXES.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1
            logger.info(f"  {name}: {result}")
        
        # 3. Palm Beach Fixes
        logger.info("\n--- PALM BEACH COUNTY FIXES ---")
        for name, data in PALM_BEACH_FIXES.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1
            logger.info(f"  {name}: {result}")
        
        # 4. Miami-Dade Expansion
        logger.info("\n--- MIAMI-DADE EXPANSION ---")
        for name, data in MIAMI_DADE_EXPANSION.items():
            result = await add_or_update_spot(db, name, data)
            if "added" in result:
                stats["added"] += 1
            elif "updated" in result:
                stats["updated"] += 1
            else:
                stats["unchanged"] += 1
            logger.info(f"  {name}: {result}")
        
        await db.commit()
        
        logger.info("\n" + "="*70)
        logger.info("FLORIDA FINAL SYNC COMPLETE")
        logger.info(f"Added: {stats['added']}, Updated: {stats['updated']}, Unchanged: {stats['unchanged']}")
        logger.info("="*70)
        
        return stats


async def main():
    stats = await run_florida_final_sync()
    print(f"\nDone! Added {stats['added']}, Updated {stats['updated']}, Unchanged {stats['unchanged']}")


if __name__ == "__main__":
    asyncio.run(main())
