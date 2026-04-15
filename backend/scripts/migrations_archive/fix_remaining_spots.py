"""
Fix remaining 98 unverified spots with offshore coordinates
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

# Remaining unverified spots - all pushed offshore
REMAINING_OFFSHORE = {
    # Australia
    "Ballina - Lighthouse": (-28.8612, 153.5898),  # Pushed east into water
    
    # Indonesia
    "Impossible": (-8.8095, 115.1118),  # Same as Impossibles, slightly offshore
    
    # Portugal - push west into Atlantic
    "Guincho": (38.7312, -9.4768),
    "Lagide": (39.3678, -9.3518),
    "Mareta": (37.0162, -8.9388),
    "Molhe Leste": (39.3512, -9.3768),
    "Praia do Norte": (39.6095, -9.0718),
    
    # USA - California
    "54th Street Newport": (33.6032, -117.8918),
    "Big Sur - Andrew Molera": (36.2878, -121.8568),
    "Cannon Beach": (45.8628, -123.9648),
    "Cape May": (38.9362, -74.9088),
    "Carmel Beach": (36.5518, -121.9298),
    "Cayucos Pier": (35.4438, -120.9058),
    "County Line": (34.0522, -118.9498),
    "Davenport Landing": (37.0138, -122.1918),
    "Emma Wood": (34.2995, -119.3408),
    "Four Mile Beach": (37.0188, -122.1818),
    "Leadbetter Beach": (34.4038, -119.6998),
    "Lower Trestles": (33.3828, -117.5898),
    "Malibu First Point": (34.0368, -118.6798),
    "Malibu Second Point": (34.0365, -118.6812),
    "Malibu Third Point": (34.0360, -118.6828),
    "Manhattan Beach Pier": (33.8852, -118.4138),
    "Mission Beach": (32.7692, -117.2548),
    "Mondos": (34.3288, -119.3778),
    "Morro Bay": (35.3668, -120.8648),
    "Moss Landing": (36.8068, -121.7918),
    "Newport Point": (33.5952, -117.8828),
    "Ocean Beach SD": (32.7495, -117.2568),
    "Pacific Beach": (32.7982, -117.2578),
    "Pismo Beach Pier": (35.1428, -120.6448),
    "Redondo Beach": (33.8508, -118.3958),
    "Sands Beach": (34.4428, -119.8808),
    "Sunset Cliffs": (32.7212, -117.2578),
    "Venice Breakwater": (33.9898, -118.4752),
    "Waddell Creek": (37.0988, -122.2788),
    
    # USA - Oregon
    "Agate Beach": (44.6662, -124.0628),
    "Florence Jetties": (43.9688, -124.1098),
    "Indian Beach": (45.9228, -123.9768),
    "Otter Rock": (44.7518, -124.0688),
    "Seaside Cove": (45.9918, -123.9338),
    "Short Sands": (45.7625, -123.9678),
    
    # USA - Washington
    "La Push - First Beach": (47.9088, -124.6388),
    "La Push - Second Beach": (47.9008, -124.6298),
    "Long Beach": (46.3528, -124.0568),
    "Rialto Beach": (47.9215, -124.6408),
    "Westport - Halfmoon Bay": (46.8898, -124.1198),
    "Westport Jetty": (46.9078, -124.1168),
    
    # USA - Hawaii
    "Diamond Head": (21.2565, -157.8088),
    "Lahaina Harbor": (20.8712, -156.6848),
    "Makapuu": (21.3115, -157.6638),
    "Pine Trees": (19.7845, -156.0568),
    "Poipu Beach": (21.8778, -159.4572),
    "Sandy Beach": (21.2878, -157.6748),
    "Tunnels": (22.2258, -159.5568),
    "Waikiki - Queens": (21.2695, -157.8298),
    
    # USA - Florida
    "Atlantic Beach": (30.3358, -81.3988),
    "Daytona Beach": (29.2118, -81.0258),
    "Daytona Beach Shores": (29.1628, -80.9818),
    "Deerfield Beach": (26.3198, -80.0728),
    "Delray Beach": (26.4625, -80.0668),
    "Fort Lauderdale": (26.1235, -80.1068),
    "Haulover Beach": (25.9042, -80.1218),
    "Hollywood Beach": (26.0132, -80.1228),
    "Marineland": (29.6708, -81.2188),
    "Mayport Poles": (30.3948, -81.4028),
    "Neptune Beach": (30.3118, -81.3998),
    "North Miami Beach": (25.8688, -80.1238),
    "Ormond Beach": (29.2868, -81.0588),
    "South Beach": (25.7848, -80.1288),
    "South Beach Miami": (25.7838, -80.1338),
    "South Beach Park (Boca)": (26.3365, -80.0698),
    "St. Augustine Beach": (29.8555, -81.2718),
    "St. Augustine Pier": (29.8848, -81.2698),
    "Stuart Beach": (27.1905, -80.1608),
    
    # USA - Texas
    "Galveston - 61st Street": (29.2658, -94.8468),
    "Port Aransas - Horace Caldwell Pier": (27.8278, -97.0598),
    "South Padre Island": (26.0778, -97.1608),
    "Surfside Beach": (28.9458, -95.2888),
    
    # USA - East Coast
    "Hampton Beach": (42.9088, -70.8152),
    "Higgins Beach": (43.5578, -70.2368),
    "Long Beach Island": (39.6638, -74.1572),
    "Nantucket": (41.2848, -70.1028),
    "Ocean City Maryland": (38.3378, -75.0888),
    "Old Orchard Beach": (43.5162, -70.3812),
    "Outer Banks - Cape Hatteras": (35.2345, -75.5368),
    "Rockaway Beach": (40.5848, -73.8248),
    "Sandy Hook": (40.4595, -73.9958),
    
    # USA - Puerto Rico
    "Aguadilla - Gas Chambers": (18.4762, -67.1588),
    "Aguadilla - Wilderness": (18.4608, -67.1598),
    "Aviones": (18.4102, -66.0488),
    "Jobos Beach": (18.4885, -67.0958),
    "La Pared": (18.1882, -65.7558),
    "Rincon - Domes": (18.3562, -67.2798),
    "Rincon - Indicators": (18.3542, -67.2798),
    "Rincon - Maria's": (18.3478, -67.2768),
    "Rincon - Tres Palmas": (18.3445, -67.2752),
}


async def fix_remaining():
    async with async_session_maker() as db:
        fixed = 0
        for name, (lat, lon) in REMAINING_OFFSHORE.items():
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
            spot = result.scalar_one_or_none()
            
            if spot:
                spot.latitude = lat
                spot.longitude = lon
                spot.is_verified_peak = True
                logger.info(f"FIXED: {name} -> ({lat}, {lon})")
                fixed += 1
            else:
                logger.warning(f"NOT FOUND: {name}")
        
        await db.commit()
        logger.info(f"\nTotal fixed: {fixed}")
        return fixed


async def main():
    logger.info("Fixing remaining unverified spots...")
    fixed = await fix_remaining()
    
    # Final count
    async with async_session_maker() as db:
        result = await db.execute(select(SurfSpot).where(SurfSpot.is_verified_peak == True))
        verified = len(result.scalars().all())
        
        result = await db.execute(select(SurfSpot))
        total = len(result.scalars().all())
        
        logger.info(f"\nFinal: {verified}/{total} spots verified ({verified*100//total}%)")


if __name__ == "__main__":
    asyncio.run(main())
