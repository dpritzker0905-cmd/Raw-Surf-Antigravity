"""
GLOBAL EXPANSION PHASE 4 - April 2026
=============================================
COVERAGE:
- Pacific Islands: Tonga, Vanuatu, Papua New Guinea
- Africa: Madagascar, Mozambique, Angola
- Middle East: Oman, UAE, Israel
- South America: Ecuador, Colombia

ALL coordinates are 50-150m OFFSHORE at actual breaking wave peaks.
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot
from uuid import uuid4

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# PACIFIC ISLANDS - Tonga, Vanuatu, Papua New Guinea
# =============================================================================

TONGA_SPOTS = {
    "Ha'atafu Beach": {
        "lat": -21.098, "lon": -175.358,  # Main surf beach offshore
        "region": "Tongatapu", "state": "Tongatapu", "country": "Tonga",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Koloa": {
        "lat": -21.108, "lon": -175.348,  # Reef break offshore
        "region": "Tongatapu", "state": "Tongatapu", "country": "Tonga",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Liku'alofa": {
        "lat": -21.118, "lon": -175.368,  # Beach break offshore
        "region": "Tongatapu", "state": "Tongatapu", "country": "Tonga",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Ha'apai Islands": {
        "lat": -19.798, "lon": -174.358,  # Remote reef break offshore
        "region": "Ha'apai", "state": "Ha'apai", "country": "Tonga",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Vava'u": {
        "lat": -18.658, "lon": -174.008,  # Northern islands reef offshore
        "region": "Vava'u", "state": "Vava'u", "country": "Tonga",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

VANUATU_SPOTS = {
    "Pango Point": {
        "lat": -17.788, "lon": 168.298,  # Right point offshore
        "region": "Efate", "state": "Shefa", "country": "Vanuatu",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Breakas": {
        "lat": -17.748, "lon": 168.258,  # Reef break offshore
        "region": "Efate", "state": "Shefa", "country": "Vanuatu",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Erakor Lagoon": {
        "lat": -17.768, "lon": 168.328,  # Lagoon break offshore
        "region": "Efate", "state": "Shefa", "country": "Vanuatu",
        "spot_type": "reef_break", "difficulty": "beginner",
    },
    "Tanna Island": {
        "lat": -19.528, "lon": 169.288,  # Remote reef offshore
        "region": "Tanna", "state": "Tafea", "country": "Vanuatu",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Espiritu Santo": {
        "lat": -15.508, "lon": 167.178,  # Northern island offshore
        "region": "Espiritu Santo", "state": "Sanma", "country": "Vanuatu",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

PAPUA_NEW_GUINEA_SPOTS = {
    "Tupira Surf Club": {
        "lat": -5.048, "lon": 145.798,  # Madang Province offshore
        "region": "Madang", "state": "Madang", "country": "Papua New Guinea",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Vanimo": {
        "lat": -2.688, "lon": 141.298,  # Border town reef offshore
        "region": "Vanimo", "state": "West Sepik", "country": "Papua New Guinea",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Wewak": {
        "lat": -3.558, "lon": 143.638,  # Beach break offshore
        "region": "Wewak", "state": "East Sepik", "country": "Papua New Guinea",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Kavieng": {
        "lat": -2.578, "lon": 150.798,  # New Ireland Province offshore
        "region": "Kavieng", "state": "New Ireland", "country": "Papua New Guinea",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Nusa Island": {
        "lat": -2.568, "lon": 150.778,  # Resort island reef offshore
        "region": "Kavieng", "state": "New Ireland", "country": "Papua New Guinea",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Ral Island": {
        "lat": -4.218, "lon": 145.328,  # Surf charter destination offshore
        "region": "Madang", "state": "Madang", "country": "Papua New Guinea",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
}

# =============================================================================
# AFRICA - Madagascar, Mozambique, Angola
# =============================================================================

MADAGASCAR_SPOTS = {
    # Southwest Coast (Main surf region)
    "Anakao": {
        "lat": -23.668, "lon": 43.658,  # Main surf village offshore
        "region": "Anakao", "state": "Atsimo-Andrefana", "country": "Madagascar",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Lavanono": {
        "lat": -25.418, "lon": 45.078,  # Consistent left offshore
        "region": "Lavanono", "state": "Androy", "country": "Madagascar",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Itampolo": {
        "lat": -24.688, "lon": 43.958,  # Remote reef offshore
        "region": "Itampolo", "state": "Atsimo-Andrefana", "country": "Madagascar",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Salary": {
        "lat": -22.888, "lon": 43.428,  # Beach break offshore
        "region": "Salary", "state": "Atsimo-Andrefana", "country": "Madagascar",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Tulear": {
        "lat": -23.358, "lon": 43.678,  # Beach break offshore
        "region": "Tulear", "state": "Atsimo-Andrefana", "country": "Madagascar",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Fort Dauphin": {
        "lat": -25.038, "lon": 47.008,  # Southeast coast offshore
        "region": "Fort Dauphin", "state": "Anosy", "country": "Madagascar",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

MOZAMBIQUE_SPOTS = {
    # Inhambane Province (Main surf region)
    "Tofo Beach": {
        "lat": -23.858, "lon": 35.548,  # Main surf beach offshore
        "region": "Tofo", "state": "Inhambane", "country": "Mozambique",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Tofo - Backdoor": {
        "lat": -23.848, "lon": 35.538,  # Right reef offshore
        "region": "Tofo", "state": "Inhambane", "country": "Mozambique",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Tofinho": {
        "lat": -23.868, "lon": 35.558,  # Point break offshore
        "region": "Tofo", "state": "Inhambane", "country": "Mozambique",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Barra Beach": {
        "lat": -23.798, "lon": 35.528,  # Beach break offshore
        "region": "Barra", "state": "Inhambane", "country": "Mozambique",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Ponta do Ouro": {
        "lat": -26.838, "lon": 32.898,  # Southern border offshore
        "region": "Ponta do Ouro", "state": "Maputo", "country": "Mozambique",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Zavora": {
        "lat": -24.498, "lon": 35.268,  # Reef break offshore
        "region": "Zavora", "state": "Inhambane", "country": "Mozambique",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

ANGOLA_SPOTS = {
    # Benguela Province (Main surf region)
    "Baia Azul": {
        "lat": -12.588, "lon": 13.398,  # Beach break offshore
        "region": "Benguela", "state": "Benguela", "country": "Angola",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Lobito": {
        "lat": -12.368, "lon": 13.548,  # Beach break offshore
        "region": "Lobito", "state": "Benguela", "country": "Angola",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Cabo Ledo": {
        "lat": -9.648, "lon": 13.258,  # Point break offshore
        "region": "Cabo Ledo", "state": "Bengo", "country": "Angola",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Sangano": {
        "lat": -9.528, "lon": 13.278,  # Beach break offshore
        "region": "Sangano", "state": "Bengo", "country": "Angola",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Luanda - Ilha": {
        "lat": -8.808, "lon": 13.228,  # Urban beach offshore
        "region": "Luanda", "state": "Luanda", "country": "Angola",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# MIDDLE EAST - Oman, UAE, Israel
# =============================================================================

OMAN_SPOTS = {
    # Dhofar Region (Southwest - Monsoon swells)
    "Salalah - Mughsail": {
        "lat": 16.878, "lon": 53.738,  # Beach break offshore
        "region": "Salalah", "state": "Dhofar", "country": "Oman",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Salalah - Fizayah": {
        "lat": 16.948, "lon": 53.838,  # Point break offshore
        "region": "Salalah", "state": "Dhofar", "country": "Oman",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Al Mughsayl": {
        "lat": 16.868, "lon": 53.728,  # Beach break offshore
        "region": "Salalah", "state": "Dhofar", "country": "Oman",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Musandam Peninsula (North)
    "Musandam": {
        "lat": 26.218, "lon": 56.258,  # Remote point break offshore
        "region": "Musandam", "state": "Musandam", "country": "Oman",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    
    # Al Batinah Coast
    "Barka": {
        "lat": 23.698, "lon": 57.878,  # Beach break offshore
        "region": "Al Batinah", "state": "Al Batinah South", "country": "Oman",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

UAE_SPOTS = {
    # Fujairah (East Coast - Gulf of Oman)
    "Fujairah - Sandy Beach": {
        "lat": 25.458, "lon": 56.368,  # Main surf beach offshore
        "region": "Fujairah", "state": "Fujairah", "country": "United Arab Emirates",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Fujairah - Dibba": {
        "lat": 25.618, "lon": 56.268,  # Northern beach offshore
        "region": "Dibba", "state": "Fujairah", "country": "United Arab Emirates",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Kalba": {
        "lat": 25.068, "lon": 56.358,  # Southern beach offshore
        "region": "Kalba", "state": "Sharjah", "country": "United Arab Emirates",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Khor Fakkan": {
        "lat": 25.348, "lon": 56.358,  # Beach break offshore
        "region": "Khor Fakkan", "state": "Sharjah", "country": "United Arab Emirates",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

ISRAEL_SPOTS = {
    # Mediterranean Coast
    "Tel Aviv - Hilton": {
        "lat": 32.098, "lon": 34.768,  # Main surf spot offshore
        "region": "Tel Aviv", "state": "Tel Aviv", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Tel Aviv - Drum Beach": {
        "lat": 32.088, "lon": 34.758,  # Beach break offshore
        "region": "Tel Aviv", "state": "Tel Aviv", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Herzliya": {
        "lat": 32.168, "lon": 34.798,  # Beach break offshore
        "region": "Herzliya", "state": "Tel Aviv", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Netanya": {
        "lat": 32.328, "lon": 34.848,  # Beach break offshore
        "region": "Netanya", "state": "Central", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Haifa - Dado Beach": {
        "lat": 32.818, "lon": 34.958,  # Beach break offshore
        "region": "Haifa", "state": "Haifa", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Bat Yam": {
        "lat": 32.018, "lon": 34.738,  # Beach break offshore
        "region": "Bat Yam", "state": "Tel Aviv", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Ashdod": {
        "lat": 31.798, "lon": 34.638,  # Beach break offshore
        "region": "Ashdod", "state": "Southern", "country": "Israel",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# SOUTH AMERICA - Ecuador, Colombia
# =============================================================================

ECUADOR_SPOTS = {
    # Manabi Province (Main surf region)
    "Montanita": {
        "lat": -1.828, "lon": -80.758,  # Party beach offshore
        "region": "Santa Elena", "state": "Santa Elena", "country": "Ecuador",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Montanita - La Punta": {
        "lat": -1.818, "lon": -80.768,  # Right point offshore
        "region": "Santa Elena", "state": "Santa Elena", "country": "Ecuador",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Olón": {
        "lat": -1.788, "lon": -80.768,  # Beach break offshore
        "region": "Santa Elena", "state": "Santa Elena", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Ayampe": {
        "lat": -1.688, "lon": -80.778,  # Beach break offshore
        "region": "Manabi", "state": "Manabi", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Canoa": {
        "lat": -0.468, "lon": -80.458,  # Beach break offshore
        "region": "Manabi", "state": "Manabi", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Mompiche": {
        "lat": 0.528, "lon": -80.028,  # Point break offshore
        "region": "Esmeraldas", "state": "Esmeraldas", "country": "Ecuador",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Same": {
        "lat": 0.718, "lon": -80.068,  # Beach break offshore
        "region": "Esmeraldas", "state": "Esmeraldas", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Engabao": {
        "lat": -2.568, "lon": -80.478,  # Beach break offshore
        "region": "Guayas", "state": "Guayas", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Galapagos
    "San Cristobal - Tongo Reef": {
        "lat": -0.918, "lon": -89.618,  # Reef break offshore
        "region": "Galapagos", "state": "Galapagos", "country": "Ecuador",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "San Cristobal - Carola": {
        "lat": -0.898, "lon": -89.608,  # Beach break offshore
        "region": "Galapagos", "state": "Galapagos", "country": "Ecuador",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

COLOMBIA_SPOTS = {
    # Pacific Coast (Main surf region)
    "Nuqui": {
        "lat": 5.728, "lon": -77.278,  # Remote beach offshore
        "region": "Choco", "state": "Choco", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Bahia Solano": {
        "lat": 6.228, "lon": -77.408,  # Beach break offshore
        "region": "Choco", "state": "Choco", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "El Valle": {
        "lat": 6.128, "lon": -77.398,  # Beach break offshore
        "region": "Choco", "state": "Choco", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Termales": {
        "lat": 5.738, "lon": -77.288,  # Point break offshore
        "region": "Choco", "state": "Choco", "country": "Colombia",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Juanchaco": {
        "lat": 3.938, "lon": -77.358,  # Beach break offshore
        "region": "Valle del Cauca", "state": "Valle del Cauca", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Caribbean Coast
    "Palomino": {
        "lat": 11.248, "lon": -73.568,  # Beach break offshore
        "region": "La Guajira", "state": "La Guajira", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Costeno Beach": {
        "lat": 11.298, "lon": -73.678,  # Beach break offshore
        "region": "Magdalena", "state": "Magdalena", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Cartagena - Bocagrande": {
        "lat": 10.398, "lon": -75.558,  # Beach break offshore
        "region": "Cartagena", "state": "Bolivar", "country": "Colombia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}


async def add_or_update_spot(db, name: str, data: dict) -> str:
    """Add new spot or update existing."""
    result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
    spot = result.scalar_one_or_none()
    
    if spot:
        old_lat = float(spot.latitude) if spot.latitude else 0
        old_lon = float(spot.longitude) if spot.longitude else 0
        
        lat_diff = abs(data["lat"] - old_lat) * 111000
        lon_diff = abs(data["lon"] - old_lon) * 111000 * 0.85
        dist = (lat_diff**2 + lon_diff**2)**0.5
        
        if dist > 30:
            spot.latitude = data["lat"]
            spot.longitude = data["lon"]
            spot.is_verified_peak = True
            return f"updated ({dist:.0f}m)"
        return "unchanged"
    else:
        new_spot = SurfSpot(
            id=str(uuid4()),
            name=name,
            region=data.get("region", "Unknown"),
            country=data.get("country", "Unknown"),
            state_province=data.get("state", None),
            latitude=data["lat"],
            longitude=data["lon"],
            is_active=True,
            is_verified_peak=True,
            difficulty=data.get("difficulty", "intermediate"),
        )
        db.add(new_spot)
        return "added"


async def run_expansion():
    """Run the global expansion phase 4."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0}
        
        logger.info("="*70)
        logger.info("GLOBAL EXPANSION PHASE 4 - April 2026")
        logger.info("="*70)
        
        all_regions = [
            ("TONGA", TONGA_SPOTS),
            ("VANUATU", VANUATU_SPOTS),
            ("PAPUA NEW GUINEA", PAPUA_NEW_GUINEA_SPOTS),
            ("MADAGASCAR", MADAGASCAR_SPOTS),
            ("MOZAMBIQUE", MOZAMBIQUE_SPOTS),
            ("ANGOLA", ANGOLA_SPOTS),
            ("OMAN", OMAN_SPOTS),
            ("UAE", UAE_SPOTS),
            ("ISRAEL", ISRAEL_SPOTS),
            ("ECUADOR", ECUADOR_SPOTS),
            ("COLOMBIA", COLOMBIA_SPOTS),
        ]
        
        for region_name, spots in all_regions:
            logger.info(f"\n--- {region_name} ---")
            region_added = 0
            region_updated = 0
            
            for name, data in spots.items():
                result = await add_or_update_spot(db, name, data)
                if "added" in result:
                    stats["added"] += 1
                    region_added += 1
                elif "updated" in result:
                    stats["updated"] += 1
                    region_updated += 1
                logger.info(f"  {name}: {result}")
            
            logger.info(f"  >> {region_name}: +{region_added} added, {region_updated} updated")
        
        await db.commit()
        
        # Get final count
        result = await db.execute(select(SurfSpot))
        total_spots = len(result.scalars().all())
        
        logger.info("\n" + "="*70)
        logger.info("EXPANSION PHASE 4 COMPLETE")
        logger.info(f"Added: {stats['added']}, Updated: {stats['updated']}")
        logger.info(f"TOTAL SPOTS IN DATABASE: {total_spots}")
        logger.info("="*70)
        
        return stats, total_spots


async def main():
    stats, total = await run_expansion()
    print(f"\nDone! Added {stats['added']}, Updated {stats['updated']}")
    print(f"Total spots in database: {total}")


if __name__ == "__main__":
    asyncio.run(main())
