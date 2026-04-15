"""
Tahiti, Maldives, Morocco, South Africa Surf Spot Expansion
Adds 50+ verified offshore surf spots
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Tahiti / French Polynesia - World-famous reef breaks
TAHITI_SPOTS = [
    # Tahiti Island
    {"name": "Teahupo'o", "latitude": -17.8683, "longitude": -149.2567, "region": "Tahiti Iti", "country": "French Polynesia", "difficulty": "expert", "wave_type": "reef", "description": "The heaviest wave on Earth - Code Red slab"},
    {"name": "Papara", "latitude": -17.7667, "longitude": -149.5167, "region": "Tahiti", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Consistent reef break, less crowded than Teahupo'o"},
    {"name": "Taapuna", "latitude": -17.5833, "longitude": -149.6167, "region": "Tahiti", "country": "French Polynesia", "difficulty": "advanced", "wave_type": "reef", "description": "Fast left-hander over shallow reef"},
    {"name": "Maraa", "latitude": -17.7833, "longitude": -149.4833, "region": "Tahiti", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break with multiple peaks"},
    {"name": "Papenoo", "latitude": -17.5167, "longitude": -149.4000, "region": "Tahiti", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "river", "description": "River mouth break on north shore"},
    
    # Moorea
    {"name": "Haapiti", "latitude": -17.5667, "longitude": -149.9167, "region": "Moorea", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Long left reef pass with crystal water"},
    {"name": "Temae", "latitude": -17.4833, "longitude": -149.7667, "region": "Moorea", "country": "French Polynesia", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach near airport"},
    
    # Huahine
    {"name": "Fare", "latitude": -16.7000, "longitude": -151.0333, "region": "Huahine", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef pass with both lefts and rights"},
    {"name": "Fitii", "latitude": -16.7833, "longitude": -151.0000, "region": "Huahine", "country": "French Polynesia", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful reef break"},
    
    # Raiatea
    {"name": "Raiatea Pass", "latitude": -16.8333, "longitude": -151.4333, "region": "Raiatea", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Pass break with long rides"},
    
    # Rangiroa (Tuamotus)
    {"name": "Avatoru Pass", "latitude": -14.9667, "longitude": -147.6667, "region": "Rangiroa", "country": "French Polynesia", "difficulty": "advanced", "wave_type": "reef", "description": "Atoll pass with shark-filled lineup"},
    {"name": "Tiputa Pass", "latitude": -14.9833, "longitude": -147.6333, "region": "Rangiroa", "country": "French Polynesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Famous dolphin-filled pass"},
]


# Maldives - Perfect Indian Ocean atolls
MALDIVES_SPOTS = [
    # North Male Atoll
    {"name": "Chickens", "latitude": 4.2667, "longitude": 73.4333, "region": "North Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Long right-hander, Maldives classic"},
    {"name": "Cokes", "latitude": 4.2833, "longitude": 73.4167, "region": "North Male", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful right barrel"},
    {"name": "Lohis", "latitude": 4.2500, "longitude": 73.4500, "region": "North Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun left near Lohifushi resort"},
    {"name": "Ninjas", "latitude": 4.3000, "longitude": 73.4000, "region": "North Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Playful right with multiple sections"},
    {"name": "Sultans", "latitude": 4.2333, "longitude": 73.4667, "region": "North Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Perfect right, most consistent wave"},
    {"name": "Honkys", "latitude": 4.2167, "longitude": 73.4833, "region": "North Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Left-hander across channel from Sultans"},
    {"name": "Jailbreaks", "latitude": 4.2000, "longitude": 73.5000, "region": "North Male", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Fast right near Himmafushi prison"},
    
    # South Male Atoll
    {"name": "Riptides", "latitude": 3.9500, "longitude": 73.4667, "region": "South Male", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow right with strong current"},
    {"name": "Quarters", "latitude": 3.9333, "longitude": 73.4833, "region": "South Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun right-hander"},
    {"name": "Kandooma Right", "latitude": 3.9167, "longitude": 73.5000, "region": "South Male", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy right barrel"},
    {"name": "Guru's", "latitude": 3.9000, "longitude": 73.5167, "region": "South Male", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Long left, good for all levels"},
    
    # Central Atolls (Meemu, Dhaalu, Thaa)
    {"name": "Malik's", "latitude": 2.7500, "longitude": 73.0000, "region": "Meemu", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Remote atoll right"},
    {"name": "Five Islands", "latitude": 2.8333, "longitude": 72.9500, "region": "Dhaalu", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Uncrowded left in central atolls"},
    
    # Huvadhoo Atoll (far south)
    {"name": "Beacons", "latitude": 0.5000, "longitude": 73.1667, "region": "Huvadhoo", "country": "Maldives", "difficulty": "advanced", "wave_type": "reef", "description": "Southernmost quality break"},
    {"name": "Tiger Stripes", "latitude": 0.4833, "longitude": 73.1833, "region": "Huvadhoo", "country": "Maldives", "difficulty": "intermediate", "wave_type": "reef", "description": "Long walls with tiger shark sightings"},
]


# Morocco - North Africa's surf mecca
MOROCCO_SPOTS = [
    # Taghazout Region
    {"name": "Anchor Point", "latitude": 30.5483, "longitude": -9.6533, "region": "Taghazout", "country": "Morocco", "difficulty": "advanced", "wave_type": "point", "description": "Morocco's most famous wave - long right point"},
    {"name": "Killer Point", "latitude": 30.5600, "longitude": -9.6600, "region": "Taghazout", "country": "Morocco", "difficulty": "expert", "wave_type": "point", "description": "Heavy right with urchin-covered rocks"},
    {"name": "La Source", "latitude": 30.5367, "longitude": -9.6467, "region": "Taghazout", "country": "Morocco", "difficulty": "intermediate", "wave_type": "point", "description": "Fun right point, freshwater spring"},
    {"name": "Mysteries", "latitude": 30.5283, "longitude": -9.6400, "region": "Taghazout", "country": "Morocco", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break with mysterious vibe"},
    {"name": "Panoramas", "latitude": 30.5433, "longitude": -9.6500, "region": "Taghazout", "country": "Morocco", "difficulty": "beginner", "wave_type": "beach", "description": "Long beach break, great for learners"},
    {"name": "Hash Point", "latitude": 30.5517, "longitude": -9.6567, "region": "Taghazout", "country": "Morocco", "difficulty": "intermediate", "wave_type": "point", "description": "Mellow right point break"},
    {"name": "Boilers", "latitude": 30.5317, "longitude": -9.6433, "region": "Taghazout", "country": "Morocco", "difficulty": "advanced", "wave_type": "reef", "description": "Reef break near old factory boilers"},
    {"name": "Devils Rock", "latitude": 30.5250, "longitude": -9.6367, "region": "Taghazout", "country": "Morocco", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef with both lefts and rights"},
    
    # Imsouane
    {"name": "Imsouane Bay", "latitude": 30.8417, "longitude": -9.8250, "region": "Imsouane", "country": "Morocco", "difficulty": "beginner", "wave_type": "point", "description": "Longest wave in Africa - 800m+ rides"},
    {"name": "Cathedral", "latitude": 30.8500, "longitude": -9.8333, "region": "Imsouane", "country": "Morocco", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break outside the bay"},
    
    # Essaouira
    {"name": "Sidi Kaouki", "latitude": 31.3500, "longitude": -9.8000, "region": "Essaouira", "country": "Morocco", "difficulty": "intermediate", "wave_type": "beach", "description": "Windy beach break south of Essaouira"},
    {"name": "Moulay Bouzerktoun", "latitude": 31.6333, "longitude": -9.7167, "region": "Essaouira", "country": "Morocco", "difficulty": "intermediate", "wave_type": "point", "description": "Right point with famous wind"},
    
    # Agadir
    {"name": "Banana Beach", "latitude": 30.3833, "longitude": -9.5833, "region": "Agadir", "country": "Morocco", "difficulty": "beginner", "wave_type": "beach", "description": "Protected beach for beginners"},
    {"name": "Anza", "latitude": 30.4167, "longitude": -9.6167, "region": "Agadir", "country": "Morocco", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near fishing village"},
]


# South Africa - J-Bay and beyond
SOUTH_AFRICA_SPOTS = [
    # Jeffreys Bay (Eastern Cape)
    {"name": "Supertubes", "latitude": -34.0500, "longitude": 24.9333, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "expert", "wave_type": "point", "description": "World's best right point - WSL CT venue"},
    {"name": "Boneyards", "latitude": -34.0467, "longitude": 24.9367, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "advanced", "wave_type": "point", "description": "Section above Supertubes"},
    {"name": "Impossibles", "latitude": -34.0433, "longitude": 24.9400, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "advanced", "wave_type": "point", "description": "Fast connecting section"},
    {"name": "Tubes", "latitude": -34.0517, "longitude": 24.9300, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "advanced", "wave_type": "point", "description": "Barrel section of the point"},
    {"name": "The Point", "latitude": -34.0550, "longitude": 24.9267, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "intermediate", "wave_type": "point", "description": "End section, mellower waves"},
    {"name": "Kitchen Windows", "latitude": -34.0400, "longitude": 24.9450, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "intermediate", "wave_type": "point", "description": "Top of the point system"},
    {"name": "Magna Tubes", "latitude": -34.0367, "longitude": 24.9483, "region": "Jeffreys Bay", "country": "South Africa", "difficulty": "intermediate", "wave_type": "point", "description": "Northern section of J-Bay"},
    
    # Cape Town
    {"name": "Dungeons", "latitude": -34.0833, "longitude": 18.3500, "region": "Cape Town", "country": "South Africa", "difficulty": "expert", "wave_type": "reef", "description": "Big wave spot - 50ft+ faces"},
    {"name": "Llandudno", "latitude": -34.0167, "longitude": 18.3333, "region": "Cape Town", "country": "South Africa", "difficulty": "intermediate", "wave_type": "beach", "description": "Beautiful beach break"},
    {"name": "Noordhoek", "latitude": -34.1000, "longitude": 18.3667, "region": "Cape Town", "country": "South Africa", "difficulty": "intermediate", "wave_type": "beach", "description": "Long beach with peaks"},
    {"name": "Muizenberg", "latitude": -34.1167, "longitude": 18.4667, "region": "Cape Town", "country": "South Africa", "difficulty": "beginner", "wave_type": "beach", "description": "SA's most famous learner wave"},
    {"name": "Kommetjie", "latitude": -34.1500, "longitude": 18.3333, "region": "Cape Town", "country": "South Africa", "difficulty": "intermediate", "wave_type": "reef", "description": "Kelp-lined reef break"},
    {"name": "Long Beach", "latitude": -34.1333, "longitude": 18.3500, "region": "Cape Town", "country": "South Africa", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break peaks"},
    
    # Durban (KwaZulu-Natal)
    {"name": "Cave Rock", "latitude": -29.9167, "longitude": 31.0500, "region": "Durban", "country": "South Africa", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow right barrel"},
    {"name": "New Pier", "latitude": -29.8667, "longitude": 31.0333, "region": "Durban", "country": "South Africa", "difficulty": "intermediate", "wave_type": "sandbar", "description": "Consistent sandbars by the pier"},
    {"name": "North Beach", "latitude": -29.8500, "longitude": 31.0333, "region": "Durban", "country": "South Africa", "difficulty": "intermediate", "wave_type": "beach", "description": "Urban beach break"},
    
    # Wild Coast
    {"name": "Coffee Bay", "latitude": -31.9833, "longitude": 29.1500, "region": "Wild Coast", "country": "South Africa", "difficulty": "intermediate", "wave_type": "point", "description": "Remote point break"},
    {"name": "Hole in the Wall", "latitude": -32.0500, "longitude": 29.1000, "region": "Wild Coast", "country": "South Africa", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef near famous rock formation"},
]


async def add_spots(spots: list, session: AsyncSession) -> int:
    """Add spots to database, skipping duplicates"""
    added = 0
    for spot_data in spots:
        result = await session.execute(
            select(SurfSpot).where(SurfSpot.name == spot_data["name"])
        )
        if result.scalar_one_or_none():
            print(f"  - Skipped (exists): {spot_data['name']}")
            continue
        
        spot = SurfSpot(**spot_data)
        session.add(spot)
        added += 1
        print(f"  + Added: {spot_data['name']} ({spot_data['region']}, {spot_data['country']})")
    
    return added


async def main():
    print("=" * 60)
    print("TAHITI, MALDIVES, MOROCCO & SOUTH AFRICA EXPANSION")
    print("=" * 60)
    
    async with AsyncSession(engine) as session:
        total_added = 0
        
        # Tahiti / French Polynesia
        print("\n[TAHITI / FRENCH POLYNESIA]")
        count = await add_spots(TAHITI_SPOTS, session)
        total_added += count
        print(f"  Tahiti Total: {count} spots added")
        
        # Maldives
        print("\n[MALDIVES]")
        count = await add_spots(MALDIVES_SPOTS, session)
        total_added += count
        print(f"  Maldives Total: {count} spots added")
        
        # Morocco
        print("\n[MOROCCO]")
        count = await add_spots(MOROCCO_SPOTS, session)
        total_added += count
        print(f"  Morocco Total: {count} spots added")
        
        # South Africa
        print("\n[SOUTH AFRICA]")
        count = await add_spots(SOUTH_AFRICA_SPOTS, session)
        total_added += count
        print(f"  South Africa Total: {count} spots added")
        
        await session.commit()
        
        # Get total count
        result = await session.execute(select(SurfSpot))
        total_spots = len(result.scalars().all())
        
        print("\n" + "=" * 60)
        print(f"EXPANSION COMPLETE!")
        print(f"  New spots added: {total_added}")
        print(f"  Total spots in database: {total_spots}")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
