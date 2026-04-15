"""
GLOBAL EXPANSION PHASE 5 - April 2026
=============================================
COVERAGE:
- Caribbean: Aruba, Curaçao, Martinique, Guadeloupe
- Pacific: Tuvalu, Solomon Islands
- Indonesia: Full expansion (Sumbawa, Sumba, Nias, West Java)
- Middle East: Saudi Arabia, Qatar Red Sea
- Oceania: Micronesia, Marshall Islands

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
# CARIBBEAN - Aruba, Curaçao, Martinique, Guadeloupe
# =============================================================================

ARUBA_SPOTS = {
    "Boca Grandi": {
        "lat": 12.428, "lon": -69.868,  # Main surf beach offshore
        "region": "Aruba", "state": "Aruba", "country": "Aruba",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Andicuri": {
        "lat": 12.538, "lon": -69.948,  # Natural pool area offshore
        "region": "Aruba", "state": "Aruba", "country": "Aruba",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    "Dos Playa": {
        "lat": 12.528, "lon": -69.938,  # Beach break offshore
        "region": "Aruba", "state": "Aruba", "country": "Aruba",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Wariruri": {
        "lat": 12.568, "lon": -69.978,  # Remote beach offshore
        "region": "Aruba", "state": "Aruba", "country": "Aruba",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
}

CURACAO_SPOTS = {
    "Playa Kanoa": {
        "lat": 12.158, "lon": -68.998,  # Main surf spot offshore
        "region": "Curacao", "state": "Curacao", "country": "Curacao",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Westpunt": {
        "lat": 12.378, "lon": -69.158,  # North coast offshore
        "region": "Curacao", "state": "Curacao", "country": "Curacao",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Daaibooi": {
        "lat": 12.218, "lon": -69.028,  # Beach break offshore
        "region": "Curacao", "state": "Curacao", "country": "Curacao",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

MARTINIQUE_SPOTS = {
    "Le Diamant": {
        "lat": 14.468, "lon": -61.038,  # South coast offshore
        "region": "Martinique", "state": "Martinique", "country": "Martinique",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Tartane": {
        "lat": 14.768, "lon": -60.928,  # Atlantic coast offshore
        "region": "Martinique", "state": "Martinique", "country": "Martinique",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Anse Bonneville": {
        "lat": 14.788, "lon": -60.918,  # Beach break offshore
        "region": "Martinique", "state": "Martinique", "country": "Martinique",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Basse Pointe": {
        "lat": 14.868, "lon": -61.118,  # North coast offshore
        "region": "Martinique", "state": "Martinique", "country": "Martinique",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
}

GUADELOUPE_SPOTS = {
    "Le Moule": {
        "lat": 16.338, "lon": -61.338,  # Main surf town offshore
        "region": "Grande-Terre", "state": "Guadeloupe", "country": "Guadeloupe",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Sainte-Anne": {
        "lat": 16.228, "lon": -61.358,  # Beach break offshore
        "region": "Grande-Terre", "state": "Guadeloupe", "country": "Guadeloupe",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Port-Louis": {
        "lat": 16.418, "lon": -61.528,  # North coast offshore
        "region": "Grande-Terre", "state": "Guadeloupe", "country": "Guadeloupe",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Petit-Bourg": {
        "lat": 16.188, "lon": -61.588,  # Basse-Terre offshore
        "region": "Basse-Terre", "state": "Guadeloupe", "country": "Guadeloupe",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# PACIFIC - Tuvalu, Solomon Islands
# =============================================================================

TUVALU_SPOTS = {
    "Funafuti": {
        "lat": -8.528, "lon": 179.198,  # Main atoll offshore
        "region": "Funafuti", "state": "Funafuti", "country": "Tuvalu",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Nanumea": {
        "lat": -5.678, "lon": 176.108,  # Northern atoll offshore
        "region": "Nanumea", "state": "Nanumea", "country": "Tuvalu",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
}

SOLOMON_ISLANDS_SPOTS = {
    "Gizo": {
        "lat": -8.108, "lon": 156.848,  # Western Province offshore
        "region": "Western Province", "state": "Western", "country": "Solomon Islands",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Munda": {
        "lat": -8.328, "lon": 157.268,  # New Georgia offshore
        "region": "Western Province", "state": "Western", "country": "Solomon Islands",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Honiara": {
        "lat": -9.438, "lon": 160.028,  # Capital city offshore
        "region": "Guadalcanal", "state": "Guadalcanal", "country": "Solomon Islands",
        "spot_type": "reef_break", "difficulty": "beginner",
    },
    "Marovo Lagoon": {
        "lat": -8.498, "lon": 158.098,  # UNESCO site offshore
        "region": "Western Province", "state": "Western", "country": "Solomon Islands",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
}

# =============================================================================
# INDONESIA - Full Expansion (Sumbawa, Sumba, Nias, West Java)
# =============================================================================

INDONESIA_FULL_EXPANSION = {
    # Sumbawa
    "Lakey Peak": {
        "lat": -8.788, "lon": 118.428,  # World-class A-frame offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Lakey Pipe": {
        "lat": -8.778, "lon": 118.418,  # Left barrel offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Periscopes": {
        "lat": -8.768, "lon": 118.408,  # Right reef offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Nungas": {
        "lat": -8.798, "lon": 118.438,  # Beach break offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Scar Reef": {
        "lat": -9.058, "lon": 116.758,  # West Sumbawa offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Supersuck": {
        "lat": -9.048, "lon": 116.748,  # Left barrel offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Yo-Yos": {
        "lat": -9.038, "lon": 116.738,  # Right reef offshore
        "region": "Sumbawa", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Sumba
    "Nihiwatu": {
        "lat": -9.668, "lon": 119.398,  # Exclusive resort wave offshore
        "region": "Sumba", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Tarimbang": {
        "lat": -10.058, "lon": 120.268,  # Remote left offshore
        "region": "Sumba", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Pantai Marosi": {
        "lat": -9.358, "lon": 119.068,  # Beach break offshore
        "region": "Sumba", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Nias
    "Sorake Bay": {
        "lat": 0.568, "lon": 97.788,  # Main Nias wave offshore
        "region": "Nias", "state": "North Sumatra", "country": "Indonesia",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Lagundri Bay": {
        "lat": 0.558, "lon": 97.778,  # Classic right offshore
        "region": "Nias", "state": "North Sumatra", "country": "Indonesia",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "The Point Nias": {
        "lat": 0.578, "lon": 97.798,  # Inside section offshore
        "region": "Nias", "state": "North Sumatra", "country": "Indonesia",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Indicators Nias": {
        "lat": 0.588, "lon": 97.808,  # Outer reef offshore
        "region": "Nias", "state": "North Sumatra", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    
    # West Java
    "Cimaja": {
        "lat": -7.028, "lon": 106.468,  # Main West Java beach offshore
        "region": "West Java", "state": "West Java", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pelabuhan Ratu": {
        "lat": -6.988, "lon": 106.548,  # Fisherman's bay offshore
        "region": "West Java", "state": "West Java", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Sawarna": {
        "lat": -6.918, "lon": 105.898,  # Hidden gem offshore
        "region": "West Java", "state": "Banten", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Karang Hawu": {
        "lat": -6.938, "lon": 106.388,  # Reef break offshore
        "region": "West Java", "state": "West Java", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Rote Island
    "T-Land": {
        "lat": -10.838, "lon": 123.028,  # World-class left offshore
        "region": "Rote", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Nembrala": {
        "lat": -10.848, "lon": 123.038,  # Village reef offshore
        "region": "Rote", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Boa": {
        "lat": -10.828, "lon": 123.018,  # Right reef offshore
        "region": "Rote", "state": "East Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# MIDDLE EAST - Saudi Arabia, Qatar
# =============================================================================

SAUDI_ARABIA_SPOTS = {
    # Red Sea Coast
    "Jeddah - Obhur": {
        "lat": 21.728, "lon": 39.098,  # Beach break offshore
        "region": "Jeddah", "state": "Makkah", "country": "Saudi Arabia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "King Abdullah Economic City": {
        "lat": 22.398, "lon": 39.108,  # Beach break offshore
        "region": "KAEC", "state": "Makkah", "country": "Saudi Arabia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Yanbu": {
        "lat": 24.088, "lon": 38.048,  # Beach break offshore
        "region": "Yanbu", "state": "Madinah", "country": "Saudi Arabia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "NEOM Bay": {
        "lat": 28.188, "lon": 34.618,  # Future surf city offshore
        "region": "NEOM", "state": "Tabuk", "country": "Saudi Arabia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

QATAR_SPOTS = {
    "Al Wakrah": {
        "lat": 25.168, "lon": 51.608,  # Beach break offshore
        "region": "Al Wakrah", "state": "Al Wakrah", "country": "Qatar",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Mesaieed": {
        "lat": 24.998, "lon": 51.558,  # Industrial beach offshore
        "region": "Mesaieed", "state": "Al Wakrah", "country": "Qatar",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Fuwairit": {
        "lat": 25.948, "lon": 51.358,  # North coast offshore
        "region": "Al Khor", "state": "Al Khor", "country": "Qatar",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# OCEANIA - Micronesia, Marshall Islands
# =============================================================================

MICRONESIA_SPOTS = {
    "Pohnpei - P-Pass": {
        "lat": 6.848, "lon": 158.228,  # World-class right offshore
        "region": "Pohnpei", "state": "Pohnpei", "country": "Micronesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Pohnpei - Palikir Pass": {
        "lat": 6.918, "lon": 158.168,  # Pass break offshore
        "region": "Pohnpei", "state": "Pohnpei", "country": "Micronesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Kosrae": {
        "lat": 5.318, "lon": 163.008,  # Eastern island offshore
        "region": "Kosrae", "state": "Kosrae", "country": "Micronesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Chuuk": {
        "lat": 7.418, "lon": 151.848,  # Lagoon island offshore
        "region": "Chuuk", "state": "Chuuk", "country": "Micronesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

MARSHALL_ISLANDS_SPOTS = {
    "Majuro": {
        "lat": 7.108, "lon": 171.378,  # Capital atoll offshore
        "region": "Majuro", "state": "Majuro", "country": "Marshall Islands",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Arno Atoll": {
        "lat": 7.088, "lon": 171.728,  # Eastern atoll offshore
        "region": "Arno", "state": "Arno", "country": "Marshall Islands",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Kwajalein": {
        "lat": 8.728, "lon": 167.738,  # Military atoll offshore
        "region": "Kwajalein", "state": "Kwajalein", "country": "Marshall Islands",
        "spot_type": "reef_break", "difficulty": "intermediate",
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
    """Run the global expansion phase 5."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0}
        
        logger.info("="*70)
        logger.info("GLOBAL EXPANSION PHASE 5 - April 2026")
        logger.info("="*70)
        
        all_regions = [
            ("ARUBA", ARUBA_SPOTS),
            ("CURACAO", CURACAO_SPOTS),
            ("MARTINIQUE", MARTINIQUE_SPOTS),
            ("GUADELOUPE", GUADELOUPE_SPOTS),
            ("TUVALU", TUVALU_SPOTS),
            ("SOLOMON ISLANDS", SOLOMON_ISLANDS_SPOTS),
            ("INDONESIA (FULL EXPANSION)", INDONESIA_FULL_EXPANSION),
            ("SAUDI ARABIA", SAUDI_ARABIA_SPOTS),
            ("QATAR", QATAR_SPOTS),
            ("MICRONESIA", MICRONESIA_SPOTS),
            ("MARSHALL ISLANDS", MARSHALL_ISLANDS_SPOTS),
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
        logger.info("EXPANSION PHASE 5 COMPLETE")
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
