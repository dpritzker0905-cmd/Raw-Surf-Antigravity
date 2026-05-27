filepath = r"c:\Users\dprit\Raw-Surf\frontend\src\components\map\mapUtils.js"

try:
    with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
        lines = f.readlines()
        
    print(f"Total lines in mapUtils.js: {len(lines)}")
    
    # Simple parser to find function declarations
    functions = []
    current_func = None
    
    for i, line in enumerate(lines):
        # Match function declarations
        if "function " in line or "const " in line and "=>" in line:
            clean_line = line.strip()
            if clean_line.startswith(("export function", "function", "export const", "const")):
                functions.append((i + 1, clean_line))
                
    print("\nFunctions found in mapUtils.js:")
    for ln, decl in functions:
        print(f"  Line {ln:3d}: {decl[:80]}")
        
except Exception as e:
    print(f"Error: {e}")
