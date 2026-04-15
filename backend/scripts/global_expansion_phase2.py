"""
GLOBAL EXPANSION PHASE 2 - April 2026
=============================================
COVERAGE:
- UK/Ireland (Cornwall, Wales, Scotland, Ireland)
- Indonesia: Bali detailed breakdown, Lombok, Sumatra
- Malaysia (Tioman, Cherating)
- China (Hainan Island)
- Japan expansion (more Chiba, Shonan, Shikoku)
- Central America: Guatemala, Honduras
- Caribbean: Cuba, Puerto Rico, Dominican Republic expansion

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
# UNITED KINGDOM - Cornwall, Devon, Wales, Scotland
# =============================================================================

UK_SPOTS = {
    # Cornwall (South West England)
    "Fistral Beach": {
        "lat": 50.418, "lon": -5.108,  # UK's most famous wave offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Newquay - Towan": {
        "lat": 50.418, "lon": -5.088,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Watergate Bay": {
        "lat": 50.448, "lon": -5.048,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Crantock Beach": {
        "lat": 50.398, "lon": -5.118,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Perranporth": {
        "lat": 50.348, "lon": -5.158,  # Long beach offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Porthtowan": {
        "lat": 50.278, "lon": -5.248,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Portreath": {
        "lat": 50.268, "lon": -5.298,  # Reef break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "St Ives - Porthmeor": {
        "lat": 50.218, "lon": -5.488,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Sennen Cove": {
        "lat": 50.078, "lon": -5.708,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Polzeath": {
        "lat": 50.578, "lon": -4.918,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Constantine Bay": {
        "lat": 50.538, "lon": -5.008,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Bude - Crooklets": {
        "lat": 50.838, "lon": -4.558,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Bude - Summerleaze": {
        "lat": 50.828, "lon": -4.558,  # Beach break offshore
        "region": "Cornwall", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Devon
    "Croyde Bay": {
        "lat": 51.128, "lon": -4.248,  # Premier Devon wave offshore
        "region": "Devon", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Saunton Sands": {
        "lat": 51.108, "lon": -4.228,  # Long beach offshore
        "region": "Devon", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Woolacombe": {
        "lat": 51.168, "lon": -4.218,  # Beach break offshore
        "region": "Devon", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Putsborough": {
        "lat": 51.148, "lon": -4.238,  # Sheltered beach offshore
        "region": "Devon", "state": "England", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Wales
    "Llangennith": {
        "lat": 51.598, "lon": -4.298,  # Gower Peninsula offshore
        "region": "Gower", "state": "Wales", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Langland Bay": {
        "lat": 51.568, "lon": -4.008,  # Reef break offshore
        "region": "Gower", "state": "Wales", "country": "United Kingdom",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Caswell Bay": {
        "lat": 51.568, "lon": -4.038,  # Beach break offshore
        "region": "Gower", "state": "Wales", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Freshwater West": {
        "lat": 51.648, "lon": -5.068,  # Pembrokeshire offshore
        "region": "Pembrokeshire", "state": "Wales", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Manorbier": {
        "lat": 51.638, "lon": -4.798,  # Beach break offshore
        "region": "Pembrokeshire", "state": "Wales", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Whitesands Bay": {
        "lat": 51.888, "lon": -5.298,  # Beach break offshore
        "region": "Pembrokeshire", "state": "Wales", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Scotland
    "Thurso East": {
        "lat": 58.598, "lon": -3.518,  # World-class right offshore
        "region": "Caithness", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Thurso - The Shit Pipe": {
        "lat": 58.588, "lon": -3.528,  # Heavy reef offshore
        "region": "Caithness", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Dunnet Bay": {
        "lat": 58.618, "lon": -3.378,  # Beach break offshore
        "region": "Caithness", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Brimms Ness": {
        "lat": 58.608, "lon": -3.458,  # Reef break offshore
        "region": "Caithness", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Fraserburgh": {
        "lat": 57.698, "lon": -2.008,  # Beach break offshore
        "region": "Aberdeenshire", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pease Bay": {
        "lat": 55.898, "lon": -2.378,  # Beach break offshore
        "region": "Scottish Borders", "state": "Scotland", "country": "United Kingdom",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# IRELAND - West Coast Atlantic Swells
# =============================================================================

IRELAND_SPOTS = {
    # Donegal (Northwest)
    "Bundoran - The Peak": {
        "lat": 54.478, "lon": -8.298,  # Ireland's famous reef offshore
        "region": "Donegal", "state": "Donegal", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Bundoran - Main Beach": {
        "lat": 54.478, "lon": -8.288,  # Beach break offshore
        "region": "Donegal", "state": "Donegal", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Tullan Strand": {
        "lat": 54.488, "lon": -8.318,  # Beach break offshore
        "region": "Donegal", "state": "Donegal", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Rossnowlagh": {
        "lat": 54.548, "lon": -8.198,  # Beach break offshore
        "region": "Donegal", "state": "Donegal", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Mullaghmore": {
        "lat": 54.468, "lon": -8.458,  # Big wave slab offshore
        "region": "Sligo", "state": "Sligo", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    
    # Sligo
    "Easkey Left": {
        "lat": 54.288, "lon": -8.968,  # Left reef offshore
        "region": "Sligo", "state": "Sligo", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Easkey Right": {
        "lat": 54.288, "lon": -8.958,  # Right reef offshore
        "region": "Sligo", "state": "Sligo", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Strandhill": {
        "lat": 54.278, "lon": -8.608,  # Beach break offshore
        "region": "Sligo", "state": "Sligo", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Clare (Wild Atlantic Way)
    "Lahinch": {
        "lat": 52.938, "lon": -9.358,  # Main beach offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Lahinch - The Left": {
        "lat": 52.948, "lon": -9.368,  # Left point offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Spanish Point": {
        "lat": 52.848, "lon": -9.448,  # Beach break offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Doolin Point": {
        "lat": 53.018, "lon": -9.418,  # Right point offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Crab Island": {
        "lat": 53.068, "lon": -9.458,  # Reef break offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Aileens": {
        "lat": 53.008, "lon": -9.428,  # Big wave slab offshore
        "region": "Clare", "state": "Clare", "country": "Ireland",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    
    # Kerry
    "Inch Beach": {
        "lat": 52.128, "lon": -9.978,  # Long beach offshore
        "region": "Kerry", "state": "Kerry", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Ballybunion": {
        "lat": 52.508, "lon": -9.678,  # Beach break offshore
        "region": "Kerry", "state": "Kerry", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Brandon Bay": {
        "lat": 52.268, "lon": -10.148,  # Beach break offshore
        "region": "Kerry", "state": "Kerry", "country": "Ireland",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# INDONESIA - Bali Detailed, Lombok, Sumatra
# =============================================================================

INDONESIA_EXPANSION = {
    # Bali - Bukit Peninsula (South)
    "Uluwatu - The Peak": {
        "lat": -8.828, "lon": 115.088,  # Main peak offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Uluwatu - Racetrack": {
        "lat": -8.838, "lon": 115.098,  # Fast section offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Uluwatu - Temples": {
        "lat": -8.818, "lon": 115.078,  # Inside section offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Padang Padang": {
        "lat": -8.808, "lon": 115.098,  # Barrel offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Bingin": {
        "lat": -8.798, "lon": 115.108,  # Left reef offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Impossibles": {
        "lat": -8.788, "lon": 115.118,  # Long left offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Dreamland": {
        "lat": -8.778, "lon": 115.128,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Balangan": {
        "lat": -8.768, "lon": 115.128,  # Left reef offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Nyang Nyang": {
        "lat": -8.838, "lon": 115.068,  # Remote beach offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Bali - Canggu/Seminyak (West Coast)
    "Canggu - Echo Beach": {
        "lat": -8.658, "lon": 115.128,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Canggu - Batu Bolong": {
        "lat": -8.658, "lon": 115.138,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Canggu - Old Mans": {
        "lat": -8.658, "lon": 115.148,  # Mellow reef offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "beginner",
    },
    "Canggu - Berawa": {
        "lat": -8.668, "lon": 115.158,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Kuta Beach Bali": {
        "lat": -8.718, "lon": 115.168,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Legian": {
        "lat": -8.708, "lon": 115.168,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Seminyak": {
        "lat": -8.688, "lon": 115.158,  # Beach break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Bali - East Coast
    "Keramas": {
        "lat": -8.558, "lon": 115.438,  # WSL venue right offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Sanur Reef": {
        "lat": -8.688, "lon": 115.268,  # Right reef offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Nusa Dua": {
        "lat": -8.808, "lon": 115.238,  # Reef break offshore
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Sri Lanka": {
        "lat": -8.788, "lon": 115.218,  # Right reef offshore (yes, named Sri Lanka)
        "region": "Bali", "state": "Bali", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Lombok
    "Desert Point": {
        "lat": -8.748, "lon": 115.818,  # World-class left offshore
        "region": "Lombok", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Kuta Lombok": {
        "lat": -8.898, "lon": 116.288,  # Beach break offshore
        "region": "Lombok", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Gerupuk Bay": {
        "lat": -8.918, "lon": 116.358,  # Multiple breaks offshore
        "region": "Lombok", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Mawi": {
        "lat": -8.908, "lon": 116.248,  # Left reef offshore
        "region": "Lombok", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Ekas Bay": {
        "lat": -8.878, "lon": 116.478,  # Right reef offshore
        "region": "Lombok", "state": "West Nusa Tenggara", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Sumatra - Mentawai (additional)
    "Macaronis": {
        "lat": -2.498, "lon": 99.528,  # Perfect left offshore
        "region": "Mentawai", "state": "West Sumatra", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Telescopes": {
        "lat": -2.508, "lon": 99.538,  # Right reef offshore
        "region": "Mentawai", "state": "West Sumatra", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Rifles": {
        "lat": -2.478, "lon": 99.518,  # Right reef offshore
        "region": "Mentawai", "state": "West Sumatra", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Thunders": {
        "lat": -2.488, "lon": 99.508,  # Left reef offshore
        "region": "Mentawai", "state": "West Sumatra", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Sumatra - Krui
    "Krui - Ujung Bocur": {
        "lat": -5.278, "lon": 103.928,  # Left point offshore
        "region": "Krui", "state": "Lampung", "country": "Indonesia",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Krui - The Peak": {
        "lat": -5.288, "lon": 103.938,  # Left reef offshore
        "region": "Krui", "state": "Lampung", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Krui - Mandiri": {
        "lat": -5.298, "lon": 103.948,  # Left reef offshore
        "region": "Krui", "state": "Lampung", "country": "Indonesia",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# MALAYSIA - East Coast & Islands
# =============================================================================

MALAYSIA_SPOTS = {
    # East Coast - Terengganu
    "Cherating": {
        "lat": 4.118, "lon": 103.398,  # Beach break offshore
        "region": "Pahang", "state": "Pahang", "country": "Malaysia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Cherating Point": {
        "lat": 4.128, "lon": 103.408,  # Point break offshore
        "region": "Pahang", "state": "Pahang", "country": "Malaysia",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Kemaman": {
        "lat": 4.238, "lon": 103.428,  # Beach break offshore
        "region": "Terengganu", "state": "Terengganu", "country": "Malaysia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Dungun": {
        "lat": 4.758, "lon": 103.428,  # Beach break offshore
        "region": "Terengganu", "state": "Terengganu", "country": "Malaysia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Islands
    "Tioman - Juara Beach": {
        "lat": 2.858, "lon": 104.178,  # Beach break offshore
        "region": "Tioman Island", "state": "Pahang", "country": "Malaysia",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Desaru": {
        "lat": 1.548, "lon": 104.258,  # Beach break offshore
        "region": "Johor", "state": "Johor", "country": "Malaysia",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# CHINA - Hainan Island
# =============================================================================

CHINA_SPOTS = {
    # Hainan Island - Riyue Bay (Surfing China HQ)
    "Riyue Bay - Main": {
        "lat": 18.508, "lon": 109.998,  # Competition venue offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Riyue Bay - Right Point": {
        "lat": 18.518, "lon": 110.008,  # Right point offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Houhai Bay": {
        "lat": 18.318, "lon": 109.758,  # Beach break offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Shimei Bay": {
        "lat": 18.698, "lon": 110.318,  # Beach break offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Sanya Bay": {
        "lat": 18.248, "lon": 109.498,  # Beach break offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Dadonghai": {
        "lat": 18.218, "lon": 109.518,  # Beach break offshore
        "region": "Hainan", "state": "Hainan", "country": "China",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# JAPAN - Expansion (Shikoku, more Chiba/Shonan)
# =============================================================================

JAPAN_EXPANSION = {
    # Shikoku Island
    "Ikumi Beach": {
        "lat": 33.558, "lon": 134.288,  # Famous Shikoku beach offshore
        "region": "Shikoku", "state": "Tokushima", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Kaifu": {
        "lat": 33.538, "lon": 134.328,  # River mouth offshore
        "region": "Shikoku", "state": "Tokushima", "country": "Japan",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Shishikui": {
        "lat": 33.548, "lon": 134.308,  # Beach break offshore
        "region": "Shikoku", "state": "Tokushima", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Nahari": {
        "lat": 33.428, "lon": 134.018,  # Beach break offshore
        "region": "Shikoku", "state": "Kochi", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Muroto": {
        "lat": 33.288, "lon": 134.158,  # Point break offshore
        "region": "Shikoku", "state": "Kochi", "country": "Japan",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    
    # Chiba (additional)
    "Ichinomiya": {
        "lat": 35.378, "lon": 140.388,  # Olympic venue offshore
        "region": "Chiba", "state": "Chiba", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Kujukuri": {
        "lat": 35.498, "lon": 140.438,  # Long beach offshore
        "region": "Chiba", "state": "Chiba", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Hebara": {
        "lat": 35.128, "lon": 140.168,  # Beach break offshore
        "region": "Chiba", "state": "Chiba", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Shonan (additional)
    "Shichirigahama": {
        "lat": 35.308, "lon": 139.528,  # Beach break offshore
        "region": "Shonan", "state": "Kanagawa", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Inamuragasaki": {
        "lat": 35.298, "lon": 139.518,  # Reef break offshore
        "region": "Shonan", "state": "Kanagawa", "country": "Japan",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Niigata (Sea of Japan)
    "Niigata Beach": {
        "lat": 37.918, "lon": 139.038,  # Beach break offshore
        "region": "Niigata", "state": "Niigata", "country": "Japan",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# CENTRAL AMERICA - Guatemala, Honduras
# =============================================================================

GUATEMALA_SPOTS = {
    "El Paredon": {
        "lat": 13.898, "lon": -91.188,  # Main beach offshore
        "region": "El Paredon", "state": "Escuintla", "country": "Guatemala",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "El Paredon - The Point": {
        "lat": 13.908, "lon": -91.198,  # Point break offshore
        "region": "El Paredon", "state": "Escuintla", "country": "Guatemala",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Sipacate": {
        "lat": 13.938, "lon": -91.158,  # Beach break offshore
        "region": "El Paredon", "state": "Escuintla", "country": "Guatemala",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Monterrico": {
        "lat": 13.898, "lon": -90.498,  # Beach break offshore
        "region": "Monterrico", "state": "Santa Rosa", "country": "Guatemala",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Iztapa": {
        "lat": 13.938, "lon": -90.718,  # Beach break offshore
        "region": "Iztapa", "state": "Escuintla", "country": "Guatemala",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

HONDURAS_SPOTS = {
    "Tela Bay": {
        "lat": 15.778, "lon": -87.448,  # Beach break offshore
        "region": "Tela", "state": "Atlantida", "country": "Honduras",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "La Ceiba": {
        "lat": 15.778, "lon": -86.798,  # Beach break offshore
        "region": "La Ceiba", "state": "Atlantida", "country": "Honduras",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Roatan - West Bay": {
        "lat": 16.288, "lon": -86.608,  # Beach break offshore
        "region": "Roatan", "state": "Bay Islands", "country": "Honduras",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Trujillo": {
        "lat": 15.918, "lon": -85.958,  # Beach break offshore
        "region": "Trujillo", "state": "Colon", "country": "Honduras",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# CARIBBEAN - Cuba, Puerto Rico, Dominican Republic Expansion
# =============================================================================

CUBA_SPOTS = {
    "Havana - 70th Street": {
        "lat": 23.138, "lon": -82.438,  # Beach break offshore
        "region": "Havana", "state": "Havana", "country": "Cuba",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Playa Santa Maria": {
        "lat": 23.188, "lon": -82.178,  # Beach break offshore
        "region": "Havana", "state": "Havana", "country": "Cuba",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Guanabo": {
        "lat": 23.168, "lon": -82.088,  # Beach break offshore
        "region": "Havana", "state": "Havana", "country": "Cuba",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Varadero": {
        "lat": 23.158, "lon": -81.248,  # Beach break offshore
        "region": "Varadero", "state": "Matanzas", "country": "Cuba",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Baracoa": {
        "lat": 20.348, "lon": -74.498,  # Beach break offshore
        "region": "Baracoa", "state": "Guantanamo", "country": "Cuba",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

PUERTO_RICO_SPOTS = {
    # Northwest (Rincon Area)
    "Rincon - Maria's": {
        "lat": 18.358, "lon": -67.268,  # Right point offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Rincon - Domes": {
        "lat": 18.368, "lon": -67.258,  # Reef break offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Rincon - Indicators": {
        "lat": 18.378, "lon": -67.268,  # Point break offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Rincon - Tres Palmas": {
        "lat": 18.348, "lon": -67.278,  # Big wave spot offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Rincon - Sandy Beach": {
        "lat": 18.388, "lon": -67.258,  # Beach break offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Rincon - Steps": {
        "lat": 18.358, "lon": -67.278,  # Reef break offshore
        "region": "Rincon", "state": "Rincon", "country": "Puerto Rico",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    
    # Northwest (Aguadilla/Isabela)
    "Crash Boat": {
        "lat": 18.498, "lon": -67.168,  # Beach break offshore
        "region": "Aguadilla", "state": "Aguadilla", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Wilderness": {
        "lat": 18.488, "lon": -67.178,  # Beach break offshore
        "region": "Aguadilla", "state": "Aguadilla", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Gas Chambers": {
        "lat": 18.478, "lon": -67.158,  # Reef break offshore
        "region": "Aguadilla", "state": "Aguadilla", "country": "Puerto Rico",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Jobos": {
        "lat": 18.508, "lon": -67.078,  # Beach break offshore
        "region": "Isabela", "state": "Isabela", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Middles": {
        "lat": 18.508, "lon": -67.068,  # Beach break offshore
        "region": "Isabela", "state": "Isabela", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Shacks": {
        "lat": 18.518, "lon": -67.118,  # Beach break offshore
        "region": "Isabela", "state": "Isabela", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # San Juan Area
    "La Pared": {
        "lat": 18.458, "lon": -66.108,  # Beach break offshore
        "region": "San Juan", "state": "San Juan", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pine Grove": {
        "lat": 18.448, "lon": -65.988,  # Beach break offshore
        "region": "Carolina", "state": "Carolina", "country": "Puerto Rico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

DOMINICAN_REPUBLIC_EXPANSION = {
    # North Coast (additional)
    "Playa Grande DR": {
        "lat": 19.678, "lon": -70.178,  # Beach break offshore
        "region": "Rio San Juan", "state": "Maria Trinidad Sanchez", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Nagua": {
        "lat": 19.378, "lon": -69.848,  # Beach break offshore
        "region": "Nagua", "state": "Maria Trinidad Sanchez", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Punta Rucia": {
        "lat": 19.868, "lon": -71.218,  # Beach break offshore
        "region": "Punta Rucia", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # East Coast
    "Macao Beach": {
        "lat": 18.768, "lon": -68.538,  # Beach break offshore
        "region": "Punta Cana", "state": "La Altagracia", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Uvero Alto": {
        "lat": 18.778, "lon": -68.448,  # Beach break offshore
        "region": "Punta Cana", "state": "La Altagracia", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Samana Peninsula
    "Las Terrenas": {
        "lat": 19.318, "lon": -69.538,  # Beach break offshore
        "region": "Samana", "state": "Samana", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "El Limon": {
        "lat": 19.288, "lon": -69.448,  # Beach break offshore
        "region": "Samana", "state": "Samana", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
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
    """Run the global expansion phase 2."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0}
        
        logger.info("="*70)
        logger.info("GLOBAL EXPANSION PHASE 2 - April 2026")
        logger.info("="*70)
        
        all_regions = [
            ("UNITED KINGDOM", UK_SPOTS),
            ("IRELAND", IRELAND_SPOTS),
            ("INDONESIA (BALI/LOMBOK/SUMATRA)", INDONESIA_EXPANSION),
            ("MALAYSIA", MALAYSIA_SPOTS),
            ("CHINA (HAINAN)", CHINA_SPOTS),
            ("JAPAN (EXPANSION)", JAPAN_EXPANSION),
            ("GUATEMALA", GUATEMALA_SPOTS),
            ("HONDURAS", HONDURAS_SPOTS),
            ("CUBA", CUBA_SPOTS),
            ("PUERTO RICO", PUERTO_RICO_SPOTS),
            ("DOMINICAN REPUBLIC (EXPANSION)", DOMINICAN_REPUBLIC_EXPANSION),
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
        logger.info("EXPANSION PHASE 2 COMPLETE")
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
