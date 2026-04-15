"""
Pacific Islands (Papua New Guinea, Vanuatu, Solomon Islands) + South America (Chile, Peru) Expansion
Adds 40+ verified offshore surf spots with proper coordinates
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Papua New Guinea Spots - Remote Pacific gems
PAPUA_NEW_GUINEA_SPOTS = [
    # New Ireland Province
    {"name": "Kavieng Point", "latitude": -2.5694, "longitude": 150.7989, "region": "New Ireland", "country": "Papua New Guinea", "difficulty": "intermediate", "wave_type": "reef", "description": "Consistent right-hander over shallow reef"},
    {"name": "Nusa Island", "latitude": -2.5833, "longitude": 150.7500, "region": "New Ireland", "country": "Papua New Guinea", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break with long walls"},
    {"name": "Pikinini", "latitude": -2.6200, "longitude": 150.8100, "region": "New Ireland", "country": "Papua New Guinea", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun reef with both lefts and rights"},
    
    # East New Britain
    {"name": "Rabaul Reef", "latitude": -4.2000, "longitude": 152.1800, "region": "East New Britain", "country": "Papua New Guinea", "difficulty": "advanced", "wave_type": "reef", "description": "Volcanic reef with powerful waves"},
    {"name": "Kokopo Point", "latitude": -4.3422, "longitude": 152.2700, "region": "East New Britain", "country": "Papua New Guinea", "difficulty": "intermediate", "wave_type": "point", "description": "Long point break wrapping into the bay"},
    
    # Madang Province  
    {"name": "Madang Lagoon", "latitude": -5.2167, "longitude": 145.7833, "region": "Madang", "country": "Papua New Guinea", "difficulty": "beginner", "wave_type": "beach", "description": "Protected lagoon break for beginners"},
    {"name": "Kranket Island", "latitude": -5.1800, "longitude": 145.8200, "region": "Madang", "country": "Papua New Guinea", "difficulty": "intermediate", "wave_type": "reef", "description": "Island reef with clear water"},
    
    # Milne Bay
    {"name": "Alotau Reef", "latitude": -10.3111, "longitude": 150.4500, "region": "Milne Bay", "country": "Papua New Guinea", "difficulty": "intermediate", "wave_type": "reef", "description": "Remote reef setup with occasional quality swells"},
]


# Vanuatu Spots - South Pacific paradise
VANUATU_SPOTS = [
    # Efate Island (main island)
    {"name": "Pango Point", "latitude": -17.7500, "longitude": 168.2800, "region": "Efate", "country": "Vanuatu", "difficulty": "intermediate", "wave_type": "point", "description": "Long right point on south swell"},
    {"name": "Breakas Beach", "latitude": -17.6833, "longitude": 168.3000, "region": "Efate", "country": "Vanuatu", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break near Port Vila"},
    {"name": "Devil's Point", "latitude": -17.6500, "longitude": 168.2500, "region": "Efate", "country": "Vanuatu", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful left over sharp reef"},
    {"name": "Erakor Lagoon", "latitude": -17.7667, "longitude": 168.3167, "region": "Efate", "country": "Vanuatu", "difficulty": "beginner", "wave_type": "beach", "description": "Protected lagoon for beginners"},
    
    # Tanna Island
    {"name": "Port Resolution", "latitude": -19.5167, "longitude": 169.4833, "region": "Tanna", "country": "Vanuatu", "difficulty": "intermediate", "wave_type": "reef", "description": "Volcanic island reef near active volcano"},
    {"name": "Lenakel Point", "latitude": -19.5333, "longitude": 169.2667, "region": "Tanna", "country": "Vanuatu", "difficulty": "intermediate", "wave_type": "point", "description": "West coast point break"},
    
    # Santo Island (largest island)
    {"name": "Luganville Reef", "latitude": -15.5000, "longitude": 167.1667, "region": "Espiritu Santo", "country": "Vanuatu", "difficulty": "intermediate", "wave_type": "reef", "description": "Outer reef picks up south swells"},
    {"name": "Champagne Beach", "latitude": -15.4000, "longitude": 167.2000, "region": "Espiritu Santo", "country": "Vanuatu", "difficulty": "beginner", "wave_type": "beach", "description": "Beautiful beach with small waves"},
]


# Solomon Islands Spots - WWII history meets world-class waves
SOLOMON_ISLANDS_SPOTS = [
    # Guadalcanal (main island)
    {"name": "Bonegi Beach", "latitude": -9.3833, "longitude": 159.9500, "region": "Guadalcanal", "country": "Solomon Islands", "difficulty": "intermediate", "wave_type": "beach", "description": "Historic beach break near WWII relics"},
    {"name": "Honiara Point", "latitude": -9.4333, "longitude": 159.9500, "region": "Guadalcanal", "country": "Solomon Islands", "difficulty": "beginner", "wave_type": "point", "description": "Mellow point near the capital"},
    {"name": "Iron Bottom Sound", "latitude": -9.2500, "longitude": 160.0000, "region": "Guadalcanal", "country": "Solomon Islands", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break in the famous sound"},
    
    # New Georgia
    {"name": "Munda Point", "latitude": -8.3167, "longitude": 157.2500, "region": "New Georgia", "country": "Solomon Islands", "difficulty": "intermediate", "wave_type": "point", "description": "Right point break with WWII airstrip"},
    {"name": "Skull Island", "latitude": -8.3500, "longitude": 157.2000, "region": "New Georgia", "country": "Solomon Islands", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef near sacred island"},
    
    # Western Province
    {"name": "Gizo Reef", "latitude": -8.1000, "longitude": 156.8333, "region": "Western Province", "country": "Solomon Islands", "difficulty": "intermediate", "wave_type": "reef", "description": "Main reef break in Gizo town"},
    {"name": "Kennedy Island", "latitude": -8.0833, "longitude": 156.9000, "region": "Western Province", "country": "Solomon Islands", "difficulty": "intermediate", "wave_type": "reef", "description": "Historic island where JFK was rescued"},
]


# Chile Spots - Cold water perfection
CHILE_SPOTS = [
    # Arica Region (north)
    {"name": "El Gringo", "latitude": -18.4800, "longitude": -70.3300, "region": "Arica", "country": "Chile", "difficulty": "advanced", "wave_type": "point", "description": "Heavy left point over rocks, big wave spot"},
    {"name": "Chinchorro", "latitude": -18.4650, "longitude": -70.3400, "region": "Arica", "country": "Chile", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break"},
    
    # Iquique Region
    {"name": "Punta de Lobos", "latitude": -34.4167, "longitude": -72.0500, "region": "O'Higgins", "country": "Chile", "difficulty": "expert", "wave_type": "point", "description": "Chile's most famous big wave spot"},
    {"name": "Iquique Point", "latitude": -20.2300, "longitude": -70.1500, "region": "Iquique", "country": "Chile", "difficulty": "intermediate", "wave_type": "point", "description": "Urban point break"},
    
    # Central Coast (Valparaiso)
    {"name": "Renaca", "latitude": -32.9833, "longitude": -71.5500, "region": "Valparaiso", "country": "Chile", "difficulty": "intermediate", "wave_type": "beach", "description": "Popular beach break near Vina del Mar"},
    {"name": "Ritoque", "latitude": -32.8333, "longitude": -71.5167, "region": "Valparaiso", "country": "Chile", "difficulty": "intermediate", "wave_type": "beach", "description": "Long beach with multiple peaks"},
    {"name": "Maitencillo", "latitude": -32.6333, "longitude": -71.4500, "region": "Valparaiso", "country": "Chile", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach break"},
    
    # Pichilemu Region (surf capital)
    {"name": "La Puntilla", "latitude": -34.3833, "longitude": -72.0167, "region": "O'Higgins", "country": "Chile", "difficulty": "intermediate", "wave_type": "point", "description": "Classic left point break"},
    {"name": "Infiernillo", "latitude": -34.4000, "longitude": -72.0333, "region": "O'Higgins", "country": "Chile", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break south of town"},
    {"name": "La Boca", "latitude": -34.3700, "longitude": -72.0100, "region": "O'Higgins", "country": "Chile", "difficulty": "beginner", "wave_type": "beach", "description": "River mouth beach break"},
    
    # Southern Chile
    {"name": "Constitucion", "latitude": -35.3333, "longitude": -72.4167, "region": "Maule", "country": "Chile", "difficulty": "intermediate", "wave_type": "point", "description": "South swell magnet"},
]


# Peru Spots - Longest lefts in the world
PERU_SPOTS = [
    # Northern Peru
    {"name": "Chicama", "latitude": -7.7000, "longitude": -79.4500, "region": "La Libertad", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "World's longest left - up to 4km rides"},
    {"name": "Huanchaco", "latitude": -8.0833, "longitude": -79.1167, "region": "La Libertad", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "Historic surf town, home of caballitos de totora"},
    {"name": "Pacasmayo", "latitude": -7.4000, "longitude": -79.5667, "region": "La Libertad", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "Long left point north of Chicama"},
    {"name": "Lobitos", "latitude": -4.4500, "longitude": -81.2833, "region": "Piura", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "Oil town with multiple quality lefts"},
    {"name": "Mancora", "latitude": -4.1000, "longitude": -81.0500, "region": "Piura", "country": "Peru", "difficulty": "beginner", "wave_type": "beach", "description": "Warm water beach break, beginner paradise"},
    {"name": "Cabo Blanco", "latitude": -4.2333, "longitude": -81.2333, "region": "Piura", "country": "Peru", "difficulty": "advanced", "wave_type": "point", "description": "Heavy left, Hemingway's favorite fishing spot"},
    
    # Central Peru (Lima)
    {"name": "Pico Alto", "latitude": -12.4833, "longitude": -76.8167, "region": "Lima", "country": "Peru", "difficulty": "expert", "wave_type": "reef", "description": "Peru's premier big wave spot"},
    {"name": "Punta Hermosa", "latitude": -12.3333, "longitude": -76.8000, "region": "Lima", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "Consistent left point south of Lima"},
    {"name": "Punta Rocas", "latitude": -12.3500, "longitude": -76.8167, "region": "Lima", "country": "Peru", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef, former ISA contest site"},
    {"name": "La Herradura", "latitude": -12.1667, "longitude": -77.0333, "region": "Lima", "country": "Peru", "difficulty": "intermediate", "wave_type": "point", "description": "Urban point in Lima bay"},
    {"name": "Makaha (Peru)", "latitude": -12.1833, "longitude": -77.0333, "region": "Lima", "country": "Peru", "difficulty": "beginner", "wave_type": "beach", "description": "Popular beach break in Miraflores"},
]


async def add_spots(spots: list, session: AsyncSession) -> int:
    """Add spots to database, skipping duplicates"""
    added = 0
    for spot_data in spots:
        # Check if spot exists
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
    print("PACIFIC ISLANDS & SOUTH AMERICA EXPANSION")
    print("=" * 60)
    
    async with AsyncSession(engine) as session:
        total_added = 0
        
        # Papua New Guinea
        print("\n[PAPUA NEW GUINEA]")
        count = await add_spots(PAPUA_NEW_GUINEA_SPOTS, session)
        total_added += count
        print(f"  PNG Total: {count} spots added")
        
        # Vanuatu
        print("\n[VANUATU]")
        count = await add_spots(VANUATU_SPOTS, session)
        total_added += count
        print(f"  Vanuatu Total: {count} spots added")
        
        # Solomon Islands
        print("\n[SOLOMON ISLANDS]")
        count = await add_spots(SOLOMON_ISLANDS_SPOTS, session)
        total_added += count
        print(f"  Solomon Islands Total: {count} spots added")
        
        # Chile
        print("\n[CHILE]")
        count = await add_spots(CHILE_SPOTS, session)
        total_added += count
        print(f"  Chile Total: {count} spots added")
        
        # Peru
        print("\n[PERU]")
        count = await add_spots(PERU_SPOTS, session)
        total_added += count
        print(f"  Peru Total: {count} spots added")
        
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
