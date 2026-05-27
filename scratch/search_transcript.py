import json
import os

TRANSCRIPT_PATH = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\.system_generated\logs\transcript.jsonl"

def search():
    if not os.path.exists(TRANSCRIPT_PATH):
        print(f"Transcript path not found: {TRANSCRIPT_PATH}")
        return
        
    print(f"Searching transcript: {TRANSCRIPT_PATH}")
    with open(TRANSCRIPT_PATH, "r", encoding="utf-8") as f:
        for i, line in enumerate(f):
            try:
                data = json.loads(line)
                content = str(data.get("content", ""))
                tool_calls = str(data.get("tool_calls", ""))
                
                # Check for access code keywords
                for keyword in ["access_code", "access code", "site_access_code", "verify"]:
                    if keyword.lower() in content.lower() or keyword.lower() in tool_calls.lower():
                        print(f"--- Match found on line {i+1} ---")
                        print(f"Content preview: {content[:300]}...")
                        if "site_access_code" in content or "site_access_code" in tool_calls:
                            print(f"Content: {content}")
                        break
            except Exception as e:
                pass

if __name__ == "__main__":
    search()
