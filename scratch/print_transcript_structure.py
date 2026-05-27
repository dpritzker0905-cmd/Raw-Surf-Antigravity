import json
import os

PATH = r"C:\Users\dprit\.gemini\antigravity\brain\91300015-4149-4f3f-8d9c-549a9b3969fd\.system_generated\logs\transcript.jsonl"
with open(PATH, "r", encoding="utf-8") as f:
    for idx, line in enumerate(f):
        data = json.loads(line)
        print("Keys:", data.keys())
        print("Type:", data.get("type"))
        print("Tool calls:", data.get("tool_calls"))
        if idx > 3:
            break
