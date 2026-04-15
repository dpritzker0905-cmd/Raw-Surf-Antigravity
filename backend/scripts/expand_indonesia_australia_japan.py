"""
Indonesia, Australia, Japan Surf Spot Expansion (Delta Sync)
Adds new spots only - skips existing spots to preserve data integrity
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Indonesia - World's most diverse surf destination
INDONESIA_SPOTS = [
    # Bali
    {"name": "Uluwatu", "latitude": -8.8294, "longitude": 115.0849, "region": "Bali", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Bali's most famous wave - multiple sections from Temples to Racetrack"},
    {"name": "Padang Padang", "latitude": -8.8147, "longitude": 115.1003, "region": "Bali", "country": "Indonesia", "difficulty": "expert", "wave_type": "reef", "description": "Heavy barrel over shallow reef - Pipeline of the East"},
    {"name": "Bingin", "latitude": -8.8072, "longitude": 115.1047, "region": "Bali", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun left with barrel sections"},
    {"name": "Impossibles", "latitude": -8.8111, "longitude": 115.1028, "region": "Bali", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Long left reef - connects 3 sections when big"},
    {"name": "Keramas", "latitude": -8.5575, "longitude": 115.4439, "region": "Bali", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "World-class right - WSL CT venue"},
    {"name": "Canggu", "latitude": -8.6478, "longitude": 115.1364, "region": "Bali", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "beach", "description": "Popular beach break with multiple peaks"},
    {"name": "Medewi", "latitude": -8.4147, "longitude": 114.8133, "region": "Bali", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "point", "description": "Long left point break in West Bali"},
    {"name": "Balangan", "latitude": -8.7922, "longitude": 115.1117, "region": "Bali", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Scenic beach with fun left reef"},
    
    # Lombok & Sumbawa
    {"name": "Desert Point", "latitude": -8.7500, "longitude": 115.8333, "region": "Lombok", "country": "Indonesia", "difficulty": "expert", "wave_type": "reef", "description": "One of the world's longest barrels - 300m+ rides"},
    {"name": "Gerupuk Inside", "latitude": -8.8967, "longitude": 116.3314, "region": "Lombok", "country": "Indonesia", "difficulty": "beginner", "wave_type": "reef", "description": "Protected bay with beginner-friendly waves"},
    {"name": "Gerupuk Outside", "latitude": -8.9000, "longitude": 116.3400, "region": "Lombok", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple reef breaks in the bay"},
    {"name": "Lakey Peak", "latitude": -8.8167, "longitude": 118.3833, "region": "Sumbawa", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Perfect A-frame peak - lefts and rights"},
    {"name": "Lakey Pipe", "latitude": -8.8200, "longitude": 118.3800, "region": "Sumbawa", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow left barrel"},
    {"name": "Nungas", "latitude": -8.8133, "longitude": 118.3867, "region": "Sumbawa", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun right-hander with multiple sections"},
    {"name": "Supersuck", "latitude": -9.0000, "longitude": 119.3500, "region": "Sumbawa", "country": "Indonesia", "difficulty": "expert", "wave_type": "slab", "description": "Heavy slab - one of Indonesia's most dangerous"},
    
    # Mentawai Islands
    {"name": "Macaronis", "latitude": -2.1333, "longitude": 99.4000, "region": "Mentawai", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "The 'Funnest Wave in the World' - perfect left"},
    {"name": "Lance's Right", "latitude": -2.1500, "longitude": 99.4167, "region": "Mentawai", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "World-class right barrel - Hollow Trees"},
    {"name": "Lance's Left", "latitude": -2.1467, "longitude": 99.4133, "region": "Mentawai", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful left across from Lance's Right"},
    {"name": "Telescopes", "latitude": -2.2000, "longitude": 99.3833, "region": "Mentawai", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Long walling right - great for intermediates"},
    {"name": "Rifles", "latitude": -2.1833, "longitude": 99.4000, "region": "Mentawai", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Fast mechanical right"},
    {"name": "Kandui Left", "latitude": -2.1667, "longitude": 99.3667, "region": "Mentawai", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy left barrel with thick lip"},
    {"name": "Ebay", "latitude": -2.2167, "longitude": 99.3500, "region": "Mentawai", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun left with long walls"},
    
    # Sumatra
    {"name": "Krui", "latitude": -5.2833, "longitude": 103.9500, "region": "Sumatra", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple breaks around Krui town"},
    {"name": "Mandiri", "latitude": -5.3000, "longitude": 103.9333, "region": "Sumatra", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy left barrel south of Krui"},
    {"name": "The Peak Krui", "latitude": -5.2667, "longitude": 103.9667, "region": "Sumatra", "country": "Indonesia", "difficulty": "intermediate", "wave_type": "reef", "description": "A-frame peak with fun lefts and rights"},
    
    # G-Land (East Java)
    {"name": "G-Land Speedies", "latitude": -8.4500, "longitude": 114.3500, "region": "East Java", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Fast racing section of G-Land"},
    {"name": "G-Land Money Trees", "latitude": -8.4467, "longitude": 114.3467, "region": "East Java", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Main peak - world-class left"},
    {"name": "G-Land Launching Pad", "latitude": -8.4433, "longitude": 114.3433, "region": "East Java", "country": "Indonesia", "difficulty": "advanced", "wave_type": "reef", "description": "Outside section with big barrels"},
    {"name": "G-Land Kongs", "latitude": -8.4400, "longitude": 114.3400, "region": "East Java", "country": "Indonesia", "difficulty": "expert", "wave_type": "reef", "description": "Heavy outer reef for experts only"},
]


# Australia - The Land Down Under
AUSTRALIA_SPOTS = [
    # New South Wales
    {"name": "Snapper Rocks", "latitude": -28.1667, "longitude": 153.5500, "region": "Gold Coast", "country": "Australia", "difficulty": "advanced", "wave_type": "point", "description": "World-famous right point - WSL CT venue"},
    {"name": "Kirra", "latitude": -28.1667, "longitude": 153.5167, "region": "Gold Coast", "country": "Australia", "difficulty": "expert", "wave_type": "point", "description": "Legendary barrel - when it's on, nothing compares"},
    {"name": "Burleigh Heads", "latitude": -28.0833, "longitude": 153.4500, "region": "Gold Coast", "country": "Australia", "difficulty": "advanced", "wave_type": "point", "description": "Classic right point break"},
    {"name": "D-Bah", "latitude": -28.1833, "longitude": 153.5333, "region": "Gold Coast", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Duranbah Beach - high-performance waves"},
    {"name": "Byron Bay - The Pass", "latitude": -28.6333, "longitude": 153.6167, "region": "NSW", "country": "Australia", "difficulty": "intermediate", "wave_type": "point", "description": "Long right point in Byron Bay"},
    {"name": "Lennox Head", "latitude": -28.7833, "longitude": 153.5833, "region": "NSW", "country": "Australia", "difficulty": "advanced", "wave_type": "point", "description": "Boulder point break - powerful right"},
    {"name": "Angourie", "latitude": -29.4667, "longitude": 153.3667, "region": "NSW", "country": "Australia", "difficulty": "advanced", "wave_type": "point", "description": "Classic point break near Yamba"},
    {"name": "Manly Beach", "latitude": -33.7833, "longitude": 151.2833, "region": "Sydney", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Sydney's most famous beach break"},
    {"name": "Dee Why Point", "latitude": -33.7500, "longitude": 151.3000, "region": "Sydney", "country": "Australia", "difficulty": "advanced", "wave_type": "point", "description": "Rocky right point on the northern beaches"},
    {"name": "North Narrabeen", "latitude": -33.7167, "longitude": 151.3000, "region": "Sydney", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break - competition venue"},
    
    # Victoria
    {"name": "Bells Beach", "latitude": -38.3667, "longitude": 144.2667, "region": "Victoria", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Iconic right - home of the Rip Curl Pro"},
    {"name": "Winkipop", "latitude": -38.3700, "longitude": 144.2633, "region": "Victoria", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Right next to Bells - hollow right"},
    {"name": "Johanna Beach", "latitude": -38.7500, "longitude": 143.3833, "region": "Victoria", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Remote beach break on the Great Ocean Road"},
    {"name": "Woolamai", "latitude": -38.5167, "longitude": 145.3333, "region": "Victoria", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Powerful beach break on Phillip Island"},
    
    # Western Australia
    {"name": "Margaret River Main Break", "latitude": -33.9667, "longitude": 114.9833, "region": "Western Australia", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Margaret River - WSL CT venue"},
    {"name": "The Box", "latitude": -33.9833, "longitude": 114.9667, "region": "Western Australia", "country": "Australia", "difficulty": "expert", "wave_type": "slab", "description": "Heavy slab - one of Australia's heaviest"},
    {"name": "North Point", "latitude": -33.9500, "longitude": 115.0000, "region": "Western Australia", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Long right reef at Gracetown"},
    {"name": "Yallingup", "latitude": -33.6500, "longitude": 115.0333, "region": "Western Australia", "country": "Australia", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple reef breaks - fun waves"},
    {"name": "Rottnest Island", "latitude": -32.0000, "longitude": 115.5000, "region": "Western Australia", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Island reef breaks near Perth"},
    {"name": "Scarborough Beach", "latitude": -31.8833, "longitude": 115.7500, "region": "Western Australia", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Perth's main beach break"},
    
    # South Australia
    {"name": "Cactus Beach", "latitude": -32.0500, "longitude": 132.5000, "region": "South Australia", "country": "Australia", "difficulty": "advanced", "wave_type": "reef", "description": "Remote world-class wave in the Nullarbor"},
    {"name": "Pennington Bay", "latitude": -35.8000, "longitude": 137.8667, "region": "South Australia", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Kangaroo Island beach break"},
    
    # Queensland
    {"name": "Noosa First Point", "latitude": -26.3833, "longitude": 153.0833, "region": "Queensland", "country": "Australia", "difficulty": "intermediate", "wave_type": "point", "description": "Long mellow right - longboard paradise"},
    {"name": "Coolangatta", "latitude": -28.1667, "longitude": 153.5333, "region": "Queensland", "country": "Australia", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach breaks"},
]


# Japan - Typhoon swells and unique culture
JAPAN_SPOTS = [
    # Chiba Prefecture (Near Tokyo)
    {"name": "Ichinomiya", "latitude": 35.3667, "longitude": 140.4000, "region": "Chiba", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "2020 Olympics surf venue - consistent beach break"},
    {"name": "Shidashita", "latitude": 35.3500, "longitude": 140.3833, "region": "Chiba", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Popular competition venue"},
    {"name": "Taito Beach", "latitude": 35.3333, "longitude": 140.3667, "region": "Chiba", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break south of Tokyo"},
    {"name": "Maruki", "latitude": 35.3167, "longitude": 140.3500, "region": "Chiba", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Fun peaks when typhoon swells hit"},
    {"name": "Onjuku", "latitude": 35.1833, "longitude": 140.3833, "region": "Chiba", "country": "Japan", "difficulty": "beginner", "wave_type": "beach", "description": "Protected beach good for beginners"},
    
    # Kanagawa (Shonan Coast)
    {"name": "Shonan", "latitude": 35.3167, "longitude": 139.4833, "region": "Kanagawa", "country": "Japan", "difficulty": "beginner", "wave_type": "beach", "description": "Japan's surf birthplace - small but fun"},
    {"name": "Kugenuma", "latitude": 35.3333, "longitude": 139.4667, "region": "Kanagawa", "country": "Japan", "difficulty": "beginner", "wave_type": "beach", "description": "Popular Shonan beach break"},
    {"name": "Enoshima", "latitude": 35.3000, "longitude": 139.4833, "region": "Kanagawa", "country": "Japan", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near the famous island"},
    
    # Shizuoka (Izu Peninsula)
    {"name": "Shirahama (Izu)", "latitude": 34.6667, "longitude": 138.9667, "region": "Shizuoka", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "White sand beach with fun waves"},
    {"name": "Irita", "latitude": 34.7500, "longitude": 138.9500, "region": "Shizuoka", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Izu Peninsula beach break"},
    
    # Miyazaki Prefecture (Kyushu)
    {"name": "Kisakihama", "latitude": 31.7333, "longitude": 131.4167, "region": "Miyazaki", "country": "Japan", "difficulty": "advanced", "wave_type": "beach", "description": "Powerful beach break - typhoon magnet"},
    {"name": "Aoshima", "latitude": 31.8000, "longitude": 131.4667, "region": "Miyazaki", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Scenic beach near Devil's Washboard"},
    {"name": "Okuragahama", "latitude": 31.9167, "longitude": 131.4833, "region": "Miyazaki", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Long stretch of beach with multiple peaks"},
    
    # Okinawa
    {"name": "Sunabe Seawall", "latitude": 26.3333, "longitude": 127.7333, "region": "Okinawa", "country": "Japan", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break along the famous seawall"},
    {"name": "Motobu", "latitude": 26.6500, "longitude": 127.8833, "region": "Okinawa", "country": "Japan", "difficulty": "advanced", "wave_type": "reef", "description": "Northern Okinawa reef break"},
    
    # Hokkaido
    {"name": "Hamaatsuma", "latitude": 42.8167, "longitude": 141.7833, "region": "Hokkaido", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Cold water beach break in northern Japan"},
    
    # Shikoku
    {"name": "Ikumi", "latitude": 33.5500, "longitude": 134.3333, "region": "Shikoku", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Typhoon swell magnet on Shikoku"},
    {"name": "Ohama", "latitude": 33.5333, "longitude": 134.3167, "region": "Shikoku", "country": "Japan", "difficulty": "intermediate", "wave_type": "beach", "description": "Fun beach break near Ikumi"},
]


async def add_spots_delta(spots: list, session: AsyncSession, country: str) -> tuple:
    """
    Delta sync: Add only NEW spots, skip existing ones
    Returns (added_count, skipped_count)
    """
    added = 0
    skipped = 0
    
    for spot_data in spots:
        # Check if spot exists by name
        result = await session.execute(
            select(SurfSpot).where(SurfSpot.name == spot_data["name"])
        )
        existing = result.scalar_one_or_none()
        
        if existing:
            skipped += 1
            continue
        
        spot = SurfSpot(**spot_data)
        session.add(spot)
        added += 1
        print(f"  + Added: {spot_data['name']} ({spot_data['region']})")
    
    return added, skipped


async def main():
    print("=" * 60)
    print("INDONESIA, AUSTRALIA, JAPAN EXPANSION (Delta Sync)")
    print("=" * 60)
    
    async with AsyncSession(engine) as session:
        # Get initial count
        result = await session.execute(select(SurfSpot))
        initial_count = len(result.scalars().all())
        print(f"\nInitial spot count: {initial_count}")
        
        total_added = 0
        total_skipped = 0
        
        # Indonesia
        print("\n[INDONESIA] - Delta Sync")
        added, skipped = await add_spots_delta(INDONESIA_SPOTS, session, "Indonesia")
        total_added += added
        total_skipped += skipped
        print(f"  Indonesia: {added} added, {skipped} skipped")
        
        # Australia
        print("\n[AUSTRALIA] - Delta Sync")
        added, skipped = await add_spots_delta(AUSTRALIA_SPOTS, session, "Australia")
        total_added += added
        total_skipped += skipped
        print(f"  Australia: {added} added, {skipped} skipped")
        
        # Japan
        print("\n[JAPAN] - Delta Sync")
        added, skipped = await add_spots_delta(JAPAN_SPOTS, session, "Japan")
        total_added += added
        total_skipped += skipped
        print(f"  Japan: {added} added, {skipped} skipped")
        
        await session.commit()
        
        # Get final count
        result = await session.execute(select(SurfSpot))
        final_count = len(result.scalars().all())
        
        print("\n" + "=" * 60)
        print(f"DELTA SYNC COMPLETE!")
        print(f"  New spots added: {total_added}")
        print(f"  Existing spots skipped: {total_skipped}")
        print(f"  Total spots in database: {final_count}")
        print("=" * 60)


if __name__ == "__main__":
    asyncio.run(main())
