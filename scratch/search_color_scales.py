path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

import re
matches = [m.start() for m in re.finditer(r"(const COLOR_SCALES\s*=|COLOR_SCALES_WITH_ALIASES)", content)]
print(f"Found {len(matches)} occurrences.")
out_path = r"c:\Users\dprit\Raw-Surf\scratch\color_scales_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for i, pos in enumerate(matches):
        out.write(f"\n--- MATCH {i+1} ---\n")
        start = max(0, pos - 100)
        end = min(len(content), pos + 10000)
        out.write(content[start:end])
        out.write("\n")
print("Done extracting color scales!")
