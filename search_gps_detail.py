import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_all.txt"

with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    text = f.read()

# Let's find all occurrences of 'recoloring' or 'stair' or 'GPS' or 'staircasing'
# and extract sections of about 1000 characters around them.
matches = [m.start() for m in re.finditer(r"recolor|stair|GPS|GSHHS", text, re.IGNORECASE)]
print(f"Found {len(matches)} matches.")

seen = set()
for idx, pos in enumerate(matches[:30]):  # print first 30 matches
    start = max(0, pos - 400)
    end = min(len(text), pos + 600)
    snippet = text[start:end]
    # avoid duplicates
    if snippet[:100] in seen:
        continue
    seen.add(snippet[:100])
    
    print(f"=== Match {idx+1} at position {pos} ===")
    print(snippet)
    print("=" * 80)
