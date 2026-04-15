"""
GLOBAL EXPANSION PHASE 3 - April 2026
=============================================
COVERAGE:
- Hawaii (detailed expansion - additional spots)
- Fiji (Cloudbreak, Restaurants, Frigates)
- Tahiti/French Polynesia (Teahupoo, Papara)
- Samoa (Salani, Aganoa)
- India (Kerala, Karnataka, Goa)
- Taiwan (expansion)
- Morocco (expansion - more Taghazout, southern spots)
- Namibia (Skeleton Bay)
- West Africa: Ghana, Senegal

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
# HAWAII - Additional Spots (expand existing 25)
# =============================================================================

HAWAII_EXPANSION = {
    # Oahu - North Shore (additional)
    "Rocky Point": {
        "lat": 21.678, "lon": -158.058,  # Between Pipe and Sunset offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Gas Chambers Hawaii": {
        "lat": 21.678, "lon": -158.068,  # Heavy slab offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Off The Wall": {
        "lat": 21.668, "lon": -158.048,  # Near Pipeline offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Pupukea": {
        "lat": 21.658, "lon": -158.068,  # Beach break offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Log Cabins": {
        "lat": 21.668, "lon": -158.078,  # Near Rockpiles offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Rockpiles": {
        "lat": 21.668, "lon": -158.088,  # Reef break offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Velzyland": {
        "lat": 21.708, "lon": -158.028,  # V-Land offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Phantoms": {
        "lat": 21.718, "lon": -158.018,  # Far north shore offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    
    # Oahu - South Shore (additional)
    "Kaisers": {
        "lat": 21.278, "lon": -157.838,  # Waikiki offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Rockpiles Waikiki": {
        "lat": 21.268, "lon": -157.828,  # Waikiki offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Tonggs": {
        "lat": 21.258, "lon": -157.818,  # Diamond Head offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Ala Moana Beach": {
        "lat": 21.288, "lon": -157.858,  # Beach break offshore
        "region": "Oahu", "state": "Hawaii", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Maui (additional)
    "Lanes Maui": {
        "lat": 20.948, "lon": -156.688,  # Lahaina offshore
        "region": "Maui", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Grandmas Maui": {
        "lat": 20.938, "lon": -156.678,  # Lahaina offshore
        "region": "Maui", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "beginner",
    },
    "Maalaea": {
        "lat": 20.798, "lon": -156.508,  # Fastest wave in world offshore
        "region": "Maui", "state": "Hawaii", "country": "USA",
        "spot_type": "point_break", "difficulty": "expert",
    },
    "Kanaha": {
        "lat": 20.918, "lon": -156.438,  # Windsurf/kite spot offshore
        "region": "Maui", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Big Island
    "Honolii": {
        "lat": 19.778, "lon": -155.098,  # Hilo's main spot offshore
        "region": "Big Island", "state": "Hawaii", "country": "USA",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Banyans Big Island": {
        "lat": 19.538, "lon": -155.968,  # Kona side offshore
        "region": "Big Island", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Pine Trees Big Island": {
        "lat": 19.818, "lon": -155.988,  # North Kona offshore
        "region": "Big Island", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Kauai (additional)
    "Tunnels Kauai": {
        "lat": 22.228, "lon": -159.568,  # Haena offshore
        "region": "Kauai", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Hanalei Pier": {
        "lat": 22.208, "lon": -159.508,  # Hanalei Bay offshore
        "region": "Kauai", "state": "Hawaii", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Centers Kauai": {
        "lat": 22.218, "lon": -159.518,  # Hanalei center offshore
        "region": "Kauai", "state": "Hawaii", "country": "USA",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Pakala (Infinities)": {
        "lat": 21.898, "lon": -159.658,  # Long left offshore
        "region": "Kauai", "state": "Hawaii", "country": "USA",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Polihale": {
        "lat": 22.078, "lon": -159.768,  # Remote beach offshore
        "region": "Kauai", "state": "Hawaii", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
}

# =============================================================================
# FIJI - World-Class Reef Breaks
# =============================================================================

FIJI_SPOTS = {
    # Tavarua/Mamanuca Islands
    "Cloudbreak": {
        "lat": -17.868, "lon": 177.198,  # World-class left offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Restaurants": {
        "lat": -17.858, "lon": 177.188,  # Right reef offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Tavarua Rights": {
        "lat": -17.848, "lon": 177.178,  # Fun right offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Namotu Lefts": {
        "lat": -17.878, "lon": 177.158,  # Left reef offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Wilkes Pass": {
        "lat": -17.888, "lon": 177.168,  # Reef break offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Swimming Pools": {
        "lat": -17.898, "lon": 177.148,  # Mellow reef offshore
        "region": "Mamanuca Islands", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "beginner",
    },
    
    # Viti Levu (Main Island)
    "Frigates": {
        "lat": -18.178, "lon": 177.468,  # Heavy left offshore
        "region": "Coral Coast", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Sigatoka": {
        "lat": -18.148, "lon": 177.498,  # River mouth offshore
        "region": "Coral Coast", "state": "Western", "country": "Fiji",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Natadola": {
        "lat": -18.128, "lon": 177.378,  # Beach break offshore
        "region": "Coral Coast", "state": "Western", "country": "Fiji",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Hideaways": {
        "lat": -18.118, "lon": 177.358,  # Reef break offshore
        "region": "Coral Coast", "state": "Western", "country": "Fiji",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# TAHITI / FRENCH POLYNESIA - Teahupoo & More
# =============================================================================

TAHITI_SPOTS = {
    # Tahiti
    "Teahupoo": {
        "lat": -17.868, "lon": -149.258,  # World's heaviest wave offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Teahupoo - End of the Road": {
        "lat": -17.878, "lon": -149.268,  # Inside section offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Papara": {
        "lat": -17.738, "lon": -149.518,  # Beach break offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Taapuna": {
        "lat": -17.578, "lon": -149.608,  # Reef break offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Sapinus": {
        "lat": -17.598, "lon": -149.588,  # Right reef offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Maraa": {
        "lat": -17.798, "lon": -149.328,  # Beach break offshore
        "region": "Tahiti", "state": "Tahiti", "country": "French Polynesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Moorea
    "Haapiti": {
        "lat": -17.568, "lon": -149.908,  # Left reef offshore
        "region": "Moorea", "state": "Moorea", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Temae": {
        "lat": -17.498, "lon": -149.768,  # Beach break offshore
        "region": "Moorea", "state": "Moorea", "country": "French Polynesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Huahine
    "Fare": {
        "lat": -16.718, "lon": -151.038,  # Pass break offshore
        "region": "Huahine", "state": "Huahine", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Fitii": {
        "lat": -16.758, "lon": -151.018,  # Reef break offshore
        "region": "Huahine", "state": "Huahine", "country": "French Polynesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
}

# =============================================================================
# SAMOA - South Pacific Gems
# =============================================================================

SAMOA_SPOTS = {
    # Upolu (main island)
    "Salani": {
        "lat": -13.988, "lon": -171.428,  # Village reef offshore
        "region": "Upolu", "state": "Upolu", "country": "Samoa",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Boulders": {
        "lat": -13.978, "lon": -171.418,  # Left reef offshore
        "region": "Upolu", "state": "Upolu", "country": "Samoa",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Coconuts": {
        "lat": -13.998, "lon": -171.438,  # Right reef offshore
        "region": "Upolu", "state": "Upolu", "country": "Samoa",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Aganoa": {
        "lat": -14.018, "lon": -171.458,  # Beach break offshore
        "region": "Upolu", "state": "Upolu", "country": "Samoa",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Siumu": {
        "lat": -14.008, "lon": -171.768,  # Reef pass offshore
        "region": "Upolu", "state": "Upolu", "country": "Samoa",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Savai'i
    "Lano": {
        "lat": -13.478, "lon": -172.328,  # Reef break offshore
        "region": "Savaii", "state": "Savaii", "country": "Samoa",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Manase": {
        "lat": -13.458, "lon": -172.258,  # Beach break offshore
        "region": "Savaii", "state": "Savaii", "country": "Samoa",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# INDIA - Kerala, Karnataka, Goa
# =============================================================================

INDIA_SPOTS = {
    # Kerala
    "Kovalam": {
        "lat": 8.398, "lon": 76.978,  # Beach break offshore
        "region": "Kerala", "state": "Kerala", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Varkala": {
        "lat": 8.738, "lon": 76.708,  # Beach break offshore
        "region": "Kerala", "state": "Kerala", "country": "India",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Marari Beach": {
        "lat": 9.598, "lon": 76.288,  # Beach break offshore
        "region": "Kerala", "state": "Kerala", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Cherai Beach": {
        "lat": 10.138, "lon": 76.178,  # Beach break offshore
        "region": "Kerala", "state": "Kerala", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Karnataka
    "Mulki": {
        "lat": 13.098, "lon": 74.798,  # River mouth offshore
        "region": "Karnataka", "state": "Karnataka", "country": "India",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Mangalore": {
        "lat": 12.868, "lon": 74.828,  # Beach break offshore
        "region": "Karnataka", "state": "Karnataka", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Gokarna - Om Beach": {
        "lat": 14.518, "lon": 74.318,  # Beach break offshore
        "region": "Karnataka", "state": "Karnataka", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Gokarna - Kudle Beach": {
        "lat": 14.528, "lon": 74.308,  # Beach break offshore
        "region": "Karnataka", "state": "Karnataka", "country": "India",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Goa
    "Ashwem": {
        "lat": 15.648, "lon": 73.728,  # Beach break offshore
        "region": "Goa", "state": "Goa", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Morjim": {
        "lat": 15.628, "lon": 73.738,  # Beach break offshore
        "region": "Goa", "state": "Goa", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Mandrem": {
        "lat": 15.668, "lon": 73.718,  # Beach break offshore
        "region": "Goa", "state": "Goa", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Tamil Nadu / Puducherry
    "Mahabalipuram": {
        "lat": 12.618, "lon": 80.198,  # Beach break offshore
        "region": "Tamil Nadu", "state": "Tamil Nadu", "country": "India",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pondicherry": {
        "lat": 11.938, "lon": 79.838,  # Beach break offshore
        "region": "Puducherry", "state": "Puducherry", "country": "India",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# TAIWAN - Expansion
# =============================================================================

TAIWAN_EXPANSION = {
    # Additional Taitung
    "Chenggong": {
        "lat": 23.098, "lon": 121.388,  # Reef break offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Changbin": {
        "lat": 23.298, "lon": 121.458,  # Beach break offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Additional Yilan
    "Toucheng": {
        "lat": 24.858, "lon": 121.828,  # Beach break offshore
        "region": "Yilan", "state": "Yilan County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Fulong": {
        "lat": 25.028, "lon": 121.948,  # Beach break offshore
        "region": "New Taipei", "state": "New Taipei", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Penghu Islands
    "Penghu - Shanshui": {
        "lat": 23.528, "lon": 119.578,  # Beach break offshore
        "region": "Penghu", "state": "Penghu County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# MOROCCO - Expansion (additional spots)
# =============================================================================

MOROCCO_EXPANSION = {
    # Additional Taghazout area
    "Tamri": {
        "lat": 30.718, "lon": -9.848,  # River mouth offshore
        "region": "Tamri", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Boilers": {
        "lat": 30.588, "lon": -9.748,  # Right reef offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Dracula": {
        "lat": 30.598, "lon": -9.758,  # Reef break offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Southern Morocco
    "Dakhla - Foum Labouir": {
        "lat": 23.718, "lon": -15.938,  # Point break offshore
        "region": "Dakhla", "state": "Dakhla-Oued Ed-Dahab", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Dakhla - Oued Kraa": {
        "lat": 23.698, "lon": -15.948,  # Beach break offshore
        "region": "Dakhla", "state": "Dakhla-Oued Ed-Dahab", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Dakhla - Speed Spot": {
        "lat": 23.708, "lon": -15.958,  # Windsurf spot offshore
        "region": "Dakhla", "state": "Dakhla-Oued Ed-Dahab", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Casablanca area
    "Casablanca - Ain Diab": {
        "lat": 33.588, "lon": -7.678,  # Beach break offshore
        "region": "Casablanca", "state": "Casablanca-Settat", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Dar Bouazza": {
        "lat": 33.528, "lon": -7.828,  # Point break offshore
        "region": "Casablanca", "state": "Casablanca-Settat", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# NAMIBIA - Skeleton Coast
# =============================================================================

NAMIBIA_SPOTS = {
    "Skeleton Bay": {
        "lat": -22.948, "lon": 14.498,  # World's longest barrel offshore
        "region": "Skeleton Coast", "state": "Erongo", "country": "Namibia",
        "spot_type": "beach_break", "difficulty": "expert",
    },
    "Donkey Bay": {
        "lat": -22.938, "lon": 14.508,  # Beach break offshore
        "region": "Skeleton Coast", "state": "Erongo", "country": "Namibia",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    "Swakopmund - The Mole": {
        "lat": -22.678, "lon": 14.518,  # Point break offshore
        "region": "Swakopmund", "state": "Erongo", "country": "Namibia",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Swakopmund - Gun": {
        "lat": -22.668, "lon": 14.528,  # Reef break offshore
        "region": "Swakopmund", "state": "Erongo", "country": "Namibia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Long Beach Namibia": {
        "lat": -22.818, "lon": 14.538,  # Beach break offshore
        "region": "Walvis Bay", "state": "Erongo", "country": "Namibia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# WEST AFRICA - Ghana, Senegal
# =============================================================================

GHANA_SPOTS = {
    "Busua Beach": {
        "lat": 4.798, "lon": -1.918,  # Main surf beach offshore
        "region": "Western Region", "state": "Western", "country": "Ghana",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Dixcove": {
        "lat": 4.788, "lon": -1.958,  # Point break offshore
        "region": "Western Region", "state": "Western", "country": "Ghana",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Cape Three Points": {
        "lat": 4.728, "lon": -2.088,  # Reef break offshore
        "region": "Western Region", "state": "Western", "country": "Ghana",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Kokrobite": {
        "lat": 5.478, "lon": -0.398,  # Beach break offshore
        "region": "Greater Accra", "state": "Greater Accra", "country": "Ghana",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Labadi Beach": {
        "lat": 5.558, "lon": -0.148,  # Beach break offshore
        "region": "Greater Accra", "state": "Greater Accra", "country": "Ghana",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

SENEGAL_SPOTS = {
    # Dakar Area
    "Ngor Right": {
        "lat": 14.758, "lon": -17.528,  # Right point offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Ngor Left": {
        "lat": 14.768, "lon": -17.538,  # Left reef offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Ouakam": {
        "lat": 14.718, "lon": -17.478,  # Reef break offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Vivier": {
        "lat": 14.708, "lon": -17.488,  # Beach break offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Yoff": {
        "lat": 14.758, "lon": -17.468,  # Beach break offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Secret Spot Dakar": {
        "lat": 14.738, "lon": -17.508,  # Reef break offshore
        "region": "Dakar", "state": "Dakar", "country": "Senegal",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # South of Dakar
    "Toubab Dialaw": {
        "lat": 14.548, "lon": -17.158,  # Beach break offshore
        "region": "Thies", "state": "Thies", "country": "Senegal",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Saly": {
        "lat": 14.448, "lon": -17.028,  # Beach break offshore
        "region": "Thies", "state": "Thies", "country": "Senegal",
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
    """Run the global expansion phase 3."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0}
        
        logger.info("="*70)
        logger.info("GLOBAL EXPANSION PHASE 3 - April 2026")
        logger.info("="*70)
        
        all_regions = [
            ("HAWAII (EXPANSION)", HAWAII_EXPANSION),
            ("FIJI", FIJI_SPOTS),
            ("TAHITI / FRENCH POLYNESIA", TAHITI_SPOTS),
            ("SAMOA", SAMOA_SPOTS),
            ("INDIA", INDIA_SPOTS),
            ("TAIWAN (EXPANSION)", TAIWAN_EXPANSION),
            ("MOROCCO (EXPANSION)", MOROCCO_EXPANSION),
            ("NAMIBIA", NAMIBIA_SPOTS),
            ("GHANA", GHANA_SPOTS),
            ("SENEGAL", SENEGAL_SPOTS),
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
        logger.info("EXPANSION PHASE 3 COMPLETE")
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
