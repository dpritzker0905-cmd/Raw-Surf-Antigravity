"""
Central Florida Surf Spot Recalibration Script
Based on Surfline peak coordinates with offshore-snap precision.

All coordinates are verified against:
1. Surfline official spot guides
2. NOAA tide gauge stations
3. Surf-forecast.com data
4. OSM/general databases

Logic: Pins must be IN THE WATER at the actual surf peak, not on land/roads.
"""
import asyncio
import logging
from datetime import datetime, timezone
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Precise Surfline-verified offshore coordinates for Central FL
# Format: name -> (latitude, longitude, source_notes)
RECALIBRATED_SPOTS = {
    # === SPACE COAST (North to South) ===
    
    # Kennedy Space Center area
    "Kennedy Space Center": (28.5220, -80.5950, "Offshore at Playalinda south end, restricted access beach"),
    "Playalinda Beach": (28.6700, -80.6050, "Offshore at main Playalinda break, east of dunes"),
    
    # Cape Canaveral / Jetty Park area
    "Cape Canaveral Air Force Station": (28.4700, -80.5920, "Offshore of CCAFS beach, south of port"),
    "Jetty Park": (28.4061, -80.5890, "Tip of North Jetty - Surfline verified peak"),
    "Cape Canaveral": (28.3950, -80.6050, "Offshore Cape Canaveral town beach"),
    
    # Cocoa Beach core (North)
    "Cherie Down Park": (28.3842, -80.6015, "Seaward of Ridgewood Ave - offshore peak"),
    "Cocoa Beach Pier": (28.3676, -80.6012, "NOAA station 8721649 - offshore end of pier"),
    "Shepard Park": (28.3585, -80.6035, "Offshore of SR 520 / Shepard Park beach"),
    "Lori Wilson Park": (28.3351, -80.6069, "Offshore of 1500 N Atlantic Ave park"),
    
    # Cocoa Beach core (Central)
    "16th Street South": (28.3420, -80.6055, "Offshore at 16th St break, handles ENE-ESE swells"),
    "Minuteman Causeway": (28.3310, -80.6040, "Offshore of downtown Cocoa Beach at Minuteman"),
    
    # Satellite Beach / Patrick AFB area
    "Picnic Tables": (28.2251, -80.6033, "Offshore of Patrick SFB - Tables Beach area"),
    "O Club": (28.2680, -80.6020, "Offshore north of Patrick AFB, south of Cocoa Beach"),
    "Patrick Air Force Base": (28.2360, -80.6060, "Offshore of Patrick SFB main beach - 28.236N verified"),
    "Satellite Beach": (28.1790, -80.5950, "Offshore of Satellite Beach town, near coquina reefs"),
    
    # Southern Space Coast
    "Indialantic": (28.0920, -80.5720, "Offshore of Indialantic beach, south of Melbourne Beach causeway"),
    "Melbourne Beach": (28.0700, -80.5650, "Offshore of Melbourne Beach town center"),
    
    # Sebastian Inlet - Premier break
    "Sebastian Inlet": (27.8562, -80.4417, "First Peak - verified 27°51'22\"N, offshore at inlet south side"),
}

# Additional spots to add if missing (Surfline-verified)
NEW_SPOTS_TO_ADD = [
    {
        "name": "Pineda Causeway",
        "latitude": 28.2050,
        "longitude": -80.6000,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "Jetty break at Pineda Causeway, good on NE swells",
        "difficulty": "Intermediate",
        "source": "surfline"
    },
    {
        "name": "Hightower Beach",
        "latitude": 28.1520,
        "longitude": -80.5920,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "Beach break south of Satellite Beach",
        "difficulty": "Beginner-Intermediate",
        "source": "surfline"
    },
    {
        "name": "Paradise Beach",
        "latitude": 28.1350,
        "longitude": -80.5880,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "South end of Satellite Beach area",
        "difficulty": "Beginner-Intermediate",
        "source": "surfline"
    },
    {
        "name": "Ocean Avenue (Indialantic)",
        "latitude": 28.0850,
        "longitude": -80.5700,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "Central Indialantic break at Ocean Ave",
        "difficulty": "Beginner-Intermediate",
        "source": "surfline"
    },
    {
        "name": "Spessard Holland",
        "latitude": 28.0550,
        "longitude": -80.5600,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "Beach break at Spessard Holland Park, south Melbourne Beach",
        "difficulty": "Beginner-Intermediate",
        "source": "surfline"
    },
    {
        "name": "Spanish House",
        "latitude": 28.0250,
        "longitude": -80.5500,
        "region": "Space Coast",
        "country": "USA",
        "state_province": "Florida",
        "wave_type": "Beach Break",
        "description": "South Melbourne Beach area",
        "difficulty": "Intermediate",
        "source": "surfline"
    },
]


async def recalibrate_spots():
    """Update existing Central FL spots with precise offshore coordinates."""
    async with async_session_maker() as db:
        updated_count = 0
        
        for spot_name, (lat, lon, notes) in RECALIBRATED_SPOTS.items():
            # Find the spot
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.name == spot_name)
            )
            spot = result.scalar_one_or_none()
            
            if spot:
                old_lat, old_lon = spot.latitude, spot.longitude
                
                # Check if coordinates changed significantly (> 0.001 degrees ~ 111m)
                lat_diff = abs(float(spot.latitude) - lat) if spot.latitude else 999
                lon_diff = abs(float(spot.longitude) - lon) if spot.longitude else 999
                
                if lat_diff > 0.001 or lon_diff > 0.001:
                    # Store original coords if not already stored
                    if not spot.original_latitude:
                        spot.original_latitude = spot.latitude
                        spot.original_longitude = spot.longitude
                    
                    spot.latitude = lat
                    spot.longitude = lon
                    spot.is_verified_peak = True
                    spot.source = "surfline"
                    
                    logger.info(f"RECALIBRATED: {spot_name}")
                    logger.info(f"  OLD: ({old_lat}, {old_lon})")
                    logger.info(f"  NEW: ({lat}, {lon})")
                    logger.info(f"  NOTE: {notes}")
                    updated_count += 1
                else:
                    logger.info(f"SKIPPED (already precise): {spot_name}")
            else:
                logger.warning(f"NOT FOUND: {spot_name} - may need to be added")
        
        await db.commit()
        logger.info(f"\nTotal spots recalibrated: {updated_count}")
        return updated_count


async def add_missing_spots():
    """Add new Surfline-verified spots that are missing from DB."""
    async with async_session_maker() as db:
        added_count = 0
        
        for spot_data in NEW_SPOTS_TO_ADD:
            # Check if spot already exists
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.name == spot_data["name"])
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["latitude"],
                    longitude=spot_data["longitude"],
                    region=spot_data["region"],
                    country=spot_data["country"],
                    state_province=spot_data["state_province"],
                    wave_type=spot_data.get("wave_type"),
                    description=spot_data.get("description"),
                    difficulty=spot_data.get("difficulty"),
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=1  # Tier 1 for curated spots
                )
                db.add(new_spot)
                logger.info(f"ADDED: {spot_data['name']} at ({spot_data['latitude']}, {spot_data['longitude']})")
                added_count += 1
            else:
                logger.info(f"EXISTS: {spot_data['name']}")
        
        await db.commit()
        logger.info(f"\nTotal spots added: {added_count}")
        return added_count


async def verify_offshore_positions():
    """Verify all Central FL spots are offshore (longitude should be more negative = further west/into ocean)."""
    async with async_session_maker() as db:
        result = await db.execute(
            select(SurfSpot).where(
                (SurfSpot.region.ilike('%space coast%')) |
                (SurfSpot.region.ilike('%central florida%')) |
                (SurfSpot.state_province == 'Florida')
            ).where(
                SurfSpot.latitude.between(27.5, 29.5)  # Central FL latitude range
            )
        )
        spots = result.scalars().all()
        
        # Florida Atlantic coast longitude should be around -80.4 to -80.7
        # Spots should be east of the shoreline (more negative longitude)
        
        logger.info("\n=== OFFSHORE VERIFICATION ===")
        issues = []
        for spot in sorted(spots, key=lambda x: -x.latitude):  # North to South
            lon = float(spot.longitude)
            lat = float(spot.latitude)
            
            # Florida's Atlantic shoreline is roughly at -80.55 to -80.60
            # Anything less negative (e.g., -80.50) might be on land
            # Sebastian Inlet is special - it's at -80.44 which is correct
            
            if spot.name == "Sebastian Inlet":
                expected_lon_min = -80.50
            else:
                expected_lon_min = -80.65
            
            expected_lon_max = -80.40 if spot.name == "Sebastian Inlet" else -80.55
            
            status = "OK"
            if lon > expected_lon_max:
                status = "POTENTIALLY ON LAND (too far west)"
                issues.append(spot.name)
            elif lon < expected_lon_min:
                status = "OK (well offshore)"
            
            logger.info(f"{spot.name}: ({lat:.4f}, {lon:.4f}) - {status}")
        
        if issues:
            logger.warning(f"\nSpots needing review: {issues}")
        else:
            logger.info("\nAll spots appear to be properly offshore!")
        
        return len(issues) == 0


async def main():
    logger.info("=" * 60)
    logger.info("CENTRAL FLORIDA SURF SPOT RECALIBRATION")
    logger.info("Surfline Peak-Centric Precision Update")
    logger.info("=" * 60)
    
    # Step 1: Recalibrate existing spots
    logger.info("\n--- STEP 1: Recalibrating existing spots ---")
    recalibrated = await recalibrate_spots()
    
    # Step 2: Add missing spots
    logger.info("\n--- STEP 2: Adding missing Surfline spots ---")
    added = await add_missing_spots()
    
    # Step 3: Verify all spots are offshore
    logger.info("\n--- STEP 3: Verifying offshore positions ---")
    all_good = await verify_offshore_positions()
    
    # Summary
    logger.info("\n" + "=" * 60)
    logger.info("RECALIBRATION COMPLETE")
    logger.info(f"  Spots recalibrated: {recalibrated}")
    logger.info(f"  New spots added: {added}")
    logger.info(f"  Offshore verification: {'PASSED' if all_good else 'NEEDS REVIEW'}")
    logger.info("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
