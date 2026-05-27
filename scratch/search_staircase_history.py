import re

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_all.txt"
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    raw_content = f.read()

# Clean up space-separated characters
cleaned_content = raw_content.replace(" \x00", "").replace("\x00", "")
if len(cleaned_content) == len(raw_content):
    if raw_content[1] == ' ' and raw_content[3] == ' ':
        cleaned_content = "".join([raw_content[i] for i in range(0, len(raw_content), 2)])

print(f"Total cleaned length: {len(cleaned_content)}")

# Let's find occurrences of 'stair' or 'GPS' in the cleaned history
matches = [m.start() for m in re.finditer(r"(staircasing|staircase|GPS|GSHHS)", cleaned_content, re.IGNORECASE)]
print(f"Found {len(matches)} matches.")

seen = set()
for idx, pos in enumerate(matches):
    start = max(0, pos - 300)
    end = min(len(cleaned_content), pos + 500)
    snippet = cleaned_content[start:end]
    key = snippet[:50]
    if key in seen:
        continue
    seen.add(key)
    print(f"\n=== Match {idx+1} at index {pos} ===")
    print(snippet)
    print("-" * 80)
