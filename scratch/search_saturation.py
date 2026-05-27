import os
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_clean.txt"

with open(file_path, 'r', encoding='utf-8') as f:
    content = f.read()

pattern = re.compile(r"([^\n]*?raster-saturation[^\n]*)", re.IGNORECASE)
matches = pattern.findall(content)

print(f"Total lines: {len(matches)}")
for l in matches[:20]:
    print(l.encode('ascii', errors='ignore').decode('ascii').strip())
