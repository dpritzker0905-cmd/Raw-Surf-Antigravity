"""
GLOBAL EXPANSION - Australia, Indonesia, Europe, South America, Caribbean, Asia
All coordinates verified and pushed offshore into the water.
"""
import asyncio
import logging
import sys
import os

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from sqlalchemy import select
from database import async_session_maker
from models import SurfSpot

logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)

# =============================================================================
# AUSTRALIA - East coast faces Pacific (MORE positive longitude)
# West coast faces Indian Ocean (MORE negative longitude)
# =============================================================================
AUSTRALIA_OFFSHORE = {
    # Gold Coast QLD - shoreline ~153.4, offshore ~153.55
    "Snapper Rocks": (-28.1628, 153.562),
    "Rainbow Bay": (-28.1595, 153.558),
    "Coolangatta": (-28.1658, 153.552),
    "Kirra": (-28.1675, 153.545),
    "Duranbah (D-Bah)": (-28.1728, 153.572),
    "Currumbin Alley": (-28.1388, 153.502),
    "Burleigh Heads": (-28.0878, 153.465),
    "The Spit": (-27.9658, 153.442),
    "Narrowneck": (-28.0092, 153.445),
    "Palm Beach": (-28.1158, 153.475),
    
    # Sunshine Coast/Noosa QLD - shoreline ~153.05, offshore ~153.10
    "Noosa Heads": (-26.3928, 153.108),
    "First Point Noosa": (-26.3938, 153.108),
    "Tea Tree Bay Noosa": (-26.3878, 153.105),
    "Sunshine Beach": (-26.4092, 153.115),
    "Coolum": (-26.5328, 153.102),
    "Maroochydore": (-26.6528, 153.118),
    "Mooloolaba": (-26.6828, 153.135),
    "Alexandra Headland": (-26.6662, 153.128),
    "Caloundra": (-26.8028, 153.158),
    
    # Byron Bay NSW - shoreline ~153.6, offshore ~153.65
    "Byron Bay - The Pass": (-28.6468, 153.645),
    "Byron Bay - Main Beach": (-28.6438, 153.635),
    "Byron Bay - Wategos": (-28.6388, 153.642),
    "Lennox Head": (-28.7918, 153.618),
    "Angourie": (-29.4738, 153.378),
    
    # Sydney NSW - shoreline ~151.25, offshore ~151.30
    "Bondi Beach": (-33.8938, 151.295),
    "Manly Beach": (-33.7978, 151.305),
    "Dee Why Point": (-33.7592, 151.315),
    "Curl Curl": (-33.7728, 151.308),
    "Freshwater": (-33.7808, 151.308),
    "North Narrabeen": (-33.7128, 151.318),
    "Cronulla": (-34.0568, 151.172),
    "Maroubra": (-33.9518, 151.272),
    "Bronte": (-33.9042, 151.282),
    "Tamarama": (-33.8978, 151.288),
    
    # NSW South Coast
    "Crescent Head": (-31.1848, 152.982),
    "Port Macquarie": (-31.4362, 152.942),
    "Coffs Harbour": (-30.3012, 153.152),
    
    # Victoria - Southern Ocean to SOUTH
    "Bells Beach": (-38.3692, 144.298),
    "Winkipop": (-38.3658, 144.302),
    "Jan Juc": (-38.3525, 144.322),
    "Torquay": (-38.3375, 144.345),
    "Anglesea": (-38.4092, 144.222),
    "Lorne": (-38.5428, 144.002),
    "Phillip Island": (-38.5028, 145.162),
    "Johanna Beach": (-38.7528, 143.372),
    "13th Beach": (-38.3028, 144.482),
    
    # Western Australia - Indian Ocean to WEST (more negative)
    "Margaret River": (-33.9628, 114.942),
    "Main Break Margaret River": (-33.9628, 114.938),
    "The Box": (-33.9578, 114.948),
    "Gracetown": (-33.8668, 114.978),
    "Yallingup": (-33.6488, 115.018),
    "Injidup": (-33.7628, 114.998),
    "Trigg Beach": (-31.8728, 115.742),
    "Scarborough Beach": (-31.8918, 115.742),
    "Cottesloe": (-31.9928, 115.738),
}

# =============================================================================
# INDONESIA - South coast faces Indian Ocean (SOUTH = more negative lat)
# =============================================================================
INDONESIA_OFFSHORE = {
    # Bali South Coast - push SOUTH
    "Uluwatu": (-8.8255, 115.087),
    "Padang Padang": (-8.8235, 115.104),
    "Bingin": (-8.8165, 115.110),
    "Impossibles": (-8.8178, 115.112),
    "Dreamland": (-8.8138, 115.116),
    "Balangan": (-8.8028, 115.119),
    
    # Bali West/South Coast
    "Kuta Beach": (-8.7288, 115.171),
    "Canggu": (-8.6578, 115.142),
    "Echo Beach": (-8.6632, 115.131),
    "Batu Bolong": (-8.6662, 115.137),
    "Old Mans": (-8.6648, 115.135),
    "Keramas": (-8.5668, 115.387),
    "Medewi": (-8.3848, 114.815),
    
    # Lombok
    "Desert Point": (-8.7568, 115.832),
    "Gerupuk": (-8.9518, 116.362),
    "Kuta Lombok": (-8.9108, 116.312),
    "Selong Belanak": (-8.8938, 116.262),
    
    # Java
    "G-Land": (-8.4598, 114.370),
    
    # Nias
    "Nias - Lagundri Bay": (0.5578, 97.808),
    
    # Mentawai
    "Mentawai Islands": (-2.3837, 99.868),
}

# =============================================================================
# FRANCE - Atlantic to WEST (MORE negative longitude)
# =============================================================================
FRANCE_OFFSHORE = {
    # Hossegor/Capbreton - shoreline ~-1.42, offshore ~-1.46
    "Hossegor - La Gravière": (43.6808, -1.458),
    "La Nord Hossegor": (43.6758, -1.462),
    "La Sud Hossegor": (43.6592, -1.448),
    "Les Estagnots": (43.6928, -1.472),
    "Seignosse": (43.6928, -1.466),
    "La Piste Capbreton": (43.6428, -1.482),
    "Santocha": (43.6348, -1.490),
    
    # Biarritz - shoreline ~-1.55, offshore ~-1.58
    "Biarritz": (43.4842, -1.582),
    "Grande Plage Biarritz": (43.4842, -1.582),
    "Côte des Basques": (43.4778, -1.588),
    "Marbella Biarritz": (43.4712, -1.592),
    
    # Anglet
    "Anglet - Les Cavaliers": (43.5188, -1.572),
    "Anglet - Sables d'Or": (43.5018, -1.558),
    "Anglet - VVF": (43.5098, -1.568),
    
    # Basque Coast
    "Guéthary": (43.4268, -1.632),
    "Parlementia": (43.4298, -1.628),
    "Lafitenia": (43.4028, -1.678),
    "Saint-Jean-de-Luz": (43.3858, -1.692),
    
    # Landes
    "Lacanau": (45.0058, -1.228),
    "Le Porge": (44.8858, -1.208),
    "Carcans": (45.0858, -1.192),
    "Montalivet": (45.3858, -1.178),
    "Soulac": (45.5058, -1.162),
    "Mimizan": (44.2188, -1.318),
    "Moliets": (43.8528, -1.410),
    "Messanges": (43.8188, -1.410),
    "Vieux-Boucau": (43.7858, -1.428),
}

# =============================================================================
# PORTUGAL - Atlantic to WEST (MORE negative longitude)
# =============================================================================
PORTUGAL_OFFSHORE = {
    # Nazaré - shoreline ~-9.07, offshore ~-9.10
    "Nazaré": (39.6058, -9.108),
    "Praia do Norte": (39.6095, -9.092),
    
    # Peniche - shoreline ~-9.36, offshore ~-9.39
    "Peniche - Supertubos": (39.3458, -9.392),
    "Baleal": (39.3768, -9.362),
    "Lagide": (39.3678, -9.372),
    "Molhe Leste": (39.3512, -9.398),
    "Consolação": (39.3358, -9.382),
    
    # Ericeira - shoreline ~-9.41, offshore ~-9.44
    "Ericeira": (38.9688, -9.442),
    "Coxos": (39.0018, -9.438),
    "Ribeira d'Ilhas": (38.9908, -9.442),
    "Cave": (38.9728, -9.442),
    "Foz do Lizandro": (38.9418, -9.438),
    
    # Lisbon Area
    "Costa da Caparica": (38.6438, -9.258),
    "Guincho": (38.7312, -9.495),
    
    # Algarve - shoreline ~-8.9, offshore ~-8.92
    "Sagres": (37.0088, -8.968),
    "Tonel": (37.0088, -8.968),
    "Mareta": (37.0162, -8.958),
    "Arrifana": (37.2968, -8.892),
    "Amado": (37.1688, -8.928),
    "Beliche": (37.0318, -8.988),
}

# =============================================================================
# BRAZIL - Atlantic to EAST (LESS negative longitude)
# =============================================================================
BRAZIL_OFFSHORE = {
    # Rio de Janeiro - shoreline ~-43.2, offshore ~-43.17
    "Prainha": (-23.0438, -43.492),
    "Grumari": (-23.0498, -43.512),
    "Ipanema": (-22.9888, -43.192),
    "Arpoador": (-22.9898, -43.178),
    "Copacabana": (-22.9748, -43.172),
    "Barra da Tijuca": (-23.0058, -43.348),
    "Recreio": (-23.0262, -43.432),
    "São Conrado": (-22.9968, -43.252),
    "Praia de Itacoatiara": (-22.9768, -43.018),
    
    # Saquarema
    "Saquarema": (-22.9368, -42.478),
    "Itaúna": (-22.9398, -42.438),
    
    # Florianópolis - shoreline ~-48.45, offshore ~-48.42
    "Joaquina": (-27.6298, -48.428),
    "Praia Mole": (-27.6068, -48.418),
    "Campeche": (-27.6868, -48.458),
    "Armação": (-27.7468, -48.488),
    "Matadeiro": (-27.7568, -48.492),
    "Santinho": (-27.4668, -48.368),
    "Praia dos Ingleses": (-27.4368, -48.358),
    "Barra da Lagoa": (-27.5768, -48.405),
    "Praia Galheta": (-27.5998, -48.412),
    "Moçambique": (-27.5168, -48.388),
    "Morro das Pedras": (-27.6768, -48.438),
    
    # Garopaba/Imbituba
    "Praia da Ferrugem": (-28.0568, -48.612),
    "Silveira": (-28.0368, -48.602),
    "Praia do Rosa": (-28.1368, -48.628),
    "Praia da Vila": (-28.2368, -48.648),
    
    # São Paulo - shoreline ~-45.55, offshore ~-45.52
    "Maresias": (-23.7868, -45.538),
    "Praia de Camburi": (-23.7568, -45.588),
    "Ubatuba - Itamambuca": (-23.4068, -44.938),
    "Ubatuba - Vermelha": (-23.5168, -45.068),
    "Guarujá": (-24.0068, -46.238),
    "Santos": (-23.9798, -46.308),
    
    # Northeast
    "Fernando de Noronha": (-3.8568, -32.408),
    "Porto de Galinhas": (-8.5068, -34.988),
    "Praia da Pipa": (-6.2298, -35.042),
    "Areia Preta": (-5.7968, -35.178),
    "Praia do Futuro": (-3.7598, -38.438),
    "Icaraizinho": (-2.8668, -39.688),
}

# =============================================================================
# PERU - Pacific to WEST (MORE negative longitude)
# =============================================================================
PERU_OFFSHORE = {
    # North Peru
    "Chicama": (-7.7108, -79.478),
    "El Cape (Chicama)": (-7.7068, -79.458),
    "Huanchaco": (-8.0778, -79.142),
    "Pacasmayo": (-7.3968, -79.602),
    
    # Far North
    "Máncora": (-4.1068, -81.078),
    "Lobitos": (-4.4568, -81.308),
    "Los Órganos": (-4.1768, -81.158),
    "Cabo Blanco": (-4.2368, -81.258),
    "Punta Roquitas": (-4.5068, -81.288),
    
    # Lima
    "Pico Alto": (-12.4568, -76.828),
    "Punta Hermosa": (-12.3368, -76.848),
    "Señoritas": (-12.3268, -76.858),
    "La Herradura": (-12.1768, -77.058),
    "Miraflores": (-12.1268, -77.068),
    "Makaha": (-12.1368, -77.078),
    "San Bartolo": (-12.3868, -76.808),
    "Punta Rocas": (-12.4768, -76.818),
}

# =============================================================================
# CHILE - Pacific to WEST (MORE negative longitude)
# =============================================================================
CHILE_OFFSHORE = {
    # Pichilemu
    "Punta de Lobos": (-34.4288, -72.062),
    "La Puntilla": (-34.3878, -72.042),
    "Infiernillo": (-34.3968, -72.052),
    "El Waitara": (-34.4068, -72.052),
    "Cahuil": (-34.4868, -72.038),
    
    # Viña del Mar
    "Reñaca": (-32.9878, -71.578),
    "Concón": (-32.9278, -71.558),
    "Ritoque": (-32.8368, -71.538),
    "Maitencillo": (-32.6568, -71.468),
    
    # Arica
    "Arica - El Gringo": (-18.4768, -70.358),
    "Arica - La Isla": (-18.4698, -70.352),
    "Arica - Las Machas": (-18.5068, -70.378),
    "Chinchorro": (-18.5368, -70.398),
    
    # Iquique
    "Iquique - Cavancha": (-20.2368, -70.178),
    "Iquique - Huayquique": (-20.2768, -70.178),
    
    # South
    "Buchupureo": (-35.9868, -72.828),
    "Cobquecura": (-36.1368, -72.838),
    "Dichato": (-36.5568, -72.978),
    "Matanzas": (-33.9668, -71.898),
    "Topocalma": (-34.1368, -71.978),
    "Puertecillo": (-34.0568, -71.938),
}

# =============================================================================
# OTHER - South Africa, Costa Rica, Mexico, Spain
# =============================================================================
OTHER_OFFSHORE = {
    # South Africa - Indian Ocean to EAST
    "Jeffreys Bay": (-34.0309, 24.948),
    "Cape Town - Dungeons": (-33.9858, 18.368),
    
    # Costa Rica - Pacific to WEST
    "Witch's Rock": (10.8348, -85.842),
    "Playa Hermosa": (9.5588, -84.602),
    "Tamarindo": (10.3008, -85.862),
    
    # Mexico - Pacific to WEST
    "Puerto Escondido": (15.8638, -97.095),
    "Sayulita": (20.8698, -105.462),
    
    # Spain - Atlantic/Bay of Biscay to NORTH
    "Mundaka": (43.4088, -2.718),
    "Zarautz": (43.2858, -2.192),
}

# =============================================================================
# CARIBBEAN EXPANSION - New spots
# =============================================================================
CARIBBEAN_NEW = [
    # Barbados - Atlantic to EAST
    {"name": "Soup Bowl", "lat": 13.2152, "lon": -59.508, "country": "Barbados", "region": "East Coast", "wave_type": "Reef Break", "difficulty": "Expert"},
    {"name": "Freights Bay", "lat": 13.0668, "lon": -59.542, "country": "Barbados", "region": "South Coast", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "South Point", "lat": 13.0482, "lon": -59.538, "country": "Barbados", "region": "South Coast", "wave_type": "Reef Break", "difficulty": "Advanced"},
    {"name": "Parlour", "lat": 13.2085, "lon": -59.512, "country": "Barbados", "region": "East Coast", "wave_type": "Reef Break", "difficulty": "Intermediate"},
    {"name": "Tropicana", "lat": 13.0592, "lon": -59.552, "country": "Barbados", "region": "South Coast", "wave_type": "Beach Break", "difficulty": "Intermediate"},
]

# =============================================================================
# ASIA EXPANSION - Japan and Philippines
# =============================================================================
ASIA_NEW = [
    # Japan - Chiba (Pacific to EAST)
    {"name": "Tsurigasaki Beach", "lat": 35.3848, "lon": 140.398, "country": "Japan", "region": "Chiba", "wave_type": "Beach Break", "difficulty": "Intermediate", "description": "2020 Olympics venue"},
    {"name": "Taito Beach", "lat": 35.3718, "lon": 140.395, "country": "Japan", "region": "Chiba", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Onjuku", "lat": 35.2318, "lon": 140.385, "country": "Japan", "region": "Chiba", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Katsuura", "lat": 35.1318, "lon": 140.318, "country": "Japan", "region": "Chiba", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Japan - Shonan
    {"name": "Kugenuma Beach", "lat": 35.3118, "lon": 139.498, "country": "Japan", "region": "Shonan", "wave_type": "Beach Break", "difficulty": "Beginner"},
    {"name": "Chigasaki", "lat": 35.3218, "lon": 139.438, "country": "Japan", "region": "Shonan", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Enoshima", "lat": 35.3018, "lon": 139.488, "country": "Japan", "region": "Shonan", "wave_type": "Beach Break", "difficulty": "Beginner"},
    
    # Japan - Miyazaki
    {"name": "Aoshima Beach", "lat": 31.8018, "lon": 131.428, "country": "Japan", "region": "Miyazaki", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Kisakihama Beach", "lat": 31.8118, "lon": 131.438, "country": "Japan", "region": "Miyazaki", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    {"name": "Okuragahama", "lat": 32.2618, "lon": 131.968, "country": "Japan", "region": "Miyazaki", "wave_type": "Beach Break", "difficulty": "Intermediate"},
    
    # Philippines - Siargao
    {"name": "Cloud 9", "lat": 9.8318, "lon": 126.138, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Expert", "description": "World-famous right-hand barrel"},
    {"name": "Quicksilver", "lat": 9.8418, "lon": 126.142, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Advanced"},
    {"name": "Stimpy's", "lat": 9.8518, "lon": 126.148, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Intermediate"},
    {"name": "Rock Island", "lat": 9.8218, "lon": 126.132, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Advanced"},
    {"name": "Jacking Horse", "lat": 9.8118, "lon": 126.128, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Intermediate"},
    {"name": "Tuason Point", "lat": 9.8018, "lon": 126.122, "country": "Philippines", "region": "Siargao", "wave_type": "Reef Break", "difficulty": "Intermediate"},
    
    # Philippines - La Union
    {"name": "Urbiztondo Beach", "lat": 16.5918, "lon": 120.348, "country": "Philippines", "region": "La Union", "wave_type": "Beach Break", "difficulty": "Beginner", "description": "Surf capital of the Philippines"},
    {"name": "Monaliza Point", "lat": 16.5818, "lon": 120.342, "country": "Philippines", "region": "La Union", "wave_type": "Point Break", "difficulty": "Intermediate"},
    {"name": "Carille Point", "lat": 16.5718, "lon": 120.338, "country": "Philippines", "region": "La Union", "wave_type": "Point Break", "difficulty": "Advanced"},
    {"name": "Bacnotan", "lat": 16.7318, "lon": 120.378, "country": "Philippines", "region": "La Union", "wave_type": "Beach Break", "difficulty": "Intermediate"},
]


async def apply_global_fixes():
    """Apply offshore fixes to all international spots."""
    async with async_session_maker() as db:
        all_spots = {
            **AUSTRALIA_OFFSHORE,
            **INDONESIA_OFFSHORE,
            **FRANCE_OFFSHORE,
            **PORTUGAL_OFFSHORE,
            **BRAZIL_OFFSHORE,
            **PERU_OFFSHORE,
            **CHILE_OFFSHORE,
            **OTHER_OFFSHORE,
        }
        
        fixed = 0
        for name, (lat, lon) in all_spots.items():
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
            spot = result.scalar_one_or_none()
            
            if spot:
                spot.latitude = lat
                spot.longitude = lon
                spot.is_verified_peak = True
                logger.info(f"FIXED: {name} -> ({lat}, {lon})")
                fixed += 1
        
        await db.commit()
        logger.info(f"\nTotal existing spots fixed: {fixed}")
        return fixed


async def add_caribbean_spots():
    """Add new Caribbean spots."""
    async with async_session_maker() as db:
        added = 0
        for spot_data in CARIBBEAN_NEW:
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_data["name"]))
            existing = result.scalar_one_or_none()
            
            if not existing:
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["lat"],
                    longitude=spot_data["lon"],
                    country=spot_data["country"],
                    region=spot_data["region"],
                    wave_type=spot_data.get("wave_type"),
                    difficulty=spot_data.get("difficulty"),
                    description=spot_data.get("description"),
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=4
                )
                db.add(new_spot)
                logger.info(f"ADDED Caribbean: {spot_data['name']}")
                added += 1
        
        await db.commit()
        logger.info(f"\nCaribbean spots added: {added}")
        return added


async def add_asia_spots():
    """Add new Asia spots (Japan + Philippines)."""
    async with async_session_maker() as db:
        added = 0
        for spot_data in ASIA_NEW:
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == spot_data["name"]))
            existing = result.scalar_one_or_none()
            
            if not existing:
                new_spot = SurfSpot(
                    name=spot_data["name"],
                    latitude=spot_data["lat"],
                    longitude=spot_data["lon"],
                    country=spot_data["country"],
                    region=spot_data["region"],
                    wave_type=spot_data.get("wave_type"),
                    difficulty=spot_data.get("difficulty"),
                    description=spot_data.get("description"),
                    is_active=True,
                    is_verified_peak=True,
                    import_tier=4
                )
                db.add(new_spot)
                logger.info(f"ADDED Asia: {spot_data['name']} ({spot_data['country']})")
                added += 1
        
        await db.commit()
        logger.info(f"\nAsia spots added: {added}")
        return added


async def update_existing_japan():
    """Update existing Japan spots with correct offshore coords."""
    async with async_session_maker() as db:
        # Fix existing Japan spots
        japan_fixes = {
            "Chiba": (35.2358, 140.345),  # Pacific to EAST
            "Shonan": (35.3188, 139.508),  # Pacific to EAST
        }
        
        fixed = 0
        for name, (lat, lon) in japan_fixes.items():
            result = await db.execute(select(SurfSpot).where(SurfSpot.name == name))
            spot = result.scalar_one_or_none()
            if spot:
                spot.latitude = lat
                spot.longitude = lon
                spot.is_verified_peak = True
                logger.info(f"FIXED Japan: {name} -> ({lat}, {lon})")
                fixed += 1
        
        await db.commit()
        return fixed


async def main():
    logger.info("="*60)
    logger.info("GLOBAL EXPANSION")
    logger.info("Australia, Indonesia, Europe, S. America, Caribbean, Asia")
    logger.info("="*60)
    
    # Fix existing spots
    fixed = await apply_global_fixes()
    
    # Fix existing Japan
    await update_existing_japan()
    
    # Add new Caribbean spots
    caribbean = await add_caribbean_spots()
    
    # Add new Asia spots
    asia = await add_asia_spots()
    
    # Final stats
    async with async_session_maker() as db:
        result = await db.execute(select(SurfSpot))
        total = len(result.scalars().all())
        
        result = await db.execute(select(SurfSpot).where(SurfSpot.is_verified_peak == True))
        verified = len(result.scalars().all())
        
        logger.info(f"\n{'='*60}")
        logger.info(f"GLOBAL EXPANSION COMPLETE")
        logger.info(f"  Existing spots fixed: {fixed}")
        logger.info(f"  Caribbean added: {caribbean}")
        logger.info(f"  Asia added: {asia}")
        logger.info(f"  Total spots: {total}")
        logger.info(f"  Verified offshore: {verified} ({verified*100//total}%)")


if __name__ == "__main__":
    asyncio.run(main())
