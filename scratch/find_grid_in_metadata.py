import json

paths = {
    "gfs": r"c:\Users\dprit\Raw-Surf\scratch\gfs_metadata.json",
    "gfs_wave": r"c:\Users\dprit\Raw-Surf\scratch\gfs_wave_metadata.json"
}

for name, path in paths.items():
    try:
        print(f"=== {name} ===")
        with open(path, "r", encoding="utf-8") as f:
            data = json.load(f)
        
        # Let's recursive search for keys "grid" or "domain"
        def search(obj, key_to_find, depth=0):
            if depth > 10:
                return
            if isinstance(obj, dict):
                for k, v in obj.items():
                    if k == key_to_find:
                        print(f"Found '{key_to_find}':", v)
                    else:
                        search(v, key_to_find, depth + 1)
            elif isinstance(obj, list):
                for item in obj:
                    search(item, key_to_find, depth + 1)
        
        search(data, "grid")
        search(data, "domain")
    except Exception as e:
        print("Error:", e)
