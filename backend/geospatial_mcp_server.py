import sys
import json
import math
from datetime import datetime, timedelta

# Geospatial Helper Functions
def haversine_distance(lat1, lon1, lat2, lon2):
    # Radius of the Earth in km
    R = 6371.0
    
    phi1 = math.radians(lat1)
    phi2 = math.radians(lat2)
    delta_phi = math.radians(lat2 - lat1)
    delta_lambda = math.radians(lon2 - lon1)
    
    a = math.sin(delta_phi / 2.0) ** 2 + \
        math.cos(phi1) * math.cos(phi2) * \
        math.sin(delta_lambda / 2.0) ** 2
        
    c = 2.0 * math.atan2(math.sqrt(a), math.sqrt(1.0 - a))
    return R * c

# Optimized Spatial Query using Bounding Box (BBox) pre-filtering
def filter_points_within_radius(center_lat, center_lon, points, radius_km):
    # 1 degree of latitude is approx 111.32 km
    delta_lat = radius_km / 111.32
    # 1 degree of longitude depends on latitude
    cos_lat = math.cos(math.radians(center_lat))
    delta_lon = radius_km / (111.32 * cos_lat) if cos_lat > 0 else delta_lat
    
    lat_min, lat_max = center_lat - delta_lat, center_lat + delta_lat
    lon_min, lon_max = center_lon - delta_lon, center_lon + delta_lon
    
    filtered = []
    for p in points:
        lat = p.get("latitude")
        lon = p.get("longitude")
        if lat is None or lon is None:
            continue
            
        # Fast bounding box check (O(1) float comparison)
        if lat_min <= lat <= lat_max and lon_min <= lon <= lon_max:
            # Exclude points that fall outside the circular radius
            dist = haversine_distance(center_lat, center_lon, lat, lon)
            if dist <= radius_km:
                # Add distance info to point
                p_copy = p.copy()
                p_copy["distance_km"] = round(dist, 4)
                filtered.append(p_copy)
                
    return filtered

# Simple Agglomerative Clustering
def cluster_points(points, threshold_km=0.5):
    clusters = []
    for p in points:
        lat = p.get("latitude")
        lon = p.get("longitude")
        if lat is None or lon is None:
            continue
            
        # Try to find a cluster this point fits in
        placed = False
        for c in clusters:
            # Check distance against cluster centroid
            c_lat = c["centroid_lat"]
            c_lon = c["centroid_lon"]
            if haversine_distance(lat, lon, c_lat, c_lon) <= threshold_km:
                c["points"].append(p)
                # Re-calculate centroid (average)
                count = len(c["points"])
                c["centroid_lat"] = sum(x["latitude"] for x in c["points"]) / count
                c["centroid_lon"] = sum(x["longitude"] for x in c["points"]) / count
                placed = True
                break
                
        if not placed:
            clusters.append({
                "centroid_lat": lat,
                "centroid_lon": lon,
                "points": [p]
            })
            
    return clusters

# Forecast Accuracy Metrics Analyzer
def calculate_accuracy(forecast_ratings, actual_reports):
    # Map textual ratings to numerical index
    rating_map = {
        "flat": 1, "poor": 2, "poor_to_fair": 3, "fair": 4, 
        "fair_to_good": 5, "good": 6, "epic": 7
    }
    
    correlations = []
    for report in actual_reports:
        spot_id = report.get("spot_id")
        actual_rating = report.get("rating")  # 1-5 stars
        
        # Find matching forecast
        matching_forecast = next((f for f in forecast_ratings if f.get("spot_id") == spot_id), None)
        if not matching_forecast:
            continue
            
        forecast_text = matching_forecast.get("rating_text", "fair").lower()
        forecast_val = rating_map.get(forecast_text, 4)
        
        # Normalize forecast 1-7 to 1-5 scale
        # (forecast_val - 1) / 6 = (norm_val - 1) / 4 => norm_val = 1 + 4 * (forecast_val - 1) / 6
        norm_forecast = 1.0 + 4.0 * (forecast_val - 1) / 6.0
        
        error = abs(actual_rating - norm_forecast)
        accuracy = max(0.0, 1.0 - (error / 4.0)) # 4.0 is max possible error (5 - 1)
        correlations.append(accuracy)
        
    if not correlations:
        return 1.0 # 100% baseline if no correlation reports exist
        
    return sum(correlations) / len(correlations)

# JSON-RPC Loop for Stdio Integration
def main():
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
                            "name": "geospatial-analytics-mcp",
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
                                "name": "analyze_crowd_density",
                                "description": "Identify density metrics, traffic overlays, and active check-ins within a spot's radius using optimized spatial filters.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spot_latitude": {
                                            "type": "number",
                                            "description": "Spot latitude"
                                        },
                                        "spot_longitude": {
                                            "type": "number",
                                            "description": "Spot longitude"
                                        },
                                        "checkins": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "latitude": {"type": "number"},
                                                    "longitude": {"type": "number"},
                                                    "user_id": {"type": "string"},
                                                    "timestamp": {"type": "string"}
                                                },
                                                "required": ["latitude", "longitude"]
                                            },
                                            "description": "List of active user check-ins"
                                        },
                                        "radius_km": {
                                            "type": "number",
                                            "description": "Filter radius in kilometers (default: 0.5km)"
                                        }
                                    },
                                    "required": ["spot_latitude", "spot_longitude", "checkins"]
                                }
                            },
                            {
                                "name": "generate_maplibre_geojson",
                                "description": "Compile active density spatial clusters into standard GeoJSON structures for ultra-high-performance MapLibre GL Heatmap rendering.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "spots": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "name": {"type": "string"},
                                                    "latitude": {"type": "number"},
                                                    "longitude": {"type": "number"},
                                                    "crowd_density": {"type": "integer"}
                                                },
                                                "required": ["name", "latitude", "longitude"]
                                            },
                                            "description": "List of surf spots with crowd scores"
                                        }
                                    },
                                    "required": ["spots"]
                                }
                            },
                            {
                                "name": "predict_crowd_levels",
                                "description": "Predict surf traffic curves and crowd sizes for a spot based on historical trends, time, and forecast wind/swell parameters.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "historical_base_density": {
                                            "type": "integer",
                                            "description": "Average baseline check-ins at this spot"
                                        },
                                        "forecast_surf_rating": {
                                            "type": "string",
                                            "enum": ["FLAT", "POOR", "FAIR", "GOOD", "EPIC"],
                                            "description": "NOAA wind/swell forecast rating"
                                        },
                                        "time_of_day": {
                                            "type": "string",
                                            "enum": ["dawn", "morning", "afternoon", "evening"],
                                            "description": "Time bucket to evaluate"
                                        }
                                    },
                                    "required": ["historical_base_density", "forecast_surf_rating", "time_of_day"]
                                }
                            },
                            {
                                "name": "analyze_forecast_accuracy",
                                "description": "Calculate forecast accuracy by comparing forecast ratings with user-reported surf conditions.",
                                "inputSchema": {
                                    "type": "object",
                                    "properties": {
                                        "forecasts": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "spot_id": {"type": "string"},
                                                    "rating_text": {"type": "string"}
                                                },
                                                "required": ["spot_id", "rating_text"]
                                            }
                                        },
                                        "reports": {
                                            "type": "array",
                                            "items": {
                                                "type": "object",
                                                "properties": {
                                                    "spot_id": {"type": "string"},
                                                    "rating": {"type": "integer"} # 1-5 scale
                                                },
                                                "required": ["spot_id", "rating"]
                                            }
                                        }
                                    },
                                    "required": ["forecasts", "reports"]
                                }
                            }
                        ]
                    }
                }
                
            elif method == "tools/call":
                tool_name = params.get("name")
                args = params.get("arguments", {})
                
                if tool_name == "analyze_crowd_density":
                    spot_lat = args.get("spot_latitude")
                    spot_lon = args.get("spot_longitude")
                    checkins = args.get("checkins")
                    radius = args.get("radius_km", 0.5)
                    
                    points_in_radius = filter_points_within_radius(spot_lat, spot_lon, checkins, radius)
                    clusters = cluster_points(points_in_radius, radius * 0.5)
                    
                    density_count = len(points_in_radius)
                    traffic_level = "low"
                    if density_count >= 15:
                        traffic_level = "extreme"
                    elif density_count >= 8:
                        traffic_level = "high"
                    elif density_count >= 3:
                        traffic_level = "moderate"
                        
                    result = {
                        "spot_coordinates": {"latitude": spot_lat, "longitude": spot_lon},
                        "total_checkins_in_radius": density_count,
                        "traffic_overlay_level": traffic_level,
                        "radius_filtered_checkins": points_in_radius,
                        "spatial_clusters_detected": len(clusters),
                        "clusters": [
                            {
                                "centroid": {"latitude": round(c["centroid_lat"], 5), "longitude": round(c["centroid_lon"], 5)},
                                "points_count": len(c["points"])
                            } for c in clusters
                        ]
                    }
                    text_out = json.dumps(result, indent=2)
                    
                elif tool_name == "generate_maplibre_geojson":
                    spots = args.get("spots")
                    
                    features = []
                    for spot in spots:
                        features.append({
                            "type": "Feature",
                            "geometry": {
                                "type": "Point",
                                "coordinates": [spot["longitude"], spot["latitude"]]
                            },
                            "properties": {
                                "name": spot["name"],
                                "density": spot["crowd_density"],
                                "intensity": round(min(1.0, spot["crowd_density"] / 20.0), 3) # normalized weight
                            }
                        })
                        
                    geojson = {
                        "type": "FeatureCollection",
                        "features": features
                    }
                    text_out = json.dumps(geojson, indent=2)
                    
                elif tool_name == "predict_crowd_levels":
                    base_density = args.get("historical_base_density")
                    rating = args.get("forecast_surf_rating").upper()
                    time_bucket = args.get("time_of_day").lower()
                    
                    # Compute multipliers based on weather/swell quality
                    rating_multipliers = {
                        "FLAT": 0.20,
                        "POOR": 0.60,
                        "FAIR": 1.00,
                        "GOOD": 1.50,
                        "EPIC": 2.20
                    }
                    f_swell = rating_multipliers.get(rating, 1.00)
                    
                    # Compute multipliers based on time curves (dawn/morning swells are highly packed)
                    time_multipliers = {
                        "dawn": 1.10,
                        "morning": 1.40,
                        "afternoon": 0.85,
                        "evening": 0.65
                    }
                    f_time = time_multipliers.get(time_bucket, 1.00)
                    
                    predicted_density = int(round(base_density * f_swell * f_time))
                    
                    # Generate curve data
                    curve = {}
                    for t, m in time_multipliers.items():
                        curve[t] = int(round(base_density * f_swell * m))
                        
                    result = {
                        "predicted_checkins_for_bucket": predicted_density,
                        "query_parameters": {
                            "base_density": base_density,
                            "forecast_multiplier": f_swell,
                            "time_multiplier": f_time
                        },
                        "predicted_traffic_curve": curve,
                        "crowd_status": "Heavy Traffic Expected" if predicted_density >= 12 else "Mild/Calm Lineup"
                    }
                    text_out = json.dumps(result, indent=2)
                    
                elif tool_name == "analyze_forecast_accuracy":
                    forecasts = args.get("forecasts")
                    reports = args.get("reports")
                    
                    accuracy = calculate_accuracy(forecasts, reports)
                    result = {
                        "accuracy_index": round(accuracy, 4),
                        "accuracy_percentage": f"{round(accuracy * 100, 2)}%",
                        "total_correlation_reports": len(reports),
                        "status": "High Reliability" if accuracy >= 0.85 else "Standard/Variable Accuracy"
                    }
                    text_out = json.dumps(result, indent=2)
                    
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
