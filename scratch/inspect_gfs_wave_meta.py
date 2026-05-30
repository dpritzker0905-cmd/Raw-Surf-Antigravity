import urllib.request
import json

url = "https://map-tiles.open-meteo.com/data_spatial/ncep_gfswave025/latest.json"
req = urllib.request.Request(url, headers={'User-Agent': 'Mozilla/5.0'})
with urllib.request.urlopen(req) as response:
    data = json.loads(response.read().decode())
    print("Top-level keys:", list(data.keys()))
    # print domain keys or values
    if "domain" in data:
        print("domain type:", type(data["domain"]))
        print("domain keys:", list(data["domain"].keys()) if isinstance(data["domain"], dict) else "not dict")
    else:
        for k, v in data.items():
            if isinstance(v, dict):
                print(f"Key '{k}' is dict with keys: {list(v.keys())}")
            else:
                print(f"Key '{k}' value: {v}")
