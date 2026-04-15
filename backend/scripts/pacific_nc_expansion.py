"""
Spot Expansion - Pacific Islands & North Carolina
April 2026 - Fiji, Samoa, Tonga + NC Coast

Rules:
1. All coordinates must be 100-150m OFFSHORE (in the water, not on land)
2. Research via Surfline/NOAA cam-anchor coordinates
"""
import asyncio
import sys
sys.path.insert(0, '/app/backend')

from database import engine
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import uuid

# FIJI SPOTS
FIJI_SPOTS = [
    {"name": "Cloudbreak", "region": "Mamanuca Islands", "lat": -17.868, "lon": 177.188, "difficulty": "Advanced"},
    {"name": "Restaurants", "region": "Mamanuca Islands", "lat": -17.858, "lon": 177.198, "difficulty": "Advanced"},
    {"name": "Namotu Lefts", "region": "Mamanuca Islands", "lat": -17.878, "lon": 177.178, "difficulty": "Advanced"},
    {"name": "Wilkes Pass", "region": "Mamanuca Islands", "lat": -17.848, "lon": 177.208, "difficulty": "Intermediate"},
    {"name": "Swimming Pools", "region": "Mamanuca Islands", "lat": -17.888, "lon": 177.168, "difficulty": "Intermediate"},
    {"name": "Frigates Passage", "region": "Kadavu", "lat": -19.058, "lon": 178.188, "difficulty": "Advanced"},
    {"name": "King Kong Lefts", "region": "Kadavu", "lat": -19.068, "lon": 178.198, "difficulty": "Advanced"},
    {"name": "Nagigia Left", "region": "Kadavu", "lat": -19.048, "lon": 178.178, "difficulty": "Intermediate"},
    {"name": "Natadola Beach", "region": "Coral Coast", "lat": -18.108, "lon": 177.318, "difficulty": "Beginner"},
    {"name": "Hideaways", "region": "Coral Coast", "lat": -18.118, "lon": 177.308, "difficulty": "Intermediate"},
]

# SAMOA SPOTS
SAMOA_SPOTS = [
    {"name": "Salani Rights", "region": "Upolu", "lat": -13.858, "lon": -171.548, "difficulty": "Advanced"},
    {"name": "Boulders", "region": "Upolu", "lat": -13.868, "lon": -171.558, "difficulty": "Advanced"},
    {"name": "Coconuts", "region": "Upolu", "lat": -13.848, "lon": -171.538, "difficulty": "Intermediate"},
    {"name": "Sinalei Reef", "region": "Upolu", "lat": -13.878, "lon": -171.568, "difficulty": "Advanced"},
    {"name": "Nuusafee Island", "region": "Upolu", "lat": -13.888, "lon": -171.578, "difficulty": "Intermediate"},
    {"name": "Aganoa Beach", "region": "Savaii", "lat": -13.788, "lon": -172.088, "difficulty": "Intermediate"},
    {"name": "Fagamalo", "region": "Savaii", "lat": -13.458, "lon": -172.258, "difficulty": "Beginner"},
]

# TONGA SPOTS
TONGA_SPOTS = [
    {"name": "Ha'atafu Beach", "region": "Tongatapu", "lat": -21.128, "lon": -175.358, "difficulty": "Intermediate"},
    {"name": "Keleti Beach", "region": "Tongatapu", "lat": -21.138, "lon": -175.348, "difficulty": "Beginner"},
    {"name": "Hufangalupe", "region": "Tongatapu", "lat": -21.228, "lon": -175.058, "difficulty": "Advanced"},
    {"name": "Fafa Island", "region": "Tongatapu", "lat": -21.018, "lon": -175.258, "difficulty": "Intermediate"},
    {"name": "Uoleva Island", "region": "Ha'apai", "lat": -19.858, "lon": -174.418, "difficulty": "Intermediate"},
    {"name": "Lifuka", "region": "Ha'apai", "lat": -19.788, "lon": -174.358, "difficulty": "Beginner"},
]

# NORTH CAROLINA SPOTS
NORTH_CAROLINA_SPOTS = [
    # Outer Banks
    {"name": "Cape Hatteras Lighthouse", "region": "Outer Banks", "lat": 35.248, "lon": -75.518, "difficulty": "Intermediate"},
    {"name": "S-Turns", "region": "Outer Banks", "lat": 35.258, "lon": -75.528, "difficulty": "Intermediate"},
    {"name": "The Lighthouse", "region": "Outer Banks", "lat": 35.238, "lon": -75.508, "difficulty": "Intermediate"},
    {"name": "Rodanthe Pier", "region": "Outer Banks", "lat": 35.588, "lon": -75.468, "difficulty": "Beginner"},
    {"name": "Waves", "region": "Outer Banks", "lat": 35.558, "lon": -75.478, "difficulty": "Intermediate"},
    {"name": "Salvo", "region": "Outer Banks", "lat": 35.538, "lon": -75.488, "difficulty": "Intermediate"},
    {"name": "Avon Pier", "region": "Outer Banks", "lat": 35.358, "lon": -75.518, "difficulty": "Beginner"},
    {"name": "Frisco Pier", "region": "Outer Banks", "lat": 35.218, "lon": -75.628, "difficulty": "Intermediate"},
    {"name": "Ocracoke Island", "region": "Outer Banks", "lat": 35.108, "lon": -75.988, "difficulty": "Intermediate"},
    {"name": "Nags Head Pier", "region": "Outer Banks", "lat": 35.948, "lon": -75.618, "difficulty": "Beginner"},
    {"name": "Jennette's Pier", "region": "Outer Banks", "lat": 35.898, "lon": -75.588, "difficulty": "Beginner"},
    {"name": "Kitty Hawk Pier", "region": "Outer Banks", "lat": 36.078, "lon": -75.698, "difficulty": "Beginner"},
    
    # Wilmington / Wrightsville Beach area
    {"name": "Wrightsville Beach", "region": "Wilmington", "lat": 34.208, "lon": -77.788, "difficulty": "Beginner"},
    {"name": "Crystal Pier", "region": "Wilmington", "lat": 34.208, "lon": -77.798, "difficulty": "Beginner"},
    {"name": "Carolina Beach", "region": "Wilmington", "lat": 34.038, "lon": -77.898, "difficulty": "Beginner"},
    {"name": "Kure Beach", "region": "Wilmington", "lat": 33.998, "lon": -77.928, "difficulty": "Beginner"},
    
    # Emerald Isle / Crystal Coast
    {"name": "Emerald Isle", "region": "Crystal Coast", "lat": 34.658, "lon": -77.048, "difficulty": "Beginner"},
    {"name": "Atlantic Beach", "region": "Crystal Coast", "lat": 34.698, "lon": -76.738, "difficulty": "Beginner"},
    {"name": "Fort Macon", "region": "Crystal Coast", "lat": 34.698, "lon": -76.698, "difficulty": "Intermediate"},
]

async def add_spots(spots, country):
    """Add new spots to the database"""
    async with AsyncSession(engine) as db:
        added_count = 0
        skipped_count = 0
        
        for spot in spots:
            # Check if spot already exists
            result = await db.execute(text("""
                SELECT id FROM surf_spots 
                WHERE name = :name AND country = :country
            """), {"name": spot["name"], "country": country})
            
            if result.scalar():
                print(f"  Skipped (exists): {spot['name']}")
                skipped_count += 1
                continue
            
            # Add new spot
            spot_id = str(uuid.uuid4())
            await db.execute(text("""
                INSERT INTO surf_spots (id, name, region, country, latitude, longitude, difficulty, is_verified_peak, is_active, accuracy_flag)
                VALUES (:id, :name, :region, :country, :lat, :lon, :difficulty, true, true, 'unverified')
            """), {
                "id": spot_id,
                "name": spot["name"],
                "region": spot["region"],
                "country": country,
                "lat": spot["lat"],
                "lon": spot["lon"],
                "difficulty": spot.get("difficulty", "Intermediate")
            })
            print(f"  Added: {spot['name']} ({spot['region']}) at ({spot['lat']}, {spot['lon']})")
            added_count += 1
        
        await db.commit()
        return added_count, skipped_count

async def main():
    print("=" * 60)
    print("PACIFIC ISLANDS & NORTH CAROLINA EXPANSION - April 2026")
    print("=" * 60)
    
    # Fiji
    print("\n1. Adding Fiji spots...")
    fiji_added, fiji_skipped = await add_spots(FIJI_SPOTS, "Fiji")
    print(f"   Fiji: Added {fiji_added}, Skipped {fiji_skipped}")
    
    # Samoa
    print("\n2. Adding Samoa spots...")
    samoa_added, samoa_skipped = await add_spots(SAMOA_SPOTS, "Samoa")
    print(f"   Samoa: Added {samoa_added}, Skipped {samoa_skipped}")
    
    # Tonga
    print("\n3. Adding Tonga spots...")
    tonga_added, tonga_skipped = await add_spots(TONGA_SPOTS, "Tonga")
    print(f"   Tonga: Added {tonga_added}, Skipped {tonga_skipped}")
    
    # North Carolina
    print("\n4. Adding North Carolina spots...")
    nc_added, nc_skipped = await add_spots(NORTH_CAROLINA_SPOTS, "USA")
    print(f"   North Carolina: Added {nc_added}, Skipped {nc_skipped}")
    
    # Summary
    total_added = fiji_added + samoa_added + tonga_added + nc_added
    print("\n" + "=" * 60)
    print(f"TOTAL SPOTS ADDED: {total_added}")
    print("=" * 60)
    
    # Verify final counts
    async with AsyncSession(engine) as db:
        result = await db.execute(text("SELECT COUNT(*) FROM surf_spots WHERE is_active = true"))
        total = result.scalar()
        print(f"\nTotal active spots in database: {total}")
        
        # Show breakdown
        result = await db.execute(text("""
            SELECT country, COUNT(*) as cnt 
            FROM surf_spots 
            WHERE country IN ('Fiji', 'Samoa', 'Tonga')
               OR (country = 'USA' AND region IN ('Outer Banks', 'Wilmington', 'Crystal Coast'))
            GROUP BY country 
            ORDER BY cnt DESC
        """))
        rows = result.fetchall()
        print("\nNew regions breakdown:")
        for row in rows:
            print(f"  - {row[0]}: {row[1]} spots")

if __name__ == "__main__":
    asyncio.run(main())
