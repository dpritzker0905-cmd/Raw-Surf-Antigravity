import os
import json
import re
import sys

sys.stdout.reconfigure(encoding='utf-8')

brain_dir = r"C:\Users\dprit\.gemini\antigravity\brain"
for conv in os.listdir(brain_dir):
    conv_dir = os.path.join(brain_dir, conv)
    if not os.path.isdir(conv_dir):
        continue
    trans_path = os.path.join(conv_dir, ".system_generated", "logs", "transcript.jsonl")
    if not os.path.exists(trans_path):
        continue
    
    with open(trans_path, 'r', encoding='utf-8') as f:
        for line in f:
            try:
                js = json.loads(line)
                content = js.get("content", "")
                if not content:
                    continue
                if re.search(r"stair|gps|coastline", content, re.IGNORECASE):
                    # print type and index
                    print(f"=== Conv {conv} Step {js.get('step_index')} ({js.get('source')} - {js.get('type')}) ===")
                    # print only lines containing the keywords to keep output short
                    for l in content.split("\n"):
                        if re.search(r"stair|gps|coastline", l, re.IGNORECASE):
                            print("  ", l[:200])
                    print("-" * 50)
            except Exception as e:
                pass
