"""Check for duplicate route prefixes and structural issues in backend routes."""
import re, os

route_dir = os.path.join(os.path.dirname(__file__), '..', 'backend', 'routes')
prefixes = {}

for fname in sorted(os.listdir(route_dir)):
    if not fname.endswith('.py') or fname.startswith('__'):
        continue
    fpath = os.path.join(route_dir, fname)
    with open(fpath, encoding='utf-8') as f:
        src = f.read()
    for m in re.finditer(r'APIRouter\(prefix=["\'](/[^"\']+)', src):
        p = m.group(1)
        if p in prefixes:
            prefixes[p].append(fname)
        else:
            prefixes[p] = [fname]

conflicts = {k: v for k, v in prefixes.items() if len(v) > 1}
if conflicts:
    print("ROUTE PREFIX CONFLICTS:")
    for prefix, files in conflicts.items():
        print(f"  {prefix}: used by {files}")
else:
    print("No route prefix conflicts found")

print(f"\nTotal unique route prefixes: {len(prefixes)}")
for p in sorted(prefixes.keys()):
    print(f"  {p} -> {prefixes[p][0]}")
