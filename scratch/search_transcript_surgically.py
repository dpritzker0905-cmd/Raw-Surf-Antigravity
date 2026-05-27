import json
import re

log_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\.system_generated\logs\transcript.jsonl"
out_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_search_results.txt"

terms = [r"stair", r"GPS", r"GSHHS", r"coastline", r"coast"]

with open(log_path, 'r', encoding='utf-8') as f, open(out_path, 'w', encoding='utf-8') as out:
    for line in f:
        try:
            js = json.loads(line)
            content = js.get("content", "")
            if not content:
                continue
            
            # Avoid printing massive file contents or transcripts
            if len(content) > 15000:
                content = content[:3000] + "... [TRUNCATED] ..."
                
            matched = []
            for term in terms:
                if re.search(term, content, re.IGNORECASE):
                    matched.append(term)
                    
            if matched and js.get("type") in ["USER_INPUT", "PLANNER_RESPONSE", "MODEL_RESPONSE", "EXPLICIT_USER_REQUEST"]:
                idx = js.get("step_index", 0)
                source = js.get("source")
                step_type = js.get("type")
                out.write(f"=== Step {idx} ({source} - {step_type}) matches {matched} ===\n")
                out.write(content + "\n")
                out.write("=" * 60 + "\n\n")
        except Exception as e:
            pass

print("Search completed. Output written to scratch/stair_search_results.txt")
