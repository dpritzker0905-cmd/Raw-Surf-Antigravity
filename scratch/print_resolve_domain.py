path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

import re
matches = [m.start() for m in re.finditer(r"RESOLVE_DOMAIN_", content)]
for i, pos in enumerate(matches):
    print(f"--- MATCH {i+1} ---")
    print(content[pos-100:pos+300])
