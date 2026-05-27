import sys
import re

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\stair_conversations_clean.txt"
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

keywords = ["animation", "animating", "animate", "RAF", "loop", "advect", "CanvasAnimationCoordinator"]
paragraphs = content.split("\n\n")
print(f"Total paragraphs to search: {len(paragraphs)}")

count = 0
for p in paragraphs:
    if any(k.lower() in p.lower() for k in keywords):
        if "particle" in p.lower() or "canvas" in p.lower() or "marine" in p.lower() or "wind" in p.lower() or "failed" in p.lower():
            count += 1
            print(f"=== MATCH {count} ===")
            # Remove high unicode chars for safety
            safe_text = p[:1500].encode('ascii', errors='replace').decode('ascii')
            print(safe_text)
            print("="*60)

print(f"Found {count} matching paragraphs.")
