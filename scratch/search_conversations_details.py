import os
import json

BRAIN_DIR = r"C:\Users\dprit\.gemini\antigravity\brain"

def search():
    found = 0
    for conv_id in os.listdir(BRAIN_DIR):
        conv_path = os.path.join(BRAIN_DIR, conv_id)
        if not os.path.isdir(conv_path):
            continue
        transcript_path = os.path.join(conv_path, ".system_generated", "logs", "transcript.jsonl")
        if not os.path.exists(transcript_path):
            continue
            
        with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
            for idx, line in enumerate(f):
                try:
                    data = json.loads(line)
                    tool_calls = data.get("tool_calls", [])
                    if not tool_calls:
                        continue
                    for tc in tool_calls:
                        name = tc.get("name", "")
                        args = tc.get("args", {})
                        if name in ["replace_file_content", "multi_replace_file_content", "write_to_file"]:
                            target = str(args.get("TargetFile", ""))
                            if ".js" in target:
                                found += 1
                                print(f"Conv {conv_id} Step {data.get('step_index')}: {name} on {target}")
                                print(f"  Description: {args.get('Description', '')}")
                except Exception as e:
                    pass
    print(f"Total edits found: {found}")

if __name__ == "__main__":
    search()
