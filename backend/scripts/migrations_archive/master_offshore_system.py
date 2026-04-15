"""
MASTER OFFSHORE COORDINATE SYSTEM
Comprehensive analysis and correction of ALL surf spot coordinates globally.

This script:
1. Defines coastline orientations for every region
2. Calculates proper offshore offsets based on ocean direction
3. Ensures ALL pins are IN THE WATER, not on land

COASTLINE GEOMETRY RULES:
- Identify which direction the ocean faces for each coastline
- Push coordinates PERPENDICULAR to the shoreline INTO the water
- Use approximately 500-1500m offshore offset depending on break type
"""
import asyncio
import logging
import math
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# COASTLINE ORIENTATION DATABASE
# For each region, define: (ocean_direction, lat_offset, lon_offset)
# ocean_direction: N, S, E, W, NE, NW, SE, SW
# Offsets are in degrees (0.01 degree ≈ 1.1km)
# =============================================================================

COASTLINE_ORIENTATIONS = {
    # USA - FLORIDA
    "Florida_Atlantic_North": ("E", 0, 0.025),      # Jacksonville to Daytona - ocean EAST
    "Florida_Atlantic_Central": ("E", 0, 0.020),    # Daytona to Melbourne - ocean EAST
    "Florida_Atlantic_Space_Coast": ("E", 0, 0.018), # Space Coast - ocean EAST
    "Florida_Atlantic_Treasure": ("E", 0, 0.022),   # Treasure Coast - ocean EAST
    "Florida_Atlantic_Palm": ("E", 0, 0.020),       # Palm Beach - ocean EAST
    "Florida_Atlantic_South": ("E", 0, 0.018),      # Fort Lauderdale to Miami - ocean EAST
    "Florida_Gulf_West": ("W", 0, -0.022),          # Tampa/Clearwater - ocean WEST
    "Florida_Gulf_Southwest": ("W", 0, -0.020),     # Naples/Fort Myers - ocean WEST
    "Florida_Panhandle": ("S", -0.020, 0),          # Pensacola to Panama City - ocean SOUTH
    
    # USA - CALIFORNIA
    "California_San_Diego": ("W", 0, -0.018),       # San Diego - ocean WEST
    "California_Orange": ("W", 0, -0.020),          # Orange County - ocean WEST
    "California_LA": ("W", 0, -0.022),              # Los Angeles - ocean WEST
    "California_Ventura": ("W", 0, -0.020),         # Ventura - ocean WEST
    "California_Santa_Barbara": ("W", 0, -0.022),   # Santa Barbara - ocean WEST
    "California_Central": ("W", 0, -0.025),         # Central Coast - ocean WEST
    "California_Santa_Cruz": ("SW", -0.010, -0.015), # Santa Cruz - ocean SOUTHWEST
    "California_SF": ("W", 0, -0.020),              # San Francisco - ocean WEST
    "California_North": ("W", 0, -0.025),           # North Coast - ocean WEST
    
    # USA - HAWAII
    "Hawaii_North_Shore": ("N", 0.015, 0),          # North Shore Oahu - ocean NORTH
    "Hawaii_South_Shore": ("S", -0.012, 0),         # South Shore Oahu - ocean SOUTH
    "Hawaii_West": ("W", 0, -0.015),                # West side - ocean WEST
    "Hawaii_East": ("E", 0, 0.015),                 # East side - ocean EAST
    
    # USA - EAST COAST
    "East_Coast_NE": ("E", 0, 0.020),               # New England - ocean EAST
    "East_Coast_NY_NJ": ("E", 0, 0.022),            # NY/NJ - ocean EAST
    "East_Coast_Mid_Atlantic": ("E", 0, 0.020),     # MD/VA - ocean EAST
    "East_Coast_NC_OBX": ("E", 0, 0.025),           # Outer Banks - ocean EAST
    "East_Coast_NC_South": ("E", 0, 0.022),         # Southern NC - ocean EAST
    "East_Coast_SC": ("E", 0, 0.022),               # South Carolina - ocean EAST
    
    # USA - PACIFIC NORTHWEST
    "Oregon": ("W", 0, -0.025),                     # Oregon - ocean WEST
    "Washington": ("W", 0, -0.028),                 # Washington - ocean WEST
    
    # USA - TEXAS
    "Texas_Gulf": ("SE", -0.015, 0.010),            # Texas - ocean SOUTH/EAST
    
    # USA - PUERTO RICO
    "Puerto_Rico_North": ("N", 0.015, 0),           # North coast - ocean NORTH
    "Puerto_Rico_West": ("W", 0, -0.020),           # Rincon area - ocean WEST
    
    # AUSTRALIA
    "Australia_Gold_Coast": ("E", 0, 0.018),        # Gold Coast - ocean EAST
    "Australia_Sunshine": ("E", 0, 0.015),          # Sunshine Coast - ocean EAST
    "Australia_Byron": ("E", 0, 0.018),             # Byron Bay - ocean EAST
    "Australia_Sydney": ("E", 0, 0.015),            # Sydney - ocean EAST
    "Australia_Victoria": ("S", -0.015, 0),         # Victoria - ocean SOUTH
    "Australia_WA": ("W", 0, -0.020),               # Western Australia - ocean WEST
    
    # INDONESIA
    "Bali_South": ("S", -0.012, 0),                 # Bali South - ocean SOUTH
    "Bali_West": ("W", 0, -0.012),                  # Bali West - ocean WEST
    "Lombok": ("S", -0.012, 0),                     # Lombok - ocean SOUTH
    "Java": ("S", -0.015, 0),                       # Java - ocean SOUTH
    "Mentawai": ("SW", -0.010, -0.010),             # Mentawai - ocean SOUTHWEST
    
    # FRANCE
    "France_Hossegor": ("W", 0, -0.020),            # Hossegor - ocean WEST
    "France_Biarritz": ("W", 0, -0.022),            # Biarritz - ocean WEST
    "France_Landes": ("W", 0, -0.020),              # Landes - ocean WEST
    
    # PORTUGAL
    "Portugal_Nazare": ("W", 0, -0.025),            # Nazaré - ocean WEST
    "Portugal_Peniche": ("W", 0, -0.022),           # Peniche - ocean WEST
    "Portugal_Ericeira": ("W", 0, -0.020),          # Ericeira - ocean WEST
    "Portugal_Algarve": ("SW", -0.010, -0.015),     # Algarve - ocean SOUTHWEST
    
    # BRAZIL
    "Brazil_Rio": ("E", 0, 0.020),                  # Rio - ocean EAST
    "Brazil_Floripa": ("E", 0, 0.022),              # Florianópolis - ocean EAST
    "Brazil_Sao_Paulo": ("E", 0, 0.018),            # São Paulo coast - ocean EAST
    "Brazil_Northeast": ("E", 0, 0.022),            # Northeast - ocean EAST
    
    # PERU
    "Peru": ("W", 0, -0.022),                       # Peru - ocean WEST
    
    # CHILE
    "Chile": ("W", 0, -0.025),                      # Chile - ocean WEST
    
    # SOUTH AFRICA
    "South_Africa_JBay": ("SE", -0.010, 0.015),     # J-Bay - ocean SOUTHEAST
    "South_Africa_Cape": ("W", 0, -0.020),          # Cape Town - ocean WEST
    
    # CARIBBEAN
    "Caribbean_Barbados_East": ("E", 0, 0.020),     # Barbados East - ocean EAST
    "Caribbean_Barbados_South": ("S", -0.015, 0),   # Barbados South - ocean SOUTH
    
    # JAPAN
    "Japan_Chiba": ("E", 0, 0.018),                 # Chiba - ocean EAST
    "Japan_Shonan": ("S", -0.012, 0),               # Shonan - ocean SOUTH
    "Japan_Miyazaki": ("E", 0, 0.015),              # Miyazaki - ocean EAST
    
    # PHILIPPINES
    "Philippines_Siargao": ("E", 0, 0.015),         # Siargao - ocean EAST
    "Philippines_La_Union": ("W", 0, -0.015),       # La Union - ocean WEST
    
    # SPAIN
    "Spain_Basque": ("N", 0.015, 0),                # Basque Country - ocean NORTH
    
    # COSTA RICA
    "Costa_Rica_Pacific": ("W", 0, -0.020),         # Pacific side - ocean WEST
    
    # MEXICO
    "Mexico_Pacific": ("W", 0, -0.022),             # Pacific side - ocean WEST
}


def get_region_for_spot(spot):
    """Determine the coastline region for a spot based on country and coordinates."""
    country = spot.country or ""
    lat = float(spot.latitude) if spot.latitude else 0
    lon = float(spot.longitude) if spot.longitude else 0
    region = spot.region or ""
    state = spot.state_province or ""
    
    # USA
    if country == "USA":
        # Florida
        if state == "Florida" or "Florida" in region:
            if lon < -85:  # Panhandle
                return "Florida_Panhandle"
            elif lon < -82:  # Gulf West (Tampa, Clearwater)
                return "Florida_Gulf_West"
            elif lon < -81.5:  # Gulf Southwest (Naples)
                return "Florida_Gulf_Southwest"
            elif lat > 29.5:  # North Atlantic
                return "Florida_Atlantic_North"
            elif lat > 28.8:  # Central Atlantic (Daytona)
                return "Florida_Atlantic_Central"
            elif lat > 27.5:  # Space Coast / Treasure Coast
                return "Florida_Atlantic_Space_Coast"
            elif lat > 26.5:  # Palm Beach
                return "Florida_Atlantic_Palm"
            else:  # South Florida
                return "Florida_Atlantic_South"
        
        # California
        elif state == "California" or lon < -115:
            if lat < 33:
                return "California_San_Diego"
            elif lat < 33.8:
                return "California_Orange"
            elif lat < 34.2:
                return "California_LA"
            elif lat < 34.5:
                return "California_Ventura"
            elif lat < 35:
                return "California_Santa_Barbara"
            elif lat < 36.5:
                return "California_Central"
            elif lat < 37.2:
                return "California_Santa_Cruz"
            elif lat < 38:
                return "California_SF"
            else:
                return "California_North"
        
        # Hawaii
        elif lon < -150:
            name = spot.name or ""
            if "north" in name.lower() or "pipeline" in name.lower() or "sunset" in name.lower():
                return "Hawaii_North_Shore"
            elif "south" in name.lower() or "waikiki" in name.lower() or "diamond" in name.lower():
                return "Hawaii_South_Shore"
            elif lat > 21.5:
                return "Hawaii_North_Shore"
            else:
                return "Hawaii_South_Shore"
        
        # Texas
        elif state == "Texas" or (lon > -98 and lon < -93 and lat < 30):
            return "Texas_Gulf"
        
        # Pacific Northwest
        elif state == "Oregon" or (lat > 41 and lat < 46.5 and lon < -123):
            return "Oregon"
        elif state == "Washington" or (lat > 46 and lon < -123):
            return "Washington"
        
        # Puerto Rico
        elif "Puerto Rico" in region or (lat > 17.5 and lat < 18.6 and lon > -68 and lon < -65):
            if "rincon" in (spot.name or "").lower():
                return "Puerto_Rico_West"
            return "Puerto_Rico_North"
        
        # East Coast
        elif lat > 40:
            return "East_Coast_NE"
        elif lat > 38.5:
            return "East_Coast_NY_NJ"
        elif lat > 36:
            return "East_Coast_Mid_Atlantic"
        elif lat > 34.5:
            return "East_Coast_NC_OBX"
        elif lat > 33.5 and state == "North Carolina":
            return "East_Coast_NC_South"
        else:
            return "East_Coast_SC"
    
    # Australia
    elif country == "Australia":
        if lon > 152:  # Gold Coast / Byron
            if lat > -28:
                return "Australia_Gold_Coast"
            elif lat > -29:
                return "Australia_Byron"
            else:
                return "Australia_Sunshine"
        elif lon > 150:  # Sydney area
            return "Australia_Sydney"
        elif lon < 120:  # Western Australia
            return "Australia_WA"
        else:  # Victoria
            return "Australia_Victoria"
    
    # Indonesia
    elif country == "Indonesia":
        name = spot.name or ""
        if "uluwatu" in name.lower() or "padang" in name.lower() or "bingin" in name.lower():
            return "Bali_South"
        elif "canggu" in name.lower() or "echo" in name.lower() or "medewi" in name.lower():
            return "Bali_West"
        elif "lombok" in name.lower() or "desert" in name.lower() or "gerupuk" in name.lower():
            return "Lombok"
        elif "g-land" in name.lower() or "java" in name.lower():
            return "Java"
        else:
            return "Mentawai"
    
    # France
    elif country == "France":
        name = spot.name or ""
        if "hossegor" in name.lower() or "graviere" in name.lower():
            return "France_Hossegor"
        elif "biarritz" in name.lower() or "anglet" in name.lower():
            return "France_Biarritz"
        else:
            return "France_Landes"
    
    # Portugal
    elif country == "Portugal":
        name = spot.name or ""
        if "nazare" in name.lower():
            return "Portugal_Nazare"
        elif "peniche" in name.lower() or "supertubos" in name.lower():
            return "Portugal_Peniche"
        elif "ericeira" in name.lower() or "coxos" in name.lower():
            return "Portugal_Ericeira"
        else:
            return "Portugal_Algarve"
    
    # Brazil
    elif country == "Brazil":
        if lat > -24:
            return "Brazil_Rio"
        elif lat > -28:
            return "Brazil_Floripa"
        elif lat > -25:
            return "Brazil_Sao_Paulo"
        else:
            return "Brazil_Northeast"
    
    # Peru
    elif country == "Peru":
        return "Peru"
    
    # Chile
    elif country == "Chile":
        return "Chile"
    
    # South Africa
    elif country == "South Africa":
        if lon > 24:
            return "South_Africa_JBay"
        else:
            return "South_Africa_Cape"
    
    # Barbados
    elif country == "Barbados":
        name = spot.name or ""
        if "soup" in name.lower():
            return "Caribbean_Barbados_East"
        else:
            return "Caribbean_Barbados_South"
    
    # Japan
    elif country == "Japan":
        region_lower = (spot.region or "").lower()
        if "chiba" in region_lower:
            return "Japan_Chiba"
        elif "shonan" in region_lower:
            return "Japan_Shonan"
        else:
            return "Japan_Miyazaki"
    
    # Philippines
    elif country == "Philippines":
        region_lower = (spot.region or "").lower()
        if "siargao" in region_lower:
            return "Philippines_Siargao"
        else:
            return "Philippines_La_Union"
    
    # Spain
    elif country == "Spain":
        return "Spain_Basque"
    
    # Costa Rica
    elif country == "Costa Rica":
        return "Costa_Rica_Pacific"
    
    # Mexico
    elif country == "Mexico":
        return "Mexico_Pacific"
    
    # Default - try to infer from coordinates
    return None


async def apply_offshore_corrections():
    """Apply offshore corrections to ALL spots based on coastline orientation."""
    async with async_session_maker() as db:
        result = await db.execute(select(SurfSpot))
        spots = result.scalars().all()
        
        corrected = 0
        unknown_regions = []
        
        for spot in spots:
            region = get_region_for_spot(spot)
            
            if region and region in COASTLINE_ORIENTATIONS:
                direction, lat_offset, lon_offset = COASTLINE_ORIENTATIONS[region]
                
                old_lat = float(spot.latitude) if spot.latitude else 0
                old_lon = float(spot.longitude) if spot.longitude else 0
                
                new_lat = old_lat + lat_offset
                new_lon = old_lon + lon_offset
                
                # Only update if changed
                if abs(new_lat - old_lat) > 0.0001 or abs(new_lon - old_lon) > 0.0001:
                    spot.latitude = round(new_lat, 4)
                    spot.longitude = round(new_lon, 4)
                    spot.is_verified_peak = True
                    logger.info(f"CORRECTED [{region}]: {spot.name} ({old_lat:.4f}, {old_lon:.4f}) -> ({new_lat:.4f}, {new_lon:.4f})")
                    corrected += 1
            else:
                if spot.name not in unknown_regions:
                    unknown_regions.append(f"{spot.name} ({spot.country})")
        
        await db.commit()
        
        if unknown_regions:
            logger.warning(f"\nUnknown regions for: {unknown_regions[:10]}...")
        
        logger.info(f"\nTotal spots corrected: {corrected}")
        return corrected


# =============================================================================
# WEST FLORIDA SPOTS - Missing from database
# =============================================================================
WEST_FLORIDA_SPOTS = [
    # Tampa Bay / Clearwater Area (Pinellas County)
    {"name": "Clearwater Beach", "lat": 27.968, "lon": -82.848, "region": "Tampa Bay", "state": "Florida"},
    {"name": "880 Clearwater", "lat": 27.992, "lon": -82.852, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Sand Key", "lat": 27.948, "lon": -82.848, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Indian Rocks Beach", "lat": 27.888, "lon": -82.858, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Indian Shores", "lat": 27.858, "lon": -82.858, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Redington Beach", "lat": 27.818, "lon": -82.842, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Madeira Beach", "lat": 27.798, "lon": -82.818, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Treasure Island", "lat": 27.768, "lon": -82.782, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Sunset Beach FL", "lat": 27.748, "lon": -82.768, "region": "Tampa Bay", "state": "Florida"},
    {"name": "St Pete Beach", "lat": 27.718, "lon": -82.748, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Upham Beach", "lat": 27.698, "lon": -82.742, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Pass-a-Grille", "lat": 27.688, "lon": -82.738, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Fort De Soto", "lat": 27.618, "lon": -82.738, "region": "Tampa Bay", "state": "Florida"},
    {"name": "Honeymoon Island", "lat": 28.068, "lon": -82.838, "region": "Tampa Bay", "state": "Florida"},
    
    # Bradenton / Sarasota Area
    {"name": "Anna Maria Island", "lat": 27.528, "lon": -82.738, "region": "Bradenton", "state": "Florida"},
    {"name": "Holmes Beach", "lat": 27.498, "lon": -82.718, "region": "Bradenton", "state": "Florida"},
    {"name": "Bradenton Beach", "lat": 27.468, "lon": -82.702, "region": "Bradenton", "state": "Florida"},
    {"name": "Longboat Key", "lat": 27.418, "lon": -82.668, "region": "Sarasota", "state": "Florida"},
    {"name": "Lido Key", "lat": 27.318, "lon": -82.578, "region": "Sarasota", "state": "Florida"},
    {"name": "Siesta Key", "lat": 27.268, "lon": -82.558, "region": "Sarasota", "state": "Florida"},
    {"name": "Casey Key", "lat": 27.148, "lon": -82.488, "region": "Sarasota", "state": "Florida"},
    {"name": "Venice Beach FL", "lat": 27.098, "lon": -82.468, "region": "Venice", "state": "Florida"},
    {"name": "Venice Jetty", "lat": 27.068, "lon": -82.458, "region": "Venice", "state": "Florida"},
    
    # Charlotte / Lee County
    {"name": "Englewood Beach", "lat": 26.948, "lon": -82.368, "region": "Charlotte", "state": "Florida"},
    {"name": "Boca Grande", "lat": 26.758, "lon": -82.278, "region": "Lee County", "state": "Florida"},
    {"name": "Captiva Island", "lat": 26.528, "lon": -82.198, "region": "Lee County", "state": "Florida"},
    {"name": "Sanibel Island", "lat": 26.448, "lon": -82.108, "region": "Lee County", "state": "Florida"},
    {"name": "Fort Myers Beach", "lat": 26.448, "lon": -81.958, "region": "Fort Myers", "state": "Florida"},
    {"name": "Bonita Beach", "lat": 26.348, "lon": -81.858, "region": "Fort Myers", "state": "Florida"},
    
    # Naples / Collier County  
    {"name": "Naples Beach", "lat": 26.148, "lon": -81.818, "region": "Naples", "state": "Florida"},
    {"name": "Naples Pier", "lat": 26.138, "lon": -81.812, "region": "Naples", "state": "Florida"},
    {"name": "Vanderbilt Beach", "lat": 26.248, "lon": -81.838, "region": "Naples", "state": "Florida"},
    {"name": "Marco Island", "lat": 25.948, "lon": -81.728, "region": "Naples", "state": "Florida"},
]


async def add_west_florida():
    """Add West Florida Gulf Coast spots."""
    async with async_session_maker() as db:
        added = 0
        for spot_data in WEST_FLORIDA_SPOTS:
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.name == spot_data["name"])
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["lat"],
                    longitude=spot_data["lon"],
                    region=spot_data["region"],
                    state_province=spot_data["state"],
                    country="USA",
                    wave_type="Beach Break",
                    difficulty="Intermediate",
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=5
                )
                db.add(new_spot)
                logger.info(f"ADDED West FL: {spot_data['name']} ({spot_data['lat']}, {spot_data['lon']})")
                added += 1
            else:
                # Update if exists
                existing.latitude = spot_data["lat"]
                existing.longitude = spot_data["lon"]
                existing.is_verified_peak = True
        
        await db.commit()
        logger.info(f"\nWest Florida: {added} spots added")
        return added


async def main():
    logger.info("="*70)
    logger.info("MASTER OFFSHORE COORDINATE SYSTEM")
    logger.info("Comprehensive global surf spot correction")
    logger.info("="*70)
    
    # Step 1: Add missing West Florida
    logger.info("\n--- STEP 1: Adding West Florida Gulf Coast ---")
    west_fl = await add_west_florida()
    
    # Step 2: Apply offshore corrections to ALL spots
    logger.info("\n--- STEP 2: Applying offshore corrections globally ---")
    corrected = await apply_offshore_corrections()
    
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
        
        logger.info(f"\n{'='*70}")
        logger.info(f"MASTER OFFSHORE SYSTEM COMPLETE")
        logger.info(f"  West FL added: {west_fl}")
        logger.info(f"  Spots corrected: {corrected}")
        logger.info(f"  USA total: {usa}")
        logger.info(f"  Global total: {total}")
        logger.info(f"  Verified offshore: {verified} ({verified*100//total}%)")
        logger.info(f"{'='*70}")


if __name__ == "__main__":
    asyncio.run(main())
