"""
GLOBAL MEGA EXPANSION - April 2026
=============================================
COVERAGE:
- Northern California (complete Surfline coverage)
- Texas (Gulf Coast complete)
- Mexico (expanded Pacific/Caribbean)
- Southeast Asia: Thailand, Vietnam, Philippines expansion
- Europe: Spain (Basque, Canary Islands), Morocco
- Africa: South Africa complete
- Caribbean: Turks & Caicos, Barbados expansion

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
# NORTHERN CALIFORNIA - Complete Surfline Coverage
# Missing: Humboldt, Mendocino, Sonoma, more SF Bay Area
# =============================================================================

NORTHERN_CALIFORNIA_SPOTS = {
    # Humboldt County (Far North)
    "Shelter Cove": {
        "lat": 40.028, "lon": -124.078,  # Black Sand Beach offshore
        "region": "Humboldt", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    "Centerville Beach": {
        "lat": 40.568, "lon": -124.358,  # Beach break offshore
        "region": "Humboldt", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Camel Rock": {
        "lat": 41.058, "lon": -124.138,  # Trinidad area offshore
        "region": "Humboldt", "state": "California", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Moonstone Beach Humboldt": {
        "lat": 41.048, "lon": -124.128,  # Beach break offshore
        "region": "Humboldt", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Mendocino County
    "Fort Bragg - Glass Beach": {
        "lat": 39.458, "lon": -123.818,  # Beach break offshore
        "region": "Mendocino", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Caspar Headlands": {
        "lat": 39.358, "lon": -123.828,  # Point break offshore
        "region": "Mendocino", "state": "California", "country": "USA",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Big River Mouth": {
        "lat": 39.308, "lon": -123.808,  # River mouth offshore
        "region": "Mendocino", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Arena Cove": {
        "lat": 38.918, "lon": -123.718,  # Point Arena offshore
        "region": "Mendocino", "state": "California", "country": "USA",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    
    # Sonoma County
    "Salmon Creek": {
        "lat": 38.358, "lon": -123.078,  # Beach break offshore
        "region": "Sonoma", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Doran Beach": {
        "lat": 38.318, "lon": -123.048,  # Bodega Bay offshore
        "region": "Sonoma", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Goat Rock": {
        "lat": 38.448, "lon": -123.128,  # Russian River mouth offshore
        "region": "Sonoma", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    
    # Marin County (additional)
    "Rodeo Beach": {
        "lat": 37.838, "lon": -122.548,  # Marin Headlands offshore
        "region": "Marin", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Muir Beach": {
        "lat": 37.868, "lon": -122.578,  # Beach break offshore
        "region": "Marin", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # San Francisco (additional)
    "Fort Point": {
        "lat": 37.808, "lon": -122.478,  # Under Golden Gate offshore
        "region": "San Francisco", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    "Kelly's Cove": {
        "lat": 37.768, "lon": -122.518,  # South OB offshore
        "region": "San Francisco", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    "Sloat Boulevard": {
        "lat": 37.738, "lon": -122.508,  # OB south section offshore
        "region": "San Francisco", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "advanced",
    },
    
    # Half Moon Bay (additional)
    "Montara State Beach": {
        "lat": 37.548, "lon": -122.518,  # Beach break offshore
        "region": "San Mateo", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pacifica - Rockaway": {
        "lat": 37.608, "lon": -122.498,  # Sheltered cove offshore
        "region": "San Mateo", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Princeton Jetty": {
        "lat": 37.498, "lon": -122.488,  # Pillar Point Harbor offshore
        "region": "Half Moon Bay", "state": "California", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
    },
    "Ross's Cove": {
        "lat": 37.488, "lon": -122.498,  # Near Mavericks offshore
        "region": "Half Moon Bay", "state": "California", "country": "USA",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Santa Cruz (additional)
    "Cowell's Beach": {
        "lat": 36.958, "lon": -122.028,  # Beginner wave offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "The Hook": {
        "lat": 36.958, "lon": -121.968,  # Live Oak offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Capitola": {
        "lat": 36.978, "lon": -121.958,  # Beach break offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "New Brighton": {
        "lat": 36.978, "lon": -121.938,  # State beach offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Manresa": {
        "lat": 36.938, "lon": -121.858,  # State beach offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Sunset State Beach": {
        "lat": 36.898, "lon": -121.838,  # Beach break offshore
        "region": "Santa Cruz", "state": "California", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# TEXAS - Complete Gulf Coast Coverage
# =============================================================================

TEXAS_SPOTS = {
    # Galveston Area
    "Galveston Seawall": {
        "lat": 29.288, "lon": -94.788,  # Seawall break offshore
        "region": "Galveston", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Galveston - 37th Street": {
        "lat": 29.268, "lon": -94.838,  # Beach break offshore
        "region": "Galveston", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Jamaica Beach": {
        "lat": 29.188, "lon": -94.978,  # Beach break offshore
        "region": "Galveston", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "San Luis Pass": {
        "lat": 29.088, "lon": -95.128,  # Pass break offshore
        "region": "Galveston", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Brazoria County
    "Quintana Beach": {
        "lat": 28.918, "lon": -95.318,  # Beach break offshore
        "region": "Brazoria", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Bryan Beach": {
        "lat": 28.888, "lon": -95.368,  # State park offshore
        "region": "Brazoria", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Port Aransas / Corpus Christi
    "Port Aransas - Beach Access 1": {
        "lat": 27.838, "lon": -97.058,  # North Port A offshore
        "region": "Port Aransas", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Port Aransas Jetty": {
        "lat": 27.818, "lon": -97.048,  # South jetty offshore
        "region": "Port Aransas", "state": "Texas", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
    },
    "Mustang Island": {
        "lat": 27.688, "lon": -97.158,  # State park offshore
        "region": "Corpus Christi", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Padre Island National Seashore": {
        "lat": 27.428, "lon": -97.298,  # National seashore offshore
        "region": "Corpus Christi", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # South Padre
    "South Padre - Beach Access 5": {
        "lat": 26.118, "lon": -97.168,  # Main beach offshore
        "region": "South Padre", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "South Padre - Jetties": {
        "lat": 26.068, "lon": -97.158,  # Jetty break offshore
        "region": "South Padre", "state": "Texas", "country": "USA",
        "spot_type": "jetty_break", "difficulty": "intermediate",
    },
    "Isla Blanca Park": {
        "lat": 26.058, "lon": -97.168,  # South tip offshore
        "region": "South Padre", "state": "Texas", "country": "USA",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# MEXICO - Expanded Pacific & Caribbean
# =============================================================================

MEXICO_EXPANSION = {
    # Baja California Norte
    "Ensenada - San Miguel": {
        "lat": 31.878, "lon": -116.678,  # Right point offshore
        "region": "Baja California", "state": "Baja California", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "K-38": {
        "lat": 32.238, "lon": -117.088,  # Beach break offshore
        "region": "Baja California", "state": "Baja California", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "K-55": {
        "lat": 32.148, "lon": -117.058,  # Beach break offshore
        "region": "Baja California", "state": "Baja California", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Rosarito": {
        "lat": 32.368, "lon": -117.068,  # Beach break offshore
        "region": "Baja California", "state": "Baja California", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Popotla": {
        "lat": 32.338, "lon": -117.058,  # Point break offshore
        "region": "Baja California", "state": "Baja California", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    
    # Baja California Sur (additional)
    "Scorpion Bay - First Point": {
        "lat": 27.298, "lon": -114.998,  # World's longest right offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Scorpion Bay - Second Point": {
        "lat": 27.308, "lon": -115.008,  # Second section offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "La Bocana": {
        "lat": 23.728, "lon": -110.268,  # River mouth offshore
        "region": "Baja California Sur", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Monuments": {
        "lat": 22.948, "lon": -109.738,  # Los Cabos reef offshore
        "region": "Los Cabos", "state": "Baja California Sur", "country": "Mexico",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Mainland Mexico Pacific
    "Mazatlan - Olas Altas": {
        "lat": 23.218, "lon": -106.438,  # Beach break offshore
        "region": "Sinaloa", "state": "Sinaloa", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Nexpa": {
        "lat": 18.138, "lon": -102.788,  # Point break offshore
        "region": "Michoacan", "state": "Michoacan", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Pascuales": {
        "lat": 18.738, "lon": -103.958,  # Heavy beach break offshore
        "region": "Colima", "state": "Colima", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "expert",
    },
    "Boca de Pascuales": {
        "lat": 18.748, "lon": -103.968,  # River mouth offshore
        "region": "Colima", "state": "Colima", "country": "Mexico",
        "spot_type": "river_mouth", "difficulty": "advanced",
    },
    "Rio Nexpa": {
        "lat": 18.148, "lon": -102.798,  # River mouth offshore
        "region": "Michoacan", "state": "Michoacan", "country": "Mexico",
        "spot_type": "river_mouth", "difficulty": "intermediate",
    },
    "Troncones": {
        "lat": 17.788, "lon": -101.728,  # Beach break offshore
        "region": "Guerrero", "state": "Guerrero", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Saladita": {
        "lat": 17.798, "lon": -101.758,  # Long left point offshore
        "region": "Guerrero", "state": "Guerrero", "country": "Mexico",
        "spot_type": "point_break", "difficulty": "beginner",
    },
    
    # Caribbean Mexico
    "Tulum": {
        "lat": 20.218, "lon": -87.428,  # Beach break offshore
        "region": "Quintana Roo", "state": "Quintana Roo", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Playa del Carmen": {
        "lat": 20.628, "lon": -87.068,  # Beach break offshore
        "region": "Quintana Roo", "state": "Quintana Roo", "country": "Mexico",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# THAILAND - Gulf of Thailand & Andaman Sea
# =============================================================================

THAILAND_SPOTS = {
    # Phuket (Andaman Sea - West Coast)
    "Kata Beach": {
        "lat": 7.818, "lon": 98.298,  # Main beach offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Kata Noi": {
        "lat": 7.808, "lon": 98.298,  # South Kata offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Kalim Beach": {
        "lat": 7.908, "lon": 98.288,  # Reef break offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Surin Beach": {
        "lat": 7.978, "lon": 98.278,  # Beach break offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Nai Harn": {
        "lat": 7.778, "lon": 98.308,  # Beach break offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Bang Tao": {
        "lat": 8.008, "lon": 98.288,  # Long beach offshore
        "region": "Phuket", "state": "Phuket", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Khao Lak
    "Khao Lak Beach": {
        "lat": 8.648, "lon": 98.238,  # Beach break offshore
        "region": "Phang Nga", "state": "Phang Nga", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Pakarang Beach": {
        "lat": 8.738, "lon": 98.238,  # Beach break offshore
        "region": "Phang Nga", "state": "Phang Nga", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Krabi
    "Ao Nang": {
        "lat": 8.038, "lon": 98.828,  # Beach break offshore
        "region": "Krabi", "state": "Krabi", "country": "Thailand",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# VIETNAM - Emerging Surf Destination
# =============================================================================

VIETNAM_SPOTS = {
    # Da Nang / Central Vietnam
    "My Khe Beach": {
        "lat": 16.048, "lon": 108.248,  # Beach break offshore
        "region": "Da Nang", "state": "Da Nang", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Non Nuoc Beach": {
        "lat": 15.998, "lon": 108.278,  # Beach break offshore
        "region": "Da Nang", "state": "Da Nang", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "China Beach": {
        "lat": 16.018, "lon": 108.268,  # Historic surf spot offshore
        "region": "Da Nang", "state": "Da Nang", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Nha Trang
    "Nha Trang Beach": {
        "lat": 12.248, "lon": 109.198,  # Main beach offshore
        "region": "Nha Trang", "state": "Khanh Hoa", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Bai Dai": {
        "lat": 12.288, "lon": 109.138,  # Long beach offshore
        "region": "Nha Trang", "state": "Khanh Hoa", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Mui Ne
    "Mui Ne Beach": {
        "lat": 10.948, "lon": 108.288,  # Kite/surf beach offshore
        "region": "Mui Ne", "state": "Binh Thuan", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Vung Tau
    "Vung Tau - Back Beach": {
        "lat": 10.348, "lon": 107.088,  # Beach break offshore
        "region": "Vung Tau", "state": "Ba Ria-Vung Tau", "country": "Vietnam",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# PHILIPPINES - Expansion
# =============================================================================

PHILIPPINES_EXPANSION = {
    # Siargao (additional)
    "Cloud 9 - Inside": {
        "lat": 9.858, "lon": 126.178,  # Inside section offshore
        "region": "Siargao", "state": "Surigao del Norte", "country": "Philippines",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Tuason Point": {
        "lat": 9.868, "lon": 126.188,  # Left reef offshore
        "region": "Siargao", "state": "Surigao del Norte", "country": "Philippines",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Rock Island": {
        "lat": 9.848, "lon": 126.168,  # Right reef offshore
        "region": "Siargao", "state": "Surigao del Norte", "country": "Philippines",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Stimpy's": {
        "lat": 9.878, "lon": 126.198,  # Beach break offshore
        "region": "Siargao", "state": "Surigao del Norte", "country": "Philippines",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Jacking Horse": {
        "lat": 9.838, "lon": 126.158,  # Reef break offshore
        "region": "Siargao", "state": "Surigao del Norte", "country": "Philippines",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    
    # Baler
    "Sabang Beach": {
        "lat": 15.758, "lon": 121.568,  # Main Baler beach offshore
        "region": "Baler", "state": "Aurora", "country": "Philippines",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Cemento": {
        "lat": 15.768, "lon": 121.578,  # Reef break offshore
        "region": "Baler", "state": "Aurora", "country": "Philippines",
        "spot_type": "reef_break", "difficulty": "intermediate",
    },
    "Charlie's Point": {
        "lat": 15.748, "lon": 121.558,  # Point break offshore
        "region": "Baler", "state": "Aurora", "country": "Philippines",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    
    # Zambales
    "Crystal Beach": {
        "lat": 15.478, "lon": 119.938,  # Beach break offshore
        "region": "Zambales", "state": "Zambales", "country": "Philippines",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Liwa-Liwa": {
        "lat": 15.488, "lon": 119.928,  # Beach break offshore
        "region": "Zambales", "state": "Zambales", "country": "Philippines",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

from global_mega_expansion_data_part2 import *



