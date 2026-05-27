import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Match all keys under const COLOR_SCALES = {
start_idx = content.find("const COLOR_SCALES = {")
if start_idx != -1:
    end_idx = content.find("};", start_idx)
    scales_text = content[start_idx:end_idx+2]
    # Find all top-level keys
    keys = re.findall(r"^\s+([a-zA-Z0-9_]+): \{", scales_text, re.MULTILINE)
    print("Keys found in COLOR_SCALES:", keys)
else:
    print("Could not find COLOR_SCALES")
