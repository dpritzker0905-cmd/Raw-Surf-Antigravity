"""
COORDINATE VALIDATION SAFETY NET
Implements the >150m from water validation check.
Flags problematic spots for admin review rather than auto-fixing.
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select, update
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# Florida Atlantic coastline reference points (approximate shoreline longitudes)
# For validation: Atlantic spots should have longitude LESS negative than shoreline
FLORIDA_ATLANTIC_SHORELINE = {
    # Jacksonville area: -81.40
    (30.20, 30.50): -81.40,
    # St Augustine: -81.28
    (29.70, 30.20): -81.28,
    # Flagler: -81.13
    (29.40, 29.70): -81.13,
    # Daytona: -81.02
    (29.10, 29.40): -81.02,
    # New Smyrna: -80.93
    (28.95, 29.10): -80.93,
    # Space Coast North: -80.61
    (28.50, 28.95): -80.61,
    # Cocoa Beach: -80.61
    (28.30, 28.50): -80.61,
    # Space Coast South: -80.58
    (28.00, 28.30): -80.58,
    # Sebastian: -80.45
    (27.80, 28.00): -80.45,
    # Vero: -80.37
    (27.50, 27.80): -80.37,
    # Jupiter/Palm Beach: -80.08
    (26.80, 27.50): -80.08,
    # Fort Lauderdale: -80.10
    (26.00, 26.80): -80.10,
    # Miami: -80.12
    (25.70, 26.00): -80.12,
}

# Florida Gulf coastline reference (approximate shoreline longitudes)
# For validation: Gulf spots should have longitude MORE negative than shoreline
FLORIDA_GULF_SHORELINE = {
    # Tampa Bay area: -82.80
    (27.50, 28.20): -82.80,
    # Sarasota: -82.55
    (27.00, 27.50): -82.55,
    # Southwest FL: -81.85
    (25.90, 27.00): -81.85,
}

# Florida Panhandle (ocean is SOUTH)
# For validation: Panhandle spots should have latitude around 30.1-30.4
FLORIDA_PANHANDLE_BOUNDS = {
    "min_lat": 30.05,  # Offshore should be around 30.1-30.38
    "max_lat": 30.40,
    "min_lon": -87.50,
    "max_lon": -84.50,
}


def get_shoreline_longitude(lat: float, region: str) -> float:
    """Get approximate shoreline longitude for a given latitude and region."""
    if region == "atlantic":
        for (lat_min, lat_max), lon in FLORIDA_ATLANTIC_SHORELINE.items():
            if lat_min <= lat <= lat_max:
                return lon
        return -80.50  # Default for Atlantic
    elif region == "gulf":
        for (lat_min, lat_max), lon in FLORIDA_GULF_SHORELINE.items():
            if lat_min <= lat <= lat_max:
                return lon
        return -82.50  # Default for Gulf
    return None


def validate_spot_position(spot: SurfSpot) -> tuple:
    """
    Validate if a spot is properly offshore.
    Returns (is_valid, issue_description, suggested_action)
    """
    if not spot.latitude or not spot.longitude:
        return False, "Missing coordinates", "ADD_COORDINATES"
    
    lat = float(spot.latitude)
    lon = float(spot.longitude)
    
    # Skip non-Florida spots for now
    if spot.state_province != "Florida":
        return True, None, None
    
    # Determine region
    region = None
    if lon > -82.0:
        region = "atlantic"
    elif lon < -82.0 and lat > 27.0:
        region = "gulf"
    elif lat > 29.5 and lon < -84.5:
        region = "panhandle"
    else:
        region = "atlantic"  # Default
    
    # Check Atlantic coast
    if region == "atlantic":
        shoreline_lon = get_shoreline_longitude(lat, "atlantic")
        if shoreline_lon:
            # Atlantic: spot should be LESS negative (more EAST) than shoreline
            if lon <= shoreline_lon:
                distance_inland = abs(lon - shoreline_lon) * 111000 * 0.85  # meters
                return False, f"Spot appears to be {distance_inland:.0f}m inland (lon {lon} vs shoreline {shoreline_lon})", "MOVE_EAST"
    
    # Check Gulf coast
    elif region == "gulf":
        shoreline_lon = get_shoreline_longitude(lat, "gulf")
        if shoreline_lon:
            # Gulf: spot should be MORE negative (more WEST) than shoreline
            if lon >= shoreline_lon:
                distance_inland = abs(lon - shoreline_lon) * 111000 * 0.85
                return False, f"Spot appears to be {distance_inland:.0f}m inland (lon {lon} vs shoreline {shoreline_lon})", "MOVE_WEST"
    
    # Check Panhandle
    elif region == "panhandle":
        if lat > FLORIDA_PANHANDLE_BOUNDS["max_lat"]:
            distance_inland = abs(lat - FLORIDA_PANHANDLE_BOUNDS["max_lat"]) * 111000
            return False, f"Spot appears to be {distance_inland:.0f}m inland (lat {lat} too far north)", "MOVE_SOUTH"
    
    return True, None, None


async def run_validation_audit():
    """Run validation audit on all Florida spots and flag issues."""
    async with async_session_maker() as db:
        result = await db.execute(
            select(SurfSpot).where(SurfSpot.state_province == "Florida")
        )
        spots = result.scalars().all()
        
        issues = []
        valid_count = 0
        
        logger.info("="*80)
        logger.info("FLORIDA SPOT VALIDATION AUDIT")
        logger.info("="*80)
        
        for spot in spots:
            is_valid, issue, action = validate_spot_position(spot)
            
            if not is_valid:
                issues.append({
                    "name": spot.name,
                    "id": str(spot.id),
                    "lat": float(spot.latitude) if spot.latitude else None,
                    "lon": float(spot.longitude) if spot.longitude else None,
                    "region": spot.region,
                    "issue": issue,
                    "suggested_action": action
                })
                logger.warning(f"FLAGGED: {spot.name} - {issue}")
            else:
                valid_count += 1
        
        logger.info("="*80)
        logger.info(f"VALIDATION COMPLETE:")
        logger.info(f"  Valid spots: {valid_count}")
        logger.info(f"  Flagged for review: {len(issues)}")
        logger.info("="*80)
        
        if issues:
            logger.info("\nFLAGGED SPOTS FOR ADMIN REVIEW:")
            for issue in issues:
                logger.info(f"  - {issue['name']}: {issue['issue']} ({issue['suggested_action']})")
        
        return issues


async def main():
    issues = await run_validation_audit()
    print(f"\nValidation complete. {len(issues)} spots flagged for review.")
    return issues


if __name__ == "__main__":
    asyncio.run(main())
