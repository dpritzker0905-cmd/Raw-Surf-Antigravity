import urllib.request
import json

try:
    url = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json"
    req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
    with urllib.request.urlopen(req) as response:
        data = json.loads(response.read().decode())
        print("Success fetching GFS latest.json")
        print("visibility in variables:", "visibility" in data.get("variables", []))
        valid_times = data.get("valid_times", [])
        print("Valid times count:", len(valid_times))
        if valid_times:
            # Let's construct a tile URL for zoom 4, x 8, y 5
            ref_time = data.get("reference_time").replace(":", "").replace("-", "") # e.g. 2026-05-25T18:00:00Z -> 20260525T180000Z or similar?
            # Wait, let's look at the format in the user's logs:
            # https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/2026/05/25/0600Z/2026-05-31T0700.om
            # The folder format: map-tiles.open-meteo.com/data_spatial/ncep_gfs025/YYYY/MM/DD/HH00Z/YYYY-MM-DDTHH00.om
            import datetime
            ref_dt = datetime.datetime.strptime(data.get("reference_time"), "%Y-%m-%dT%H:%M:%SZ")
            date_path = ref_dt.strftime("%Y/%m/%d/%H00Z")
            target_time = valid_times[0]
            tile_url = f"https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/{date_path}/{target_time}.om"
            print(f"Testing tile URL: {tile_url}")
            try:
                tile_req = urllib.request.Request(tile_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(tile_req) as tile_res:
                    print("Tile response code:", tile_res.getcode())
                    print("Tile byte length:", len(tile_res.read()))
            except Exception as e_tile:
                print("Tile request failed:", e_tile)
except Exception as e:
    print("Error:", e)
