import requests
import json

url = "http://localhost:8000/api/weather/grid"
params = {
    "model": "EURO",
    "domain": "marine",
    "layer": "swell_2",
    "valid_time": "2026-06-14T00:00:00Z",
    "bbox": "-82.00,24.00,-78.00,26.00"
}

try:
    r = requests.get(url, params=params)
    if r.status_code == 200:
        data = r.json()
        grid = data.get("grid", {})
        vectors = grid.get("vectors", [])
        
        speeds = []
        none_count = 0
        for i, v in enumerate(vectors):
            s = v.get("speed")
            if s is None:
                none_count += 1
            else:
                speeds.append(s)
                
        print(f"Total vectors: {len(vectors)}")
        print(f"Vectors with speed=None: {none_count}")
        if speeds:
            print(f"Non-None speeds: min={min(speeds)}, max={max(speeds)}, average={sum(speeds)/len(speeds)}")
            print(f"Non-zero speeds count: {sum(1 for s in speeds if s > 0)}")
            non_zero_vectors = [v for v in vectors if v.get("speed") is not None and v.get("speed") > 0]
            if non_zero_vectors:
                print("First 3 non-zero vectors:")
                for nzv in non_zero_vectors[:3]:
                    print(nzv)
        else:
            print("No non-None speeds found.")
    else:
        print("HTTP Error:", r.status_code, r.text)
except Exception as e:
    print("Exception occurred:", e)
