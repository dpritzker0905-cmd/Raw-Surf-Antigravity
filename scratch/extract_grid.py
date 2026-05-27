import re

path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo\weather-map-layer\dist\index.mjs"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

matches = [m.start() for m in re.finditer("getLinearInterpolatedValue", content)]
out_path = r"c:\Users\dprit\Raw-Surf\scratch\grid_output.txt"
with open(out_path, "w", encoding="utf-8") as out:
    for i, pos in enumerate(matches):
        out.write(f"\n--- MATCH {i+1} ---\n")
        start = max(0, pos - 1500)
        end = min(len(content), pos + 1000)
        out.write(content[start:end])
        out.write("\n")
print("Done extracting!")
