import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_clean.txt"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Let's search for "staircasing" and print the sentences/lines.
keywords = ["gps", "gfs", "polygon", "staircasing", "ne_50m_land", "ne_110m_land"]

# Find all blocks of text related to GFS or GPS staircasing
pattern = re.compile(r"([^\n]*?(?:stair|gps|gfs|polygon|ocean-mask|mask|landmask)[^\n]*)", re.IGNORECASE)
matches = pattern.findall(content)

print(f"Total lines matching keywords: {len(matches)}")
# Print a subset of lines that are most interesting
count = 0
for line in matches:
    if any(k in line.lower() for k in ["stair", "polygon", "mask"]):
        # clean line from problematic chars just in case
        clean_line = line.encode('ascii', errors='ignore').decode('ascii')
        if "spot-geofences-layer" in clean_line or "geofence" in clean_line or "mask" in clean_line or "staircasing" in clean_line:
            print(clean_line.strip())
            count += 1
            if count > 80:
                break
