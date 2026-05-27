import sys

sys.stdout.reconfigure(encoding='utf-8')

file_path = r"C:\Users\dprit\.gemini\antigravity\brain\b97d8ab7-4ee5-420f-b778-b93f174dae99\scratch\MapWebGL_good.js"
with open(file_path, 'r', encoding='utf-8', errors='ignore') as f:
    content = f.read()

print("Searching MapWebGL_good.js for bootstrap/engine references:")
for idx, line in enumerate(content.splitlines()):
    if any(k in line for k in ["initEngine", "bootstrap", "engine", "startPlugin"]):
        print(f"L{idx+1}: {line}")
