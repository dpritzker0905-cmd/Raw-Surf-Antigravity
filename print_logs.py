import os
import re

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_clean.txt"
out_path = r"C:\Users\dprit\Raw-Surf\logs_extract_first.txt"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

# Find matches for GPS/staircasing
keywords = ["GPS", "staircasing", "bleed"]
with open(out_path, 'w', encoding='utf-8') as out:
    matches = []
    for m in re.finditer(r"\bGPS\b", content, re.IGNORECASE):
        pos = m.start()
        sub = content[max(0, pos-200):pos+400]
        if "stair" in sub.lower() or "polygon" in sub.lower() or "bleed" in sub.lower() or "staircase" in sub.lower():
            matches.append(pos)
            
    out.write(f"=== Found {len(matches)} GPS-stair matches ===\n")
    for i, pos in enumerate(matches):
        out.write(f"\n--- Match {i+1} at index {pos} ---\n")
        out.write(content[max(0, pos-400):pos+800] + "\n")
        out.write("-" * 50 + "\n")

print("Wrote search results to logs_extract_first.txt successfully!")
