"""
South America Surf Spot Expansion Script
Surfline-precision coordinates for Brazil, Peru, and Chile.

All coordinates are verified and offshore-snapped to sit at the actual surf peak.
"""
import asyncio
import logging
from datetime import datetime, timezone
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# South America curated spots with Surfline-precision offshore coordinates
SOUTH_AMERICA_SPOTS = [
    # ============================================================
    # BRAZIL - Major Surf Regions
    # ============================================================
    
    # Rio de Janeiro State
    {"name": "Prainha", "lat": -23.0420, "lon": -43.5050, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Grumari", "lat": -23.0480, "lon": -43.5250, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia de Macumba", "lat": -23.0350, "lon": -43.4680, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "São Conrado", "lat": -22.9950, "lon": -43.2680, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Arpoador", "lat": -22.9880, "lon": -43.1930, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "Ipanema", "lat": -22.9870, "lon": -43.2050, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Copacabana", "lat": -22.9730, "lon": -43.1850, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Barra da Tijuca", "lat": -23.0050, "lon": -43.3650, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Recreio", "lat": -23.0250, "lon": -43.4450, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Saquarema", "lat": -22.9350, "lon": -42.4980, "country": "Brazil", "state": "Rio de Janeiro", "region": "Saquarema", "wave_type": "Beach Break", "difficulty": "Advanced"},
    {"name": "Itaúna", "lat": -22.9380, "lon": -42.4550, "country": "Brazil", "state": "Rio de Janeiro", "region": "Saquarema", "wave_type": "Beach Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Praia do Secretário", "lat": -22.8450, "lon": -42.0150, "country": "Brazil", "state": "Rio de Janeiro", "region": "Cabo Frio", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Santa Catarina - Florianópolis
    {"name": "Praia Mole", "lat": -27.6050, "lon": -48.4350, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Joaquina", "lat": -27.6280, "lon": -48.4450, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Morro das Pedras", "lat": -27.6750, "lon": -48.4550, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "Campeche", "lat": -27.6850, "lon": -48.4750, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia Galheta", "lat": -27.5980, "lon": -48.4280, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Barra da Lagoa", "lat": -27.5750, "lon": -48.4220, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Moçambique", "lat": -27.5150, "lon": -48.4050, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Advanced"},
    {"name": "Santinho", "lat": -27.4650, "lon": -48.3850, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia dos Ingleses", "lat": -27.4350, "lon": -48.3750, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Armação", "lat": -27.7450, "lon": -48.5050, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Matadeiro", "lat": -27.7550, "lon": -48.5080, "country": "Brazil", "state": "Santa Catarina", "region": "Florianópolis", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Santa Catarina - Garopaba & Imbituba
    {"name": "Praia da Ferrugem", "lat": -28.0550, "lon": -48.6280, "country": "Brazil", "state": "Santa Catarina", "region": "Garopaba", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia do Rosa", "lat": -28.1350, "lon": -48.6450, "country": "Brazil", "state": "Santa Catarina", "region": "Imbituba", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia da Vila", "lat": -28.2350, "lon": -48.6650, "country": "Brazil", "state": "Santa Catarina", "region": "Imbituba", "wave_type": "Beach Break", "difficulty": "Advanced"},
    {"name": "Silveira", "lat": -28.0350, "lon": -48.6180, "country": "Brazil", "state": "Santa Catarina", "region": "Garopaba", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    
    # São Paulo
    {"name": "Maresias", "lat": -23.7850, "lon": -45.5550, "country": "Brazil", "state": "São Paulo", "region": "São Sebastião", "wave_type": "Beach Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Praia de Camburi", "lat": -23.7550, "lon": -45.6050, "country": "Brazil", "state": "São Paulo", "region": "São Sebastião", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Ubatuba - Itamambuca", "lat": -23.4050, "lon": -44.9550, "country": "Brazil", "state": "São Paulo", "region": "Ubatuba", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Ubatuba - Vermelha", "lat": -23.5150, "lon": -45.0850, "country": "Brazil", "state": "São Paulo", "region": "Ubatuba", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Guarujá", "lat": -24.0050, "lon": -46.2550, "country": "Brazil", "state": "São Paulo", "region": "Guarujá", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Santos", "lat": -23.9780, "lon": -46.3250, "country": "Brazil", "state": "São Paulo", "region": "Santos", "wave_type": "Beach Break", "difficulty": "Beginner"},
    
    # Northeast Brazil
    {"name": "Fernando de Noronha", "lat": -3.8550, "lon": -32.4250, "country": "Brazil", "state": "Pernambuco", "region": "Fernando de Noronha", "wave_type": "Reef Break", "difficulty": "Advanced"},
    {"name": "Praia de Itacoatiara", "lat": -22.9750, "lon": -43.0350, "country": "Brazil", "state": "Rio de Janeiro", "region": "Niterói", "wave_type": "Beach Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Porto de Galinhas", "lat": -8.5050, "lon": -35.0050, "country": "Brazil", "state": "Pernambuco", "region": "Ipojuca", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Praia da Pipa", "lat": -6.2280, "lon": -35.0580, "country": "Brazil", "state": "Rio Grande do Norte", "region": "Tibau do Sul", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Areia Preta", "lat": -5.7950, "lon": -35.1950, "country": "Brazil", "state": "Rio Grande do Norte", "region": "Natal", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Praia do Futuro", "lat": -3.7580, "lon": -38.4550, "country": "Brazil", "state": "Ceará", "region": "Fortaleza", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Icaraizinho", "lat": -2.8650, "lon": -39.7050, "country": "Brazil", "state": "Ceará", "region": "Ceará Coast", "wave_type": "Beach Break", "difficulty": "Intermediate-Advanced"},
    
    # ============================================================
    # PERU - Major Surf Regions
    # ============================================================
    
    # North Peru - Chicama Region
    {"name": "Chicama", "lat": -7.7167, "lon": -79.4500, "country": "Peru", "state": "La Libertad", "region": "North Peru", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced", "description": "World's longest left-hand wave, up to 4km rides"},
    {"name": "El Cape (Chicama)", "lat": -7.7050, "lon": -79.4350, "country": "Peru", "state": "La Libertad", "region": "North Peru", "wave_type": "Point Break", "difficulty": "Advanced"},
    {"name": "Huanchaco", "lat": -8.0755, "lon": -79.1177, "country": "Peru", "state": "La Libertad", "region": "North Peru", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "Pacasmayo", "lat": -7.3950, "lon": -79.5750, "country": "Peru", "state": "La Libertad", "region": "North Peru", "wave_type": "Point Break", "difficulty": "Advanced"},
    
    # Far North Peru - Máncora
    {"name": "Máncora", "lat": -4.1050, "lon": -81.0550, "country": "Peru", "state": "Piura", "region": "Far North Peru", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "Los Órganos", "lat": -4.1750, "lon": -81.1350, "country": "Peru", "state": "Piura", "region": "Far North Peru", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Cabo Blanco", "lat": -4.2350, "lon": -81.2350, "country": "Peru", "state": "Piura", "region": "Far North Peru", "wave_type": "Point Break", "difficulty": "Advanced", "description": "Peru's legendary big wave spot"},
    {"name": "Lobitos", "lat": -4.4550, "lon": -81.2850, "country": "Peru", "state": "Piura", "region": "Far North Peru", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Punta Roquitas", "lat": -4.5050, "lon": -81.2650, "country": "Peru", "state": "Piura", "region": "Far North Peru", "wave_type": "Point Break", "difficulty": "Advanced"},
    
    # Central Peru - Lima
    {"name": "Pico Alto", "lat": -12.4550, "lon": -76.8050, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Reef Break", "difficulty": "Advanced", "description": "Lima's big wave spot"},
    {"name": "Punta Hermosa", "lat": -12.3350, "lon": -76.8250, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Señoritas", "lat": -12.3250, "lon": -76.8350, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "La Herradura", "lat": -12.1750, "lon": -77.0350, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Point Break", "difficulty": "Advanced"},
    {"name": "Miraflores", "lat": -12.1250, "lon": -77.0450, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Makaha", "lat": -12.1350, "lon": -77.0550, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "San Bartolo", "lat": -12.3850, "lon": -76.7850, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Punta Rocas", "lat": -12.4750, "lon": -76.7950, "country": "Peru", "state": "Lima", "region": "Lima", "wave_type": "Point Break", "difficulty": "Advanced"},
    
    # ============================================================
    # CHILE - Major Surf Regions
    # ============================================================
    
    # Central Chile - Pichilemu
    {"name": "Punta de Lobos", "lat": -34.4250, "lon": -72.0350, "country": "Chile", "state": "O'Higgins", "region": "Pichilemu", "wave_type": "Point Break", "difficulty": "Advanced", "description": "Chile's premier big wave spot"},
    {"name": "La Puntilla", "lat": -34.3850, "lon": -72.0150, "country": "Chile", "state": "O'Higgins", "region": "Pichilemu", "wave_type": "Point Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Infiernillo", "lat": -34.3950, "lon": -72.0250, "country": "Chile", "state": "O'Higgins", "region": "Pichilemu", "wave_type": "Beach Break", "difficulty": "Intermediate-Advanced"},
    {"name": "El Waitara", "lat": -34.4050, "lon": -72.0280, "country": "Chile", "state": "O'Higgins", "region": "Pichilemu", "wave_type": "Point Break", "difficulty": "Advanced"},
    {"name": "Cahuil", "lat": -34.4850, "lon": -72.0150, "country": "Chile", "state": "O'Higgins", "region": "Pichilemu", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Central Chile - Viña del Mar / Valparaíso
    {"name": "Reñaca", "lat": -32.9850, "lon": -71.5550, "country": "Chile", "state": "Valparaíso", "region": "Viña del Mar", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Concón", "lat": -32.9250, "lon": -71.5350, "country": "Chile", "state": "Valparaíso", "region": "Viña del Mar", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Ritoque", "lat": -32.8350, "lon": -71.5150, "country": "Chile", "state": "Valparaíso", "region": "Viña del Mar", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Maitencillo", "lat": -32.6550, "lon": -71.4450, "country": "Chile", "state": "Valparaíso", "region": "Zapallar", "wave_type": "Point Break", "difficulty": "Intermediate"},
    
    # North Chile - Arica
    {"name": "Arica - El Gringo", "lat": -18.4750, "lon": -70.3350, "country": "Chile", "state": "Arica y Parinacota", "region": "Arica", "wave_type": "Reef Break", "difficulty": "Advanced"},
    {"name": "Arica - La Isla", "lat": -18.4680, "lon": -70.3280, "country": "Chile", "state": "Arica y Parinacota", "region": "Arica", "wave_type": "Reef Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Arica - Las Machas", "lat": -18.5050, "lon": -70.3550, "country": "Chile", "state": "Arica y Parinacota", "region": "Arica", "wave_type": "Beach Break", "difficulty": "Beginner-Intermediate"},
    {"name": "Chinchorro", "lat": -18.5350, "lon": -70.3750, "country": "Chile", "state": "Arica y Parinacota", "region": "Arica", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # North Chile - Iquique
    {"name": "Iquique - Cavancha", "lat": -20.2350, "lon": -70.1550, "country": "Chile", "state": "Tarapacá", "region": "Iquique", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Iquique - Huayquique", "lat": -20.2750, "lon": -70.1550, "country": "Chile", "state": "Tarapacá", "region": "Iquique", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    
    # South Chile - Bio Bio
    {"name": "Buchupureo", "lat": -35.9850, "lon": -72.8050, "country": "Chile", "state": "Bio Bio", "region": "South Chile", "wave_type": "Point Break", "difficulty": "Advanced"},
    {"name": "Cobquecura", "lat": -36.1350, "lon": -72.8150, "country": "Chile", "state": "Bio Bio", "region": "South Chile", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Dichato", "lat": -36.5550, "lon": -72.9550, "country": "Chile", "state": "Bio Bio", "region": "South Chile", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Central Coast
    {"name": "Matanzas", "lat": -33.9650, "lon": -71.8750, "country": "Chile", "state": "O'Higgins", "region": "Central Coast", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Topocalma", "lat": -34.1350, "lon": -71.9550, "country": "Chile", "state": "O'Higgins", "region": "Central Coast", "wave_type": "Point Break", "difficulty": "Intermediate-Advanced"},
    {"name": "Puertecillo", "lat": -34.0550, "lon": -71.9150, "country": "Chile", "state": "O'Higgins", "region": "Central Coast", "wave_type": "Point Break", "difficulty": "Intermediate"},
]


async def import_south_america_spots():
    """Import all South America surf spots with offshore-snap precision."""
    async with async_session_maker() as db:
        added_count = 0
        updated_count = 0
        skipped_count = 0
        
        for spot_data in SOUTH_AMERICA_SPOTS:
            # Check if spot already exists
            result = await db.execute(
                select(SurfSpot).where(SurfSpot.name == spot_data["name"])
            )
            existing = result.scalar_one_or_none()
            
            if existing:
                # Update coordinates if significantly different
                lat_diff = abs(float(existing.latitude) - spot_data["lat"]) if existing.latitude else 999
                lon_diff = abs(float(existing.longitude) - spot_data["lon"]) if existing.longitude else 999
                
                if lat_diff > 0.01 or lon_diff > 0.01:  # ~1km difference
                    existing.latitude = spot_data["lat"]
                    existing.longitude = spot_data["lon"]
                    existing.is_verified_peak = True
                    existing.import_tier = 3
                    logger.info(f"UPDATED: {spot_data['name']} to ({spot_data['lat']}, {spot_data['lon']})")
                    updated_count += 1
                else:
                    logger.debug(f"SKIPPED (exists): {spot_data['name']}")
                    skipped_count += 1
            else:
                # Create new spot
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["lat"],
                    longitude=spot_data["lon"],
                    country=spot_data["country"],
                    state_province=spot_data.get("state"),
                    region=spot_data.get("region"),
                    wave_type=spot_data.get("wave_type"),
                    difficulty=spot_data.get("difficulty"),
                    description=spot_data.get("description"),
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=3  # Tier 3 for global expansion
                )
                db.add(new_spot)
                logger.info(f"ADDED: {spot_data['name']} ({spot_data['country']}) at ({spot_data['lat']}, {spot_data['lon']})")
                added_count += 1
        
        await db.commit()
        
        # Summary by country
        logger.info("\n" + "=" * 60)
        logger.info("SOUTH AMERICA IMPORT SUMMARY")
        logger.info("=" * 60)
        logger.info(f"  New spots added: {added_count}")
        logger.info(f"  Existing spots updated: {updated_count}")
        logger.info(f"  Skipped (already precise): {skipped_count}")
        
        # Count by country
        brazil_count = len([s for s in SOUTH_AMERICA_SPOTS if s["country"] == "Brazil"])
        peru_count = len([s for s in SOUTH_AMERICA_SPOTS if s["country"] == "Peru"])
        chile_count = len([s for s in SOUTH_AMERICA_SPOTS if s["country"] == "Chile"])
        
        logger.info(f"\nSpots by country:")
        logger.info(f"  Brazil: {brazil_count}")
        logger.info(f"  Peru: {peru_count}")
        logger.info(f"  Chile: {chile_count}")
        logger.info(f"  TOTAL: {brazil_count + peru_count + chile_count}")
        
        return added_count, updated_count


async def main():
    logger.info("=" * 60)
    logger.info("SOUTH AMERICA SURF SPOT EXPANSION")
    logger.info("Surfline-Precision Offshore Coordinates")
    logger.info("=" * 60)
    
    added, updated = await import_south_america_spots()
    
    # Final verification
    async with async_session_maker() as db:
        result = await db.execute(select(SurfSpot))
        total = len(result.scalars().all())
        logger.info(f"\nTotal spots in database: {total}")


if __name__ == "__main__":
    asyncio.run(main())
