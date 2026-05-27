import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's extract the COLOR_SCALES dictionary structure
# It starts with "const COLOR_SCALES = {"
start_idx = content.find("const COLOR_SCALES = {")
if start_idx != -1:
    end_idx = content.find("};", start_idx)
    scales_text = content[start_idx:end_idx+2]
    print(scales_text[:2000]) # Print first 2000 chars of scales
else:
    print("Could not find COLOR_SCALES in index.mjs")
