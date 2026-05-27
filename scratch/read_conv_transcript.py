import json
import os

TRANSCRIPT_PATH = r"C:\Users\dprit\.gemini\antigravity\brain\e21eb211-4ee4-4770-90b1-172555238885\.system_generated\logs\transcript.jsonl"

def read():
    if not os.path.exists(TRANSCRIPT_PATH):
        print("Not found")
        return
    with open(TRANSCRIPT_PATH, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    print(f"Total steps: {len(lines)}")
    # Print the last few planner responses or user requests
    for i in range(max(0, len(lines) - 15), len(lines)):
        try:
            data = json.loads(lines[i])
            source = data.get("source", "")
            type_ = data.get("type", "")
            content = data.get("content", "")
            print(f"\n--- STEP {i+1} | Source: {source} | Type: {type_} ---")
            if content:
                print(content[:3000])
        except Exception as e:
            print("Error parsing line", i+1, e)

if __name__ == "__main__":
    read()
