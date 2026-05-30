path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

import re
matches = [m.start() for m in re.finditer(r"\bcallback\b", content, re.IGNORECASE)]
print(f"Total 'callback' occurrences: {len(matches)}")
# Let's search for any option keys that are passed to fileReader or similar
matches_opt = [m.start() for m in re.finditer(r"postRead", content, re.IGNORECASE)]
print(f"Total 'postRead' occurrences in dist/index.mjs: {len(matches_opt)}")
# Search in index.cjs too just in case
path_cjs = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.cjs"
with open(path_cjs, "r", encoding="utf-8") as f_cjs:
    content_cjs = f_cjs.read()
matches_opt_cjs = [m.start() for m in re.finditer(r"postRead", content_cjs, re.IGNORECASE)]
print(f"Total 'postRead' occurrences in dist/index.cjs: {len(matches_opt_cjs)}")
