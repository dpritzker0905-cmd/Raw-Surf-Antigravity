import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

brain_dir = r"C:\Users\dprit\.gemini\antigravity\brain"
found = False
for root, dirs, files in os.walk(brain_dir):
    for file in files:
        if "coastline_masking_audit_report.md" in file:
            path = os.path.join(root, file)
            print(f"=== Found file: {path} ===")
            with open(path, 'r', encoding='utf-8', errors='ignore') as f:
                print(f.read())
            print("=" * 80)
            found = True

if not found:
    print("File coastline_masking_audit_report.md not found.")
