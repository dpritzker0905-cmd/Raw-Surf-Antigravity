import os

node_modules_path = r"c:\Users\dprit\Raw-Surf\frontend\node_modules\@openmeteo"
search_terms = ["wasm", "init", "instance", "OmFileReader", "dispose", "pool", "WebAssembly"]

print("Searching inside @openmeteo packages...")
for root, dirs, files in os.walk(node_modules_path):
    for file in files:
        if file.endswith((".js", ".mjs", ".cjs", ".ts")):
            filepath = os.path.join(root, file)
            try:
                with open(filepath, 'r', encoding='utf-8', errors='ignore') as f:
                    content = f.read()
                    
                matches = []
                for term in search_terms:
                    if term.lower() in content.lower():
                        matches.append(term)
                
                if matches:
                    print(f"File: {os.path.relpath(filepath, node_modules_path)} - Matches: {matches}")
                    # Print out some context for WebAssembly or OmFileReader or dispose
                    lines = content.split('\n')
                    for i, line in enumerate(lines):
                        if "wasm" in line.lower() or "dispose" in line.lower() or "oom" in line.lower():
                            if i > 0:
                                print(f"  L{i}: {lines[i-1].strip()}")
                            print(f"  L{i+1}: {line.strip()}")
                            if i < len(lines) - 1:
                                print(f"  L{i+2}: {lines[i+1].strip()}")
                            print("-" * 40)
            except Exception as e:
                print(f"Error reading {filepath}: {e}")
