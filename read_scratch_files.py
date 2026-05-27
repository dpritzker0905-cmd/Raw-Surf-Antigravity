import os
import sys

sys.stdout.reconfigure(encoding='utf-8')

scratch_dir = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch"
for file in os.listdir(scratch_dir):
    path = os.path.join(scratch_dir, file)
    if os.path.isfile(path) and file.endswith(".js"):
        print(f"=== File: {file} (Size: {os.path.getsize(path)} bytes) ===")
        # Print first 50 lines to identify
        with open(path, 'r', encoding='utf-8', errors='ignore') as f:
            for idx, line in enumerate(f):
                if idx < 50:
                    print(line.rstrip())
        print("-" * 50)
