import json

path = r"c:\Users\dprit\Raw-Surf\scratch\gfs_wave_metadata.json"
with open(path, "r", encoding="utf-8") as f:
    data = json.load(f)

print("Top level keys:", list(data.keys()))
for k in list(data.keys()):
    val = data[k]
    if isinstance(val, dict):
        print(f"Key '{k}' is dict with subkeys:", list(val.keys())[:10])
    elif isinstance(val, list):
        print(f"Key '{k}' is list with length:", len(val), "sample:", val[:3])
    else:
        print(f"Key '{k}':", val)
