from supabase import create_client, Client
import os
from dotenv import load_dotenv
from pathlib import Path
import datetime

ROOT_DIR = Path(__file__).parent
load_dotenv(ROOT_DIR / '.env')

url: str = os.environ.get("SUPABASE_URL")
key: str = os.environ.get("SUPABASE_KEY")
supabase: Client = create_client(url, key)

missingSpots = [
    {'name': 'Worms Head', 'region': 'Gower Peninsula', 'country': 'Wales', 'latitude': 51.5640, 'longitude': -4.3010, 'difficulty': 'Advanced', 'wave_type': 'Reef Break'},
    {'name': "St. Ouen's Bay", 'region': 'Jersey', 'country': 'Channel Islands', 'latitude': 49.2060, 'longitude': -2.2350, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Portrush', 'region': 'County Antrim', 'country': 'Northern Ireland', 'latitude': 55.2010, 'longitude': -6.6570, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Castlerock', 'region': 'County Londonderry', 'country': 'Northern Ireland', 'latitude': 55.1660, 'longitude': -6.7900, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Belmullet', 'region': 'County Mayo', 'country': 'Ireland', 'latitude': 54.2260, 'longitude': -10.0000, 'difficulty': 'Advanced', 'wave_type': 'Reef Break'},
    {'name': 'Lacanau Ocean', 'region': 'Gironde', 'country': 'France', 'latitude': 45.0020, 'longitude': -1.2000, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Vieux Boucau', 'region': 'Landes', 'country': 'France', 'latitude': 43.7840, 'longitude': -1.4110, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Somo', 'region': 'Cantabria', 'country': 'Spain', 'latitude': 43.4680, 'longitude': -3.7370, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Ribadesella', 'region': 'Asturias', 'country': 'Spain', 'latitude': 43.4680, 'longitude': -5.0680, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Pantin', 'region': 'Galicia', 'country': 'Spain', 'latitude': 43.6390, 'longitude': -8.1130, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Afife', 'region': 'Viana do Castelo', 'country': 'Portugal', 'latitude': 41.7760, 'longitude': -8.8780, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Carcavelos', 'region': 'Lisbon', 'country': 'Portugal', 'latitude': 38.6790, 'longitude': -9.3350, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Amado', 'region': 'Algarve', 'country': 'Portugal', 'latitude': 37.1660, 'longitude': -8.9020, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Playa de Famara', 'region': 'Lanzarote', 'country': 'Canary Islands', 'latitude': 29.1170, 'longitude': -13.5650, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'La Santa', 'region': 'Lanzarote', 'country': 'Canary Islands', 'latitude': 29.1150, 'longitude': -13.6520, 'difficulty': 'Advanced', 'wave_type': 'Reef Break'},
    {'name': 'Los Lobos', 'region': 'Fuerteventura', 'country': 'Canary Islands', 'latitude': 28.7490, 'longitude': -13.8200, 'difficulty': 'Advanced', 'wave_type': 'Point Break'},
    {'name': 'Majanicho', 'region': 'Fuerteventura', 'country': 'Canary Islands', 'latitude': 28.7390, 'longitude': -13.9350, 'difficulty': 'Intermediate', 'wave_type': 'Reef Break'},
    {'name': 'El Quemao', 'region': 'Lanzarote', 'country': 'Canary Islands', 'latitude': 29.1120, 'longitude': -13.6380, 'difficulty': 'Expert', 'wave_type': 'Reef Break'},
    {'name': 'Cox Bay', 'region': 'Tofino', 'country': 'Canada', 'latitude': 49.1020, 'longitude': -125.8770, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Chesterman Beach', 'region': 'Tofino', 'country': 'Canada', 'latitude': 49.1190, 'longitude': -125.8940, 'difficulty': 'Beginner', 'wave_type': 'Beach Break'},
    {'name': 'Lawrencetown', 'region': 'Nova Scotia', 'country': 'Canada', 'latitude': 44.6460, 'longitude': -63.3510, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Martinique Beach', 'region': 'Nova Scotia', 'country': 'Canada', 'latitude': 44.7070, 'longitude': -63.1490, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Sandvik', 'region': 'Reykjanes', 'country': 'Iceland', 'latitude': 63.8500, 'longitude': -22.7160, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Thorlasnes', 'region': 'South Coast', 'country': 'Iceland', 'latitude': 63.8440, 'longitude': -22.4280, 'difficulty': 'Advanced', 'wave_type': 'Reef Break'},
    {'name': 'Unstad', 'region': 'Lofoten Islands', 'country': 'Norway', 'latitude': 68.2670, 'longitude': 13.5850, 'difficulty': 'Advanced', 'wave_type': 'Point Break'},
    {'name': 'Hoddevik', 'region': 'Stadlandet', 'country': 'Norway', 'latitude': 62.1190, 'longitude': 5.1430, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Playa Grande', 'region': 'Mar del Plata', 'country': 'Argentina', 'latitude': -38.0330, 'longitude': -57.5330, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Biologia', 'region': 'Mar del Plata', 'country': 'Argentina', 'latitude': -38.0300, 'longitude': -57.5300, 'difficulty': 'Beginner', 'wave_type': 'Beach Break'},
    {'name': 'Miramar', 'region': 'Buenos Aires', 'country': 'Argentina', 'latitude': -38.2830, 'longitude': -57.8330, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'La Olla', 'region': 'Punta del Este', 'country': 'Uruguay', 'latitude': -34.9540, 'longitude': -54.9350, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Playa El Emir', 'region': 'Punta del Este', 'country': 'Uruguay', 'latitude': -34.9610, 'longitude': -54.9380, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Los Botes', 'region': 'La Paloma', 'country': 'Uruguay', 'latitude': -34.6620, 'longitude': -54.1610, 'difficulty': 'Intermediate', 'wave_type': 'Point Break'},
    {'name': 'Santa Iria', 'region': 'Sao Miguel', 'country': 'Portugal', 'latitude': 37.8180, 'longitude': -25.5900, 'difficulty': 'Intermediate', 'wave_type': 'Reef Break'},
    {'name': 'Ribeira Grande', 'region': 'Sao Miguel', 'country': 'Portugal', 'latitude': 37.8220, 'longitude': -25.5220, 'difficulty': 'Intermediate', 'wave_type': 'Beach Break'},
    {'name': 'Faja da Caldeira', 'region': 'Sao Jorge', 'country': 'Portugal', 'latitude': 38.6250, 'longitude': -27.9300, 'difficulty': 'Advanced', 'wave_type': 'Point Break'},
    {'name': 'Jardim do Mar', 'region': 'Madeira', 'country': 'Portugal', 'latitude': 32.7380, 'longitude': -17.2120, 'difficulty': 'Expert', 'wave_type': 'Point Break'},
    {'name': 'Paul do Mar', 'region': 'Madeira', 'country': 'Portugal', 'latitude': 32.7520, 'longitude': -17.2340, 'difficulty': 'Advanced', 'wave_type': 'Point Break'},
    {'name': 'Ponta Preta', 'region': 'Sal', 'country': 'Cape Verde', 'latitude': 16.5860, 'longitude': -22.9230, 'difficulty': 'Expert', 'wave_type': 'Reef Break'},
    {'name': 'Kite Beach', 'region': 'Sal', 'country': 'Cape Verde', 'latitude': 16.6110, 'longitude': -22.8880, 'difficulty': 'Beginner', 'wave_type': 'Beach Break'},
    {'name': 'Tamarin Bay', 'region': 'Black River', 'country': 'Mauritius', 'latitude': -20.3220, 'longitude': 57.3730, 'difficulty': 'Expert', 'wave_type': 'Reef Break'},
    {'name': 'One Eye', 'region': 'Le Morne', 'country': 'Mauritius', 'latitude': -20.4630, 'longitude': 57.3110, 'difficulty': 'Expert', 'wave_type': 'Reef Break'},
    {'name': 'Maconde', 'region': 'South Coast', 'country': 'Mauritius', 'latitude': -20.4850, 'longitude': 57.3820, 'difficulty': 'Advanced', 'wave_type': 'Point Break'},
    {'name': 'St. Leu', 'region': 'West Coast', 'country': 'Reunion Island', 'latitude': -21.1680, 'longitude': 55.2820, 'difficulty': 'Advanced', 'wave_type': 'Reef Break'}
]

def run():
    success = 0
    for s in missingSpots:
        # Check if already in DB
        res = supabase.table('surf_spots').select('id').eq('name', s['name']).execute()
        if len(res.data) == 0:
            import uuid
            # Insert Spot
            record = {
                'id': str(uuid.uuid4()),
                'name': s['name'],
                'region': s['region'],
                'country': s['country'],
                'latitude': s['latitude'],
                'longitude': s['longitude'],
                'difficulty': s['difficulty'],
                'wave_type': s['wave_type'],
                'is_active': True,
                'is_verified_peak': True,
                'accuracy_flag': 'verified',
                'created_at': datetime.datetime.now(datetime.timezone.utc).isoformat()
            }
            supabase.table('surf_spots').insert(record).execute()
            success += 1
            print(f"Injected {s['name']}")
    return success

print(f"Inserted {run()} spots via REST API!")
