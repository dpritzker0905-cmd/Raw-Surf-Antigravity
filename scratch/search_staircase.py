import json
import re

log_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\.system_generated\logs\transcript.jsonl"
with open(log_path, 'r', encoding='utf-8') as f:
    for line in f:
        try:
            js = json.loads(line)
            content = js.get("content", "")
            if not content:
                continue
            if "staircase" in content.lower() or "staircasing" in content.lower():
                idx = js.get("step_index", 0)
                source = js.get("source")
                print(f"Step {idx} ({source}):")
                # Print paragraphs containing the match
                for p in content.split("\n\n"):
                    if "staircase" in p.lower() or "staircasing" in p.lower():
                        print(p[:1000])
                        print("-" * 30)
                print("=" * 60)
        except Exception as e:
            pass
