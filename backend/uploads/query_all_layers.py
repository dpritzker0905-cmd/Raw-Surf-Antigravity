import requests
import json

url = "http://localhost:8000/api/weather/grid"
bbox = "-82.00,24.00,-78.00,26.00"
valid_time = "2026-06-14T00:00:00Z"

for layer in ["waves", "swell_1", "swell_2", "wind_waves"]:
    params = {
        "model": "EURO",
        "domain": "marine",
        "layer": layer,
        "valid_time": valid_time,
        "bbox": bbox
    }
    try:
        r = requests.get(url, params=params)
        if r.status_code == 200:
            data = r.json()
            grid = data.get("grid", {})
            vectors = grid.get("vectors", [])
            
            speeds = [v.get("speed") for v in vectors if v.get("speed") is not None]
            non_zero = [s for s in speeds if s > 0]
            
            print(f"Layer: {layer}")
            print(f"  Total vectors: {len(vectors)}, Non-None speeds: {len(speeds)}, Non-zero: {len(non_zero)}")
            if non_zero:
                print(f"  Speeds: min={min(non_zero):.4f}, max={max(non_zero):.4f}, mean={sum(non_zero)/len(non_zero):.4f}")
            else:
                print("  No non-zero speeds.")
        else:
            print(f"Layer: {layer} -> HTTP {r.status_code}")
    except Exception as e:
        print(f"Layer: {layer} -> Exception: {e}")
