import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

matches = [m.start() for m in re.finditer("findLastIndex", content)]
print(f"Found {len(matches)} matches for 'findLastIndex'")

for idx, pos in enumerate(matches):
    start = max(0, pos - 100)
    end = min(len(content), pos + 400)
    print(f"\n--- Match {idx} at position {pos} ---")
    print(content[start:end])
