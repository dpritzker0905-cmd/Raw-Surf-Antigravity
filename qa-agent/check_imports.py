"""Deep structural check: verify all imports in App.js resolve to actual exports."""
import re, os

frontend_src = os.path.join(os.path.dirname(__file__), '..', 'frontend', 'src')
app_js = os.path.join(frontend_src, 'App.js')

with open(app_js, encoding='utf-8') as f:
    app_src = f.read()

issues = []

# Parse imports from App.js
import_re = re.compile(r"import\s+(?:\{([^}]+)\}|(\w+))\s+from\s+['\"]\.\/([^'\"]+)['\"]")
for m in import_re.finditer(app_src):
    named = m.group(1)
    default = m.group(2)
    path = m.group(3)
    
    # Resolve path
    if path.endswith('.js'):
        full_path = os.path.join(frontend_src, path)
    else:
        full_path = os.path.join(frontend_src, path + '.js')
    
    if not os.path.exists(full_path):
        # Try index.js
        idx_path = os.path.join(frontend_src, path, 'index.js')
        if not os.path.exists(idx_path):
            issues.append(f"FILE NOT FOUND: ./{path} -> {full_path}")
            continue
        full_path = idx_path
    
    with open(full_path, encoding='utf-8') as f:
        target_src = f.read()
    
    # Check named exports
    if named:
        for export_name in [n.strip() for n in named.split(',')]:
            if ' as ' in export_name:
                export_name = export_name.split(' as ')[0].strip()
            if not export_name:
                continue
            # Check for export { X } or export const X or export function X or export class X
            patterns = [
                rf'export\s+(?:const|let|var|function|class)\s+{re.escape(export_name)}\b',
                rf'export\s*\{{[^}}]*\b{re.escape(export_name)}\b[^}}]*\}}',
            ]
            found = any(re.search(p, target_src) for p in patterns)
            if not found:
                issues.append(f"MISSING NAMED EXPORT: '{export_name}' not found in ./{path}")
    
    # Check default exports
    if default:
        if 'export default' not in target_src:
            # Check memo/forwardRef wrapping
            if f'export default' not in target_src:
                issues.append(f"MISSING DEFAULT EXPORT: '{default}' -> ./{path} has no 'export default'")

if issues:
    print(f"STRUCTURAL ISSUES FOUND ({len(issues)}):")
    for i in issues:
        print(f"  - {i}")
else:
    print("All App.js imports resolve correctly")
