import urllib.request
import json

url = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json"
try:
    print("=== GFS ===")
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print("Variables:", data.get("variables", []))
except Exception as e:
    print("Error:", e)
