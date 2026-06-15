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

print("Querying URL:", url)
print("Params:", params)

try:
    r = requests.get(url, params=params)
    print("Status code:", r.status_code)
    if r.status_code == 200:
        data = r.json()
        print("Keys in response:", data.keys())
        grid = data.get("grid", {})
        print("Grid keys:", grid.keys())
        vectors = grid.get("vectors", [])
        print("Total vectors:", len(vectors))
        if vectors:
            print("First vector:", vectors[0])
            non_zero = [v for v in vectors if v.get("speed", 0) > 0 or v.get("value", 0) > 0]
            print("Non-zero vectors:", len(non_zero))
            if non_zero:
                print("First non-zero vector:", non_zero[0])
        else:
            print("No vectors found in grid.")
    else:
        print("Error content:", r.text)
except Exception as e:
    print("Exception occurred:", e)
