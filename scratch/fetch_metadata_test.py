import urllib.request
import json

urls = {
    'ncep_gfs025': 'https://map-tiles.open-meteo.com/data_spatial/ncep_gfs025/latest.json',
    'ncep_gfs013': 'https://map-tiles.open-meteo.com/data_spatial/ncep_gfs013/latest.json'
}

for name, url in urls.items():
    try:
        with urllib.request.urlopen(url) as response:
            data = json.loads(response.read().decode())
            vars = data.get('variables', [])
            print(f"{name}: contains {len(vars)} variables")
            print(f"  wind vars: {[v for v in vars if 'wind' in v]}")
            print(f"  first 10 vars: {vars[:10]}")
    except Exception as e:
        print(f"{name}: FAILED - {e}")
