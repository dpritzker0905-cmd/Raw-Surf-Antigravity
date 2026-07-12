"""
Global Surf Spot Importer - OSM Overpass API Integration
Imports surf breaks from OpenStreetMap globally.
"""
import asyncio
import aiohttp
import logging
from typing import List, Dict, Optional
from datetime import datetime, timezone

logger = logging.getLogger(__name__)

# OSM Overpass API endpoint
OVERPASS_API = "https://overpass-api.de/api/interpreter"

# Region definitions for tiered import
IMPORT_REGIONS = {
    1: {  # Tier 1: East Coast USA
        "name": "East Coast USA",
        "bbox": "24.5,-81.5,45.0,-66.5",  # Maine to Florida
        "countries": ["USA"],
        "states": ["Florida", "Georgia", "South Carolina", "North Carolina", "Virginia", 
                   "Maryland", "Delaware", "New Jersey", "New York", "Connecticut", 
                   "Rhode Island", "Massachusetts", "New Hampshire", "Maine"]
    },
    2: {  # Tier 2: West Coast, Hawaii, Puerto Rico
        "name": "West Coast & Islands",
        "regions": [
            {"bbox": "32.5,-124.5,49.0,-117.0", "states": ["California", "Oregon", "Washington"]},
            {"bbox": "18.5,-160.5,22.5,-154.5", "states": ["Hawaii"]},
            {"bbox": "17.5,-68.0,18.6,-65.0", "states": ["Puerto Rico"]},
        ],
        "countries": ["USA"]
    },
    3: {  # Tier 3: Global Major Breaks
        "name": "Global",
        "regions": [
            # Australia
            {"bbox": "-44.0,112.0,-10.0,154.0", "country": "Australia"},
            # Indonesia (Bali, Java, Sumatra)
            {"bbox": "-11.0,95.0,6.0,141.0", "country": "Indonesia"},
            # Europe (Portugal, Spain, France, UK, Ireland)
            {"bbox": "36.0,-10.0,60.0,3.0", "country": "Europe"},
            # Central America & Mexico
            {"bbox": "7.0,-118.0,33.0,-77.0", "country": "Central America"},
            # South America
            {"bbox": "-56.0,-82.0,13.0,-34.0", "country": "South America"},
            # South Africa
            {"bbox": "-35.0,16.0,-22.0,33.0", "country": "South Africa"},
            # Japan
            {"bbox": "24.0,122.0,46.0,146.0", "country": "Japan"},
        ]
    }
}

# Curated list of major surf spots (when OSM data is sparse)
CURATED_SPOTS = [
    # East Coast USA - Additional spots
    {"name": "Pipeline", "lat": 21.6650, "lon": -158.0530, "country": "USA", "state": "Hawaii", "region": "North Shore", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Sunset Beach", "lat": 21.6783, "lon": -158.0417, "country": "USA", "state": "Hawaii", "region": "North Shore", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Waimea Bay", "lat": 21.6417, "lon": -158.0653, "country": "USA", "state": "Hawaii", "region": "North Shore", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Rincon", "lat": 34.3750, "lon": -119.4767, "country": "USA", "state": "California", "region": "Santa Barbara", "tier": 2, "wave_type": "Point Break"},
    {"name": "Mavericks", "lat": 37.4950, "lon": -122.4967, "country": "USA", "state": "California", "region": "Half Moon Bay", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Trestles", "lat": 33.3833, "lon": -117.5883, "country": "USA", "state": "California", "region": "San Clemente", "tier": 2, "wave_type": "Point Break"},
    {"name": "Huntington Beach Pier", "lat": 33.6550, "lon": -118.0050, "country": "USA", "state": "California", "region": "Orange County", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Blacks Beach", "lat": 32.8889, "lon": -117.2531, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Beach Break"},
    
    # Australia - Complete Tier 3 Expansion
    {"name": "Bells Beach", "lat": -38.3683, "lon": 144.2817, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Snapper Rocks", "lat": -28.1617, "lon": 153.5467, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Kirra", "lat": -28.1667, "lon": 153.5167, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Burleigh Heads", "lat": -28.0833, "lon": 153.4500, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Noosa Heads", "lat": -26.3917, "lon": 153.0917, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Margaret River", "lat": -33.9500, "lon": 114.9833, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Bondi Beach", "lat": -33.8908, "lon": 151.2743, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Manly Beach", "lat": -33.7969, "lon": 151.2878, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Duranbah (D-Bah)", "lat": -28.1722, "lon": 153.5594, "country": "Australia", "state": "New South Wales", "region": "Gold Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Rainbow Bay", "lat": -28.1589, "lon": 153.5450, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Coolangatta", "lat": -28.1650, "lon": 153.5367, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Palm Beach", "lat": -28.1150, "lon": 153.4617, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Currumbin Alley", "lat": -28.1367, "lon": 153.4867, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Narrowneck", "lat": -28.0083, "lon": 153.4317, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "The Spit", "lat": -27.9650, "lon": 153.4283, "country": "Australia", "state": "Queensland", "region": "Gold Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "North Narrabeen", "lat": -33.7117, "lon": 151.3017, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Dee Why Point", "lat": -33.7583, "lon": 151.2983, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Curl Curl", "lat": -33.7717, "lon": 151.2917, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Freshwater", "lat": -33.7800, "lon": 151.2917, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Cronulla", "lat": -34.0550, "lon": 151.1550, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Maroubra", "lat": -33.9500, "lon": 151.2550, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Bronte", "lat": -33.9033, "lon": 151.2683, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Tamarama", "lat": -33.8967, "lon": 151.2717, "country": "Australia", "state": "New South Wales", "region": "Sydney", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Winkipop", "lat": -38.3650, "lon": 144.2850, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Johanna Beach", "lat": -38.7517, "lon": 143.3517, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "13th Beach", "lat": -38.3017, "lon": 144.4617, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Phillip Island", "lat": -38.5017, "lon": 145.1417, "country": "Australia", "state": "Victoria", "region": "Phillip Island", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Torquay", "lat": -38.3367, "lon": 144.3267, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Jan Juc", "lat": -38.3517, "lon": 144.3050, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Anglesea", "lat": -38.4083, "lon": 144.2050, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Lorne", "lat": -38.5417, "lon": 143.9833, "country": "Australia", "state": "Victoria", "region": "Great Ocean Road", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Trigg Beach", "lat": -31.8717, "lon": 115.7533, "country": "Australia", "state": "Western Australia", "region": "Perth", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Scarborough Beach", "lat": -31.8900, "lon": 115.7550, "country": "Australia", "state": "Western Australia", "region": "Perth", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Cottesloe", "lat": -31.9917, "lon": 115.7517, "country": "Australia", "state": "Western Australia", "region": "Perth", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Yallingup", "lat": -33.6467, "lon": 115.0283, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Injidup", "lat": -33.7617, "lon": 115.0083, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Gracetown", "lat": -33.8650, "lon": 114.9883, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "The Box", "lat": -33.9567, "lon": 114.9583, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Main Break Margaret River", "lat": -33.9617, "lon": 114.9517, "country": "Australia", "state": "Western Australia", "region": "Margaret River", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Byron Bay - The Pass", "lat": -28.6450, "lon": 153.6283, "country": "Australia", "state": "New South Wales", "region": "Byron Bay", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Byron Bay - Wategos", "lat": -28.6367, "lon": 153.6233, "country": "Australia", "state": "New South Wales", "region": "Byron Bay", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Byron Bay - Main Beach", "lat": -28.6417, "lon": 153.6183, "country": "Australia", "state": "New South Wales", "region": "Byron Bay", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Lennox Head", "lat": -28.7900, "lon": 153.6017, "country": "Australia", "state": "New South Wales", "region": "Byron Bay", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Ballina - Lighthouse", "lat": -28.8600, "lon": 153.5883, "country": "Australia", "state": "New South Wales", "region": "Ballina", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Angourie", "lat": -29.4717, "lon": 153.3617, "country": "Australia", "state": "New South Wales", "region": "Yamba", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Crescent Head", "lat": -31.1833, "lon": 152.9650, "country": "Australia", "state": "New South Wales", "region": "Mid North Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Port Macquarie", "lat": -31.4350, "lon": 152.9267, "country": "Australia", "state": "New South Wales", "region": "Mid North Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Coffs Harbour", "lat": -30.3000, "lon": 153.1350, "country": "Australia", "state": "New South Wales", "region": "North Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Caloundra", "lat": -26.8017, "lon": 153.1417, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Mooloolaba", "lat": -26.6817, "lon": 153.1200, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Alexandra Headland", "lat": -26.6650, "lon": 153.1117, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Maroochydore", "lat": -26.6517, "lon": 153.1017, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Coolum", "lat": -26.5317, "lon": 153.0850, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Sunshine Beach", "lat": -26.4083, "lon": 153.0983, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Tea Tree Bay Noosa", "lat": -26.3867, "lon": 153.0883, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "First Point Noosa", "lat": -26.3933, "lon": 153.0917, "country": "Australia", "state": "Queensland", "region": "Sunshine Coast", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    
    # Indonesia - Complete Tier 3
    {"name": "Uluwatu", "lat": -8.8292, "lon": 115.0850, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Padang Padang", "lat": -8.8150, "lon": 115.1017, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Kuta Beach", "lat": -8.7183, "lon": 115.1686, "country": "Indonesia", "state": "Bali", "region": "Kuta", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Canggu", "lat": -8.6478, "lon": 115.1385, "country": "Indonesia", "state": "Bali", "region": "Canggu", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "G-Land", "lat": -8.4500, "lon": 114.3667, "country": "Indonesia", "state": "Java", "region": "East Java", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Desert Point", "lat": -8.7467, "lon": 115.8283, "country": "Indonesia", "state": "Lombok", "region": "Southwest Lombok", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Mentawai Islands", "lat": -2.1000, "lon": 99.5000, "country": "Indonesia", "state": "Sumatra", "region": "Mentawai", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Bingin", "lat": -8.8072, "lon": 115.1078, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Impossible", "lat": -8.8089, "lon": 115.1108, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Dreamland", "lat": -8.8044, "lon": 115.1139, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Balangan", "lat": -8.7933, "lon": 115.1167, "country": "Indonesia", "state": "Bali", "region": "Bukit Peninsula", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Echo Beach", "lat": -8.6539, "lon": 115.1289, "country": "Indonesia", "state": "Bali", "region": "Canggu", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Old Mans", "lat": -8.6556, "lon": 115.1317, "country": "Indonesia", "state": "Bali", "region": "Canggu", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Batu Bolong", "lat": -8.6572, "lon": 115.1344, "country": "Indonesia", "state": "Bali", "region": "Canggu", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Medewi", "lat": -8.3750, "lon": 114.8111, "country": "Indonesia", "state": "Bali", "region": "West Bali", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Keramas", "lat": -8.5567, "lon": 115.3833, "country": "Indonesia", "state": "Bali", "region": "East Bali", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Gerupuk", "lat": -8.9417, "lon": 116.3583, "country": "Indonesia", "state": "Lombok", "region": "South Lombok", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Kuta Lombok", "lat": -8.9000, "lon": 116.3083, "country": "Indonesia", "state": "Lombok", "region": "South Lombok", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Selong Belanak", "lat": -8.8833, "lon": 116.2583, "country": "Indonesia", "state": "Lombok", "region": "South Lombok", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Nias - Lagundri Bay", "lat": 0.7667, "lon": 97.6500, "country": "Indonesia", "state": "Sumatra", "region": "Nias", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    
    # Portugal - Europe Tier 3 Expansion
    {"name": "Nazaré", "lat": 39.6017, "lon": -9.0700, "country": "Portugal", "state": "Leiria", "region": "Central Portugal", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Peniche - Supertubos", "lat": 39.3500, "lon": -9.3667, "country": "Portugal", "state": "Leiria", "region": "Peniche", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Ericeira", "lat": 38.9667, "lon": -9.4167, "country": "Portugal", "state": "Lisbon", "region": "Ericeira", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Sagres", "lat": 37.0000, "lon": -8.9333, "country": "Portugal", "state": "Algarve", "region": "Algarve", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Coxos", "lat": 39.0000, "lon": -9.4167, "country": "Portugal", "state": "Lisbon", "region": "Ericeira", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Ribeira d'Ilhas", "lat": 38.9833, "lon": -9.4167, "country": "Portugal", "state": "Lisbon", "region": "Ericeira", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Cave", "lat": 38.9717, "lon": -9.4200, "country": "Portugal", "state": "Lisbon", "region": "Ericeira", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Foz do Lizandro", "lat": 38.9400, "lon": -9.4150, "country": "Portugal", "state": "Lisbon", "region": "Ericeira", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Guincho", "lat": 38.7300, "lon": -9.4750, "country": "Portugal", "state": "Lisbon", "region": "Cascais", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Costa da Caparica", "lat": 38.6417, "lon": -9.2350, "country": "Portugal", "state": "Lisbon", "region": "Lisbon", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Baleal", "lat": 39.3750, "lon": -9.3417, "country": "Portugal", "state": "Leiria", "region": "Peniche", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Consolação", "lat": 39.3333, "lon": -9.3583, "country": "Portugal", "state": "Leiria", "region": "Peniche", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Molhe Leste", "lat": 39.3500, "lon": -9.3750, "country": "Portugal", "state": "Leiria", "region": "Peniche", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Lagide", "lat": 39.3667, "lon": -9.3500, "country": "Portugal", "state": "Leiria", "region": "Peniche", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Arrifana", "lat": 37.2950, "lon": -8.8667, "country": "Portugal", "state": "Algarve", "region": "Aljezur", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Amado", "lat": 37.1667, "lon": -8.9000, "country": "Portugal", "state": "Algarve", "region": "Carrapateira", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Tonel", "lat": 37.0100, "lon": -8.9417, "country": "Portugal", "state": "Algarve", "region": "Sagres", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Beliche", "lat": 37.0300, "lon": -8.9600, "country": "Portugal", "state": "Algarve", "region": "Sagres", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Mareta", "lat": 37.0150, "lon": -8.9367, "country": "Portugal", "state": "Algarve", "region": "Sagres", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Praia do Norte", "lat": 39.6083, "lon": -9.0700, "country": "Portugal", "state": "Leiria", "region": "Nazaré", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # France - Complete Tier 3
    {"name": "Hossegor - La Gravière", "lat": 43.6667, "lon": -1.4333, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Biarritz", "lat": 43.4833, "lon": -1.5583, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Lacanau", "lat": 45.0000, "lon": -1.2000, "country": "France", "state": "Gironde", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "La Nord Hossegor", "lat": 43.6750, "lon": -1.4417, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "La Sud Hossegor", "lat": 43.6583, "lon": -1.4250, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Les Estagnots", "lat": 43.6917, "lon": -1.4500, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "La Piste Capbreton", "lat": 43.6417, "lon": -1.4583, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Santocha", "lat": 43.6333, "lon": -1.4667, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Côte des Basques", "lat": 43.4767, "lon": -1.5650, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Grande Plage Biarritz", "lat": 43.4833, "lon": -1.5583, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Marbella Biarritz", "lat": 43.4700, "lon": -1.5683, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Guéthary", "lat": 43.4250, "lon": -1.6117, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Parlementia", "lat": 43.4283, "lon": -1.6083, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Lafitenia", "lat": 43.4017, "lon": -1.6567, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Saint-Jean-de-Luz", "lat": 43.3833, "lon": -1.6667, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Anglet - Les Cavaliers", "lat": 43.5167, "lon": -1.5500, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Anglet - VVF", "lat": 43.5083, "lon": -1.5417, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Anglet - Sables d'Or", "lat": 43.5000, "lon": -1.5333, "country": "France", "state": "Pyrénées-Atlantiques", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Le Porge", "lat": 44.8833, "lon": -1.1833, "country": "France", "state": "Gironde", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Carcans", "lat": 45.0833, "lon": -1.1667, "country": "France", "state": "Gironde", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Montalivet", "lat": 45.3833, "lon": -1.1500, "country": "France", "state": "Gironde", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Soulac", "lat": 45.5000, "lon": -1.1333, "country": "France", "state": "Gironde", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Mimizan", "lat": 44.2167, "lon": -1.2917, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Moliets", "lat": 43.8500, "lon": -1.3833, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Messanges", "lat": 43.8167, "lon": -1.3833, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Vieux-Boucau", "lat": 43.7833, "lon": -1.4000, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Seignosse", "lat": 43.6917, "lon": -1.4417, "country": "France", "state": "Landes", "region": "Southwest France", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # Spain - Complete Tier 3
    {"name": "Mundaka", "lat": 43.4083, "lon": -2.6983, "country": "Spain", "state": "Basque Country", "region": "Basque Country", "tier": 3, "wave_type": "River Mouth"},
    {"name": "Zarautz", "lat": 43.2833, "lon": -2.1667, "country": "Spain", "state": "Basque Country", "region": "Basque Country", "tier": 3, "wave_type": "Beach Break"},
    
    # South Africa
    {"name": "Jeffreys Bay", "lat": -34.0500, "lon": 24.9333, "country": "South Africa", "state": "Eastern Cape", "region": "J-Bay", "tier": 3, "wave_type": "Point Break"},
    {"name": "Cape Town - Dungeons", "lat": -33.9833, "lon": 18.3500, "country": "South Africa", "state": "Western Cape", "region": "Cape Town", "tier": 3, "wave_type": "Reef Break"},
    
    # Mexico & Central America
    {"name": "Puerto Escondido", "lat": 15.8617, "lon": -97.0717, "country": "Mexico", "state": "Oaxaca", "region": "Pacific Coast", "tier": 3, "wave_type": "Beach Break"},
    {"name": "Sayulita", "lat": 20.8681, "lon": -105.4381, "country": "Mexico", "state": "Nayarit", "region": "Pacific Coast", "tier": 3, "wave_type": "Point Break"},
    {"name": "Tamarindo", "lat": 10.2994, "lon": -85.8378, "country": "Costa Rica", "state": "Guanacaste", "region": "Pacific Coast", "tier": 3, "wave_type": "Beach Break"},
    {"name": "Playa Hermosa", "lat": 9.5575, "lon": -84.5775, "country": "Costa Rica", "state": "Puntarenas", "region": "Pacific Coast", "tier": 3, "wave_type": "Beach Break"},
    {"name": "Witch's Rock", "lat": 10.8333, "lon": -85.8167, "country": "Costa Rica", "state": "Guanacaste", "region": "Pacific Coast", "tier": 3, "wave_type": "Beach Break"},
    
    # South America
    {"name": "Chicama", "lat": -7.7167, "lon": -79.4500, "country": "Peru", "state": "La Libertad", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Punta de Lobos", "lat": -34.4167, "lon": -72.0500, "country": "Chile", "state": "O'Higgins", "region": "Central Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Florianópolis", "lat": -27.5969, "lon": -48.5495, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # SOUTH AMERICA TIER 3 EXPANSION - Complete
    # BRAZIL - Complete Coastline
    {"name": "Itacaré", "lat": -14.2769, "lon": -38.9953, "country": "Brazil", "state": "Bahia", "region": "Northeast Brazil", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Praia do Forte", "lat": -12.5744, "lon": -37.9953, "country": "Brazil", "state": "Bahia", "region": "Northeast Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Baía Formosa", "lat": -6.3678, "lon": -35.0025, "country": "Brazil", "state": "Rio Grande do Norte", "region": "Northeast Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Natal", "lat": -5.8000, "lon": -35.2000, "country": "Brazil", "state": "Rio Grande do Norte", "region": "Northeast Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Fernando de Noronha", "lat": -3.8500, "lon": -32.4200, "country": "Brazil", "state": "Pernambuco", "region": "Northeast Brazil", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Recife - Boa Viagem", "lat": -8.1308, "lon": -34.9050, "country": "Brazil", "state": "Pernambuco", "region": "Northeast Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Salvador", "lat": -12.9711, "lon": -38.5108, "country": "Brazil", "state": "Bahia", "region": "Northeast Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Arraial do Cabo", "lat": -22.9667, "lon": -42.0333, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Cabo Frio", "lat": -22.8789, "lon": -42.0247, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Saquarema", "lat": -22.9200, "lon": -42.5100, "country": "Brazil", "state": "Rio de Janeiro", "region": "Rio de Janeiro", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Maresias", "lat": -23.7803, "lon": -45.5500, "country": "Brazil", "state": "São Paulo", "region": "São Paulo", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Ubatuba", "lat": -23.4333, "lon": -45.0833, "country": "Brazil", "state": "São Paulo", "region": "São Paulo", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Guarujá", "lat": -24.0000, "lon": -46.2500, "country": "Brazil", "state": "São Paulo", "region": "São Paulo", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Ilha do Mel", "lat": -25.5000, "lon": -48.3167, "country": "Brazil", "state": "Paraná", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Praia Mole", "lat": -27.6000, "lon": -48.4333, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Joaquina", "lat": -27.6278, "lon": -48.4481, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Campeche", "lat": -27.6667, "lon": -48.4667, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Imbituba - Praia da Vila", "lat": -28.2333, "lon": -48.6667, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Garopaba", "lat": -28.0333, "lon": -48.6167, "country": "Brazil", "state": "Santa Catarina", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Torres", "lat": -29.3500, "lon": -49.7333, "country": "Brazil", "state": "Rio Grande do Sul", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Tramandaí", "lat": -29.9833, "lon": -50.1333, "country": "Brazil", "state": "Rio Grande do Sul", "region": "South Brazil", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # PERU - Complete Coastline
    {"name": "Máncora", "lat": -4.1028, "lon": -81.0542, "country": "Peru", "state": "Piura", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Lobitos", "lat": -4.4500, "lon": -81.2833, "country": "Peru", "state": "Piura", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Cabo Blanco", "lat": -4.2500, "lon": -81.2333, "country": "Peru", "state": "Piura", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Órganos", "lat": -4.1667, "lon": -81.1333, "country": "Peru", "state": "Piura", "region": "North Peru", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Pacasmayo", "lat": -7.4000, "lon": -79.5667, "country": "Peru", "state": "La Libertad", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Huanchaco", "lat": -8.0833, "lon": -79.1167, "country": "Peru", "state": "La Libertad", "region": "North Peru", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Pico Alto", "lat": -12.5333, "lon": -76.8000, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Reef Break", "source": "surfline"},
    {"name": "Punta Hermosa", "lat": -12.3333, "lon": -76.8333, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "San Bartolo", "lat": -12.3833, "lon": -76.7833, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Señoritas", "lat": -12.3500, "lon": -76.8167, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "La Herradura", "lat": -12.2000, "lon": -77.0167, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Costa Verde", "lat": -12.1500, "lon": -77.0333, "country": "Peru", "state": "Lima", "region": "Lima", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # CHILE - Complete Coastline
    {"name": "Arica", "lat": -18.4783, "lon": -70.3333, "country": "Chile", "state": "Arica y Parinacota", "region": "North Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Iquique", "lat": -20.2208, "lon": -70.1500, "country": "Chile", "state": "Tarapacá", "region": "North Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "La Boca de Cavancha", "lat": -20.2333, "lon": -70.1500, "country": "Chile", "state": "Tarapacá", "region": "North Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Huayquique", "lat": -20.2833, "lon": -70.1333, "country": "Chile", "state": "Tarapacá", "region": "North Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Antofagasta", "lat": -23.6500, "lon": -70.4000, "country": "Chile", "state": "Antofagasta", "region": "North Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "La Serena", "lat": -29.9000, "lon": -71.2667, "country": "Chile", "state": "Coquimbo", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Totoralillo", "lat": -30.0833, "lon": -71.3833, "country": "Chile", "state": "Coquimbo", "region": "Central Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Maitencillo", "lat": -32.6500, "lon": -71.4500, "country": "Chile", "state": "Valparaíso", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Reñaca", "lat": -32.9667, "lon": -71.5333, "country": "Chile", "state": "Valparaíso", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Viña del Mar", "lat": -33.0167, "lon": -71.5500, "country": "Chile", "state": "Valparaíso", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Valparaíso", "lat": -33.0500, "lon": -71.6167, "country": "Chile", "state": "Valparaíso", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Algarrobo", "lat": -33.3667, "lon": -71.6833, "country": "Chile", "state": "Valparaíso", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Pichilemu - Punta de Lobos", "lat": -34.4200, "lon": -72.0500, "country": "Chile", "state": "O'Higgins", "region": "Central Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Pichilemu - La Puntilla", "lat": -34.3833, "lon": -72.0000, "country": "Chile", "state": "O'Higgins", "region": "Central Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Pichilemu - Infiernillo", "lat": -34.3833, "lon": -72.0083, "country": "Chile", "state": "O'Higgins", "region": "Central Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Constitución", "lat": -35.3333, "lon": -72.4167, "country": "Chile", "state": "Maule", "region": "Central Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Cobquecura", "lat": -36.1333, "lon": -72.8000, "country": "Chile", "state": "Biobío", "region": "South Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Buchupureo", "lat": -36.1500, "lon": -72.8167, "country": "Chile", "state": "Biobío", "region": "South Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Concepción", "lat": -36.8333, "lon": -73.0500, "country": "Chile", "state": "Biobío", "region": "South Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Lebu", "lat": -37.6167, "lon": -73.6667, "country": "Chile", "state": "Biobío", "region": "South Chile", "tier": 3, "wave_type": "Point Break", "source": "surfline"},
    {"name": "Puerto Saavedra", "lat": -38.8000, "lon": -73.4000, "country": "Chile", "state": "Araucanía", "region": "South Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Valdivia", "lat": -39.8000, "lon": -73.2333, "country": "Chile", "state": "Los Ríos", "region": "South Chile", "tier": 3, "wave_type": "Beach Break", "source": "surfline"},
    
    # Japan
    {"name": "Shonan", "lat": 35.3167, "lon": 139.4833, "country": "Japan", "state": "Kanagawa", "region": "Tokyo Area", "tier": 3, "wave_type": "Beach Break"},
    {"name": "Chiba", "lat": 35.6000, "lon": 140.1000, "country": "Japan", "state": "Chiba", "region": "Tokyo Area", "tier": 3, "wave_type": "Beach Break"},
    
    # Additional East Coast USA spots to fill out Tier 1
    {"name": "Outer Banks - Cape Hatteras", "lat": 35.2333, "lon": -75.5333, "country": "USA", "state": "North Carolina", "region": "Outer Banks", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Wrightsville Beach", "lat": 34.2100, "lon": -77.7900, "country": "USA", "state": "North Carolina", "region": "Wilmington", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Folly Beach", "lat": 32.6550, "lon": -79.9400, "country": "USA", "state": "South Carolina", "region": "Charleston", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Virginia Beach", "lat": 36.8529, "lon": -75.9780, "country": "USA", "state": "Virginia", "region": "Virginia Beach", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Ocean City Maryland", "lat": 38.3365, "lon": -75.0849, "country": "USA", "state": "Maryland", "region": "Ocean City", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Cape May", "lat": 38.9351, "lon": -74.9060, "country": "USA", "state": "New Jersey", "region": "Cape May", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Long Beach Island", "lat": 39.6626, "lon": -74.1535, "country": "USA", "state": "New Jersey", "region": "LBI", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Asbury Park", "lat": 40.2204, "lon": -74.0001, "country": "USA", "state": "New Jersey", "region": "Jersey Shore", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Sandy Hook", "lat": 40.4583, "lon": -73.9917, "country": "USA", "state": "New Jersey", "region": "Jersey Shore", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Rockaway Beach", "lat": 40.5834, "lon": -73.8212, "country": "USA", "state": "New York", "region": "New York City", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Long Beach NY", "lat": 40.5884, "lon": -73.6579, "country": "USA", "state": "New York", "region": "Long Island", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Montauk", "lat": 41.0359, "lon": -71.9542, "country": "USA", "state": "New York", "region": "Long Island", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Narragansett", "lat": 41.4501, "lon": -71.4495, "country": "USA", "state": "Rhode Island", "region": "Rhode Island", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Newport", "lat": 41.4901, "lon": -71.3128, "country": "USA", "state": "Rhode Island", "region": "Rhode Island", "tier": 1, "wave_type": "Point Break"},
    {"name": "Nantucket", "lat": 41.2835, "lon": -70.0995, "country": "USA", "state": "Massachusetts", "region": "Cape Cod", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Cape Cod - Coast Guard Beach", "lat": 41.8550, "lon": -69.9417, "country": "USA", "state": "Massachusetts", "region": "Cape Cod", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Hampton Beach", "lat": 42.9076, "lon": -70.8117, "country": "USA", "state": "New Hampshire", "region": "New Hampshire", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Old Orchard Beach", "lat": 43.5151, "lon": -70.3776, "country": "USA", "state": "Maine", "region": "Southern Maine", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Higgins Beach", "lat": 43.5567, "lon": -70.2333, "country": "USA", "state": "Maine", "region": "Southern Maine", "tier": 1, "wave_type": "Beach Break"},
    
    # FLORIDA - Complete Coastline (Accurate Shoreline Pins)
    # Space Coast
    {"name": "Sebastian Inlet", "lat": 27.8603, "lon": -80.4473, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Jetty Break", "source": "surfline", "difficulty": "Intermediate"},
    
    # SURFLINE-PRECISION SPACE COAST (Port Canaveral to Patrick AFB) - All pins OFFSHORE at peak
    # Coordinates recalibrated 50-150m offshore from shoreline
    {"name": "Jetty Park", "lat": 28.4062, "lon": -80.5920, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Jetty Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "Cherie Down Park", "lat": 28.3840, "lon": -80.6010, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "Cocoa Beach Pier", "lat": 28.3680, "lon": -80.6010, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Pier Break", "source": "surfline", "difficulty": "All Levels"},
    {"name": "Shepard Park", "lat": 28.3586, "lon": -80.6005, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "Lori Wilson Park", "lat": 28.3478, "lon": -80.6008, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "16th Street South", "lat": 28.3392, "lon": -80.6010, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "Minuteman Causeway", "lat": 28.3289, "lon": -80.6010, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "Picnic Tables", "lat": 28.2928, "lon": -80.6005, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "O Club", "lat": 28.2639, "lon": -80.6000, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "Patrick Air Force Base", "lat": 28.2347, "lon": -80.5995, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "Kennedy Space Center", "lat": 28.5172, "lon": -80.6040, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "Playalinda Beach", "lat": 28.6650, "lon": -80.6130, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Intermediate"},
    {"name": "Cape Canaveral Air Force Station", "lat": 28.4672, "lon": -80.6020, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline", "difficulty": "Beginner"},
    {"name": "New Smyrna Beach Inlet", "lat": 29.0288, "lon": -80.8895, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Jetty Break", "source": "surfline"},
    {"name": "Ponce Inlet", "lat": 29.0964, "lon": -80.9370, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Jetty Break", "source": "surfline"},
    {"name": "Satellite Beach", "lat": 28.1761, "lon": -80.5935, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Melbourne Beach", "lat": 28.0686, "lon": -80.5620, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline"},
    {"name": "Indialantic", "lat": 28.0897, "lon": -80.5695, "country": "USA", "state": "Florida", "region": "Space Coast", "tier": 1, "wave_type": "Beach Break", "source": "surfline"},
    
    # North Florida / First Coast
    {"name": "Jacksonville Beach Pier", "lat": 30.2947, "lon": -81.3931, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Atlantic Beach", "lat": 30.3340, "lon": -81.3979, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Neptune Beach", "lat": 30.3107, "lon": -81.3962, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Mayport Poles", "lat": 30.3938, "lon": -81.3992, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "St. Augustine Pier", "lat": 29.8836, "lon": -81.2659, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Flagler Beach Pier", "lat": 29.4728, "lon": -81.1256, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Marineland", "lat": 29.6697, "lon": -81.2150, "country": "USA", "state": "Florida", "region": "First Coast", "tier": 1, "wave_type": "Beach Break"},
    
    # Daytona Area
    {"name": "Daytona Beach", "lat": 29.2108, "lon": -81.0228, "country": "USA", "state": "Florida", "region": "Daytona", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Ormond Beach", "lat": 29.2858, "lon": -81.0553, "country": "USA", "state": "Florida", "region": "Daytona", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Daytona Beach Shores", "lat": 29.1619, "lon": -80.9789, "country": "USA", "state": "Florida", "region": "Daytona", "tier": 1, "wave_type": "Beach Break"},
    
    # Palm Beach / Treasure Coast
    {"name": "Jupiter Inlet", "lat": 26.9381, "lon": -80.0719, "country": "USA", "state": "Florida", "region": "Palm Beach", "tier": 1, "wave_type": "Jetty Break"},
    {"name": "Reef Road", "lat": 26.7039, "lon": -80.0342, "country": "USA", "state": "Florida", "region": "Palm Beach", "tier": 1, "wave_type": "Reef Break"},
    {"name": "Lake Worth Pier", "lat": 26.6139, "lon": -80.0342, "country": "USA", "state": "Florida", "region": "Palm Beach", "tier": 1, "wave_type": "Beach Break"},
    {"name": "South Beach Park (Boca)", "lat": 26.3353, "lon": -80.0661, "country": "USA", "state": "Florida", "region": "Palm Beach", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Delray Beach", "lat": 26.4614, "lon": -80.0631, "country": "USA", "state": "Florida", "region": "Palm Beach", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Stuart Beach", "lat": 27.2031, "lon": -80.1761, "country": "USA", "state": "Florida", "region": "Treasure Coast", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Fort Pierce Inlet", "lat": 27.4681, "lon": -80.2889, "country": "USA", "state": "Florida", "region": "Treasure Coast", "tier": 1, "wave_type": "Jetty Break"},
    {"name": "Vero Beach", "lat": 27.6386, "lon": -80.3661, "country": "USA", "state": "Florida", "region": "Treasure Coast", "tier": 1, "wave_type": "Beach Break"},
    
    # South Florida / Broward / Miami
    {"name": "Deerfield Beach Pier", "lat": 26.3186, "lon": -80.0728, "country": "USA", "state": "Florida", "region": "Broward", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Pompano Beach Pier", "lat": 26.2375, "lon": -80.0839, "country": "USA", "state": "Florida", "region": "Broward", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Fort Lauderdale", "lat": 26.1224, "lon": -80.1030, "country": "USA", "state": "Florida", "region": "Broward", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Hollywood Beach", "lat": 26.0122, "lon": -80.1194, "country": "USA", "state": "Florida", "region": "Broward", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Haulover Beach", "lat": 25.9053, "lon": -80.1200, "country": "USA", "state": "Florida", "region": "Miami", "tier": 1, "wave_type": "Beach Break"},
    {"name": "North Miami Beach", "lat": 25.8678, "lon": -80.1200, "country": "USA", "state": "Florida", "region": "Miami", "tier": 1, "wave_type": "Beach Break"},
    {"name": "South Beach Miami", "lat": 25.7826, "lon": -80.1300, "country": "USA", "state": "Florida", "region": "Miami", "tier": 1, "wave_type": "Beach Break"},
    
    # HAWAII - Complete Major Breaks
    {"name": "Backdoor", "lat": 21.6642, "lon": -158.0525, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Off The Wall", "lat": 21.6644, "lon": -158.0511, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Rocky Point", "lat": 21.6692, "lon": -158.0475, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Haleiwa", "lat": 21.5922, "lon": -158.1022, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Laniakea", "lat": 21.6178, "lon": -158.0789, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Chuns Reef", "lat": 21.6114, "lon": -158.0842, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Velzyland", "lat": 21.6872, "lon": -158.0331, "country": "USA", "state": "Hawaii", "region": "North Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Waikiki - Queens", "lat": 21.2683, "lon": -157.8267, "country": "USA", "state": "Hawaii", "region": "South Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Ala Moana Bowls", "lat": 21.2903, "lon": -157.8528, "country": "USA", "state": "Hawaii", "region": "South Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Diamond Head", "lat": 21.2553, "lon": -157.8056, "country": "USA", "state": "Hawaii", "region": "South Shore Oahu", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Sandy Beach", "lat": 21.2864, "lon": -157.6714, "country": "USA", "state": "Hawaii", "region": "East Shore Oahu", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Makapuu", "lat": 21.3103, "lon": -157.6608, "country": "USA", "state": "Hawaii", "region": "East Shore Oahu", "tier": 2, "wave_type": "Beach Break"},
    # Maui
    {"name": "Honolua Bay", "lat": 21.0136, "lon": -156.6381, "country": "USA", "state": "Hawaii", "region": "Maui", "tier": 2, "wave_type": "Point Break"},
    {"name": "Jaws (Peahi)", "lat": 20.9411, "lon": -156.2997, "country": "USA", "state": "Hawaii", "region": "Maui", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Hookipa", "lat": 20.9344, "lon": -156.3556, "country": "USA", "state": "Hawaii", "region": "Maui", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Lahaina Harbor", "lat": 20.8700, "lon": -156.6814, "country": "USA", "state": "Hawaii", "region": "Maui", "tier": 2, "wave_type": "Beach Break"},
    # Big Island
    {"name": "Banyans", "lat": 19.6397, "lon": -155.9897, "country": "USA", "state": "Hawaii", "region": "Big Island", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Pine Trees", "lat": 19.7831, "lon": -156.0533, "country": "USA", "state": "Hawaii", "region": "Big Island", "tier": 2, "wave_type": "Reef Break"},
    # Kauai
    {"name": "Hanalei Bay", "lat": 22.2078, "lon": -159.5044, "country": "USA", "state": "Hawaii", "region": "Kauai", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Tunnels", "lat": 22.2244, "lon": -159.5531, "country": "USA", "state": "Hawaii", "region": "Kauai", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Poipu Beach", "lat": 21.8764, "lon": -159.4542, "country": "USA", "state": "Hawaii", "region": "Kauai", "tier": 2, "wave_type": "Beach Break"},
    
    # PUERTO RICO - Complete
    {"name": "Rincon - Tres Palmas", "lat": 18.3431, "lon": -67.2717, "country": "USA", "state": "Puerto Rico", "region": "Rincon", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Rincon - Domes", "lat": 18.3550, "lon": -67.2767, "country": "USA", "state": "Puerto Rico", "region": "Rincon", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Rincon - Maria's", "lat": 18.3464, "lon": -67.2731, "country": "USA", "state": "Puerto Rico", "region": "Rincon", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Rincon - Indicators", "lat": 18.3528, "lon": -67.2764, "country": "USA", "state": "Puerto Rico", "region": "Rincon", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Aguadilla - Wilderness", "lat": 18.4594, "lon": -67.1561, "country": "USA", "state": "Puerto Rico", "region": "Aguadilla", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Aguadilla - Gas Chambers", "lat": 18.4750, "lon": -67.1556, "country": "USA", "state": "Puerto Rico", "region": "Aguadilla", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Jobos Beach", "lat": 18.4872, "lon": -67.0925, "country": "USA", "state": "Puerto Rico", "region": "Isabela", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Middles", "lat": 18.5094, "lon": -67.0619, "country": "USA", "state": "Puerto Rico", "region": "Isabela", "tier": 2, "wave_type": "Reef Break"},
    {"name": "La Pared", "lat": 18.1869, "lon": -65.7522, "country": "USA", "state": "Puerto Rico", "region": "Luquillo", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Aviones", "lat": 18.4089, "lon": -66.0450, "country": "USA", "state": "Puerto Rico", "region": "San Juan", "tier": 2, "wave_type": "Reef Break"},
    
    # CALIFORNIA - Complete Major Spots
    {"name": "Steamer Lane", "lat": 36.9508, "lon": -122.0256, "country": "USA", "state": "California", "region": "Santa Cruz", "tier": 2, "wave_type": "Point Break"},
    {"name": "Pleasure Point", "lat": 36.9625, "lon": -121.9753, "country": "USA", "state": "California", "region": "Santa Cruz", "tier": 2, "wave_type": "Point Break"},
    {"name": "Ocean Beach SF", "lat": 37.7595, "lon": -122.5107, "country": "USA", "state": "California", "region": "San Francisco", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Pacifica - Linda Mar", "lat": 37.5950, "lon": -122.5014, "country": "USA", "state": "California", "region": "San Francisco", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Bolinas", "lat": 37.9097, "lon": -122.6894, "country": "USA", "state": "California", "region": "Marin", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Stinson Beach", "lat": 37.9008, "lon": -122.6431, "country": "USA", "state": "California", "region": "Marin", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Lower Trestles", "lat": 33.3822, "lon": -117.5878, "country": "USA", "state": "California", "region": "San Clemente", "tier": 2, "wave_type": "Point Break"},
    {"name": "Upper Trestles", "lat": 33.3853, "lon": -117.5867, "country": "USA", "state": "California", "region": "San Clemente", "tier": 2, "wave_type": "Point Break"},
    {"name": "San Onofre", "lat": 33.3725, "lon": -117.5667, "country": "USA", "state": "California", "region": "San Clemente", "tier": 2, "wave_type": "Point Break"},
    {"name": "Swamis", "lat": 33.0361, "lon": -117.2919, "country": "USA", "state": "California", "region": "Encinitas", "tier": 2, "wave_type": "Point Break"},
    {"name": "Cardiff Reef", "lat": 33.0125, "lon": -117.2789, "country": "USA", "state": "California", "region": "Encinitas", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Oceanside Pier", "lat": 33.1933, "lon": -117.3889, "country": "USA", "state": "California", "region": "Oceanside", "tier": 2, "wave_type": "Beach Break"},
    {"name": "La Jolla Shores", "lat": 32.8575, "lon": -117.2553, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Windansea", "lat": 32.8308, "lon": -117.2806, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Pacific Beach", "lat": 32.7972, "lon": -117.2553, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Mission Beach", "lat": 32.7681, "lon": -117.2522, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Ocean Beach SD", "lat": 32.7483, "lon": -117.2544, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Sunset Cliffs", "lat": 32.7200, "lon": -117.2547, "country": "USA", "state": "California", "region": "San Diego", "tier": 2, "wave_type": "Reef Break"},
    {"name": "The Wedge", "lat": 33.5933, "lon": -117.8817, "country": "USA", "state": "California", "region": "Newport Beach", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Newport Point", "lat": 33.5944, "lon": -117.8797, "country": "USA", "state": "California", "region": "Newport Beach", "tier": 2, "wave_type": "Beach Break"},
    {"name": "54th Street Newport", "lat": 33.6025, "lon": -117.8897, "country": "USA", "state": "California", "region": "Newport Beach", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Venice Breakwater", "lat": 33.9889, "lon": -118.4722, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Beach Break"},
    {"name": "El Porto", "lat": 33.8969, "lon": -118.4181, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Manhattan Beach Pier", "lat": 33.8844, "lon": -118.4111, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Hermosa Beach", "lat": 33.8622, "lon": -118.3992, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Redondo Beach", "lat": 33.8497, "lon": -118.3931, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Topanga", "lat": 34.0397, "lon": -118.5767, "country": "USA", "state": "California", "region": "Los Angeles", "tier": 2, "wave_type": "Point Break"},
    {"name": "Malibu First Point", "lat": 34.0361, "lon": -118.6775, "country": "USA", "state": "California", "region": "Malibu", "tier": 2, "wave_type": "Point Break"},
    {"name": "Malibu Second Point", "lat": 34.0358, "lon": -118.6789, "country": "USA", "state": "California", "region": "Malibu", "tier": 2, "wave_type": "Point Break"},
    {"name": "Malibu Third Point", "lat": 34.0353, "lon": -118.6803, "country": "USA", "state": "California", "region": "Malibu", "tier": 2, "wave_type": "Point Break"},
    {"name": "Zuma Beach", "lat": 34.0183, "lon": -118.8194, "country": "USA", "state": "California", "region": "Malibu", "tier": 2, "wave_type": "Beach Break"},
    {"name": "County Line", "lat": 34.0511, "lon": -118.9467, "country": "USA", "state": "California", "region": "Ventura", "tier": 2, "wave_type": "Point Break"},
    {"name": "C Street Ventura", "lat": 34.2733, "lon": -119.2886, "country": "USA", "state": "California", "region": "Ventura", "tier": 2, "wave_type": "Point Break"},
    {"name": "Emma Wood", "lat": 34.2983, "lon": -119.3381, "country": "USA", "state": "California", "region": "Ventura", "tier": 2, "wave_type": "Point Break"},
    {"name": "Mondos", "lat": 34.3278, "lon": -119.3750, "country": "USA", "state": "California", "region": "Ventura", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Leadbetter Beach", "lat": 34.4025, "lon": -119.6972, "country": "USA", "state": "California", "region": "Santa Barbara", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Sands Beach", "lat": 34.4417, "lon": -119.8778, "country": "USA", "state": "California", "region": "Santa Barbara", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Jalama Beach", "lat": 34.5114, "lon": -120.5011, "country": "USA", "state": "California", "region": "Santa Barbara", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Pismo Beach Pier", "lat": 35.1419, "lon": -120.6422, "country": "USA", "state": "California", "region": "San Luis Obispo", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Morro Bay", "lat": 35.3658, "lon": -120.8619, "country": "USA", "state": "California", "region": "San Luis Obispo", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Cayucos Pier", "lat": 35.4428, "lon": -120.9031, "country": "USA", "state": "California", "region": "San Luis Obispo", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Big Sur - Andrew Molera", "lat": 36.2867, "lon": -121.8547, "country": "USA", "state": "California", "region": "Big Sur", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Carmel Beach", "lat": 36.5508, "lon": -121.9272, "country": "USA", "state": "California", "region": "Monterey", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Moss Landing", "lat": 36.8058, "lon": -121.7892, "country": "USA", "state": "California", "region": "Monterey", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Four Mile Beach", "lat": 37.0175, "lon": -122.1783, "country": "USA", "state": "California", "region": "Santa Cruz", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Davenport Landing", "lat": 37.0125, "lon": -122.1883, "country": "USA", "state": "California", "region": "Santa Cruz", "tier": 2, "wave_type": "Reef Break"},
    {"name": "Waddell Creek", "lat": 37.0978, "lon": -122.2756, "country": "USA", "state": "California", "region": "Santa Cruz", "tier": 2, "wave_type": "Beach Break"},
    
    # OREGON Coast
    {"name": "Seaside Cove", "lat": 45.9908, "lon": -123.9308, "country": "USA", "state": "Oregon", "region": "North Oregon", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Short Sands", "lat": 45.7614, "lon": -123.9642, "country": "USA", "state": "Oregon", "region": "North Oregon", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Cannon Beach", "lat": 45.8618, "lon": -123.9619, "country": "USA", "state": "Oregon", "region": "North Oregon", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Indian Beach", "lat": 45.9217, "lon": -123.9733, "country": "USA", "state": "Oregon", "region": "North Oregon", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Otter Rock", "lat": 44.7508, "lon": -124.0653, "country": "USA", "state": "Oregon", "region": "Central Oregon", "tier": 2, "wave_type": "Point Break"},
    {"name": "Agate Beach", "lat": 44.6650, "lon": -124.0597, "country": "USA", "state": "Oregon", "region": "Central Oregon", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Florence Jetties", "lat": 43.9678, "lon": -124.1069, "country": "USA", "state": "Oregon", "region": "Central Oregon", "tier": 2, "wave_type": "Jetty Break"},
    
    # WASHINGTON Coast
    {"name": "Westport Jetty", "lat": 46.9064, "lon": -124.1139, "country": "USA", "state": "Washington", "region": "Washington Coast", "tier": 2, "wave_type": "Jetty Break"},
    {"name": "Westport - Halfmoon Bay", "lat": 46.8886, "lon": -124.1167, "country": "USA", "state": "Washington", "region": "Washington Coast", "tier": 2, "wave_type": "Beach Break"},
    {"name": "La Push - First Beach", "lat": 47.9078, "lon": -124.6356, "country": "USA", "state": "Washington", "region": "Olympic Peninsula", "tier": 2, "wave_type": "Beach Break"},
    {"name": "La Push - Second Beach", "lat": 47.8994, "lon": -124.6269, "country": "USA", "state": "Washington", "region": "Olympic Peninsula", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Rialto Beach", "lat": 47.9203, "lon": -124.6372, "country": "USA", "state": "Washington", "region": "Olympic Peninsula", "tier": 2, "wave_type": "Beach Break"},
    {"name": "Long Beach", "lat": 46.3519, "lon": -124.0539, "country": "USA", "state": "Washington", "region": "Washington Coast", "tier": 2, "wave_type": "Beach Break"},
    
    # TEXAS Gulf Coast
    {"name": "South Padre Island", "lat": 26.0764, "lon": -97.1575, "country": "USA", "state": "Texas", "region": "South Texas", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Port Aransas - Horace Caldwell Pier", "lat": 27.8267, "lon": -97.0567, "country": "USA", "state": "Texas", "region": "Corpus Christi", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Galveston - 61st Street", "lat": 29.2644, "lon": -94.8431, "country": "USA", "state": "Texas", "region": "Galveston", "tier": 1, "wave_type": "Beach Break"},
    {"name": "Surfside Beach", "lat": 28.9447, "lon": -95.2850, "country": "USA", "state": "Texas", "region": "Brazoria", "tier": 1, "wave_type": "Beach Break"},
]


async def import_curated_spots(db_session) -> int:
    """Import curated surf spots into the database."""
    from models import SurfSpot
    from sqlalchemy import select
    
    imported = 0
    
    for spot_data in CURATED_SPOTS:
        # Check if spot already exists (by name and country)
        result = await db_session.execute(
            select(SurfSpot).where(
                SurfSpot.name == spot_data["name"],
                SurfSpot.country == spot_data["country"]
            )
        )
        existing = result.scalar_one_or_none()
        
        if not existing:
            spot = SurfSpot(
                name=spot_data["name"],
                latitude=spot_data["lat"],
                longitude=spot_data["lon"],
                country=spot_data["country"],
                state_province=spot_data["state"],
                region=spot_data["region"],
                import_tier=spot_data["tier"],
                wave_type=spot_data.get("wave_type"),
                is_active=True
            )
            db_session.add(spot)
            imported += 1
            logger.info(f"Imported: {spot_data['name']} ({spot_data['country']})")
    
    await db_session.commit()
    return imported


async def fetch_osm_surf_spots(bbox: str) -> List[Dict]:
    """Fetch surf spots from OSM Overpass API for a bounding box."""
    query = f"""
    [out:json][timeout:60];
    (
      node["sport"="surfing"]({bbox});
      node["leisure"="surfing"]({bbox});
      node["natural"="beach"]["sport"="surfing"]({bbox});
      way["sport"="surfing"]({bbox});
    );
    out center;
    """
    
    try:
        async with aiohttp.ClientSession() as session:
            async with session.post(OVERPASS_API, data={"data": query}, timeout=aiohttp.ClientTimeout(total=120)) as response:
                if response.status == 200:
                    data = await response.json()
                    return data.get("elements", [])
                else:
                    logger.error(f"OSM API error: {response.status}")
                    return []
    except Exception as e:
        logger.error(f"Error fetching OSM data: {e}")
        return []


async def import_osm_spots(db_session, tier: int = 1) -> int:
    """Import spots from OSM for a specific tier."""
    from models import SurfSpot
    from sqlalchemy import select
    
    region_config = IMPORT_REGIONS.get(tier)
    if not region_config:
        return 0
    
    imported = 0
    bboxes = []
    
    if "bbox" in region_config:
        bboxes.append(region_config["bbox"])
    if "regions" in region_config:
        for r in region_config["regions"]:
            if "bbox" in r:
                bboxes.append(r["bbox"])
    
    for bbox in bboxes:
        elements = await fetch_osm_surf_spots(bbox)
        
        for elem in elements:
            osm_id = str(elem.get("id"))
            
            # Get coordinates
            lat = elem.get("lat") or elem.get("center", {}).get("lat")
            lon = elem.get("lon") or elem.get("center", {}).get("lon")
            
            if not lat or not lon:
                continue
            
            tags = elem.get("tags", {})
            name = tags.get("name", tags.get("description", f"Surf Spot {osm_id}"))
            
            # Check if already exists
            result = await db_session.execute(
                select(SurfSpot).where(SurfSpot.osm_id == osm_id)
            )
            existing = result.scalar_one_or_none()
            
            if not existing:
                spot = SurfSpot(
                    name=name,
                    osm_id=osm_id,
                    latitude=lat,
                    longitude=lon,
                    import_tier=tier,
                    description=tags.get("description"),
                    is_active=True
                )
                db_session.add(spot)
                imported += 1
    
    await db_session.commit()
    return imported


async def run_global_import(tiers: List[int] = [1, 2, 3]):
    """Run the full global import process."""
    from database import AsyncSessionLocal
    
    async with AsyncSessionLocal() as db:
        total_imported = 0
        
        # First import curated spots (high quality, verified)
        logger.info("Importing curated spots...")
        curated_count = await import_curated_spots(db)
        total_imported += curated_count
        logger.info(f"Imported {curated_count} curated spots")
        
        # Then import from OSM for each tier
        for tier in tiers:
            logger.info(f"Importing Tier {tier} from OSM...")
            osm_count = await import_osm_spots(db, tier)
            total_imported += osm_count
            logger.info(f"Imported {osm_count} OSM spots for Tier {tier}")
        
        return total_imported


if __name__ == "__main__":
    import sys
    logging.basicConfig(level=logging.INFO)
    
    tiers = [1, 2, 3]  # Import all tiers by default
    if len(sys.argv) > 1:
        tiers = [int(t) for t in sys.argv[1:]]
    
    total = asyncio.run(run_global_import(tiers))
    print(f"\nTotal spots imported: {total}")
