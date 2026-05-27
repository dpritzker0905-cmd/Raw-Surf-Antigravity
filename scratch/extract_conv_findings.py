import json
import os

TRANSCRIPT_PATH = r"C:\Users\dprit\.gemini\antigravity\brain\e21eb211-4ee4-4770-90b1-172555238885\.system_generated\logs\transcript.jsonl"

def read():
    if not os.path.exists(TRANSCRIPT_PATH):
        print("Not found")
        return
    with open(TRANSCRIPT_PATH, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
    
    # Iterate backwards to find the last few MODEL responses
    count = 0
    for idx in range(len(lines) - 1, -1, -1):
        try:
            data = json.loads(lines[idx])
            source = data.get("source", "")
            type_ = data.get("type", "")
            content = data.get("content", "")
            if source == "MODEL" and len(content) > 100:
                print(f"\n==================================================")
                print(f"STEP {idx+1} | Source: {source} | Type: {type_}")
                print(f"==================================================")
                print(content)
                count += 1
                if count >= 3:
                    break
        except Exception as e:
            pass

if __name__ == "__main__":
    read()
