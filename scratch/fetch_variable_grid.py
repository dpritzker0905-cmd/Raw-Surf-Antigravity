import urllib.request
import json

# Fetching the metadata with a specific variable parameter
url_wind = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json?variable=wind_speed_10m"
url_wave = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json?variable=wave_height"

for name, url in [("Wind (GFS)", url_wind), ("Wave (GFS Wave)", url_wave)]:
    try:
        print(f"=== {name} ===")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            # Let's see if there is any grid/domain details in the json
            for k in ["domain", "grid", "bounds", "latitude", "longitude", "dy", "dx"]:
                if k in data:
                    print(f"{k}:", data[k])
            # If there are variables, print details
            if "variables" in data:
                print("Variables count:", len(data["variables"]))
                # Print the first variable and its structure if it's a dict
                if isinstance(data["variables"], dict):
                    first_var_name = list(data["variables"].keys())[0]
                    print(f"First variable '{first_var_name}':", json.dumps(data["variables"][first_var_name], indent=2))
                else:
                    print("Variables list:", data["variables"][:5])
    except Exception as e:
        print("Error:", e)
