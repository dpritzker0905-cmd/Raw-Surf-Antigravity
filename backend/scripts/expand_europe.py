"""
Europe (Portugal, France, Spain) Surf Spot Expansion (Delta Sync)
Adds new spots only - skips existing spots
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Portugal - Europe's best waves
PORTUGAL_SPOTS = [
    # Peniche Region
    {"name": "Supertubos", "latitude": 39.3500, "longitude": -9.3667, "region": "Peniche", "country": "Portugal", "difficulty": "expert", "wave_type": "beach", "description": "Europe's heaviest beach break - Pipeline of Europe"},
    {"name": "Lagide", "latitude": 39.3600, "longitude": -9.3800, "region": "Peniche", "country": "Portugal", "difficulty": "advanced", "wave_type": "beach", "description": "Powerful peaks north of Supertubos"},
    {"name": "Molho Leste", "latitude": 39.3467, "longitude": -9.3600, "region": "Peniche", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Protected beach break in the harbor"},
    {"name": "Baleal", "latitude": 39.3717, "longitude": -9.3417, "region": "Peniche", "country": "Portugal", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach near the island"},
    {"name": "Cantinho da Baía", "latitude": 39.3550, "longitude": -9.3500, "region": "Peniche", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Sheltered spot for all conditions"},
    
    # Ericeira Region (World Surfing Reserve)
    {"name": "Ribeira d'Ilhas", "latitude": 38.9833, "longitude": -9.4167, "region": "Ericeira", "country": "Portugal", "difficulty": "intermediate", "wave_type": "reef", "description": "WSL CT venue - long right-hander"},
    {"name": "Coxos", "latitude": 38.9917, "longitude": -9.4250, "region": "Ericeira", "country": "Portugal", "difficulty": "expert", "wave_type": "reef", "description": "World-class right - Portugal's best wave"},
    {"name": "Cave", "latitude": 38.9700, "longitude": -9.4150, "region": "Ericeira", "country": "Portugal", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow left in the cave"},
    {"name": "São Lourenço", "latitude": 38.9583, "longitude": -9.4100, "region": "Ericeira", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break at the World Surfing Reserve"},
    {"name": "Foz do Lizandro", "latitude": 38.9500, "longitude": -9.4050, "region": "Ericeira", "country": "Portugal", "difficulty": "beginner", "wave_type": "beach", "description": "River mouth beach break"},
    
    # Nazaré
    {"name": "Nazaré - Praia do Norte", "latitude": 39.6050, "longitude": -9.0850, "region": "Nazaré", "country": "Portugal", "difficulty": "expert", "wave_type": "beach", "description": "World's biggest waves - 100ft+ faces"},
    {"name": "Nazaré Beach", "latitude": 39.5950, "longitude": -9.0750, "region": "Nazaré", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Town beach - smaller waves"},
    
    # Algarve (South)
    {"name": "Arrifana", "latitude": 37.2917, "longitude": -8.8667, "region": "Algarve", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Scenic cliff-lined beach break"},
    {"name": "Praia do Amado", "latitude": 37.1667, "longitude": -8.9000, "region": "Algarve", "country": "Portugal", "difficulty": "beginner", "wave_type": "beach", "description": "Popular surf school beach"},
    {"name": "Sagres - Tonel", "latitude": 37.0000, "longitude": -8.9500, "region": "Algarve", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break at the end of Europe"},
    
    # North Portugal
    {"name": "Espinho", "latitude": 41.0083, "longitude": -8.6417, "region": "Porto", "country": "Portugal", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break near Porto"},
    {"name": "Matosinhos", "latitude": 41.1833, "longitude": -8.6917, "region": "Porto", "country": "Portugal", "difficulty": "beginner", "wave_type": "beach", "description": "Porto's city beach"},
]


# France - From Hossegor to Brittany
FRANCE_SPOTS = [
    # Hossegor / Les Landes (SW France)
    {"name": "La Gravière", "latitude": 43.6667, "longitude": -1.4333, "region": "Hossegor", "country": "France", "difficulty": "expert", "wave_type": "beach", "description": "France's heaviest wave - WSL CT venue"},
    {"name": "La Nord", "latitude": 43.6750, "longitude": -1.4400, "region": "Hossegor", "country": "France", "difficulty": "advanced", "wave_type": "beach", "description": "Northern Hossegor peaks"},
    {"name": "Les Estagnots", "latitude": 43.7000, "longitude": -1.4500, "region": "Seignosse", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break"},
    {"name": "La Piste", "latitude": 43.5833, "longitude": -1.4167, "region": "Capbreton", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "Protected by the jetty"},
    {"name": "VVF", "latitude": 43.7167, "longitude": -1.4583, "region": "Seignosse", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break near the holiday village"},
    {"name": "Le Penon", "latitude": 43.7333, "longitude": -1.4667, "region": "Seignosse", "country": "France", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach"},
    
    # Biarritz / Basque Coast
    {"name": "Grande Plage Biarritz", "latitude": 43.4833, "longitude": -1.5667, "region": "Biarritz", "country": "France", "difficulty": "beginner", "wave_type": "beach", "description": "Historic beach - birthplace of European surfing"},
    {"name": "Côte des Basques", "latitude": 43.4750, "longitude": -1.5583, "region": "Biarritz", "country": "France", "difficulty": "beginner", "wave_type": "beach", "description": "Iconic longboard wave"},
    {"name": "Miramar", "latitude": 43.4800, "longitude": -1.5633, "region": "Biarritz", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "Central Biarritz beach"},
    {"name": "Anglet - Les Cavaliers", "latitude": 43.5167, "longitude": -1.5333, "region": "Anglet", "country": "France", "difficulty": "advanced", "wave_type": "beach", "description": "Powerful beach break"},
    {"name": "Lafitenia", "latitude": 43.4167, "longitude": -1.6167, "region": "Saint-Jean-de-Luz", "country": "France", "difficulty": "advanced", "wave_type": "point", "description": "Classic right point break"},
    {"name": "Guéthary", "latitude": 43.4250, "longitude": -1.6083, "region": "Guéthary", "country": "France", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break"},
    {"name": "Parlementia", "latitude": 43.4200, "longitude": -1.6050, "region": "Guéthary", "country": "France", "difficulty": "expert", "wave_type": "reef", "description": "Big wave spot - holds up to 25ft"},
    
    # Brittany (NW France)
    {"name": "La Torche", "latitude": 47.8333, "longitude": -4.3500, "region": "Brittany", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "France's best beach break outside SW"},
    {"name": "Pors Carn", "latitude": 47.8167, "longitude": -4.3333, "region": "Brittany", "country": "France", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent peaks near La Torche"},
]


# Spain - Basque Country to Canary Islands
SPAIN_SPOTS = [
    # Basque Country
    {"name": "Mundaka", "latitude": 43.4083, "longitude": -2.6917, "region": "Basque Country", "country": "Spain", "difficulty": "expert", "wave_type": "river", "description": "World's best left river mouth - when it works"},
    {"name": "Meñakoz", "latitude": 43.4167, "longitude": -2.9333, "region": "Basque Country", "country": "Spain", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef break near Sopelana"},
    {"name": "Sopelana", "latitude": 43.3833, "longitude": -2.9833, "region": "Basque Country", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break near Bilbao"},
    {"name": "Zarautz", "latitude": 43.2833, "longitude": -2.1667, "region": "Basque Country", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "Longest beach break in Spain"},
    {"name": "Zurriola (San Sebastián)", "latitude": 43.3250, "longitude": -1.9750, "region": "Basque Country", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "City beach in San Sebastián"},
    
    # Cantabria
    {"name": "Liencres", "latitude": 43.4500, "longitude": -3.9500, "region": "Cantabria", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "Multiple peaks along the dunes"},
    {"name": "Los Locos", "latitude": 43.4667, "longitude": -3.7833, "region": "Cantabria", "country": "Spain", "difficulty": "advanced", "wave_type": "beach", "description": "Powerful beach break - WSL QS venue"},
    {"name": "Somo", "latitude": 43.4417, "longitude": -3.7500, "region": "Cantabria", "country": "Spain", "difficulty": "beginner", "wave_type": "beach", "description": "Long sandy beach"},
    
    # Galicia
    {"name": "Pantin", "latitude": 43.6333, "longitude": -8.1167, "region": "Galicia", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "WSL QS venue - consistent waves"},
    {"name": "Razo", "latitude": 43.3000, "longitude": -8.6333, "region": "Galicia", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break near Carballo"},
    {"name": "Praia de Leis", "latitude": 43.2000, "longitude": -9.1167, "region": "Galicia", "country": "Spain", "difficulty": "intermediate", "wave_type": "beach", "description": "End of the Camino - Costa da Morte"},
    
    # Canary Islands
    {"name": "El Confital", "latitude": 28.1667, "longitude": -15.4500, "region": "Gran Canaria", "country": "Spain", "difficulty": "advanced", "wave_type": "reef", "description": "World-class right in Las Palmas"},
    {"name": "El Frontón", "latitude": 28.0667, "longitude": -15.6833, "region": "Gran Canaria", "country": "Spain", "difficulty": "expert", "wave_type": "slab", "description": "Heavy slab - bodyboard mecca"},
    {"name": "Las Américas", "latitude": 28.0667, "longitude": -16.7333, "region": "Tenerife", "country": "Spain", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break in the tourist zone"},
    {"name": "El Hierro", "latitude": 27.8000, "longitude": -17.9167, "region": "El Hierro", "country": "Spain", "difficulty": "advanced", "wave_type": "reef", "description": "Remote volcanic reef breaks"},
    {"name": "Famara", "latitude": 29.1167, "longitude": -13.5500, "region": "Lanzarote", "country": "Spain", "difficulty": "beginner", "wave_type": "beach", "description": "Long beach break below the cliffs"},
    {"name": "La Santa", "latitude": 29.0500, "longitude": -13.6333, "region": "Lanzarote", "country": "Spain", "difficulty": "advanced", "wave_type": "reef", "description": "Right reef at the sports complex"},
    {"name": "El Cotillo", "latitude": 28.6833, "longitude": -14.0167, "region": "Fuerteventura", "country": "Spain", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple reef setups"},
    {"name": "Punta Blanca", "latitude": 28.4500, "longitude": -13.8667, "region": "Fuerteventura", "country": "Spain", "difficulty": "advanced", "wave_type": "reef", "description": "Powerful reef on south swells"},
]


async def add_spots_delta(spots: list, session: AsyncSession, country: str) -> tuple:
    """Delta sync: Add only NEW spots, skip existing ones"""
    added = 0
    skipped = 0
    
    for spot_data in spots:
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
    print("EUROPE EXPANSION (Portugal, France, Spain) - Delta Sync")
    print("=" * 60)
    
    async with AsyncSession(engine) as session:
        result = await session.execute(select(SurfSpot))
        initial_count = len(result.scalars().all())
        print(f"\nInitial spot count: {initial_count}")
        
        total_added = 0
        total_skipped = 0
        
        # Portugal
        print("\n[PORTUGAL] - Delta Sync")
        added, skipped = await add_spots_delta(PORTUGAL_SPOTS, session, "Portugal")
        total_added += added
        total_skipped += skipped
        print(f"  Portugal: {added} added, {skipped} skipped")
        
        # France
        print("\n[FRANCE] - Delta Sync")
        added, skipped = await add_spots_delta(FRANCE_SPOTS, session, "France")
        total_added += added
        total_skipped += skipped
        print(f"  France: {added} added, {skipped} skipped")
        
        # Spain
        print("\n[SPAIN] - Delta Sync")
        added, skipped = await add_spots_delta(SPAIN_SPOTS, session, "Spain")
        total_added += added
        total_skipped += skipped
        print(f"  Spain: {added} added, {skipped} skipped")
        
        await session.commit()
        
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
