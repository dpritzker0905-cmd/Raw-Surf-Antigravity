"""
GLOBAL MEGA EXPANSION - Part 2
"""

# =============================================================================
# SPAIN - Basque Country & Canary Islands
# =============================================================================

SPAIN_SPOTS = {
    # Basque Country (North Spain)
    "Mundaka": {
        "lat": 43.408, "lon": -2.698,  # World-class left offshore
        "region": "Basque Country", "state": "Vizcaya", "country": "Spain",
        "spot_type": "river_mouth", "difficulty": "expert",
    },
    "Zarautz": {
        "lat": 43.288, "lon": -2.178,  # Beach break offshore
        "region": "Basque Country", "state": "Guipuzcoa", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Sopelana": {
        "lat": 43.388, "lon": -2.988,  # Beach break offshore
        "region": "Basque Country", "state": "Vizcaya", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Bakio": {
        "lat": 43.428, "lon": -2.808,  # Beach break offshore
        "region": "Basque Country", "state": "Vizcaya", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Meñakoz": {
        "lat": 43.408, "lon": -2.918,  # Heavy reef offshore
        "region": "Basque Country", "state": "Vizcaya", "country": "Spain",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Rodiles": {
        "lat": 43.538, "lon": -5.378,  # Asturias river mouth offshore
        "region": "Asturias", "state": "Asturias", "country": "Spain",
        "spot_type": "river_mouth", "difficulty": "advanced",
    },
    
    # Galicia
    "Pantin": {
        "lat": 43.658, "lon": -8.108,  # Competition beach offshore
        "region": "Galicia", "state": "A Coruna", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Razo": {
        "lat": 43.318, "lon": -8.598,  # Beach break offshore
        "region": "Galicia", "state": "A Coruna", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Canary Islands - Tenerife
    "El Socorro": {
        "lat": 28.358, "lon": -16.538,  # Beach break offshore
        "region": "Tenerife", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Playa de las Americas": {
        "lat": 28.058, "lon": -16.728,  # Beach break offshore
        "region": "Tenerife", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "La Izquierda": {
        "lat": 28.058, "lon": -16.738,  # Left point offshore
        "region": "Tenerife", "state": "Canary Islands", "country": "Spain",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    
    # Canary Islands - Fuerteventura
    "Cotillo": {
        "lat": 28.688, "lon": -14.018,  # Beach break offshore
        "region": "Fuerteventura", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Lobos": {
        "lat": 28.758, "lon": -13.818,  # Right point offshore
        "region": "Fuerteventura", "state": "Canary Islands", "country": "Spain",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Rocky Point Fuerteventura": {
        "lat": 28.498, "lon": -13.858,  # Reef break offshore
        "region": "Fuerteventura", "state": "Canary Islands", "country": "Spain",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Flag Beach": {
        "lat": 28.548, "lon": -13.878,  # Beach break offshore
        "region": "Fuerteventura", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # Canary Islands - Lanzarote
    "Famara": {
        "lat": 29.118, "lon": -13.558,  # Beach break offshore
        "region": "Lanzarote", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "El Quemao": {
        "lat": 29.218, "lon": -13.778,  # Heavy left offshore
        "region": "Lanzarote", "state": "Canary Islands", "country": "Spain",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "San Juan": {
        "lat": 29.068, "lon": -13.628,  # Beach break offshore
        "region": "Lanzarote", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Canary Islands - Gran Canaria
    "El Confital": {
        "lat": 28.158, "lon": -15.448,  # Right point offshore
        "region": "Gran Canaria", "state": "Canary Islands", "country": "Spain",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Playa del Ingles": {
        "lat": 27.758, "lon": -15.568,  # Beach break offshore
        "region": "Gran Canaria", "state": "Canary Islands", "country": "Spain",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# MOROCCO - Atlantic Swell Magnet
# =============================================================================

MOROCCO_SPOTS = {
    # Taghazout Region
    "Anchor Point": {
        "lat": 30.548, "lon": -9.718,  # World-class right point offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Hash Point": {
        "lat": 30.538, "lon": -9.708,  # Right point offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Panoramas": {
        "lat": 30.528, "lon": -9.698,  # Beach break offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Killer Point": {
        "lat": 30.568, "lon": -9.728,  # Heavy right offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "expert",
    },
    "La Source": {
        "lat": 30.558, "lon": -9.718,  # Right reef offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Mysteries": {
        "lat": 30.578, "lon": -9.738,  # Right point offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Devils Rock": {
        "lat": 30.508, "lon": -9.678,  # Reef break offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Banana Point": {
        "lat": 30.498, "lon": -9.668,  # Right point offshore
        "region": "Taghazout", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "beginner",
    },
    
    # Agadir
    "Agadir Beach": {
        "lat": 30.428, "lon": -9.618,  # Beach break offshore
        "region": "Agadir", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Imsouane
    "Imsouane - Cathedral": {
        "lat": 30.848, "lon": -9.828,  # Long right offshore
        "region": "Imsouane", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Imsouane - Bay": {
        "lat": 30.858, "lon": -9.818,  # Sheltered bay offshore
        "region": "Imsouane", "state": "Souss-Massa", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Essaouira
    "Essaouira - Moulay Bouzerktoun": {
        "lat": 31.548, "lon": -9.778,  # Beach break offshore
        "region": "Essaouira", "state": "Marrakech-Safi", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Sidi Kaouki": {
        "lat": 31.378, "lon": -9.808,  # Beach break offshore
        "region": "Essaouira", "state": "Marrakech-Safi", "country": "Morocco",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

# =============================================================================
# SOUTH AFRICA - Complete Coverage
# =============================================================================

SOUTH_AFRICA_SPOTS = {
    # Jeffreys Bay Region
    "Jeffreys Bay - Supertubes": {
        "lat": -34.048, "lon": 24.938,  # World-class right offshore
        "region": "Jeffreys Bay", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Jeffreys Bay - Boneyards": {
        "lat": -34.038, "lon": 24.928,  # Upper section offshore
        "region": "Jeffreys Bay", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Jeffreys Bay - Kitchen Windows": {
        "lat": -34.028, "lon": 24.918,  # Inside section offshore
        "region": "Jeffreys Bay", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Jeffreys Bay - Point": {
        "lat": -34.058, "lon": 24.948,  # End section offshore
        "region": "Jeffreys Bay", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Seal Point": {
        "lat": -34.188, "lon": 24.838,  # Cape St Francis offshore
        "region": "Cape St Francis", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "advanced",
    },
    "Bruce's Beauties": {
        "lat": -34.198, "lon": 24.828,  # Classic right offshore
        "region": "Cape St Francis", "state": "Eastern Cape", "country": "South Africa",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    
    # Cape Town Region
    "Dungeons": {
        "lat": -34.048, "lon": 18.358,  # Big wave offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "reef_break", "difficulty": "expert",
    },
    "Long Beach Kommetjie": {
        "lat": -34.148, "lon": 18.328,  # Beach break offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Muizenberg": {
        "lat": -34.108, "lon": 18.478,  # Beginner beach offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Noordhoek": {
        "lat": -34.118, "lon": 18.378,  # Beach break offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Llandudno": {
        "lat": -34.008, "lon": 18.348,  # Beach break offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Big Bay": {
        "lat": -33.798, "lon": 18.468,  # Beach break offshore
        "region": "Cape Town", "state": "Western Cape", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    
    # Durban Region
    "Durban - New Pier": {
        "lat": -29.858, "lon": 31.048,  # Beach break offshore
        "region": "Durban", "state": "KwaZulu-Natal", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Durban - Cave Rock": {
        "lat": -29.918, "lon": 30.998,  # Reef break offshore
        "region": "Durban", "state": "KwaZulu-Natal", "country": "South Africa",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Ballito": {
        "lat": -29.538, "lon": 31.218,  # Beach break offshore
        "region": "Ballito", "state": "KwaZulu-Natal", "country": "South Africa",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
}

# =============================================================================
# CARIBBEAN - Turks & Caicos, Barbados Expansion
# =============================================================================

TURKS_CAICOS_SPOTS = {
    "Long Bay Beach": {
        "lat": 21.778, "lon": -72.278,  # Beach break offshore
        "region": "Providenciales", "state": "Providenciales", "country": "Turks and Caicos",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Malcolm Beach": {
        "lat": 21.798, "lon": -72.208,  # Beach break offshore
        "region": "Providenciales", "state": "Providenciales", "country": "Turks and Caicos",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    "Leeward Beach": {
        "lat": 21.808, "lon": -72.168,  # Beach break offshore
        "region": "Providenciales", "state": "Providenciales", "country": "Turks and Caicos",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Grace Bay": {
        "lat": 21.798, "lon": -72.198,  # Famous beach offshore
        "region": "Providenciales", "state": "Providenciales", "country": "Turks and Caicos",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}

BARBADOS_EXPANSION = {
    # East Coast (Atlantic)
    "Bathsheba - Soup Bowl South": {
        "lat": 13.218, "lon": -59.518,  # South section offshore
        "region": "Bathsheba", "state": "St. Joseph", "country": "Barbados",
        "spot_type": "reef_break", "difficulty": "advanced",
    },
    "Cattlewash": {
        "lat": 13.238, "lon": -59.508,  # Beach break offshore
        "region": "Bathsheba", "state": "St. Joseph", "country": "Barbados",
        "spot_type": "beach_break", "difficulty": "intermediate",
    },
    
    # South Coast
    "South Point": {
        "lat": 13.058, "lon": -59.538,  # Right point offshore
        "region": "South Coast", "state": "Christ Church", "country": "Barbados",
        "spot_type": "point_break", "difficulty": "intermediate",
    },
    "Brandons": {
        "lat": 13.108, "lon": -59.638,  # Beach break offshore
        "region": "West Coast", "state": "St. James", "country": "Barbados",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
    "Tropicana": {
        "lat": 13.078, "lon": -59.548,  # Beach break offshore
        "region": "South Coast", "state": "Christ Church", "country": "Barbados",
        "spot_type": "beach_break", "difficulty": "beginner",
    },
}
