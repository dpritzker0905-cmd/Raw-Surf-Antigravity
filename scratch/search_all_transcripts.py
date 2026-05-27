import os
import json
import re

BRAIN_DIR = r"C:\Users\dprit\.gemini\antigravity\brain"
KEYWORDS = [
    "wind particles", "marine wave", "animation loop", "RAF tick", 
    "initEngine", "isTransitioning", "engine-bootstrap", "render-orchestrator", 
    "CanvasAnimationCoordinator", "GPUWindLayer", "GPUMarineLayer"
]

def search():
    matches = []
    print(f"Scanning directories in {BRAIN_DIR}...")
    for conv_id in os.listdir(BRAIN_DIR):
        conv_path = os.path.join(BRAIN_DIR, conv_id)
        if not os.path.isdir(conv_path):
            continue
        transcript_path = os.path.join(conv_path, ".system_generated", "logs", "transcript.jsonl")
        if not os.path.exists(transcript_path):
            continue
            
        # Search the transcript
        with open(transcript_path, "r", encoding="utf-8", errors="ignore") as f:
            for line_no, line in enumerate(f):
                try:
                    data = json.loads(line)
                    content = str(data.get("content", ""))
                    tool_calls = str(data.get("tool_calls", ""))
                    
                    found_kws = []
                    for kw in KEYWORDS:
                        if re.search(r'\b' + re.escape(kw) + r'\b', content, re.IGNORECASE) or \
                           re.search(r'\b' + re.escape(kw) + r'\b', tool_calls, re.IGNORECASE):
                            found_kws.append(kw)
                            
                    if found_kws:
                        matches.append({
                            "conv_id": conv_id,
                            "line_no": line_no + 1,
                            "keywords": found_kws,
                            "content_snippet": content[:300].strip().replace('\n', ' ')
                        })
                except Exception:
                    pass
                    
    print(f"Found {len(matches)} matching steps across all conversations.")
    
    # Group by conversation and print summaries
    by_conv = {}
    for m in matches:
        by_conv.setdefault(m["conv_id"], []).append(m)
        
    for cid, items in by_conv.items():
        print(f"\n==================================================")
        print(f"Conversation ID: {cid} ({len(items)} matches)")
        print(f"==================================================")
        # Print a sample of matches
        for i, item in enumerate(items[:10]):
            print(f"  Line {item['line_no']} | Kws: {item['keywords']}")
            print(f"    Snippet: {item['content_snippet'][:150]}...")
        if len(items) > 10:
            print(f"  ... and {len(items) - 10} more matches.")

if __name__ == "__main__":
    search()
