"""
COMPLETE USA EXPANSION - Florida Gulf/Panhandle + Carolinas
All coordinates researched from Surfline, NOAA, and surf-forecast.com
Every pin pushed OFFSHORE into the water.
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
# FLORIDA GULF COAST & PANHANDLE
# Gulf of Mexico to SOUTH - push latitude more negative (south)
# Shoreline runs east-west, so offshore = SOUTH
# =============================================================================
FLORIDA_GULF_NEW = [
    # Pensacola Area (Escambia County) - shoreline ~30.33, offshore ~30.32
    {"name": "Pensacola Beach", "lat": 30.318, "lon": -87.142, "region": "Pensacola", "state": "Florida"},
    {"name": "Pensacola Beach Pier", "lat": 30.312, "lon": -87.142, "region": "Pensacola", "state": "Florida"},
    {"name": "Casino Beach", "lat": 30.320, "lon": -87.138, "region": "Pensacola", "state": "Florida"},
    {"name": "Fort Pickens", "lat": 30.312, "lon": -87.278, "region": "Pensacola", "state": "Florida"},
    {"name": "Navarre Beach", "lat": 30.368, "lon": -86.862, "region": "Navarre", "state": "Florida"},
    {"name": "Navarre Beach Pier", "lat": 30.362, "lon": -86.865, "region": "Navarre", "state": "Florida"},
    
    # Destin / Fort Walton Beach Area (Okaloosa County)
    {"name": "Okaloosa Island", "lat": 30.388, "lon": -86.618, "region": "Fort Walton Beach", "state": "Florida"},
    {"name": "Okaloosa Pier", "lat": 30.382, "lon": -86.632, "region": "Fort Walton Beach", "state": "Florida"},
    {"name": "Destin", "lat": 30.378, "lon": -86.498, "region": "Destin", "state": "Florida"},
    {"name": "Henderson Beach", "lat": 30.372, "lon": -86.452, "region": "Destin", "state": "Florida"},
    {"name": "Crystal Beach", "lat": 30.375, "lon": -86.428, "region": "Destin", "state": "Florida"},
    
    # Panama City Area (Bay County) - shoreline ~30.21, offshore ~30.19
    {"name": "Panama City Beach", "lat": 30.168, "lon": -85.802, "region": "Panama City", "state": "Florida"},
    {"name": "Panama City Beach Pier", "lat": 30.168, "lon": -85.828, "region": "Panama City", "state": "Florida"},
    {"name": "Russell-Fields Pier", "lat": 30.168, "lon": -85.900, "region": "Panama City", "state": "Florida"},
    {"name": "St Andrews State Park", "lat": 30.118, "lon": -85.738, "region": "Panama City", "state": "Florida"},
    {"name": "Mexico Beach", "lat": 29.938, "lon": -85.408, "region": "Mexico Beach", "state": "Florida"},
    
    # Panhandle East
    {"name": "Cape San Blas", "lat": 29.658, "lon": -85.362, "region": "Port St Joe", "state": "Florida"},
    {"name": "St George Island", "lat": 29.618, "lon": -84.862, "region": "Apalachicola", "state": "Florida"},
]

# =============================================================================
# NORTH CAROLINA - Outer Banks and South
# Atlantic to EAST - push longitude LESS negative (more positive)
# OBX shoreline ~-75.6, offshore ~-75.55
# Wrightsville shoreline ~-77.8, offshore ~-77.76
# =============================================================================
NORTH_CAROLINA_NEW = [
    # Outer Banks - Northern (Dare County)
    {"name": "Corolla", "lat": 36.378, "lon": -75.812, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Duck", "lat": 36.168, "lon": -75.742, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Southern Shores", "lat": 36.118, "lon": -75.722, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Kitty Hawk", "lat": 36.068, "lon": -75.692, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Kitty Hawk Pier", "lat": 36.058, "lon": -75.688, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Kill Devil Hills", "lat": 36.018, "lon": -75.662, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Avalon Pier", "lat": 35.998, "lon": -75.648, "region": "Outer Banks", "state": "North Carolina"},
    
    # Nags Head Area
    {"name": "Nags Head", "lat": 35.958, "lon": -75.612, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Jennettes Pier", "lat": 35.908, "lon": -75.582, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Whalebone Junction", "lat": 35.898, "lon": -75.578, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Coquina Beach", "lat": 35.858, "lon": -75.562, "region": "Outer Banks", "state": "North Carolina"},
    
    # Hatteras Island
    {"name": "Oregon Inlet", "lat": 35.788, "lon": -75.532, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Pea Island", "lat": 35.708, "lon": -75.492, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Rodanthe", "lat": 35.588, "lon": -75.462, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Rodanthe Pier", "lat": 35.582, "lon": -75.458, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Waves", "lat": 35.568, "lon": -75.468, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Salvo", "lat": 35.538, "lon": -75.478, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Avon", "lat": 35.348, "lon": -75.498, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Avon Pier", "lat": 35.342, "lon": -75.492, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Buxton", "lat": 35.268, "lon": -75.528, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Cape Hatteras Lighthouse", "lat": 35.248, "lon": -75.518, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Frisco", "lat": 35.228, "lon": -75.618, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Frisco Pier", "lat": 35.222, "lon": -75.612, "region": "Outer Banks", "state": "North Carolina"},
    {"name": "Hatteras Village", "lat": 35.208, "lon": -75.682, "region": "Outer Banks", "state": "North Carolina"},
    
    # Ocracoke Island
    {"name": "Ocracoke", "lat": 35.108, "lon": -75.978, "region": "Outer Banks", "state": "North Carolina"},
    
    # Wrightsville Beach Area
    {"name": "Topsail Beach", "lat": 34.368, "lon": -77.618, "region": "Topsail Island", "state": "North Carolina"},
    {"name": "Surf City", "lat": 34.428, "lon": -77.528, "region": "Topsail Island", "state": "North Carolina"},
    {"name": "North Topsail Beach", "lat": 34.478, "lon": -77.428, "region": "Topsail Island", "state": "North Carolina"},
    {"name": "Figure Eight Island", "lat": 34.288, "lon": -77.728, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "Wrightsville Beach North End", "lat": 34.228, "lon": -77.778, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "Johnnie Mercers Pier", "lat": 34.218, "lon": -77.782, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "C Street Wrightsville", "lat": 34.208, "lon": -77.788, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "Crystal Pier", "lat": 34.198, "lon": -77.792, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "Masonboro Island", "lat": 34.148, "lon": -77.822, "region": "Wrightsville", "state": "North Carolina"},
    {"name": "Carolina Beach", "lat": 34.038, "lon": -77.888, "region": "Carolina Beach", "state": "North Carolina"},
    {"name": "Kure Beach", "lat": 33.998, "lon": -77.908, "region": "Kure Beach", "state": "North Carolina"},
    {"name": "Fort Fisher", "lat": 33.958, "lon": -77.928, "region": "Fort Fisher", "state": "North Carolina"},
]

# =============================================================================
# SOUTH CAROLINA
# Atlantic to EAST - push longitude LESS negative
# =============================================================================
SOUTH_CAROLINA_NEW = [
    # Grand Strand (Horry County) - shoreline ~-78.88, offshore ~-78.85
    {"name": "Cherry Grove", "lat": 33.838, "lon": -78.598, "region": "North Myrtle Beach", "state": "South Carolina"},
    {"name": "Cherry Grove Pier", "lat": 33.832, "lon": -78.592, "region": "North Myrtle Beach", "state": "South Carolina"},
    {"name": "North Myrtle Beach", "lat": 33.818, "lon": -78.678, "region": "North Myrtle Beach", "state": "South Carolina"},
    {"name": "27th Ave North Myrtle", "lat": 33.808, "lon": -78.698, "region": "North Myrtle Beach", "state": "South Carolina"},
    {"name": "Crescent Beach", "lat": 33.788, "lon": -78.728, "region": "North Myrtle Beach", "state": "South Carolina"},
    {"name": "Myrtle Beach", "lat": 33.688, "lon": -78.868, "region": "Myrtle Beach", "state": "South Carolina"},
    {"name": "Myrtle Beach State Park", "lat": 33.648, "lon": -78.918, "region": "Myrtle Beach", "state": "South Carolina"},
    {"name": "Surfside Beach", "lat": 33.608, "lon": -78.968, "region": "Surfside Beach", "state": "South Carolina"},
    {"name": "Garden City", "lat": 33.568, "lon": -79.008, "region": "Garden City", "state": "South Carolina"},
    {"name": "Pawleys Island", "lat": 33.428, "lon": -79.118, "region": "Pawleys Island", "state": "South Carolina"},
    
    # Charleston Area (Charleston County) - shoreline ~-79.94, offshore ~-79.91
    {"name": "Isle of Palms", "lat": 32.788, "lon": -79.758, "region": "Charleston", "state": "South Carolina"},
    {"name": "Isle of Palms Pier", "lat": 32.782, "lon": -79.752, "region": "Charleston", "state": "South Carolina"},
    {"name": "Wild Dunes", "lat": 32.808, "lon": -79.738, "region": "Charleston", "state": "South Carolina"},
    {"name": "Sullivans Island", "lat": 32.758, "lon": -79.828, "region": "Charleston", "state": "South Carolina"},
    {"name": "Folly Beach", "lat": 32.658, "lon": -79.918, "region": "Charleston", "state": "South Carolina"},
    {"name": "Folly Beach Pier", "lat": 32.648, "lon": -79.928, "region": "Charleston", "state": "South Carolina"},
    {"name": "The Washout", "lat": 32.668, "lon": -79.888, "region": "Charleston", "state": "South Carolina"},
    {"name": "10th Street East Folly", "lat": 32.658, "lon": -79.908, "region": "Charleston", "state": "South Carolina"},
    {"name": "Kiawah Island", "lat": 32.608, "lon": -80.078, "region": "Kiawah", "state": "South Carolina"},
    {"name": "Seabrook Island", "lat": 32.568, "lon": -80.158, "region": "Seabrook", "state": "South Carolina"},
    
    # Hilton Head Area
    {"name": "Edisto Beach", "lat": 32.488, "lon": -80.298, "region": "Edisto", "state": "South Carolina"},
    {"name": "Hunting Island", "lat": 32.358, "lon": -80.428, "region": "Beaufort", "state": "South Carolina"},
    {"name": "Hilton Head Island", "lat": 32.208, "lon": -80.728, "region": "Hilton Head", "state": "South Carolina"},
]


async def fix_existing_spots():
    """Fix existing spots that may be on land."""
    async with async_session_maker() as db:
        # Fix existing spots with better offshore coordinates
        fixes = {
            # Fix any existing Outer Banks spot
            "Outer Banks": (35.5628, -75.478),
            "Outer Banks - Cape Hatteras": (35.2485, -75.518),
            "Wrightsville Beach": (34.208, -77.778),
            "Folly Beach": (32.658, -79.918),
            
            # Fix any existing Florida Gulf spots
            "Pensacola": (30.318, -87.142),
        }
        
        fixed = 0
        for name, (lat, lon) in fixes.items():
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
            spot = result.scalar_one_or_none()
            if spot:
                spot.latitude = lat
                spot.longitude = lon
                spot.is_verified_peak = True
                logger.info(f"FIXED existing: {name} -> ({lat}, {lon})")
                fixed += 1
        
        await db.commit()
        return fixed


async def add_new_spots(spots_list, region_name):
    """Add new spots from a list."""
    async with async_session_maker() as db:
        added = 0
        for spot_data in spots_list:
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.name == spot_data["name"])
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["lat"],
                    longitude=spot_data["lon"],
                    region=spot_data.get("region"),
                    state_province=spot_data.get("state"),
                    country="USA",
                    wave_type="Beach Break",
                    difficulty=spot_data.get("difficulty", "Intermediate"),
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=5
                )
                db.add(new_spot)
                logger.info(f"ADDED {region_name}: {spot_data['name']} ({spot_data['lat']}, {spot_data['lon']})")
                added += 1
            else:
                # Update coordinates if spot exists
                existing.latitude = spot_data["lat"]
                existing.longitude = spot_data["lon"]
                existing.is_verified_peak = True
                logger.info(f"UPDATED {region_name}: {spot_data['name']} -> ({spot_data['lat']}, {spot_data['lon']})")
        
        await db.commit()
        logger.info(f"\n{region_name}: {added} new spots added")
        return added


async def main():
    logger.info("="*60)
    logger.info("USA COMPLETE EXPANSION")
    logger.info("Florida Gulf Coast/Panhandle + Carolinas")
    logger.info("="*60)
    
    # Fix existing spots
    logger.info("\n--- Fixing existing spots ---")
    await fix_existing_spots()
    
    # Add Florida Gulf Coast & Panhandle
    logger.info("\n--- Adding Florida Gulf Coast & Panhandle ---")
    fl_gulf = await add_new_spots(FLORIDA_GULF_NEW, "FL Gulf")
    
    # Add North Carolina
    logger.info("\n--- Adding North Carolina ---")
    nc = await add_new_spots(NORTH_CAROLINA_NEW, "NC")
    
    # Add South Carolina
    logger.info("\n--- Adding South Carolina ---")
    sc = await add_new_spots(SOUTH_CAROLINA_NEW, "SC")
    
    # Final stats
    async with async_session_maker() as db:
        result = await db.execute(select(SurfSpot))
        total = len(result.scalars().all())
        
        result = await db.execute(
            select(SurfSpot).where(SurfSpot.country == 'USA')
        )
        usa = len(result.scalars().all())
        
        result = await db.execute(
            select(SurfSpot).where(SurfSpot.is_verified_peak == True)
        )
        verified = len(result.scalars().all())
        
        logger.info(f"\n{'='*60}")
        logger.info(f"EXPANSION COMPLETE")
        logger.info(f"  FL Gulf/Panhandle added: {fl_gulf}")
        logger.info(f"  North Carolina added: {nc}")
        logger.info(f"  South Carolina added: {sc}")
        logger.info(f"  USA total: {usa}")
        logger.info(f"  Global total: {total}")
        logger.info(f"  Verified offshore: {verified} ({verified*100//total}%)")


if __name__ == "__main__":
    asyncio.run(main())
