path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's extract the first few lines of the file, up to 100 lines or until imports end
lines = content.split("\n")
for i in range(min(150, len(lines))):
    if "import" in lines[i] or lines[i].strip().startswith("export"):
        print(f"{i+1}: {lines[i]}")
