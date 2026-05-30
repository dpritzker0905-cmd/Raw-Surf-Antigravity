import os
import json
import re

log_path = r"C:\Users\dprit\.gemini\antigravity\brain\c9a6ec3d-c904-427c-9911-cbbb7d605aec\.system_generated\logs\transcript.jsonl"
out_path = r"C:\Users\dprit\Raw-Surf\logs_extract.txt"

keywords = ["zoom", "cover", "hide", "transition", "visibility", "hidden"]

with open(log_path, 'r', encoding='utf-8') as f:
    lines = f.readlines()

print(f"Total lines in transcript: {len(lines)}")

matches = []
for idx, line in enumerate(lines):
    try:
        js = json.loads(line)
        content = js.get("content", "")
        # Also check tool_calls
        tool_calls_str = ""
        if "tool_calls" in js:
            tool_calls_str = json.dumps(js["tool_calls"])
        
        full_text = content + " " + tool_calls_str
        
        found = []
        for kw in keywords:
            if re.search(r'\b' + kw, full_text, re.IGNORECASE):
                found.append(kw)
        
        if found:
            matches.append((idx, js.get("type"), js.get("source"), found, content[:1000]))
    except Exception as e:
        pass

print(f"Found {len(matches)} matches")

with open(out_path, 'w', encoding='utf-8') as out:
    out.write(f"=== Found {len(matches)} matches in transcript ===\n")
    for m in matches[-50:]:  # Let's print the last 50 matches (most recent)
        out.write(f"\n--- Match at line {m[0]} (Type: {m[1]}, Source: {m[2]}) ---\n")
        out.write(f"Keywords found: {m[3]}\n")
        out.write(f"Snippet:\n{m[4]}\n")
        out.write("-" * 50 + "\n")

print("Successfully wrote search results to logs_extract.txt")
