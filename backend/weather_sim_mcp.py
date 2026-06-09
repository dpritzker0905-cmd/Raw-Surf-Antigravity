import sqlite3
import math
import random
from typing import List, Dict, Any, Optional
from fastmcp import FastMCP

# Initialize FastMCP Server for the Weather Simulation System
mcp = FastMCP("WeatherSimulationSystem")

# 1. Define High-Fidelity Mock Spot Catalog for Fallbacks
MOCK_SPOTS = {
    "Mavericks": {
        "id": 1,
        "name": "Mavericks",
        "region": "California",
        "latitude": 37.4952,
        "longitude": -122.5028,
        "orientation": 270,  # West-facing
        "optimal_swell_dir": 290, # WNW optimal
        "optimal_wind_dir": 90,    # Offshore East wind
        "base_swell_height": 3.5,
        "base_swell_period": 16.0,
        "base_wind_speed": 12.0,
        "base_wind_direction": 95.0
    },
    "Montara State Beach": {
        "id": 2,
        "name": "Montara State Beach",
        "region": "California",
        "latitude": 37.5458,
        "longitude": -122.5150,
        "orientation": 280,  # WNW-facing
        "optimal_swell_dir": 270, # West optimal
        "optimal_wind_dir": 80,    # Offshore ENE wind
        "base_swell_height": 1.5,
        "base_swell_period": 12.0,
        "base_wind_speed": 8.0,
        "base_wind_direction": 85.0
    },
    "Pacifica State Beach": {
        "id": 3,
        "name": "Pacifica State Beach",
        "region": "California",
        "latitude": 37.5956,
        "longitude": -122.5034,
        "orientation": 260,  # West-facing beach breaks
        "optimal_swell_dir": 275, # W/WNW optimal
        "optimal_wind_dir": 90,    # Offshore East wind
        "base_swell_height": 1.2,
        "base_swell_period": 11.0,
        "base_wind_speed": 5.0,
        "base_wind_direction": 90.0
    }
}

# 2. Database Helper Methods with Safe Fallbacks
def get_db_connection() -> Optional[sqlite3.Connection]:
    try:
        conn = sqlite3.connect("c:/Users/dprit/Raw-Surf/dev.db")
        return conn
    except Exception:
        return None

def query_spots_from_db() -> List[Dict[str, Any]]:
    conn = get_db_connection()
    if not conn:
        return []
    try:
        cursor = conn.cursor()
        # Attempt to read spots from condition_reports to get coordinates
        cursor.execute("SELECT DISTINCT spot_name, region, latitude, longitude FROM condition_reports WHERE is_active = 1")
        rows = cursor.fetchall()
        spots = []
        for i, row in enumerate(rows):
            spots.append({
                "id": i + 1,
                "name": row[0],
                "region": row[1],
                "latitude": float(row[2]),
                "longitude": float(row[3]),
                "orientation": 270  # Default orientation
            })
        return spots
    except Exception:
        return []
    finally:
        if conn:
            conn.close()

# 3. Core Physics and Weather Calculation Engine
def calculate_surf_rating(
    spot: Dict[str, Any],
    swell_h: float,
    swell_p: float,
    swell_dir: float,
    wind_spd: float,
    wind_dir: float
) -> Dict[str, Any]:
    """Calculates breaking wave heights and overall surf quality rating (0-100)

    based on shallow-water amplification physics and wind orientation vectors.
    """
    # 1. Shallow-water wave breaking amplification calculation
    # Breaking height increases with swell period due to wave shoaling: Hb = H * (Period / 10)^1.2
    breaking_height = swell_h * math.pow(swell_p / 10.0, 1.2)
    
    # 2. Wind factor (offshore vs onshore orientation)
    # Optimum wind is optimal_wind_dir. Calculate angular difference
    opt_wind = spot.get("optimal_wind_dir", 90.0)
    wind_diff = abs((wind_dir - opt_wind + 180) % 360 - 180)
    
    # Wind Quality Coefficient (1.0 = perfect offshore, 0.2 = blown out onshore)
    if wind_spd < 3.0:
        wind_label = "Glassy"
        wind_factor = 1.0
    elif wind_diff < 45.0:
        wind_label = "Offshore"
        wind_factor = 1.0 - (wind_spd / 45.0) * 0.15  # Very clean
    elif wind_diff > 135.0:
        wind_label = "Onshore"
        wind_factor = 1.0 - (wind_spd / 20.0) * 0.8  # Blown out fast
        wind_factor = max(0.1, wind_factor)
    else:
        wind_label = "Sideshore"
        wind_factor = 1.0 - (wind_spd / 30.0) * 0.5
        wind_factor = max(0.2, wind_factor)
        
    # 3. Swell Direction Alignment Factor
    opt_swell = spot.get("optimal_swell_dir", 270.0)
    swell_diff = abs((swell_dir - opt_swell + 180) % 360 - 180)
    swell_alignment = math.cos(math.radians(swell_diff))  # 1.0 perfect alignment, 0.0 perpendicular
    swell_alignment = max(0.1, swell_alignment)
    
    # 4. Final Wave Quality Rating (0 to 100)
    # Higher rating requires combination of matched swell direction, clean wind, and solid period
    quality_score = int(wind_factor * swell_alignment * (min(swell_p, 18.0) / 18.0) * 100.0)
    quality_score = max(0, min(100, quality_score))
    
    # Qualitative Labels
    if quality_score >= 80:
        label = "Epic"
    elif quality_score >= 60:
        label = "Good"
    elif quality_score >= 40:
        label = "Fair"
    elif quality_score >= 20:
        label = "Poor"
    else:
        label = "Flat/Blown-out"

    return {
        "breaking_height_ft": round(breaking_height * 3.28084, 1), # convert meters to feet
        "quality_rating": quality_score,
        "conditions_label": label,
        "wind_class": wind_label,
        "swell_alignment_pct": round(swell_alignment * 100, 0)
    }

# 4. FastMCP Tools

@mcp.tool
def get_surf_spots() -> List[Dict[str, Any]]:
    """Get the active list of surf spots with coordinates, regions, and orientation."""
    db_spots = query_spots_from_db()
    if db_spots:
        return db_spots
    # Return mock spots as reliable fallback
    return [
        {
            "id": s["id"],
            "name": s["name"],
            "region": s["region"],
            "latitude": s["latitude"],
            "longitude": s["longitude"],
            "orientation": s["orientation"]
        } for s in MOCK_SPOTS.values()
    ]

@mcp.tool
def get_weather_forecast(spot_name: str) -> Dict[str, Any]:
    """Get the active weather, swell, and wind forecast for a specific surf spot.

    Args:
        spot_name: The name of the spot (e.g., 'Mavericks', 'Montara State Beach').
    """
    spot = MOCK_SPOTS.get(spot_name)
    if not spot:
        return {"error": f"Spot '{spot_name}' not found. Supported spots: {list(MOCK_SPOTS.keys())}"}
    
    # Run rating calculation
    calc = calculate_surf_rating(
        spot,
        spot["base_swell_height"],
        spot["base_swell_period"],
        spot["optimal_swell_dir"],
        spot["base_wind_speed"],
        spot["base_wind_direction"]
    )
    
    return {
        "spot": spot_name,
        "coordinates": {"lat": spot["latitude"], "lng": spot["longitude"]},
        "forecast": {
            "swell_height_m": spot["base_swell_height"],
            "swell_period_sec": spot["base_swell_period"],
            "swell_direction_deg": spot["optimal_swell_dir"],
            "wind_speed_knots": spot["base_wind_speed"],
            "wind_direction_deg": spot["base_wind_direction"]
        },
        "wave_simulation": calc
    }

@mcp.tool
def simulate_weather_change(
    spot_name: str,
    wind_speed_knots: float,
    wind_direction_deg: float,
    swell_height_m: float,
    swell_period_sec: float,
    swell_direction_deg: float,
    caller_role: str = "surfer"
) -> Dict[str, Any]:
    """Simulates how changing weather and swell vectors will alter wave quality and surf height.

    Args:
        spot_name: The name of the spot to simulate.
        wind_speed_knots: The simulated wind speed in knots (0.0 to 150.0).
        wind_direction_deg: The simulated wind direction in degrees (0.0 to 360.0).
        swell_height_m: The simulated ocean swell height in meters (0.0 to 50.0).
        swell_period_sec: The simulated swell period in seconds (0.0 to 30.0).
        swell_direction_deg: The simulated swell direction in degrees (0.0 to 360.0).
        caller_role: The role of the calling user (must be 'admin' to mutate).
    """
    # Enforce strict admin role checking
    if caller_role != "admin":
        return {
            "success": False,
            "error": "Unauthorized: weather simulation overrides require admin role permissions."
        }

    # Verify parameter ranges to prevent database corruption and bad calculations
    if not (0.0 <= wind_speed_knots <= 150.0):
        return {
            "success": False,
            "error": f"Invalid wind speed: {wind_speed_knots} knots. Must be between 0.0 and 150.0 knots."
        }
    if not (0.0 <= wind_direction_deg <= 360.0):
        return {
            "success": False,
            "error": f"Invalid wind direction: {wind_direction_deg} degrees. Must be between 0.0 and 360.0 degrees."
        }
    if not (0.0 <= swell_height_m <= 50.0):
        return {
            "success": False,
            "error": f"Invalid swell height: {swell_height_m} meters. Must be between 0.0 and 50.0 meters."
        }
    if not (0.0 <= swell_period_sec <= 30.0):
        return {
            "success": False,
            "error": f"Invalid swell period: {swell_period_sec} seconds. Must be between 0.0 and 30.0 seconds."
        }
    if not (0.0 <= swell_direction_deg <= 360.0):
        return {
            "success": False,
            "error": f"Invalid swell direction: {swell_direction_deg} degrees. Must be between 0.0 and 360.0 degrees."
        }

    spot = MOCK_SPOTS.get(spot_name)
    if not spot:
        return {"error": f"Spot '{spot_name}' not found. Supported spots: {list(MOCK_SPOTS.keys())}"}
    
    calc = calculate_surf_rating(
        spot,
        swell_height_m,
        swell_period_sec,
        swell_direction_deg,
        wind_speed_knots,
        wind_direction_deg
    )
    
    # Persist simulation changes to condition_reports in dev.db if present
    conn = get_db_connection()
    db_updated = False
    if conn:
        try:
            cursor = conn.cursor()
            # Update condition_reports for this spot
            cursor.execute(
                """
                UPDATE condition_reports 
                SET wave_height_ft = ?, conditions_label = ?, wind_conditions = ?, updated_at = datetime('now')
                WHERE spot_name = ? AND is_active = 1
                """,
                (calc["breaking_height_ft"], calc["conditions_label"], calc["wind_class"], spot_name)
            )
            conn.commit()
            if cursor.rowcount > 0:
                db_updated = True
        except Exception:
            pass
        finally:
            conn.close()

    # Also update mock spots in memory for consistency
    spot["base_swell_height"] = swell_height_m
    spot["base_swell_period"] = swell_period_sec
    spot["optimal_swell_dir"] = swell_direction_deg
    spot["base_wind_speed"] = wind_speed_knots
    spot["base_wind_direction"] = wind_direction_deg

    return {
        "success": True,
        "simulation_type": "weather_vector_override",
        "spot": spot_name,
        "database_updated": db_updated,
        "input_parameters": {
            "wind_speed_knots": wind_speed_knots,
            "wind_direction_deg": wind_direction_deg,
            "swell_height_m": swell_height_m,
            "swell_period_sec": swell_period_sec,
            "swell_direction_deg": swell_direction_deg
        },
        "simulated_surf_output": calc
    }

# 5. FastMCP Resources

@mcp.resource("data://forecasts/summary")
def get_forecasts_summary() -> str:
    """A global textual summary of active surf conditions across all regions."""
    lines = ["=== DAILY OCEAN CONDITIONS AND FORECAST SUMMARY ==="]
    for s_name, spot in MOCK_SPOTS.items():
        calc = calculate_surf_rating(
            spot,
            spot["base_swell_height"],
            spot["base_swell_period"],
            spot["optimal_swell_dir"],
            spot["base_wind_speed"],
            spot["base_wind_direction"]
        )
        lines.append(
            f" - {s_name}: Breaking at {calc['breaking_height_ft']} ft | "
            f"Quality: {calc['quality_rating']}/100 ({calc['conditions_label']}) | "
            f"Wind: {spot['base_wind_speed']} kts {calc['wind_class']}"
        )
    return "\n".join(lines)

# 6. FastMCP Prompts

@mcp.prompt("surf_forecast_advisor")
def get_surf_advisor_prompt(spot_name: str) -> str:
    """Prompt template that helps analyze surf and wind parameters to give strategic surf advice."""
    spot = MOCK_SPOTS.get(spot_name, MOCK_SPOTS["Mavericks"])
    return f"""You are a veteran surf forecaster and oceanographer advising a professional surfer.

Here are the optimal parameters for the spot '{spot['name']}':
- Optimal Swell Direction: {spot['optimal_swell_dir']}°
- Optimal Wind Direction: {spot['optimal_wind_dir']}° (Offshore wind)

Analyze the current weather and swell forecast for this spot. Run a physical simulation calculating the wave break height and wind-swell vector alignment. Detail:
1. Expected breaking wave height (ft) and swell-to-beach vector alignment percentage.
2. The offshore/sideshore classification of the wind vector.
3. Your strategic recommendation: Should they surf this spot today, wait for tide changes, or head to another spot in the region? Explain your reasoning with physical principles of bathymetry and wave shoaling.
"""

if __name__ == "__main__":
    mcp.run()
