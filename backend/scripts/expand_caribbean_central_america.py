"""
Caribbean & Central America Deep Dive Surf Spot Expansion (Delta Sync)
Comprehensive coverage of all surf destinations in the region
"""

import asyncio
import sys
sys.path.append('/app/backend')

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select
from database import engine
from models import SurfSpot


# Caribbean Islands - Island by island coverage
CARIBBEAN_SPOTS = [
    # Puerto Rico (expanded)
    {"name": "Rincon - Domes", "latitude": 18.3667, "longitude": -67.2500, "region": "Rincon", "country": "Puerto Rico", "difficulty": "advanced", "wave_type": "reef", "description": "World-class right next to nuclear dome"},
    {"name": "Rincon - Maria's", "latitude": 18.3583, "longitude": -67.2583, "region": "Rincon", "country": "Puerto Rico", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun right reef with multiple sections"},
    {"name": "Rincon - Tres Palmas", "latitude": 18.3500, "longitude": -67.2667, "region": "Rincon", "country": "Puerto Rico", "difficulty": "expert", "wave_type": "reef", "description": "Big wave spot - holds 25ft+"},
    {"name": "Rincon - Sandy Beach", "latitude": 18.3417, "longitude": -67.2750, "region": "Rincon", "country": "Puerto Rico", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach break"},
    {"name": "Isabela - Jobos", "latitude": 18.5167, "longitude": -67.0833, "region": "Isabela", "country": "Puerto Rico", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break with consistent waves"},
    {"name": "Isabela - Middles", "latitude": 18.5083, "longitude": -67.0917, "region": "Isabela", "country": "Puerto Rico", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow reef break"},
    {"name": "Aguadilla - Wilderness", "latitude": 18.4833, "longitude": -67.1500, "region": "Aguadilla", "country": "Puerto Rico", "difficulty": "advanced", "wave_type": "reef", "description": "Remote reef break"},
    {"name": "Aguadilla - Gas Chambers", "latitude": 18.4917, "longitude": -67.1417, "region": "Aguadilla", "country": "Puerto Rico", "difficulty": "expert", "wave_type": "reef", "description": "Heavy barrel - experts only"},
    
    # Dominican Republic
    {"name": "Cabarete", "latitude": 19.7500, "longitude": -70.4167, "region": "Puerto Plata", "country": "Dominican Republic", "difficulty": "intermediate", "wave_type": "reef", "description": "Kite and surf capital of the Caribbean"},
    {"name": "Playa Encuentro", "latitude": 19.7667, "longitude": -70.4333, "region": "Puerto Plata", "country": "Dominican Republic", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple reef breaks"},
    {"name": "Playa Grande", "latitude": 19.6333, "longitude": -70.0000, "region": "Rio San Juan", "country": "Dominican Republic", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break on the north coast"},
    {"name": "El Pipe", "latitude": 19.7583, "longitude": -70.4250, "region": "Puerto Plata", "country": "Dominican Republic", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow left barrel"},
    
    # Barbados
    {"name": "Soup Bowl", "latitude": 13.2167, "longitude": -59.4833, "region": "Bathsheba", "country": "Barbados", "difficulty": "advanced", "wave_type": "reef", "description": "Caribbean's most famous wave - powerful rights"},
    {"name": "South Point", "latitude": 13.0500, "longitude": -59.4833, "region": "South Coast", "country": "Barbados", "difficulty": "advanced", "wave_type": "point", "description": "Left point break on south swells"},
    {"name": "Freights", "latitude": 13.0667, "longitude": -59.5333, "region": "South Coast", "country": "Barbados", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun reef break"},
    {"name": "Tropicana", "latitude": 13.2083, "longitude": -59.4917, "region": "Bathsheba", "country": "Barbados", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break south of Soup Bowl"},
    
    # Jamaica
    {"name": "Boston Bay", "latitude": 18.1500, "longitude": -76.3333, "region": "Portland", "country": "Jamaica", "difficulty": "intermediate", "wave_type": "beach", "description": "Jamaica's most consistent surf spot"},
    {"name": "Bull Bay", "latitude": 17.9333, "longitude": -76.6833, "region": "St. Andrew", "country": "Jamaica", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near Kingston"},
    {"name": "Long Bay", "latitude": 18.1833, "longitude": -76.2667, "region": "Portland", "country": "Jamaica", "difficulty": "beginner", "wave_type": "beach", "description": "Mellow beach break"},
    
    # Bahamas
    {"name": "Surfer's Beach (Eleuthera)", "latitude": 25.1500, "longitude": -76.1500, "region": "Eleuthera", "country": "Bahamas", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break on the Atlantic side"},
    {"name": "Gaulding Cay", "latitude": 25.1333, "longitude": -76.1667, "region": "Eleuthera", "country": "Bahamas", "difficulty": "intermediate", "wave_type": "reef", "description": "Fun reef in crystal water"},
    
    # U.S. Virgin Islands
    {"name": "Hull Bay", "latitude": 18.3667, "longitude": -64.9833, "region": "St. Thomas", "country": "U.S. Virgin Islands", "difficulty": "intermediate", "wave_type": "reef", "description": "North shore reef break"},
    {"name": "Cane Bay", "latitude": 17.7667, "longitude": -64.8333, "region": "St. Croix", "country": "U.S. Virgin Islands", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break with wall diving nearby"},
    
    # Guadeloupe
    {"name": "Le Moule", "latitude": 16.3333, "longitude": -61.3500, "region": "Grande-Terre", "country": "Guadeloupe", "difficulty": "intermediate", "wave_type": "reef", "description": "Main surf spot in Guadeloupe"},
    {"name": "Sainte-Anne", "latitude": 16.2167, "longitude": -61.3500, "region": "Grande-Terre", "country": "Guadeloupe", "difficulty": "beginner", "wave_type": "beach", "description": "Protected beach for beginners"},
    
    # Martinique
    {"name": "Tartane", "latitude": 14.7667, "longitude": -60.9167, "region": "Presqu'île de la Caravelle", "country": "Martinique", "difficulty": "intermediate", "wave_type": "reef", "description": "Best surf in Martinique"},
    {"name": "Le Diamant", "latitude": 14.4667, "longitude": -61.0333, "region": "South", "country": "Martinique", "difficulty": "advanced", "wave_type": "reef", "description": "Reef break near Diamond Rock"},
    
    # Trinidad & Tobago
    {"name": "Mount Irvine", "latitude": 11.2000, "longitude": -60.8000, "region": "Tobago", "country": "Trinidad & Tobago", "difficulty": "intermediate", "wave_type": "reef", "description": "Tobago's main surf spot"},
    {"name": "Grafton Beach", "latitude": 11.1833, "longitude": -60.8167, "region": "Tobago", "country": "Trinidad & Tobago", "difficulty": "beginner", "wave_type": "beach", "description": "Beginner-friendly beach"},
    
    # Aruba
    {"name": "Boca Grandi", "latitude": 12.4500, "longitude": -69.9333, "region": "East Coast", "country": "Aruba", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break on windward side"},
    
    # Curaçao
    {"name": "Playa Kanoa", "latitude": 12.0833, "longitude": -68.8667, "region": "East Coast", "country": "Curaçao", "difficulty": "intermediate", "wave_type": "beach", "description": "Windswept beach break"},
]


# Central America Deep Dive
CENTRAL_AMERICA_SPOTS = [
    # Costa Rica (expanded)
    {"name": "Playa Hermosa (Jaco)", "latitude": 9.5500, "longitude": -84.5833, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "advanced", "wave_type": "beach", "description": "Heavy beach break - competition venue"},
    {"name": "Jaco Beach", "latitude": 9.6167, "longitude": -84.6167, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "beach", "description": "Central Pacific party town waves"},
    {"name": "Playa Dominical", "latitude": 9.2500, "longitude": -83.8500, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "beach", "description": "Powerful beach break"},
    {"name": "Pavones", "latitude": 8.3833, "longitude": -83.1500, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "point", "description": "Second longest left in the world"},
    {"name": "Witch's Rock", "latitude": 10.9000, "longitude": -85.8333, "region": "Guanacaste", "country": "Costa Rica", "difficulty": "advanced", "wave_type": "beach", "description": "Remote break in Santa Rosa NP - Endless Summer II"},
    {"name": "Ollie's Point", "latitude": 10.9167, "longitude": -85.8500, "region": "Guanacaste", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "point", "description": "Perfect right point - boat access only"},
    {"name": "Tamarindo", "latitude": 10.2833, "longitude": -85.8333, "region": "Guanacaste", "country": "Costa Rica", "difficulty": "beginner", "wave_type": "beach", "description": "Surf town with beginner waves"},
    {"name": "Playa Negra (Guanacaste)", "latitude": 10.1167, "longitude": -85.8333, "region": "Guanacaste", "country": "Costa Rica", "difficulty": "advanced", "wave_type": "reef", "description": "Hollow right over rock reef"},
    {"name": "Nosara - Playa Guiones", "latitude": 9.9500, "longitude": -85.6667, "region": "Guanacaste", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break - yoga town"},
    {"name": "Santa Teresa", "latitude": 9.6333, "longitude": -85.1667, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "beach", "description": "Trendy surf town on Nicoya Peninsula"},
    {"name": "Mal Pais", "latitude": 9.6167, "longitude": -85.1500, "region": "Puntarenas", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef breaks south of Santa Teresa"},
    {"name": "Salsa Brava", "latitude": 9.6500, "longitude": -82.7500, "region": "Limón", "country": "Costa Rica", "difficulty": "expert", "wave_type": "reef", "description": "Caribbean's heaviest wave - over shallow reef"},
    {"name": "Playa Cocles", "latitude": 9.6333, "longitude": -82.7667, "region": "Limón", "country": "Costa Rica", "difficulty": "intermediate", "wave_type": "beach", "description": "Caribbean beach break near Puerto Viejo"},
    
    # Nicaragua
    {"name": "Popoyo", "latitude": 11.5000, "longitude": -86.0667, "region": "Rivas", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "reef", "description": "Multiple breaks - Nicaragua's surf hub"},
    {"name": "Colorado", "latitude": 11.4833, "longitude": -86.0833, "region": "Rivas", "country": "Nicaragua", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy outer reef"},
    {"name": "Santana", "latitude": 11.5167, "longitude": -86.0500, "region": "Rivas", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "beach", "description": "Beach break near Popoyo"},
    {"name": "Playa Maderas", "latitude": 11.4167, "longitude": -85.8667, "region": "San Juan del Sur", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "beach", "description": "Popular beach break"},
    {"name": "Playa Remanso", "latitude": 11.3833, "longitude": -85.8833, "region": "San Juan del Sur", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach south of town"},
    {"name": "Playa Hermosa (Nicaragua)", "latitude": 11.3667, "longitude": -85.9000, "region": "San Juan del Sur", "country": "Nicaragua", "difficulty": "advanced", "wave_type": "beach", "description": "Heavy beach break"},
    {"name": "Manzanillo", "latitude": 11.5333, "longitude": -86.0333, "region": "Rivas", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "point", "description": "Right point break"},
    {"name": "Astillero", "latitude": 11.7833, "longitude": -86.5000, "region": "Carazo", "country": "Nicaragua", "difficulty": "intermediate", "wave_type": "beach", "description": "Northern Nicaragua break"},
    
    # Panama
    {"name": "Santa Catalina", "latitude": 7.6333, "longitude": -81.2500, "region": "Veraguas", "country": "Panama", "difficulty": "intermediate", "wave_type": "point", "description": "Panama's best wave - long right point"},
    {"name": "Playa Venao", "latitude": 7.4333, "longitude": -80.1833, "region": "Los Santos", "country": "Panama", "difficulty": "intermediate", "wave_type": "beach", "description": "Consistent beach break"},
    {"name": "Playa Cambutal", "latitude": 7.3167, "longitude": -80.4000, "region": "Los Santos", "country": "Panama", "difficulty": "intermediate", "wave_type": "beach", "description": "Remote beach break"},
    {"name": "Morro Negrito", "latitude": 7.3833, "longitude": -81.7500, "region": "Chiriquí", "country": "Panama", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy reef in the gulf"},
    {"name": "Bocas del Toro - Paunch", "latitude": 9.3500, "longitude": -82.2333, "region": "Bocas del Toro", "country": "Panama", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break in the archipelago"},
    {"name": "Bocas del Toro - Dumpers", "latitude": 9.3667, "longitude": -82.2167, "region": "Bocas del Toro", "country": "Panama", "difficulty": "advanced", "wave_type": "reef", "description": "Heavy left barrel"},
    {"name": "Silverbacks", "latitude": 9.3833, "longitude": -82.2000, "region": "Bocas del Toro", "country": "Panama", "difficulty": "expert", "wave_type": "reef", "description": "Big wave spot in Bocas"},
    
    # El Salvador (expanded)
    {"name": "Punta Roca", "latitude": 13.4833, "longitude": -89.3833, "region": "La Libertad", "country": "El Salvador", "difficulty": "advanced", "wave_type": "point", "description": "World-class right point - El Salvador's best"},
    {"name": "La Paz", "latitude": 13.4917, "longitude": -89.3750, "region": "La Libertad", "country": "El Salvador", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near the pier"},
    {"name": "Sunzal", "latitude": 13.5000, "longitude": -89.4000, "region": "La Libertad", "country": "El Salvador", "difficulty": "intermediate", "wave_type": "point", "description": "Long right point - beginner friendly"},
    {"name": "El Tunco", "latitude": 13.4917, "longitude": -89.3833, "region": "La Libertad", "country": "El Salvador", "difficulty": "intermediate", "wave_type": "beach", "description": "Party town beach break"},
    {"name": "K59", "latitude": 13.2667, "longitude": -88.7833, "region": "Usulután", "country": "El Salvador", "difficulty": "advanced", "wave_type": "point", "description": "Remote point break"},
    {"name": "Las Flores", "latitude": 13.2333, "longitude": -88.0833, "region": "San Miguel", "country": "El Salvador", "difficulty": "intermediate", "wave_type": "point", "description": "East coast point break"},
    {"name": "Punta Mango", "latitude": 13.2167, "longitude": -88.0667, "region": "San Miguel", "country": "El Salvador", "difficulty": "advanced", "wave_type": "point", "description": "Remote right point - boat access"},
    
    # Guatemala
    {"name": "Sipacate", "latitude": 13.9333, "longitude": -91.1500, "region": "Escuintla", "country": "Guatemala", "difficulty": "intermediate", "wave_type": "beach", "description": "Guatemala's main surf beach"},
    {"name": "El Paredón", "latitude": 13.9167, "longitude": -91.2000, "region": "Escuintla", "country": "Guatemala", "difficulty": "intermediate", "wave_type": "beach", "description": "Black sand beach break"},
    {"name": "Iztapa", "latitude": 13.9333, "longitude": -90.7167, "region": "Escuintla", "country": "Guatemala", "difficulty": "beginner", "wave_type": "beach", "description": "Mellow beach break"},
    
    # Honduras
    {"name": "Tela", "latitude": 15.7833, "longitude": -87.4667, "region": "Atlántida", "country": "Honduras", "difficulty": "intermediate", "wave_type": "beach", "description": "Caribbean coast beach break"},
    {"name": "Trujillo", "latitude": 15.9167, "longitude": -85.9500, "region": "Colón", "country": "Honduras", "difficulty": "intermediate", "wave_type": "beach", "description": "Remote Caribbean break"},
    
    # Belize
    {"name": "Long Caye", "latitude": 17.2000, "longitude": -87.5333, "region": "Lighthouse Reef", "country": "Belize", "difficulty": "intermediate", "wave_type": "reef", "description": "Reef break near the Blue Hole"},
]


async def add_spots_delta(spots: list, session: AsyncSession, region: str) -> tuple:
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
        print(f"  + Added: {spot_data['name']} ({spot_data['region']}, {spot_data['country']})")
    
    return added, skipped


async def main():
    print("=" * 60)
    print("CARIBBEAN & CENTRAL AMERICA DEEP DIVE - Delta Sync")
    print("=" * 60)
    
    async with AsyncSession(engine) as session:
        result = await session.execute(select(SurfSpot))
        initial_count = len(result.scalars().all())
        print(f"\nInitial spot count: {initial_count}")
        
        total_added = 0
        total_skipped = 0
        
        # Caribbean
        print("\n[CARIBBEAN ISLANDS] - Delta Sync")
        added, skipped = await add_spots_delta(CARIBBEAN_SPOTS, session, "Caribbean")
        total_added += added
        total_skipped += skipped
        print(f"  Caribbean: {added} added, {skipped} skipped")
        
        # Central America
        print("\n[CENTRAL AMERICA] - Delta Sync")
        added, skipped = await add_spots_delta(CENTRAL_AMERICA_SPOTS, session, "Central America")
        total_added += added
        total_skipped += skipped
        print(f"  Central America: {added} added, {skipped} skipped")
        
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
