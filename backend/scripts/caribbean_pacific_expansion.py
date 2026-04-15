"""
Spot Expansion - Caribbean & Pacific
April 2026 - Bahamas, BVI, Cook Islands, Bermuda, Canary Islands

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

# BAHAMAS SPOTS
BAHAMAS_SPOTS = [
    {"name": "Surfers Beach", "region": "Eleuthera", "lat": 24.995, "lon": -76.168, "difficulty": "Intermediate"},
    {"name": "Gauldings Cay", "region": "Eleuthera", "lat": 25.012, "lon": -76.158, "difficulty": "Advanced"},
    {"name": "Lighthouse Beach", "region": "Eleuthera", "lat": 24.645, "lon": -76.168, "difficulty": "Intermediate"},
    {"name": "French Leave Beach", "region": "Eleuthera", "lat": 25.058, "lon": -76.145, "difficulty": "Beginner"},
    {"name": "Harbour Island", "region": "Eleuthera", "lat": 25.498, "lon": -76.628, "difficulty": "Beginner"},
    {"name": "Cable Beach", "region": "Nassau", "lat": 25.075, "lon": -77.415, "difficulty": "Beginner"},
    {"name": "Love Beach", "region": "Nassau", "lat": 25.068, "lon": -77.488, "difficulty": "Beginner"},
    {"name": "Junkanoo Beach", "region": "Nassau", "lat": 25.075, "lon": -77.345, "difficulty": "Beginner"},
    {"name": "Grand Bahama Point", "region": "Grand Bahama", "lat": 26.708, "lon": -78.998, "difficulty": "Intermediate"},
    {"name": "Fortune Beach", "region": "Grand Bahama", "lat": 26.498, "lon": -78.658, "difficulty": "Beginner"},
]

# BRITISH VIRGIN ISLANDS SPOTS
BVI_SPOTS = [
    {"name": "Apple Bay", "region": "Tortola", "lat": 18.428, "lon": -64.688, "difficulty": "Intermediate"},
    {"name": "Josiah's Bay", "region": "Tortola", "lat": 18.448, "lon": -64.578, "difficulty": "Intermediate"},
    {"name": "Cane Garden Bay", "region": "Tortola", "lat": 18.438, "lon": -64.668, "difficulty": "Beginner"},
    {"name": "Long Bay West", "region": "Tortola", "lat": 18.418, "lon": -64.708, "difficulty": "Intermediate"},
    {"name": "Lambert Beach", "region": "Tortola", "lat": 18.458, "lon": -64.558, "difficulty": "Beginner"},
    {"name": "Spring Bay", "region": "Virgin Gorda", "lat": 18.438, "lon": -64.428, "difficulty": "Beginner"},
    {"name": "Savannah Bay", "region": "Virgin Gorda", "lat": 18.478, "lon": -64.388, "difficulty": "Intermediate"},
]

# COOK ISLANDS SPOTS (Pacific)
COOK_ISLANDS_SPOTS = [
    {"name": "Avana Passage", "region": "Rarotonga", "lat": -21.248, "lon": -159.728, "difficulty": "Advanced"},
    {"name": "Black Rock", "region": "Rarotonga", "lat": -21.208, "lon": -159.808, "difficulty": "Intermediate"},
    {"name": "Aroa Beach", "region": "Rarotonga", "lat": -21.258, "lon": -159.808, "difficulty": "Beginner"},
    {"name": "Muri Lagoon", "region": "Rarotonga", "lat": -21.248, "lon": -159.748, "difficulty": "Beginner"},
    {"name": "Titikaveka", "region": "Rarotonga", "lat": -21.278, "lon": -159.778, "difficulty": "Intermediate"},
    {"name": "Oneroa Beach", "region": "Aitutaki", "lat": -18.858, "lon": -159.788, "difficulty": "Beginner"},
]

# BERMUDA SPOTS
BERMUDA_SPOTS = [
    {"name": "Horseshoe Bay", "region": "Southampton", "lat": 32.238, "lon": -64.838, "difficulty": "Intermediate"},
    {"name": "Elbow Beach", "region": "Paget", "lat": 32.268, "lon": -64.778, "difficulty": "Intermediate"},
    {"name": "John Smith's Bay", "region": "Smith's", "lat": 32.328, "lon": -64.718, "difficulty": "Intermediate"},
    {"name": "Warwick Long Bay", "region": "Warwick", "lat": 32.248, "lon": -64.818, "difficulty": "Intermediate"},
    {"name": "Jobson's Cove", "region": "Warwick", "lat": 32.248, "lon": -64.828, "difficulty": "Beginner"},
    {"name": "Astwood Cove", "region": "Warwick", "lat": 32.258, "lon": -64.808, "difficulty": "Beginner"},
    {"name": "Shelly Bay", "region": "Hamilton", "lat": 32.328, "lon": -64.728, "difficulty": "Beginner"},
    {"name": "Tobacco Bay", "region": "St. George's", "lat": 32.388, "lon": -64.668, "difficulty": "Beginner"},
]

# CANARY ISLANDS SPOTS (Additional)
CANARY_ISLANDS_SPOTS = [
    {"name": "Playa de Las Americas", "region": "Tenerife", "lat": 28.048, "lon": -16.728, "difficulty": "Beginner"},
    {"name": "El Socorro", "region": "Tenerife", "lat": 28.388, "lon": -16.548, "difficulty": "Intermediate"},
    {"name": "Almaciga", "region": "Tenerife", "lat": 28.558, "lon": -16.148, "difficulty": "Advanced"},
    {"name": "Playa de Benijo", "region": "Tenerife", "lat": 28.568, "lon": -16.178, "difficulty": "Advanced"},
    {"name": "El Confital", "region": "Gran Canaria", "lat": 28.158, "lon": -15.448, "difficulty": "Advanced"},
    {"name": "Playa del Ingles", "region": "Gran Canaria", "lat": 27.748, "lon": -15.568, "difficulty": "Intermediate"},
    {"name": "La Cicer", "region": "Gran Canaria", "lat": 28.128, "lon": -15.448, "difficulty": "Intermediate"},
    {"name": "El Quemao", "region": "Lanzarote", "lat": 29.218, "lon": -13.868, "difficulty": "Advanced"},
    {"name": "Famara", "region": "Lanzarote", "lat": 29.118, "lon": -13.558, "difficulty": "Intermediate"},
    {"name": "La Santa", "region": "Lanzarote", "lat": 29.048, "lon": -13.638, "difficulty": "Advanced"},
    {"name": "Lobos", "region": "Fuerteventura", "lat": 28.748, "lon": -13.818, "difficulty": "Advanced"},
    {"name": "Cotillo", "region": "Fuerteventura", "lat": 28.688, "lon": -14.018, "difficulty": "Intermediate"},
    {"name": "Flag Beach", "region": "Fuerteventura", "lat": 28.728, "lon": -13.858, "difficulty": "Beginner"},
    {"name": "Playa de la Pared", "region": "Fuerteventura", "lat": 28.218, "lon": -14.178, "difficulty": "Intermediate"},
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
    print("CARIBBEAN & PACIFIC EXPANSION - April 2026")
    print("=" * 60)
    
    # Bahamas
    print("\n1. Adding Bahamas spots...")
    bahamas_added, bahamas_skipped = await add_spots(BAHAMAS_SPOTS, "Bahamas")
    print(f"   Bahamas: Added {bahamas_added}, Skipped {bahamas_skipped}")
    
    # BVI
    print("\n2. Adding British Virgin Islands spots...")
    bvi_added, bvi_skipped = await add_spots(BVI_SPOTS, "British Virgin Islands")
    print(f"   BVI: Added {bvi_added}, Skipped {bvi_skipped}")
    
    # Cook Islands
    print("\n3. Adding Cook Islands spots...")
    cook_added, cook_skipped = await add_spots(COOK_ISLANDS_SPOTS, "Cook Islands")
    print(f"   Cook Islands: Added {cook_added}, Skipped {cook_skipped}")
    
    # Bermuda
    print("\n4. Adding Bermuda spots...")
    bermuda_added, bermuda_skipped = await add_spots(BERMUDA_SPOTS, "Bermuda")
    print(f"   Bermuda: Added {bermuda_added}, Skipped {bermuda_skipped}")
    
    # Canary Islands
    print("\n5. Adding Canary Islands spots...")
    canary_added, canary_skipped = await add_spots(CANARY_ISLANDS_SPOTS, "Spain")
    print(f"   Canary Islands: Added {canary_added}, Skipped {canary_skipped}")
    
    # Summary
    total_added = bahamas_added + bvi_added + cook_added + bermuda_added + canary_added
    print("\n" + "=" * 60)
    print(f"TOTAL SPOTS ADDED: {total_added}")
    print("=" * 60)
    
    # Verify final counts
    async with AsyncSession(engine) as db:
        result = await db.execute(text("SELECT COUNT(*) FROM surf_spots WHERE is_active = true"))
        total = result.scalar()
        print(f"\nTotal active spots in database: {total}")
        
        # Show country breakdown for new additions
        result = await db.execute(text("""
            SELECT country, COUNT(*) as cnt 
            FROM surf_spots 
            WHERE country IN ('Bahamas', 'British Virgin Islands', 'Cook Islands', 'Bermuda')
               OR (country = 'Spain' AND region IN ('Tenerife', 'Gran Canaria', 'Lanzarote', 'Fuerteventura'))
            GROUP BY country 
            ORDER BY cnt DESC
        """))
        rows = result.fetchall()
        print("\nNew regions added:")
        for row in rows:
            print(f"  - {row[0]}: {row[1]} spots")

if __name__ == "__main__":
    asyncio.run(main())
