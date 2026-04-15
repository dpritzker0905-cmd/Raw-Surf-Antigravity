"""
Spot Sync Script - Fix Coordinates & Add New Spots
April 2026 - New York, El Salvador, Costa Rica

Rules:
1. All coordinates must be 100-150m OFFSHORE (in the water, not on land)
2. De-duplicate any existing spots
3. Research via Surfline/NOAA cam-anchor coordinates
"""
import asyncio
from database import engine, get_db
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import uuid

# FIXES: Wrong coordinates that need correction
COORDINATE_FIXES = [
    # Rockaway Beach NY has SF coordinates - fix to actual NY Rockaway
    {
        "id": "9ba77cc8-429c-4b22-94de-da0077a81fe1",
        "name": "Rockaway Beach",
        "region": "Rockaways",
        "country": "USA",
        "new_lat": 40.583,
        "new_lon": -73.798  # Offshore from Beach 90th St area
    },
    # La Bocana El Salvador has Mexico coordinates - fix
    {
        "name": "La Bocana",
        "country": "El Salvador",
        "new_lat": 13.478,
        "new_lon": -89.345  # Near La Libertad coastline
    },
    # Playa Grande Costa Rica has DR coordinates - fix
    {
        "name": "Playa Grande",
        "country": "Costa Rica", 
        "new_lat": 10.328,
        "new_lon": -85.858  # Tamarindo area, offshore
    }
]

# NEW YORK SPOTS - Rockaways to Montauk (offshore coordinates)
NEW_YORK_SPOTS = [
    # Rockaways area
    {"name": "Beach 91st Street", "region": "Rockaways", "lat": 40.581, "lon": -73.810, "difficulty": "Intermediate"},
    {"name": "Beach 84th Street", "region": "Rockaways", "lat": 40.582, "lon": -73.798, "difficulty": "Beginner"},
    {"name": "Beach 69th Street", "region": "Rockaways", "lat": 40.582, "lon": -73.788, "difficulty": "Intermediate"},
    {"name": "Beach 44th Street", "region": "Rockaways", "lat": 40.584, "lon": -73.760, "difficulty": "Intermediate"},
    
    # Long Beach area
    {"name": "Long Beach Jetty", "region": "Long Island", "lat": 40.583, "lon": -73.640, "difficulty": "Intermediate"},
    {"name": "Lido Beach", "region": "Long Island", "lat": 40.583, "lon": -73.618, "difficulty": "Beginner"},
    {"name": "Atlantic Beach", "region": "Long Island", "lat": 40.585, "lon": -73.730, "difficulty": "Beginner"},
    
    # Jones Beach area
    {"name": "Gilgo Beach", "region": "Long Island", "lat": 40.620, "lon": -73.400, "difficulty": "Intermediate"},
    {"name": "Robert Moses State Park", "region": "Long Island", "lat": 40.618, "lon": -73.278, "difficulty": "Intermediate"},
    
    # Fire Island
    {"name": "Fire Island Pines", "region": "Long Island", "lat": 40.658, "lon": -73.068, "difficulty": "Intermediate"},
    
    # Hamptons
    {"name": "Ponquogue Beach", "region": "Hamptons", "lat": 40.838, "lon": -72.508, "difficulty": "Intermediate"},
    {"name": "Flying Point", "region": "Hamptons", "lat": 40.868, "lon": -72.428, "difficulty": "Intermediate"},
    {"name": "Mecox Beach", "region": "Hamptons", "lat": 40.898, "lon": -72.358, "difficulty": "Intermediate"},
    {"name": "Main Beach East Hampton", "region": "Hamptons", "lat": 40.938, "lon": -72.188, "difficulty": "Intermediate"},
    {"name": "Georgica Beach", "region": "Hamptons", "lat": 40.928, "lon": -72.228, "difficulty": "Advanced"},
    
    # Montauk (additional)
    {"name": "Hither Hills", "region": "Montauk", "lat": 41.010, "lon": -72.010, "difficulty": "Intermediate"},
    {"name": "Napeague", "region": "Montauk", "lat": 41.000, "lon": -72.060, "difficulty": "Intermediate"},
]

# EL SALVADOR SPOTS (additional, offshore coordinates)
EL_SALVADOR_SPOTS = [
    {"name": "El Tunco", "region": "La Libertad", "lat": 13.498, "lon": -89.378, "difficulty": "Intermediate"},
    {"name": "Conchalio", "region": "La Libertad", "lat": 13.502, "lon": -89.400, "difficulty": "Beginner"},
    {"name": "Mizata", "region": "Sonsonate", "lat": 13.545, "lon": -89.632, "difficulty": "Advanced"},
    {"name": "La Perla", "region": "La Libertad", "lat": 13.505, "lon": -89.412, "difficulty": "Advanced"},
    {"name": "Playa El Cuco", "region": "San Miguel", "lat": 13.178, "lon": -88.248, "difficulty": "Intermediate"},
    {"name": "El Espino", "region": "Usulutan", "lat": 13.155, "lon": -88.528, "difficulty": "Beginner"},
]

# COSTA RICA SPOTS (additional, offshore coordinates)
COSTA_RICA_SPOTS = [
    # Caribbean side
    {"name": "Playa Bonita", "region": "Limon", "lat": 10.002, "lon": -83.018, "difficulty": "Intermediate"},
    {"name": "Cahuita", "region": "Limon", "lat": 9.738, "lon": -82.838, "difficulty": "Beginner"},
    
    # Pacific side - Guanacaste
    {"name": "Playa Naranjo", "region": "Guanacaste", "lat": 10.778, "lon": -85.662, "difficulty": "Advanced"},
    {"name": "Playa Brasilito", "region": "Guanacaste", "lat": 10.405, "lon": -85.808, "difficulty": "Beginner"},
    {"name": "Playa Flamingo", "region": "Guanacaste", "lat": 10.438, "lon": -85.798, "difficulty": "Intermediate"},
    {"name": "Playa Conchal", "region": "Guanacaste", "lat": 10.415, "lon": -85.788, "difficulty": "Beginner"},
    {"name": "Playa Tamarindo Point", "region": "Tamarindo", "lat": 10.292, "lon": -85.858, "difficulty": "Intermediate"},
    
    # Nicoya Peninsula
    {"name": "Playa Guiones", "region": "Nosara", "lat": 9.932, "lon": -85.678, "difficulty": "Intermediate"},
    {"name": "Playa Ostional", "region": "Nosara", "lat": 9.998, "lon": -85.708, "difficulty": "Advanced"},
    {"name": "San Juanillo", "region": "Guanacaste", "lat": 10.035, "lon": -85.728, "difficulty": "Intermediate"},
    {"name": "Playa Coyote", "region": "Nicoya", "lat": 9.748, "lon": -85.298, "difficulty": "Intermediate"},
    {"name": "Playa Manzanillo", "region": "Santa Teresa", "lat": 9.618, "lon": -85.158, "difficulty": "Advanced"},
    {"name": "Playa Hermosa Santa Teresa", "region": "Santa Teresa", "lat": 9.628, "lon": -85.168, "difficulty": "Advanced"},
    
    # Central Pacific
    {"name": "Playa Esterillos", "region": "Puntarenas", "lat": 9.505, "lon": -84.478, "difficulty": "Intermediate"},
    {"name": "Boca Barranca", "region": "Puntarenas", "lat": 9.948, "lon": -84.758, "difficulty": "Advanced"},
    {"name": "Tivives", "region": "Puntarenas", "lat": 9.858, "lon": -84.708, "difficulty": "Intermediate"},
    
    # South Pacific
    {"name": "Playa Piñuela", "region": "Dominical", "lat": 9.218, "lon": -83.838, "difficulty": "Intermediate"},
    {"name": "Playa Uvita", "region": "Uvita", "lat": 9.158, "lon": -83.748, "difficulty": "Beginner"},
    {"name": "Playa Zancudo", "region": "Golfito", "lat": 8.528, "lon": -83.148, "difficulty": "Intermediate"},
]

async def fix_coordinates():
    """Fix wrong coordinates for existing spots"""
    async with AsyncSession(engine) as db:
        fixed_count = 0
        for fix in COORDINATE_FIXES:
            if "id" in fix:
                # Fix by ID
                await db.execute(text("""
                    UPDATE surf_spots 
                    SET latitude = :lat, longitude = :lon, region = :region, country = :country
                    WHERE id = :id
                """), {"id": fix["id"], "lat": fix["new_lat"], "lon": fix["new_lon"], 
                       "region": fix.get("region", ""), "country": fix.get("country", "")})
                print(f"Fixed by ID: {fix['name']} -> ({fix['new_lat']}, {fix['new_lon']})")
            else:
                # Fix by name and country
                await db.execute(text("""
                    UPDATE surf_spots 
                    SET latitude = :lat, longitude = :lon
                    WHERE name = :name AND country = :country
                """), {"lat": fix["new_lat"], "lon": fix["new_lon"], 
                       "name": fix["name"], "country": fix["country"]})
                print(f"Fixed by name: {fix['name']} ({fix['country']}) -> ({fix['new_lat']}, {fix['new_lon']})")
            fixed_count += 1
        
        await db.commit()
        print(f"\nFixed {fixed_count} coordinate issues")

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
                INSERT INTO surf_spots (id, name, region, country, latitude, longitude, difficulty, is_verified_peak)
                VALUES (:id, :name, :region, :country, :lat, :lon, :difficulty, true)
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
    print("SPOT SYNC - April 2026")
    print("=" * 60)
    
    # Step 1: Fix wrong coordinates
    print("\n1. Fixing wrong coordinates...")
    await fix_coordinates()
    
    # Step 2: Add New York spots
    print("\n2. Adding New York spots...")
    ny_added, ny_skipped = await add_spots(NEW_YORK_SPOTS, "USA")
    print(f"   NY: Added {ny_added}, Skipped {ny_skipped}")
    
    # Step 3: Add El Salvador spots
    print("\n3. Adding El Salvador spots...")
    es_added, es_skipped = await add_spots(EL_SALVADOR_SPOTS, "El Salvador")
    print(f"   ES: Added {es_added}, Skipped {es_skipped}")
    
    # Step 4: Add Costa Rica spots
    print("\n4. Adding Costa Rica spots...")
    cr_added, cr_skipped = await add_spots(COSTA_RICA_SPOTS, "Costa Rica")
    print(f"   CR: Added {cr_added}, Skipped {cr_skipped}")
    
    # Summary
    total_added = ny_added + es_added + cr_added
    print("\n" + "=" * 60)
    print(f"TOTAL SPOTS ADDED: {total_added}")
    print("=" * 60)
    
    # Verify final counts
    async with AsyncSession(engine) as db:
        result = await db.execute(text("SELECT COUNT(*) FROM surf_spots"))
        total = result.scalar()
        print(f"\nTotal spots in database: {total}")

if __name__ == "__main__":
    asyncio.run(main())
