"""
Surf Spot Data Normalization Migration
========================================
Fixes:
1. Populates missing state_province values for spots in countries that have empty sub-regions
2. Consolidates duplicate country entries (Puerto Rico → USA, Canary Islands → Spain, etc.)
3. Normalizes country naming (leaves USA as-is since it's the DB standard)

Run: python scripts/normalize_surf_spot_hierarchy.py
"""

import asyncio
import sys
import os
sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update, func
from database import async_engine, get_db, AsyncSessionLocal
from models import SurfSpot
import logging

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# ============================================================
# STATE/PROVINCE MAPPINGS FOR COUNTRIES MISSING SUB-REGIONS
# ============================================================
# These are based on actual geographic data from Surfline, Stormrider, etc.
# We use the spot's existing region + coordinates to infer the state/province.

# For small island nations/territories, the state_province = the island/region name
# This ensures they appear in the hierarchy correctly.

# Bahamas - group by island
BAHAMAS_REGION_TO_STATE = {
    "New Providence": "New Providence",
    "Nassau": "New Providence",
    "Eleuthera": "Eleuthera",
    "Cat Island": "Cat Island",
    "Abaco": "Abaco",
    "Grand Bahama": "Grand Bahama",
    "Long Island": "Long Island",
    "Exuma": "Exuma",
}

# Bermuda - single island, use shore
BERMUDA_REGION_TO_STATE = {
    "South Shore": "South Shore",
    "North Shore": "North Shore",
    "West End": "West End",
    "East End": "East End",
}

# BVI - group by island
BVI_REGION_TO_STATE = {
    "Tortola": "Tortola",
    "Virgin Gorda": "Virgin Gorda",
    "Anegada": "Anegada",
    "Jost Van Dyke": "Jost Van Dyke",
}

# Canada - group by province
CANADA_LAT_TO_STATE = [
    # (min_lat, max_lat, min_lng, max_lng, state_name)
    (48.0, 55.0, -130.0, -120.0, "British Columbia"),
    (43.0, 48.0, -67.0, -59.0, "Nova Scotia"),
    (45.0, 49.0, -68.0, -64.0, "New Brunswick"),
    (46.0, 49.0, -60.0, -52.0, "Newfoundland"),
]

# Cook Islands - all Rarotonga
COOK_ISLANDS_STATE = "Rarotonga"

# Iceland - use region names
ICELAND_STATE = "Iceland"

# Cape Verde - use island names
CAPE_VERDE_STATE = "Cape Verde"

# Channel Islands - single
CHANNEL_ISLANDS_STATE = "Channel Islands"

# Mauritius - single island
MAURITIUS_STATE = "Mauritius"

# Norway - use region
NORWAY_STATE = "Norway"

# Reunion Island
REUNION_STATE = "Reunion"

# Trinidad & Tobago
TRINIDAD_STATE = "Trinidad & Tobago"

# U.S. Virgin Islands
USVI_STATE = "U.S. Virgin Islands"

# Uruguay
URUGUAY_STATE = "Uruguay"


# ============================================================
# COUNTRY CONSOLIDATION - move orphan entries under parent country
# ============================================================
COUNTRY_CONSOLIDATION = [
    # (old_country, new_country, new_state_province)
    # Canary Islands standalone → Spain
    ("Canary Islands", "Spain", "Canary Islands"),
    # Northern Ireland → United Kingdom
    ("Northern Ireland", "United Kingdom", "Northern Ireland"),
    # Wales standalone → United Kingdom (only the 1 orphan spot)
    # NOTE: Wales already has 6 spots under UK → Wales, we just need to move the 1 orphan
    ("Wales", "United Kingdom", "Wales"),
]

# Puerto Rico: exists as both standalone country (10 spots) AND as USA state (10 spots)
# These appear to be different spot records, so we'll consolidate standalone → USA
PUERTO_RICO_CONSOLIDATION = ("Puerto Rico", "USA", "Puerto Rico")


async def populate_missing_state_province():
    """Populate state_province for spots that have country but no state_province."""
    async with AsyncSessionLocal() as db:
        # Get all spots with NULL state_province
        result = await db.execute(
            select(SurfSpot)
            .where(SurfSpot.state_province.is_(None))
            .where(SurfSpot.country.isnot(None))
            .where(SurfSpot.is_active.is_(True))
        )
        spots = result.scalars().all()
        
        updated_count = 0
        skipped = []
        
        for spot in spots:
            new_state = None
            country = spot.country
            region = spot.region or ""
            
            if country == "Bahamas":
                # Try to match by region name
                new_state = BAHAMAS_REGION_TO_STATE.get(region, "Bahamas")
                
            elif country == "Bermuda":
                # Infer from latitude - south shore is below ~32.3
                if spot.latitude and spot.latitude < 32.3:
                    new_state = "South Shore"
                else:
                    new_state = BERMUDA_REGION_TO_STATE.get(region, "Bermuda")
                    
            elif country == "British Virgin Islands":
                new_state = BVI_REGION_TO_STATE.get(region, "Tortola")
                
            elif country == "Canada":
                # Use coordinates to determine province
                matched = False
                if spot.latitude and spot.longitude:
                    for min_lat, max_lat, min_lng, max_lng, state_name in CANADA_LAT_TO_STATE:
                        if min_lat <= spot.latitude <= max_lat and min_lng <= spot.longitude <= max_lng:
                            new_state = state_name
                            matched = True
                            break
                if not matched:
                    new_state = "Canada"
                    
            elif country == "Cook Islands":
                new_state = COOK_ISLANDS_STATE
                
            elif country == "Iceland":
                new_state = ICELAND_STATE
                
            elif country == "Cape Verde":
                new_state = CAPE_VERDE_STATE
                
            elif country == "Channel Islands":
                new_state = CHANNEL_ISLANDS_STATE
                
            elif country == "Mauritius":
                new_state = MAURITIUS_STATE
                
            elif country == "Norway":
                new_state = NORWAY_STATE
                
            elif country == "Reunion Island":
                new_state = REUNION_STATE
                
            elif country == "Trinidad & Tobago":
                new_state = TRINIDAD_STATE
                
            elif country == "U.S. Virgin Islands":
                new_state = USVI_STATE
                
            elif country == "Uruguay":
                new_state = URUGUAY_STATE
                
            elif country == "Argentina":
                new_state = "Buenos Aires"
                
            elif country == "Belize":
                new_state = "Belize"
            
            if new_state:
                spot.state_province = new_state
                updated_count += 1
                logger.info(f"  ✅ {spot.name} ({country}) → state_province = '{new_state}'")
            else:
                skipped.append(f"{spot.name} ({country}, region={region})")
        
        if updated_count > 0:
            await db.commit()
        
        logger.info(f"\n📊 Updated {updated_count} spots with missing state_province")
        if skipped:
            logger.info(f"⚠️  Skipped {len(skipped)} spots: {skipped}")


async def consolidate_countries():
    """Move orphaned country entries under their parent country."""
    async with AsyncSessionLocal() as db:
        total_moved = 0
        
        for old_country, new_country, new_state in COUNTRY_CONSOLIDATION:
            result = await db.execute(
                select(SurfSpot)
                .where(SurfSpot.country == old_country)
                .where(SurfSpot.is_active.is_(True))
            )
            spots = result.scalars().all()
            
            if spots:
                for spot in spots:
                    old_state = spot.state_province
                    spot.country = new_country
                    if not spot.state_province:
                        spot.state_province = new_state
                    logger.info(f"  🔄 {spot.name}: {old_country} → {new_country}/{spot.state_province}")
                    total_moved += 1
        
        # Handle Puerto Rico separately - check for true duplicates first
        pr_old_country, pr_new_country, pr_new_state = PUERTO_RICO_CONSOLIDATION
        pr_result = await db.execute(
            select(SurfSpot)
            .where(SurfSpot.country == pr_old_country)
            .where(SurfSpot.is_active.is_(True))
        )
        pr_standalone_spots = pr_result.scalars().all()
        
        # Get PR spots already under USA
        pr_usa_result = await db.execute(
            select(SurfSpot.name)
            .where(SurfSpot.country == "USA")
            .where(SurfSpot.state_province == "Puerto Rico")
            .where(SurfSpot.is_active.is_(True))
        )
        pr_usa_names = {row[0].strip().lower() for row in pr_usa_result.all()}
        
        for spot in pr_standalone_spots:
            # Check if this is a true duplicate (same name already under USA)
            if spot.name.strip().lower() in pr_usa_names:
                logger.info(f"  ⚠️  DUPLICATE: {spot.name} already exists under USA/Puerto Rico — deactivating standalone")
                spot.is_active = False  # Deactivate the duplicate
            else:
                spot.country = pr_new_country
                if not spot.state_province:
                    spot.state_province = pr_new_state
                logger.info(f"  🔄 {spot.name}: Puerto Rico → USA/Puerto Rico")
            total_moved += 1
        
        if total_moved > 0:
            await db.commit()
        
        logger.info(f"\n📊 Consolidated {total_moved} spots from orphan countries")


async def verify_hierarchy():
    """Verify the hierarchy is complete after migration."""
    async with AsyncSessionLocal() as db:
        # Count spots with NULL state_province
        null_result = await db.execute(
            select(func.count(SurfSpot.id))
            .where(SurfSpot.state_province.is_(None))
            .where(SurfSpot.is_active.is_(True))
        )
        null_count = null_result.scalar()
        
        # Count unique countries
        countries_result = await db.execute(
            select(func.count(func.distinct(SurfSpot.country)))
            .where(SurfSpot.is_active.is_(True))
        )
        country_count = countries_result.scalar()
        
        # Count total active spots
        total_result = await db.execute(
            select(func.count(SurfSpot.id))
            .where(SurfSpot.is_active.is_(True))
        )
        total_count = total_result.scalar()
        
        # List countries still with NULL state_province spots
        if null_count > 0:
            null_countries = await db.execute(
                select(SurfSpot.country, func.count(SurfSpot.id))
                .where(SurfSpot.state_province.is_(None))
                .where(SurfSpot.is_active.is_(True))
                .group_by(SurfSpot.country)
            )
            logger.info("\n⚠️  Countries still with NULL state_province:")
            for country, count in null_countries.all():
                logger.info(f"    {country}: {count} spots")
        
        logger.info(f"\n📊 Verification Summary:")
        logger.info(f"   Total active spots: {total_count}")
        logger.info(f"   Unique countries: {country_count}")
        logger.info(f"   Spots missing state_province: {null_count}")
        
        if null_count == 0:
            logger.info("   ✅ All spots have state_province populated!")


async def main():
    logger.info("=" * 60)
    logger.info("SURF SPOT HIERARCHY NORMALIZATION")
    logger.info("=" * 60)
    
    logger.info("\n🔧 Step 1: Consolidating orphan countries...")
    await consolidate_countries()
    
    logger.info("\n🔧 Step 2: Populating missing state_province values...")
    await populate_missing_state_province()
    
    logger.info("\n🔍 Step 3: Verifying hierarchy...")
    await verify_hierarchy()
    
    logger.info("\n✅ Migration complete!")


if __name__ == "__main__":
    asyncio.run(main())
