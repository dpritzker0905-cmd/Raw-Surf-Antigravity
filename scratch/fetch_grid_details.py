import urllib.request
import json

urls = {
    "gfs": "https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json",
    "gfs_wave": "https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json",
}

for name, url in urls.items():
    try:
        print(f"=== {name} ===")
        req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
        with urllib.request.urlopen(req) as response:
            data = json.loads(response.read().decode())
            vars_list = data.get("variables", [])
            print(f"Number of variables: {len(vars_list)}")
            if vars_list:
                first_var = list(vars_list.values())[0] if isinstance(vars_list, dict) else vars_list[0]
                print("First variable details:", json.dumps(first_var, indent=2))
    except Exception as e:
        print("Error:", e)
