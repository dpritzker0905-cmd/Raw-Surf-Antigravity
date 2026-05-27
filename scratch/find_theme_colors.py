import re

path = r"c:\Users\dprit\Raw-Surf\frontend\src\components\map\OceanMask.js"
with open(path, "r", encoding="utf-8") as f:
    content = f.read()

# Find occurrences of THEME_COLORS
matches = [m.start() for m in re.finditer("THEME_COLORS", content)]
print(f"Found {len(matches)} matches for 'THEME_COLORS'")

for idx, pos in enumerate(matches):
    start = max(0, pos - 100)
    end = min(len(content), pos + 400)
    print(f"\n--- Match {idx} at position {pos} ---")
    print(content[start:end])
