import os

pkg_path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"

if os.path.exists(pkg_path):
    with open(pkg_path, "r", encoding="utf-8") as f:
        content = f.read()
    
    queries = ["colorScale", "colorRamp", "Canvas", "WebGL", "createTexture", "smoothColor"]
    for q in queries:
        idx = content.find(q)
        if idx != -1:
            print(f"Found '{q}' at index {idx}. Snippet:")
            print(content[idx:idx+800])
            print("-" * 60)
else:
    print("File does not exist")
