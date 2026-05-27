import os

def scan_project():
    project_root = r"c:\Users\dprit\Raw-Surf"
    frontend_dir = os.path.join(project_root, "frontend", "src")
    backend_dir = os.path.join(project_root, "backend")
    
    exclusions = {
        "node_modules", ".venv", "env", "__pycache__", ".git", 
        "build", "dist", ".system_generated", ".agents"
    }
    
    frontend_extensions = (".js", ".jsx", ".ts", ".tsx", ".css")
    backend_extensions = (".py",)
    
    violations = []
    warnings = []
    
    # 1. Scan Frontend
    print("Scanning Frontend (src)...")
    if os.path.exists(frontend_dir):
        for root, dirs, files in os.walk(frontend_dir):
            # Prune excluded directories in place
            dirs[:] = [d for d in dirs if d not in exclusions]
            for file in files:
                if file.endswith(frontend_extensions):
                    filepath = os.path.join(root, file)
                    try:
                        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                            lines = len(f.readlines())
                        rel_path = os.path.relpath(filepath, project_root)
                        if lines > 800:
                            violations.append(("Frontend", lines, rel_path))
                        elif lines > 700:
                            warnings.append(("Frontend", lines, rel_path))
                    except Exception as e:
                        pass
                        
    # 2. Scan Backend
    print("Scanning Backend...")
    if os.path.exists(backend_dir):
        for root, dirs, files in os.walk(backend_dir):
            dirs[:] = [d for d in dirs if d not in exclusions]
            for file in files:
                if file.endswith(backend_extensions):
                    filepath = os.path.join(root, file)
                    try:
                        with open(filepath, "r", encoding="utf-8", errors="ignore") as f:
                            lines = len(f.readlines())
                        rel_path = os.path.relpath(filepath, project_root)
                        if lines > 800:
                            violations.append(("Backend", lines, rel_path))
                        elif lines > 700:
                            warnings.append(("Backend", lines, rel_path))
                    except Exception as e:
                        pass
                        
    violations.sort(key=lambda x: x[1], reverse=True)
    warnings.sort(key=lambda x: x[1], reverse=True)
    
    print("\n" + "=" * 80)
    print(f"  PROJECT LINE OF CODE (LOC) AUDIT REPORT (Max limit: 800 LOC)")
    print("=" * 80)
    
    print(f"\n[!] VIOLATIONS ({len(violations)} files > 800 LOC):")
    if not violations:
      print("  None! Every scanned code file is under the 800 LOC limit.")
    else:
      for side, lines, path in violations:
        print(f"  [{side}] {lines:4d} LOC  |  {path}")
        
    print(f"\n[?] WARNINGS ({len(warnings)} files between 700-800 LOC):")
    if not warnings:
        print("  None! No files are approaching the 800 LOC warning zone.")
    else:
        for side, lines, path in warnings:
            print(f"  [{side}] {lines:4d} LOC  |  {path}")
            
    print("=" * 80)

if __name__ == "__main__":
    scan_project()
