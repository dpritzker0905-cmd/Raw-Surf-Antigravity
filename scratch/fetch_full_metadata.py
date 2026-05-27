import urllib.request
import json

urls = {
    "gfs": "https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json",
    "gfs_wave": "https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json",
}

for name, url in urls.items():
    try:
        print(f"Fetching {name}...")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            out_path = f"c:\\Users\\dprit\\Raw-Surf\\scratch\\{name}_metadata.json"
            with open(out_path, "w", encoding="utf-8") as f:
                json.dump(data, f, indent=2)
            print(f"Saved to {out_path}")
    except Exception as e:
        print("Error:", e)
