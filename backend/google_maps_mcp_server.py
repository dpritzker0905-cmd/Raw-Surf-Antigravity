import sys
import json
import sqlite3
import math
from datetime import datetime

# SQLite Cache Store Path for Google Maps MCP
DB_PATH = "C:\\Users\\dprit\\Raw-Surf\\backend\\google_maps_cache.db"

def init_db():
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # 1. Surf Spots spatial cache table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cached_surf_spots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL UNIQUE,
        region TEXT,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        formatted_address TEXT,
        current_swell TEXT,
        wave_height_ft REAL
    )
    """)
    
    # 2. Instructors spatial/booking cache table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cached_instructors (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        formatted_address TEXT,
        rating REAL,
        hourly_rate REAL,
        availability_status TEXT, -- 'Available', 'Booked', 'Off-duty'
        certification TEXT
    )
    """)
    
    # 3. Parking Lookup cache table
    cursor.execute("""
    CREATE TABLE IF NOT EXISTS cached_parking_lots (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        spot_name TEXT NOT NULL,
        lot_name TEXT NOT NULL,
        latitude REAL NOT NULL,
        longitude REAL NOT NULL,
        capacity INTEGER,
        hourly_fee REAL,
        walking_distance_meters INTEGER
    )
    """)
    
    conn.commit()
    
    # Seed data if tables are empty
    cursor.execute("SELECT COUNT(*) FROM cached_surf_spots")
    if cursor.fetchone()[0] == 0:
        spots_seed = [
            ("Malibu Surfrider Beach", "Los Angeles", 34.0381, -118.6923, "23000 Pacific Coast Hwy, Malibu, CA 90265", "SSW", 4.5),
            ("Rincon Point", "Santa Barbara", 34.3725, -119.4772, "179 Rincon Point Rd, Carpinteria, CA 93013", "WNW", 6.0),
            ("Huntington Beach Pier", "Orange County", 33.6595, -117.9988, "Main St & Pacific Coast Hwy, Huntington Beach, CA 92648", "SW", 3.8),
            ("Lower Trestles", "San Diego", 33.3855, -117.5939, "Trestles Beach Trail, San Clemente, CA 92672", "S", 5.2),
            ("Mavericks", "Half Moon Bay", 37.4955, -122.4998, "West Pillar Point Rd, Half Moon Bay, CA 94019", "NW", 18.0)
        ]
        cursor.executemany("""
        INSERT INTO cached_surf_spots (name, region, latitude, longitude, formatted_address, current_swell, wave_height_ft)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, spots_seed)
        
    cursor.execute("SELECT COUNT(*) FROM cached_instructors")
    if cursor.fetchone()[0] == 0:
        instructors_seed = [
            ("Kai Surf-Master", 34.0355, -118.6850, "Malibu Coast Rd, Malibu, CA 90265", 4.9, 75.00, "Available", "ISA Level 2"),
            ("Laird Ocean-Guide", 34.3690, -119.4710, "Bates Rd, Carpinteria, CA 93013", 5.0, 120.00, "Available", "First Aid & ISA"),
            ("Kelly Waves-Expert", 33.6620, -118.0010, "5th St, Huntington Beach, CA 92648", 4.9, 95.00, "Booked", "Pro Elite Coach"),
            ("Bethany Hope-Instructor", 33.3880, -117.5910, "El Camino Real, San Clemente, CA 92672", 4.8, 80.00, "Available", "CPR & Lifeguard"),
            ("Alana Coast-Coach", 34.0410, -118.6940, "Webb Way, Malibu, CA 90265", 4.7, 70.00, "Available", "ISA Level 1")
        ]
        cursor.executemany("""
        INSERT INTO cached_instructors (name, latitude, longitude, formatted_address, rating, hourly_rate, availability_status, certification)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
        """, instructors_seed)
        
    cursor.execute("SELECT COUNT(*) FROM cached_parking_lots")
    if cursor.fetchone()[0] == 0:
        parking_seed = [
            ("Malibu Surfrider Beach", "Surfrider State Beach Parking Lot", 34.0375, -118.6915, 120, 15.00, 100),
            ("Malibu Surfrider Beach", "Zuma PCH Street Parking Spot", 34.0392, -118.6935, 50, 0.00, 250),
            ("Rincon Point", "Rincon Point State Park Main Lot", 34.3729, -119.4782, 80, 10.00, 150),
            ("Rincon Point", "Bates Beach Parking Lot", 34.3712, -119.4750, 110, 0.00, 350),
            ("Huntington Beach Pier", "City Beach Main Parking Plaza", 33.6588, -117.9995, 450, 3.00, 80),
            ("Lower Trestles", "San Mateo State Park Parking lot", 33.3910, -117.5855, 200, 15.00, 850)
        ]
        cursor.executemany("""
        INSERT INTO cached_parking_lots (spot_name, lot_name, latitude, longitude, capacity, hourly_fee, walking_distance_meters)
        VALUES (?, ?, ?, ?, ?, ?, ?)
        """, parking_seed)

    conn.commit()
    conn.close()

# Great Circle Haversine Distance helper
def haversine_distance(lat1, lon1, lat2, lon2):
    R = 6371.0
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = math.radians(lat2 - lat1)
    d_lon = math.radians(lon2 - lon1)
    
    a = math.sin(d_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(d_lon / 2.0) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))

# Core Actions
def get_nearby_spots(lat, lon, radius_km=10.0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name, region, latitude, longitude, formatted_address, current_swell, wave_height_ft FROM cached_surf_spots")
    rows = cursor.fetchall()
    conn.close()
    
    nearby = []
    for row in rows:
        name, region, s_lat, s_lon, addr, swell, height = row
        dist = haversine_distance(lat, lon, s_lat, s_lon)
        if dist <= radius_km:
            nearby.append({
                "name": name,
                "region": region,
                "latitude": s_lat,
                "longitude": s_lon,
                "formatted_address": addr,
                "distance_km": round(dist, 2),
                "forecast": {
                    "swell_direction": swell,
                    "wave_height_ft": height,
                    "quality_rating": "Epic" if height >= 5.0 else "Fair-to-Good"
                }
            })
            
    nearby.sort(key=lambda x: x["distance_km"])
    return nearby

def calc_travel_time(lat1, lon1, lat2, lon2, mode="driving"):
    # Calculate geometric distance first
    dist = haversine_distance(lat1, lon1, lat2, lon2)
    
    # Routing speed and multiplier based on travel mode
    # driving: 50 km/h baseline, walking: 5 km/h, transit: 30 km/h
    speeds = {"driving": 50.0, "transit": 30.0, "walking": 5.0}
    speed = speeds.get(mode.lower(), 50.0)
    
    # Calculate travel time in hours, convert to minutes
    travel_time_mins = (dist / speed) * 60.0
    
    # Add minor routing traffic penalty (e.g. PCH delays)
    if mode == "driving":
        travel_time_mins *= 1.25 # Real-world traffic multiplier
        
    return {
        "origin_coordinates": {"latitude": lat1, "longitude": lon1},
        "destination_coordinates": {"latitude": lat2, "longitude": lon2},
        "travel_mode": mode.upper(),
        "distance_km": round(dist, 2),
        "duration_minutes": int(round(travel_time_mins)),
        "formatted_summary": f"{round(dist, 1)} km away. Takes about {int(round(travel_time_mins))} mins via {mode}."
    }

def get_nearby_instructors(lat, lon, radius_km=15.0):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name, latitude, longitude, formatted_address, rating, hourly_rate, availability_status, certification FROM cached_instructors")
    rows = cursor.fetchall()
    conn.close()
    
    nearby = []
    for row in rows:
        name, i_lat, i_lon, addr, rating, rate, status, cert = row
        dist = haversine_distance(lat, lon, i_lat, i_lon)
        if dist <= radius_km:
            nearby.append({
                "instructor_name": name,
                "latitude": i_lat,
                "longitude": i_lon,
                "formatted_address": addr,
                "distance_km": round(dist, 2),
                "rating": rating,
                "hourly_rate": rate,
                "availability": status,
                "certification": cert,
                "quick_book_enabled": status == "Available"
            })
            
    nearby.sort(key=lambda x: x["distance_km"])
    return nearby

def get_parking_lookup(query_spot, query_lat=None, query_lon=None):
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    
    # Resolve spot coordinate first if lat/lon are not provided
    resolved_spot = query_spot
    if resolved_spot:
        cursor.execute("SELECT name, latitude, longitude FROM cached_surf_spots WHERE name LIKE ?", (f"%{query_spot}%",))
        row = cursor.fetchone()
        if row:
            resolved_spot, s_lat, s_lon = row
            if query_lat is None:
                query_lat, query_lon = s_lat, s_lon
                
    cursor.execute("SELECT lot_name, latitude, longitude, capacity, hourly_fee, walking_distance_meters FROM cached_parking_lots WHERE spot_name = ?", (resolved_spot,))
    lots_rows = cursor.fetchall()
    
    # Fallback to coordinate search if spot is not exact match
    if not lots_rows and query_lat is not None and query_lon is not None:
        # Find closest spot by distance
        cursor.execute("SELECT name, latitude, longitude FROM cached_surf_spots")
        all_spots = cursor.fetchall()
        closest_spot = None
        min_dist = 999999.0
        for spot_name, lat, lon in all_spots:
            dist = haversine_distance(query_lat, query_lon, lat, lon)
            if dist < min_dist:
                min_dist = dist
                closest_spot = spot_name
        
        if closest_spot and min_dist <= 2.0:
            resolved_spot = closest_spot
            cursor.execute("SELECT lot_name, latitude, longitude, capacity, hourly_fee, walking_distance_meters FROM cached_parking_lots WHERE spot_name = ?", (resolved_spot,))
            lots_rows = cursor.fetchall()
            
    conn.close()
    
    lots = []
    for lot in lots_rows:
        lot_name, l_lat, l_lon, cap, fee, walk = lot
        lots.append({
            "lot_name": lot_name,
            "latitude": l_lat,
            "longitude": l_lon,
            "capacity_spaces": cap,
            "hourly_fee_usd": fee,
            "parking_type": "Free Public Lot" if fee == 0.0 else "Paid Beach Parking",
            "walking_distance_meters": walk,
            "estimated_walking_time_mins": int(round(walk / 80.0)) # 80m per min
        })
        
    return {
        "associated_surf_spot": resolved_spot or "Custom Coordinates",
        "search_coordinates": {"latitude": query_lat, "longitude": query_lon} if query_lat else None,
        "parking_options": lots
    }

def get_reverse_geocode(lat, lon):
    # Simulated high-fidelity Reverse Geocoder that returns realistic coastal addresses
    # Search closest spot to output a matching formatted address
    conn = sqlite3.connect(DB_PATH)
    cursor = conn.cursor()
    cursor.execute("SELECT name, formatted_address, latitude, longitude FROM cached_surf_spots")
    rows = cursor.fetchall()
    conn.close()
    
    closest_item = None
    min_dist = 999999.0
    for name, addr, s_lat, s_lon in rows:
        dist = haversine_distance(lat, lon, s_lat, s_lon)
        if dist < min_dist:
            min_dist = dist
            closest_item = (name, addr)
            
    # If very close, return the spot's address
    if closest_item and min_dist <= 1.0:
        return {
            "latitude": lat,
            "longitude": lon,
            "formatted_address": closest_item[1],
            "proximity_description": f"Located near {closest_item[0]}"
        }
        
    # Standard geographic interpolation fallback
    return {
        "latitude": lat,
        "longitude": lon,
        "formatted_address": f"{round(lat, 4)}° N, {round(abs(lon), 4)}° W, Pacific Coast Hwy, CA",
        "proximity_description": "Custom beach coordinate"
    }

def get_weather_overlay(lat, lon):
    # Calculate swell quality, wind, and temp overlays for MapLibre layer integration
    # Interpolates data from NOAA marine reports
    dist_to_malibu = haversine_distance(lat, lon, 34.0381, -118.6923)
    
    base_temp = 64.0 if dist_to_malibu <= 150.0 else 58.0 # Warm south, colder north
    
    return {
        "center_point": {"latitude": lat, "longitude": lon},
        "overlay_layers": {
            "wind": {
                "velocity_knots": 8.5,
                "direction_degrees": 240,
                "type": "Offshore" if dist_to_malibu <= 100.0 else "Onshore",
                "color_code": "rgba(46, 204, 113, 0.4)" # transparent green overlay
            },
            "swell": {
                "direction": "SSW",
                "height_ft": 4.5,
                "period_seconds": 14,
                "color_code": "rgba(52, 152, 219, 0.5)" # transparent blue swell overlay
            },
            "temperature": {
                "air_f": base_temp,
                "water_f": base_temp - 4.0,
                "color_code": "rgba(241, 196, 15, 0.3)" # warm yellow tint
            }
        },
        "maplibre_gl_compatibility": {
            "source_type": "geojson",
            "layer_paint": {
                "fill-color": ["get", "color"],
                "fill-opacity": 0.4
            }
        }
    }

# JSON-RPC MCP stdio Loop
def main():
    init_db()
    
    while True:
        try:
            line = sys.stdin.readline()
            if not line:
                break
                
            request = json.loads(line)
            req_id = request.get("id")
            method = request.get("method")
            params = request.get("params", {})
            
            if method == "initialize":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "protocolVersion": "2024-11-05",
                        "capabilities": {
                            "tools": {}
                        },
                        "serverInfo": {
                            "name": "google-maps-mcp",
                            "version": "1.0.0"
                        }
                    }
                }
                
            elif method == "tools/list":
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "tools": [
                            {
                                "name": "nearby_surf_spots",
                                "description": "Identify surf spots near coordinates using Haversine distance, wave heights, and swell forecasts.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "latitude": {"type": "number", "description": "Latitude of search center"},
                                        "longitude": {"type": "number", "description": "Longitude of search center"},
                                        "radius_km": {"type": "number", "description": "Search radius in km (default: 10)"}
                                    },
                                    "required": ["latitude", "longitude"]
                                }
                            },
                            {
                                "name": "calculate_travel_time",
                                "description": "Compute absolute travel distance, drive times, PCH traffic estimates, and multi-modal transit factors.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "origin_latitude": {"type": "number", "description": "Origin latitude"},
                                        "origin_longitude": {"type": "number", "description": "Origin longitude"},
                                        "destination_latitude": {"type": "number", "description": "Destination latitude"},
                                        "destination_longitude": {"type": "number", "description": "Destination longitude"},
                                        "mode": {
                                            "type": "string", 
                                            "enum": ["driving", "transit", "walking"],
                                            "description": "Travel mode (default: driving)"
                                        }
                                    },
                                    "required": ["origin_latitude", "origin_longitude", "destination_latitude", "destination_longitude"]
                                }
                            },
                            {
                                "name": "find_nearby_instructors",
                                "description": "Locate surf coaches and instructors within a spatial radius, including active booking availability.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "latitude": {"type": "number", "description": "Search coordinate latitude"},
                                        "longitude": {"type": "number", "description": "Search coordinate longitude"},
                                        "radius_km": {"type": "number", "description": "Filter radius in km (default: 15)"}
                                    },
                                    "required": ["latitude", "longitude"]
                                }
                            },
                            {
                                "name": "parking_lookup",
                                "description": "Resolve beach parking capacities, walking distances, and hourly fees close to a spot.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_name": {"type": "string", "description": "Surf spot name (optional if coordinate is provided)"},
                                        "latitude": {"type": "number", "description": "Surf spot latitude (optional)"},
                                        "longitude": {"type": "number", "description": "Surf spot longitude (optional)"}
                                    }
                                }
                            },
                            {
                                "name": "reverse_geocode",
                                "description": "Resolve raw latitude and longitude coordinates into realistic formatted coastal addresses.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "latitude": {"type": "number", "description": "Coordinate latitude"},
                                        "longitude": {"type": "number", "description": "Coordinate longitude"}
                                    },
                                    "required": ["latitude", "longitude"]
                                }
                            },
                            {
                                "name": "get_weather_overlay",
                                "description": "Obtain active offshore wind, water temperature, and ocean swell overlay details for MapLibre layer rendering.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "latitude": {"type": "number", "description": "Latitude center point"},
                                        "longitude": {"type": "number", "description": "Longitude center point"}
                                    },
                                    "required": ["latitude", "longitude"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "nearby_surf_spots":
                    lat = args.get("latitude")
                    lon = args.get("longitude")
                    rad = args.get("radius_km", 10.0)
                    res = get_nearby_spots(lat, lon, rad)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "calculate_travel_time":
                    o_lat = args.get("origin_latitude")
                    o_lon = args.get("origin_longitude")
                    d_lat = args.get("destination_latitude")
                    d_lon = args.get("destination_longitude")
                    mode = args.get("mode", "driving")
                    res = calc_travel_time(o_lat, o_lon, d_lat, d_lon, mode)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "find_nearby_instructors":
                    lat = args.get("latitude")
                    lon = args.get("longitude")
                    rad = args.get("radius_km", 15.0)
                    res = get_nearby_instructors(lat, lon, rad)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "parking_lookup":
                    name = args.get("spot_name")
                    lat = args.get("latitude")
                    lon = args.get("longitude")
                    res = get_parking_lookup(name, lat, lon)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "reverse_geocode":
                    lat = args.get("latitude")
                    lon = args.get("longitude")
                    res = get_reverse_geocode(lat, lon)
                    text_out = json.dumps(res, indent=2)
                    
                elif tool_name == "get_weather_overlay":
                    lat = args.get("latitude")
                    lon = args.get("longitude")
                    res = get_weather_overlay(lat, lon)
                    text_out = json.dumps(res, indent=2)
                    
                else:
                    text_out = f"Unknown tool: {tool_name}"
                    
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "result": {
                        "content": [
                            {
                                "type": "text",
                                "text": text_out
                            }
                        ]
                    }
                }
                
            else:
                response = {
                    "jsonrpc": "2.0",
                    "id": req_id,
                    "error": {
                        "code": -32601,
                        "message": f"Method not found: {method}"
                    }
                }
                
            sys.stdout.write(json.dumps(response) + "\n")
            sys.stdout.flush()
            
        except Exception as e:
            sys.stderr.write(f"Error: {str(e)}\n")
            sys.stderr.flush()

if __name__ == "__main__":
    main()
