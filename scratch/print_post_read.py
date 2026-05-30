path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

import re
matches = [m.start() for m in re.finditer(r"postRead", content, re.IGNORECASE)]
for i, pos in enumerate(matches):
    print(f"\n--- MATCH {i+1} ---")
    start = max(0, pos - 150)
    end = min(len(content), pos + 150)
    print(content[start:end])
