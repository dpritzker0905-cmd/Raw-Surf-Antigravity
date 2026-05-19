"""
GLOBAL EXPANSION PHASE 2 - Part 2
"""

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
