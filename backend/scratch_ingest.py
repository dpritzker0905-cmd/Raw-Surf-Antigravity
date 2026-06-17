import json

def main():
    with open("backend/uploads/weather_products/manifest.json", "r") as f:
        manifest = json.load(f)
    
    products = manifest.get("products", [])
    
    counts = {}
    for p in products:
        if p.get("model") == "EURO" and p.get("domain") == "marine":
            region = p.get("region_id")
            layer = p.get("layer")
            is_est = p.get("is_estimated", False)
            valid_start = p.get("valid_time_start")[:10]
            key = (region, layer, is_est, valid_start)
            counts[key] = counts.get(key, 0) + 1
            
    for k, count in sorted(counts.items()):
        print(f"{k}: {count}")

if __name__ == "__main__":
    main()
