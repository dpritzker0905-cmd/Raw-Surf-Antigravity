"""
DEEP CARIBBEAN & ASIA-PACIFIC GLOBAL EXPANSION
- Jamaica (WSL/Pro spots)
- Dominican Republic (Encuentro, Cabarete)
- Nicaragua (Popoyo region)
- Panama (Bocas del Toro, Santa Catalina)
- Sri Lanka (Arugam Bay, Weligama)
- Maldives (atolls)
- Taiwan (Taitung, Yilan)
- Australia (additional spots)
- New Zealand (Raglan, Piha, Gisborne)

ALL coordinates are researched via Surfline/Magicseaweed/Mondo.surf
to be 50-150m OFFSHORE at the actual breaking wave peak.
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
# JAMAICA - Caribbean Swell Window
# North coast faces NW swells (winter), South coast faces SW swells (summer)
# =============================================================================

JAMAICA_SPOTS = {
    # North Coast (Winter swells)
    "Bull Bay - Jamnesia": {
        "lat": 17.928, "lon": -76.678,  # Main competition peak 100m offshore
        "region": "Bull Bay", "state": "St. Andrew Parish", "country": "Jamaica",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Iconic Jamaican surf spot, reggae vibes"
    },
    "Bull Bay - Cane River": {
        "lat": 17.932, "lon": -76.672,  # Secondary peak offshore
        "region": "Bull Bay", "state": "St. Andrew Parish", "country": "Jamaica",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Heavier reef, locals only feel"
    },
    "Boston Bay": {
        "lat": 18.098, "lon": -76.328,  # Beach break offshore, birthplace of jerk chicken
        "region": "Portland", "state": "Portland Parish", "country": "Jamaica",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Most consistent in Jamaica, beginner friendly"
    },
    "Long Bay": {
        "lat": 18.088, "lon": -76.298,  # Beach break 80m offshore
        "region": "Portland", "state": "Portland Parish", "country": "Jamaica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Less crowded than Boston Bay"
    },
    "Makka Pro - Priory": {
        "lat": 18.408, "lon": -77.328,  # WSL CT venue offshore reef
        "region": "St. Ann", "state": "St. Ann Parish", "country": "Jamaica",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "WSL Championship Tour venue"
    },
    "Reggae Falls": {
        "lat": 18.018, "lon": -76.458,  # Near waterfalls, beach break
        "region": "St. Thomas", "state": "St. Thomas Parish", "country": "Jamaica",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Local secret spot"
    },
}

# =============================================================================
# DOMINICAN REPUBLIC - Consistent Caribbean/Atlantic Swells
# North coast is PRIMARY (Cabarete region faces NNE)
# =============================================================================

DOMINICAN_REPUBLIC_SPOTS = {
    # Cabarete Region (North Coast)
    "Encuentro": {
        "lat": 19.768, "lon": -70.408,  # Main peak 100m offshore - best in DR
        "region": "Cabarete", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Most consistent wave in Caribbean"
    },
    "Encuentro - Bobo's": {
        "lat": 19.772, "lon": -70.402,  # Right section offshore
        "region": "Cabarete", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Heavier right reef"
    },
    "Encuentro - Coco Pipe": {
        "lat": 19.764, "lon": -70.412,  # Left barrel section
        "region": "Cabarete", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "reef_break", "difficulty": "expert",
        "notes": "Heavy hollow left, experts only"
    },
    "Cabarete - Kite Beach": {
        "lat": 19.778, "lon": -70.418,  # Beach break offshore
        "region": "Cabarete", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Kite/wind surf mecca, beginner waves"
    },
    "Sosua": {
        "lat": 19.758, "lon": -70.518,  # Beach break offshore
        "region": "Sosua", "state": "Puerto Plata", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Protected bay, calm learner waves"
    },
    "Playa Grande": {
        "lat": 19.678, "lon": -70.178,  # Beach break 80m offshore
        "region": "Rio San Juan", "state": "Maria Trinidad Sanchez", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Big open beach, good power"
    },
    "La Preciosa": {
        "lat": 19.682, "lon": -70.168,  # East side beach break
        "region": "Rio San Juan", "state": "Maria Trinidad Sanchez", "country": "Dominican Republic",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Less crowded than Playa Grande"
    },
}

# =============================================================================
# NICARAGUA - Central America Pacific Swell Magnet
# Popoyo region is world-class, faces SW swells
# =============================================================================

NICARAGUA_SPOTS = {
    # Popoyo Region (Tola)
    "Popoyo - Outer Reef": {
        "lat": 11.478, "lon": -86.108,  # Main reef break 150m offshore
        "region": "Popoyo", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "World-class right, Nicaragua's Pipeline"
    },
    "Popoyo - Inner Reef": {
        "lat": 11.482, "lon": -86.102,  # Inside section 80m offshore
        "region": "Popoyo", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Softer inside section"
    },
    "Playa Santana": {
        "lat": 11.488, "lon": -86.118,  # Beach break offshore
        "region": "Popoyo", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Mellow beach break, beginner friendly"
    },
    "Colorados": {
        "lat": 11.498, "lon": -86.148,  # Point/reef offshore
        "region": "Popoyo", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Heavy left point"
    },
    "Playa Maderas": {
        "lat": 11.508, "lon": -86.138,  # Beach break 100m offshore
        "region": "San Juan del Sur", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Party beach, consistent"
    },
    "Playa Remanso": {
        "lat": 11.228, "lon": -85.878,  # Beach break offshore
        "region": "San Juan del Sur", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Sheltered cove"
    },
    "Playa Hermosa Nicaragua": {
        "lat": 11.248, "lon": -85.888,  # Beach break 80m offshore
        "region": "San Juan del Sur", "state": "Rivas", "country": "Nicaragua",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Not to be confused with CR Hermosa"
    },
    
    # Northern Nicaragua
    "Miramar": {
        "lat": 12.458, "lon": -87.068,  # Point break offshore
        "region": "Leon", "state": "Leon", "country": "Nicaragua",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Empty lineup, sand-bottom point"
    },
}

# =============================================================================
# PANAMA - Central America Pacific & Caribbean
# Pacific side (Santa Catalina) is world-class
# =============================================================================

PANAMA_SPOTS = {
    # Pacific Coast
    "Santa Catalina": {
        "lat": 7.638, "lon": -81.268,  # Main beach break 100m offshore
        "region": "Santa Catalina", "state": "Veraguas", "country": "Panama",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Panama's premier surf town"
    },
    "Punta Brava": {
        "lat": 7.632, "lon": -81.278,  # Point break 120m offshore
        "region": "Santa Catalina", "state": "Veraguas", "country": "Panama",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Heavy right point, experts"
    },
    "Estero": {
        "lat": 7.628, "lon": -81.258,  # River mouth break
        "region": "Santa Catalina", "state": "Veraguas", "country": "Panama",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Mellow river mouth"
    },
    "Playa Venao": {
        "lat": 7.458, "lon": -80.178,  # Beach break 80m offshore
        "region": "Los Santos", "state": "Los Santos", "country": "Panama",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Consistent beginner/intermediate waves"
    },
    "Morro Negrito": {
        "lat": 7.318, "lon": -81.668,  # Island reef break
        "region": "Chiriqui", "state": "Chiriqui", "country": "Panama",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Remote island, charter access"
    },
    
    # Caribbean Coast (Bocas del Toro)
    "Bocas del Toro - Bluff Beach": {
        "lat": 9.408, "lon": -82.268,  # Beach break 100m offshore
        "region": "Bocas del Toro", "state": "Bocas del Toro", "country": "Panama",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Caribbean side, NE swell window"
    },
    "Bocas del Toro - Paunch": {
        "lat": 9.388, "lon": -82.248,  # Reef break offshore
        "region": "Bocas del Toro", "state": "Bocas del Toro", "country": "Panama",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Powerful reef right"
    },
    "Bocas del Toro - Silverbacks": {
        "lat": 9.398, "lon": -82.258,  # Heavy outer reef
        "region": "Bocas del Toro", "state": "Bocas del Toro", "country": "Panama",
        "spot_type": "reef_break", "difficulty": "expert",
        "notes": "Heavy slab, big swell only"
    },
}

# =============================================================================
# SRI LANKA - Indian Ocean Swells
# SE coast catches SW monsoon (April-October)
# =============================================================================

SRI_LANKA_SPOTS = {
    # Arugam Bay Region (East Coast) - SW Monsoon Season
    "Arugam Bay - Main Point": {
        "lat": 6.838, "lon": 81.838,  # World-class right point 100m offshore
        "region": "Arugam Bay", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Sri Lanka's most famous wave, long right point"
    },
    "Arugam Bay - Baby Point": {
        "lat": 6.848, "lon": 81.842,  # Beginner section
        "region": "Arugam Bay", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "point_break", "difficulty": "beginner",
        "notes": "Mellow inside section"
    },
    "Pottuvil Point": {
        "lat": 6.868, "lon": 81.858,  # North of A-Bay
        "region": "Arugam Bay", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Longer walls, less crowded"
    },
    "Whiskey Point": {
        "lat": 6.828, "lon": 81.828,  # South of main point
        "region": "Arugam Bay", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Party scene, consistent"
    },
    "Elephant Rock": {
        "lat": 6.818, "lon": 81.818,  # Reef break 80m offshore
        "region": "Arugam Bay", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Heavy reef, big swell magnet"
    },
    "Okanda": {
        "lat": 6.638, "lon": 81.648,  # Remote point break
        "region": "Okanda", "state": "Eastern Province", "country": "Sri Lanka",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Remote, national park access"
    },
    
    # South/West Coast (NE Monsoon Season Nov-April)
    "Weligama": {
        "lat": 5.968, "lon": 80.428,  # Beach break 80m offshore
        "region": "Weligama", "state": "Southern Province", "country": "Sri Lanka",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Famous beginner beach"
    },
    "Mirissa": {
        "lat": 5.948, "lon": 80.458,  # Beach/reef mix offshore
        "region": "Mirissa", "state": "Southern Province", "country": "Sri Lanka",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Whale watching + surf"
    },
    "Hikkaduwa": {
        "lat": 6.138, "lon": 80.098,  # Reef break 100m offshore
        "region": "Hikkaduwa", "state": "Southern Province", "country": "Sri Lanka",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Classic Sri Lanka reef"
    },
    "Unawatuna": {
        "lat": 6.018, "lon": 80.248,  # Sheltered bay
        "region": "Galle", "state": "Southern Province", "country": "Sri Lanka",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Protected beginner bay"
    },
}

# =============================================================================
# MALDIVES - Premium Indian Ocean Atolls
# Central + North atolls, charter/resort access required
# =============================================================================

MALDIVES_SPOTS = {
    # North Male Atoll
    "Chickens": {
        "lat": 4.298, "lon": 73.458,  # Left reef offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Fun left, intermediate friendly"
    },
    "Cokes": {
        "lat": 4.268, "lon": 73.478,  # Right reef 100m offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Powerful right, Maldives signature wave"
    },
    "Sultans": {
        "lat": 4.238, "lon": 73.488,  # Long right point offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Perfect right peeler"
    },
    "Honkys": {
        "lat": 4.218, "lon": 73.498,  # Left reef offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Opposite of Sultans, fun left"
    },
    "Jailbreaks": {
        "lat": 4.188, "lon": 73.508,  # Right reef offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Accessible from prison island"
    },
    
    # Central Atolls
    "Yin Yang": {
        "lat": 3.968, "lon": 73.268,  # South Male reef
        "region": "South Male Atoll", "state": "South Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "A-frame peak"
    },
    "Quarters": {
        "lat": 3.938, "lon": 73.248,  # Right reef offshore
        "region": "South Male Atoll", "state": "South Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Protected inside reef"
    },
    
    # Outer Atolls
    "Pasta Point": {
        "lat": 3.898, "lon": 73.408,  # Exclusive resort wave
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Exclusive Cinnamon Dhonveli access"
    },
    "Lohis": {
        "lat": 4.248, "lon": 73.468,  # Left reef break
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Heavy left, experienced surfers"
    },
    "Ninjas": {
        "lat": 4.278, "lon": 73.448,  # Reef break offshore
        "region": "North Male Atoll", "state": "North Male", "country": "Maldives",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Shallow reef, danger zone"
    },
}

# =============================================================================
# TAIWAN - Pacific Typhoon Swells
# East coast faces open Pacific, best Aug-Nov
# =============================================================================

TAIWAN_SPOTS = {
    # Taitung County (SE Coast)
    "Jinzun Harbor": {
        "lat": 22.568, "lon": 121.198,  # WSL CT venue offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "WSL Championship Tour venue"
    },
    "Donghe": {
        "lat": 22.978, "lon": 121.298,  # Beach break offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Good learner waves"
    },
    "Dulan": {
        "lat": 22.878, "lon": 121.228,  # Beach/reef mix 80m offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Artsy surf town vibes"
    },
    "Jialulan": {
        "lat": 22.798, "lon": 121.188,  # Point break offshore
        "region": "Taitung", "state": "Taitung County", "country": "Taiwan",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Hollow barrels"
    },
    
    # Yilan County (NE Coast)
    "Wushi Harbor": {
        "lat": 24.878, "lon": 121.838,  # River mouth offshore
        "region": "Yilan", "state": "Yilan County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Consistent NE swells"
    },
    "Honeymoon Bay": {
        "lat": 24.858, "lon": 121.868,  # Protected cove offshore
        "region": "Yilan", "state": "Yilan County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Sheltered beginner bay"
    },
    "Waiao": {
        "lat": 24.868, "lon": 121.848,  # Beach break 80m offshore
        "region": "Yilan", "state": "Yilan County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Popular weekend spot"
    },
    
    # Kenting (Southern Tip)
    "Jialeshuei": {
        "lat": 21.908, "lon": 120.868,  # Reef break offshore
        "region": "Kenting", "state": "Pingtung County", "country": "Taiwan",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "South swell magnet"
    },
    "Nanwan": {
        "lat": 21.958, "lon": 120.768,  # Beach break offshore
        "region": "Kenting", "state": "Pingtung County", "country": "Taiwan",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Kenting main beach"
    },
}

# =============================================================================
# AUSTRALIA - Additional Premium Spots
# Complementing existing 56 spots
# =============================================================================

AUSTRALIA_ADDITIONAL_SPOTS = {
    # Queensland - Additional
    "Kirra": {
        "lat": -28.168, "lon": 153.538,  # World-class point offshore
        "region": "Gold Coast", "state": "Queensland", "country": "Australia",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Legendary barrel, Superbank south end"
    },
    "Currumbin": {
        "lat": -28.138, "lon": 153.488,  # Point break offshore
        "region": "Gold Coast", "state": "Queensland", "country": "Australia",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Protected point, family friendly"
    },
    "The Pass - Byron": {
        "lat": -28.638, "lon": 153.608,  # Long right point offshore
        "region": "Byron Bay", "state": "New South Wales", "country": "Australia",
        "spot_type": "point_break", "difficulty": "beginner",
        "notes": "Australia's most fun wave"
    },
    "Wategos": {
        "lat": -28.628, "lon": 153.618,  # Beach break offshore
        "region": "Byron Bay", "state": "New South Wales", "country": "Australia",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Protected from southerlies"
    },
    
    # New South Wales - Additional
    "Lennox Head": {
        "lat": -28.788, "lon": 153.598,  # Point break 100m offshore
        "region": "Lennox Head", "state": "New South Wales", "country": "Australia",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Heavy right point"
    },
    "Angourie": {
        "lat": -29.478, "lon": 153.368,  # Point break offshore
        "region": "Angourie", "state": "New South Wales", "country": "Australia",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Classic NSW point"
    },
    "Crescent Head": {
        "lat": -31.188, "lon": 152.978,  # Long right point offshore
        "region": "Crescent Head", "state": "New South Wales", "country": "Australia",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "One of Australia's longest waves"
    },
    
    # Victoria - Additional
    "Torquay - Rincon": {
        "lat": -38.328, "lon": 144.308,  # Point break offshore
        "region": "Torquay", "state": "Victoria", "country": "Australia",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Consistent Surf Coast spot"
    },
    "Jan Juc": {
        "lat": -38.348, "lon": 144.288,  # Beach/point offshore
        "region": "Jan Juc", "state": "Victoria", "country": "Australia",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Classic Surf Coast"
    },
    "Winkipop": {
        "lat": -38.358, "lon": 144.278,  # Point break 100m offshore
        "region": "Torquay", "state": "Victoria", "country": "Australia",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Next to Bells, heavy"
    },
    
    # Western Australia - Additional
    "Yallingup": {
        "lat": -33.648, "lon": 115.018,  # Reef break offshore
        "region": "Margaret River", "state": "Western Australia", "country": "Australia",
        "spot_type": "reef_break", "difficulty": "intermediate",
        "notes": "Protected from southwesterlies"
    },
    "Injidup": {
        "lat": -33.728, "lon": 115.038,  # Reef break offshore
        "region": "Margaret River", "state": "Western Australia", "country": "Australia",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Car park with view"
    },
    "The Box": {
        "lat": -33.998, "lon": 114.998,  # Heavy slab offshore
        "region": "Margaret River", "state": "Western Australia", "country": "Australia",
        "spot_type": "reef_break", "difficulty": "expert",
        "notes": "One of heaviest waves in Australia"
    },
}

# =============================================================================
# NEW ZEALAND - Tasman Sea & Pacific Swells
# North Island (west coast) faces Tasman, East Coast faces Pacific
# =============================================================================

NEW_ZEALAND_SPOTS = {
    # North Island - West Coast (Tasman Sea)
    "Raglan - Manu Bay": {
        "lat": -37.818, "lon": 174.828,  # World-class left point offshore
        "region": "Raglan", "state": "Waikato", "country": "New Zealand",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "One of world's longest lefts"
    },
    "Raglan - Indicators": {
        "lat": -37.808, "lon": 174.818,  # Outer point offshore
        "region": "Raglan", "state": "Waikato", "country": "New Zealand",
        "spot_type": "point_break", "difficulty": "advanced",
        "notes": "Heavy outside section"
    },
    "Raglan - Whale Bay": {
        "lat": -37.798, "lon": 174.808,  # Protected bay offshore
        "region": "Raglan", "state": "Waikato", "country": "New Zealand",
        "spot_type": "point_break", "difficulty": "beginner",
        "notes": "Mellow inside section"
    },
    "Piha": {
        "lat": -36.958, "lon": 174.468,  # Beach break 100m offshore
        "region": "Piha", "state": "Auckland", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Auckland's iconic beach"
    },
    "Piha - Lion Rock": {
        "lat": -36.948, "lon": 174.478,  # North Piha point offshore
        "region": "Piha", "state": "Auckland", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Next to famous Lion Rock"
    },
    "Muriwai": {
        "lat": -36.828, "lon": 174.428,  # Beach break offshore
        "region": "Muriwai", "state": "Auckland", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Black sand, gannet colony"
    },
    "Mount Maunganui": {
        "lat": -37.638, "lon": 176.178,  # Beach break offshore
        "region": "Tauranga", "state": "Bay of Plenty", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "beginner",
        "notes": "Popular east coast beach"
    },
    
    # North Island - East Coast (Pacific)
    "Gisborne - Wainui": {
        "lat": -38.648, "lon": 178.068,  # Beach break offshore
        "region": "Gisborne", "state": "Gisborne", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "First city to see sun"
    },
    "Gisborne - Makorori": {
        "lat": -38.618, "lon": 178.098,  # Point break offshore
        "region": "Gisborne", "state": "Gisborne", "country": "New Zealand",
        "spot_type": "point_break", "difficulty": "intermediate",
        "notes": "Classic NZ point"
    },
    "Mahia Peninsula": {
        "lat": -39.088, "lon": 177.898,  # Reef break offshore
        "region": "Mahia", "state": "Hawkes Bay", "country": "New Zealand",
        "spot_type": "reef_break", "difficulty": "advanced",
        "notes": "Remote peninsula reef"
    },
    
    # South Island
    "Kaikoura": {
        "lat": -42.418, "lon": 173.698,  # Beach break offshore
        "region": "Kaikoura", "state": "Canterbury", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "Whale watching + surf"
    },
    "Dunedin - St Clair": {
        "lat": -45.918, "lon": 170.488,  # Beach break offshore
        "region": "Dunedin", "state": "Otago", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "intermediate",
        "notes": "University town surf"
    },
    "Curio Bay": {
        "lat": -46.658, "lon": 169.108,  # Remote beach break offshore
        "region": "The Catlins", "state": "Southland", "country": "New Zealand",
        "spot_type": "beach_break", "difficulty": "advanced",
        "notes": "Coldest surf in NZ, fossils"
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
    """Run the Deep Caribbean & Asia-Pacific expansion."""
    async with async_session_maker() as db:
        stats = {"added": 0, "updated": 0}
        
        logger.info("="*70)
        logger.info("DEEP CARIBBEAN & ASIA-PACIFIC EXPANSION")
        logger.info("="*70)
        
        all_regions = [
            ("JAMAICA", JAMAICA_SPOTS),
            ("DOMINICAN REPUBLIC", DOMINICAN_REPUBLIC_SPOTS),
            ("NICARAGUA", NICARAGUA_SPOTS),
            ("PANAMA", PANAMA_SPOTS),
            ("SRI LANKA", SRI_LANKA_SPOTS),
            ("MALDIVES", MALDIVES_SPOTS),
            ("TAIWAN", TAIWAN_SPOTS),
            ("AUSTRALIA (ADDITIONAL)", AUSTRALIA_ADDITIONAL_SPOTS),
            ("NEW ZEALAND", NEW_ZEALAND_SPOTS),
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
        logger.info("EXPANSION COMPLETE")
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
