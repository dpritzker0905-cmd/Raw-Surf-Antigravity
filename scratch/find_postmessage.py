import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Let's find all occurrences of worker.postMessage
matches = [m.start() for m in re.finditer(r"\.postMessage\(\{", content)]
print(f"Found {len(matches)} matches for '.postMessage({{'")

for idx, pos in enumerate(matches):
    start = max(0, pos - 150)
    end = min(len(content), pos + 600)
    print(f"\n--- Match {idx} at position {pos} ---")
    print(content[start:end])
