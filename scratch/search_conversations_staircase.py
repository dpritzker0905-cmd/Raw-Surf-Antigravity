import os
import re

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
for line in matches[:40]:
    if any(k in line.lower() for k in ["stair", "polygon", "mask"]):
        print(line.strip())
