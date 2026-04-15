"""
Southeast Asia Surf Spot Expansion (Delta Sync)
Thailand, Sri Lanka, Philippines
Adds new spots only - skips existing spots to preserve data integrity
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Thailand - Gulf of Thailand and Andaman Sea
THAILAND_SPOTS = [
    # Phuket
    {"name": "Kata Beach", "latitude": 7.8203, "longitude": 98.2983, "region": "Phuket", "country": "Thailand", "difficulty": "beginner", "wave_type": "beach", "description": "Phuket's most popular surf beach - gentle waves during monsoon"},
    {"name": "Kata Noi", "latitude": 7.8133, "longitude": 98.2950, "region": "Phuket", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Smaller beach with better waves than main Kata"},
    {"name": "Kalim Beach", "latitude": 7.9017, "longitude": 98.2867, "region": "Phuket", "country": "Thailand", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near Patong - best waves in Phuket"},
    {"name": "Bang Tao Beach", "latitude": 7.9883, "longitude": 98.2900, "region": "Phuket", "country": "Thailand", "difficulty": "beginner", "wave_type": "beach", "description": "Long sandy beach with mellow waves"},
    {"name": "Surin Beach", "latitude": 7.9767, "longitude": 98.2800, "region": "Phuket", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Beautiful beach with decent surf in season"},
    
    # Khao Lak
    {"name": "Pakarang Beach", "latitude": 8.6833, "longitude": 98.2500, "region": "Khao Lak", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent monsoon swells in Khao Lak area"},
    {"name": "Khuk Khak Beach", "latitude": 8.6667, "longitude": 98.2333, "region": "Khao Lak", "country": "Thailand", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly waves during SW monsoon"},
    {"name": "Memories Beach", "latitude": 8.7500, "longitude": 98.2667, "region": "Khao Lak", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Northern Khao Lak beach break"},
    
    # Koh Samui / Koh Phangan
    {"name": "Chaweng Beach", "latitude": 9.5167, "longitude": 100.0500, "region": "Koh Samui", "country": "Thailand", "difficulty": "beginner", "wave_type": "beach", "description": "Small waves during monsoon season"},
    {"name": "Lamai Beach", "latitude": 9.4667, "longitude": 100.0333, "region": "Koh Samui", "country": "Thailand", "difficulty": "beginner", "wave_type": "beach", "description": "Mellow beach break on east coast"},
    {"name": "Haad Rin", "latitude": 9.6833, "longitude": 100.0667, "region": "Koh Phangan", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Famous party beach with occasional surf"},
    
    # Ranong / Myanmar Border
    {"name": "Ao Mae Khao Beach", "latitude": 9.7000, "longitude": 98.5833, "region": "Ranong", "country": "Thailand", "difficulty": "intermediate", "wave_type": "beach", "description": "Remote beach with good monsoon waves"},
]


# Sri Lanka - Year-round surf destination
SRI_LANKA_SPOTS = [
    # South Coast (Main season Nov-April)
    {"name": "Arugam Bay Main Point", "latitude": 6.8333, "longitude": 81.8333, "region": "East Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "point", "description": "Sri Lanka's most famous wave - long right point"},
    {"name": "Whiskey Point", "latitude": 6.8500, "longitude": 81.8500, "region": "East Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "point", "description": "Fun right point north of Main Point"},
    {"name": "Pottuvil Point", "latitude": 6.8667, "longitude": 81.8667, "region": "East Coast", "country": "Sri Lanka", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful right reef break"},
    {"name": "Elephant Rock", "latitude": 6.8200, "longitude": 81.8200, "region": "East Coast", "country": "Sri Lanka", "difficulty": "beginner", "wave_type": "beach", "description": "Mellow beginner spot in Arugam Bay"},
    {"name": "Baby Point", "latitude": 6.8400, "longitude": 81.8400, "region": "East Coast", "country": "Sri Lanka", "difficulty": "beginner", "wave_type": "reef", "description": "Gentle reef for learners"},
    {"name": "Crocodile Rock", "latitude": 6.8100, "longitude": 81.8100, "region": "East Coast", "country": "Sri Lanka", "difficulty": "advanced", "wave_type": "reef", "description": "Fast hollow right - advanced only"},
    {"name": "Panama Point", "latitude": 6.7667, "longitude": 81.7833, "region": "East Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "point", "description": "Long walling right south of Arugam"},
    {"name": "Okanda", "latitude": 6.7000, "longitude": 81.7500, "region": "East Coast", "country": "Sri Lanka", "difficulty": "advanced", "wave_type": "point", "description": "Remote point break in Yala area"},
    
    # West/South Coast (May-October)
    {"name": "Hikkaduwa Beach", "latitude": 6.1333, "longitude": 80.1000, "region": "South Coast", "country": "Sri Lanka", "difficulty": "beginner", "wave_type": "beach", "description": "Popular beach break for all levels"},
    {"name": "Hikkaduwa Reef", "latitude": 6.1400, "longitude": 80.0950, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "reef", "description": "A-frame reef with lefts and rights"},
    {"name": "Kabalana Beach", "latitude": 6.0000, "longitude": 80.0833, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "beach", "description": "Fun beach break near Ahangama"},
    {"name": "The Rock Ahangama", "latitude": 5.9833, "longitude": 80.0667, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break with multiple peaks"},
    {"name": "Lazy Left", "latitude": 5.9500, "longitude": 80.0500, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun left reef break near Midigama"},
    {"name": "Plantation Point", "latitude": 5.9333, "longitude": 80.0333, "region": "South Coast", "country": "Sri Lanka", "difficulty": "advanced", "wave_type": "point", "description": "Long left point break"},
    {"name": "Rams", "latitude": 5.9400, "longitude": 80.0400, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "reef", "description": "Right-hand reef in Midigama"},
    {"name": "Coconut Point", "latitude": 5.9600, "longitude": 80.0550, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "reef", "description": "A-frame reef with fun waves"},
    {"name": "Mirissa Point", "latitude": 5.9500, "longitude": 80.4500, "region": "South Coast", "country": "Sri Lanka", "difficulty": "intermediate", "wave_type": "point", "description": "Right point with whale watching nearby"},
    {"name": "Weligama Bay", "latitude": 5.9667, "longitude": 80.4167, "region": "South Coast", "country": "Sri Lanka", "difficulty": "beginner", "wave_type": "beach", "description": "Perfect beginner beach with gentle waves"},
    {"name": "Unawatuna", "latitude": 6.0167, "longitude": 80.2500, "region": "South Coast", "country": "Sri Lanka", "difficulty": "beginner", "wave_type": "beach", "description": "Protected bay with mellow waves"},
]


# Philippines - 7,000+ islands with endless potential
PHILIPPINES_SPOTS = [
    # Siargao Island (Surfing Capital)
    {"name": "Cloud 9", "latitude": 9.8500, "longitude": 126.1667, "region": "Siargao", "country": "Philippines", "difficulty": "expert", "wave_type": "reef", "description": "World-class right barrel - WSL CT venue since 2018"},
    {"name": "Tuason Point", "latitude": 9.8600, "longitude": 126.1700, "region": "Siargao", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "Right reef north of Cloud 9"},
    {"name": "Rock Island", "latitude": 9.8400, "longitude": 126.1600, "region": "Siargao", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun reef break with multiple sections"},
    {"name": "Stimpy's", "latitude": 9.8450, "longitude": 126.1650, "region": "Siargao", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy left near Cloud 9"},
    {"name": "Pacifico", "latitude": 9.9167, "longitude": 126.0833, "region": "Siargao", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "More forgiving reef with consistent waves"},
    {"name": "Jacking Horse", "latitude": 9.8550, "longitude": 126.1680, "region": "Siargao", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Beginner-intermediate friendly reef"},
    {"name": "Quicksilver", "latitude": 9.8350, "longitude": 126.1550, "region": "Siargao", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "Fast hollow right"},
    {"name": "Daku Reef", "latitude": 9.8700, "longitude": 126.1500, "region": "Siargao", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near Daku Island"},
    
    # La Union (North Luzon)
    {"name": "Urbiztondo Beach", "latitude": 16.6167, "longitude": 120.3167, "region": "La Union", "country": "Philippines", "difficulty": "beginner", "wave_type": "beach", "description": "Most popular surf spot in La Union - mellow beach break"},
    {"name": "Mona Lisa Point", "latitude": 16.6333, "longitude": 120.3000, "region": "La Union", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Right reef point near San Juan"},
    {"name": "Carille", "latitude": 16.6000, "longitude": 120.3333, "region": "La Union", "country": "Philippines", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break south of San Juan"},
    {"name": "Bacnotan", "latitude": 16.7333, "longitude": 120.3500, "region": "La Union", "country": "Philippines", "difficulty": "intermediate", "wave_type": "beach", "description": "Less crowded beach break"},
    
    # Baler (Aurora Province)
    {"name": "Sabang Beach", "latitude": 15.7500, "longitude": 121.5667, "region": "Baler", "country": "Philippines", "difficulty": "beginner", "wave_type": "beach", "description": "Birthplace of Philippine surfing - consistent beach break"},
    {"name": "Charlie's Point", "latitude": 15.7600, "longitude": 121.5700, "region": "Baler", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break at north end of Sabang"},
    {"name": "Cemento Reef", "latitude": 15.7400, "longitude": 121.5600, "region": "Baler", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break with fun waves"},
    {"name": "Diguisit Beach", "latitude": 15.7333, "longitude": 121.5833, "region": "Baler", "country": "Philippines", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break with scenic boulder backdrop"},
    
    # Catanduanes Island
    {"name": "Majestics", "latitude": 13.7833, "longitude": 124.2500, "region": "Catanduanes", "country": "Philippines", "difficulty": "expert", "wave_type": "reef", "description": "The 'Majestic' - one of Philippines' best waves"},
    {"name": "Twin Rocks", "latitude": 13.7900, "longitude": 124.2600, "region": "Catanduanes", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "A-frame reef between two rocks"},
    {"name": "Puraran Beach", "latitude": 13.7667, "longitude": 124.2333, "region": "Catanduanes", "country": "Philippines", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break near Majestics"},
    
    # Zambales
    {"name": "Crystal Beach", "latitude": 15.6167, "longitude": 119.9667, "region": "Zambales", "country": "Philippines", "difficulty": "beginner", "wave_type": "beach", "description": "Popular beach break near Manila"},
    {"name": "Liwa-Liwa Beach", "latitude": 15.6333, "longitude": 119.9500, "region": "Zambales", "country": "Philippines", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break in San Felipe"},
    {"name": "Liwliwa Point", "latitude": 15.6400, "longitude": 119.9450, "region": "Zambales", "country": "Philippines", "difficulty": "advanced", "wave_type": "reef", "description": "Reef break with powerful waves"},
    
    # Bohol
    {"name": "Guindulman Reef", "latitude": 9.7500, "longitude": 124.4667, "region": "Bohol", "country": "Philippines", "difficulty": "intermediate", "wave_type": "reef", "description": "Right reef break in southeast Bohol"},
    {"name": "Anda Beach", "latitude": 9.7333, "longitude": 124.5000, "region": "Bohol", "country": "Philippines", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly waves near Anda"},
]


async def add_spots_safely(spots: list, db: AsyncSession, region_name: str):
    """Add spots only if they don't already exist (by name)"""
    added = 0
    skipped = 0
    
    for spot_data in spots:
        # Check if spot already exists
        result = await db.execute(
            select(SurfSpot).where(SurfSpot.name == spot_data["name"])
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            skipped += 1
            continue
        
        # Create new spot
        spot = SurfSpot(
            name=spot_data["name"],
            latitude=spot_data["latitude"],
            longitude=spot_data["longitude"],
            region=spot_data["region"],
            country=spot_data["country"],
            difficulty=spot_data["difficulty"],
            wave_type=spot_data["wave_type"],
            description=spot_data.get("description", "")
        )
        db.add(spot)
        added += 1
    
    await db.commit()
    print(f"  {region_name}: Added {added} spots, skipped {skipped} existing")
    return added


async def run_expansion():
    """Run the Southeast Asia expansion"""
    print("\n🌊 Southeast Asia Surf Spot Expansion")
    print("=" * 50)
    
    async with AsyncSession(engine) as db:
        # Get current count
        result = await db.execute(select(SurfSpot))
        initial_count = len(result.scalars().all())
        print(f"\nCurrent total spots: {initial_count}")
        
        total_added = 0
        
        # Thailand
        print("\n🇹🇭 Thailand:")
        total_added += await add_spots_safely(THAILAND_SPOTS, db, "Thailand")
        
        # Sri Lanka
        print("\n🇱🇰 Sri Lanka:")
        total_added += await add_spots_safely(SRI_LANKA_SPOTS, db, "Sri Lanka")
        
        # Philippines
        print("\n🇵🇭 Philippines:")
        total_added += await add_spots_safely(PHILIPPINES_SPOTS, db, "Philippines")
        
        # Final count
        result = await db.execute(select(SurfSpot))
        final_count = len(result.scalars().all())
        
        print(f"\n" + "=" * 50)
        print(f"✅ Expansion complete!")
        print(f"   New spots added: {total_added}")
        print(f"   Total spots now: {final_count}")


if __name__ == "__main__":
    asyncio.run(run_expansion())
