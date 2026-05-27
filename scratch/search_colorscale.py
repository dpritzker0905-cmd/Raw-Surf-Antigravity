import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's find all references to colorScale
scale_matches = [m.start() for m in re.finditer("colorScale", content)]
print(f"Found {len(scale_matches)} matches for 'colorScale'")

# For each match, print a small snippet around it
for idx, pos in enumerate(scale_matches):
    start = max(0, pos - 60)
    end = min(len(content), pos + 120)
    print(f"\n--- colorScale Match {idx} at position {pos} ---")
    snippet = content[start:end].replace('\n', '\\n')
    print(snippet)
