"""Backend structural audit: check model references, import chains, and database alignment."""
import re, os, ast

backend_dir = os.path.join(os.path.dirname(__file__), '..', 'backend')

print("=== BACKEND STRUCTURAL AUDIT ===\n")
issues = []

# 1. Check all route files import from models correctly
route_dir = os.path.join(backend_dir, 'routes')
models_path = os.path.join(backend_dir, 'models.py')

# Parse models.py to get all table class names
with open(models_path, encoding='utf-8') as f:
    models_src = f.read()

model_classes = set()
for m in re.finditer(r'^class\s+(\w+)\(.*Base\)', models_src, re.MULTILINE):
    model_classes.add(m.group(1))

print(f"Found {len(model_classes)} SQLAlchemy model classes")

# 2. Check for model imports in route files that reference non-existent classes
for fname in sorted(os.listdir(route_dir)):
    if not fname.endswith('.py') or fname.startswith('__'):
        continue
    fpath = os.path.join(route_dir, fname)
    with open(fpath, encoding='utf-8') as f:
        src = f.read()
    
    # Find all imports from models
    for m in re.finditer(r'from\s+models\s+import\s+([^;\n]+)', src):
        imported_names = [n.strip().rstrip(',') for n in m.group(1).split(',')]
        # Handle multi-line imports
        if '(' in m.group(1):
            # Get the full import block
            start = m.start()
            end = src.find(')', start) + 1
            block = src[start:end]
            imported_names = [n.strip().rstrip(',') for n in re.findall(r'\b(\w+)\b', block.split('import')[1])]
        
        for name in imported_names:
            name = name.strip()
            if not name or name in ('', '\\', '(', ')'):
                continue
            if name not in model_classes and name not in ('Base',):
                issues.append(f"[MODEL] routes/{fname} imports unknown model: {name}")

# 3. Check for route files not imported in __init__.py
init_path = os.path.join(route_dir, '__init__.py')
with open(init_path, encoding='utf-8') as f:
    init_src = f.read()

route_files = set()
for fname in os.listdir(route_dir):
    if fname.endswith('.py') and not fname.startswith('__') and fname != '__pycache__':
        module = fname[:-3]
        route_files.add(module)

imported_in_init = set()
for m in re.finditer(r'from\s+\.(\w+)\s+import', init_src):
    imported_in_init.add(m.group(1))

unregistered = route_files - imported_in_init
if unregistered:
    for u in sorted(unregistered):
        issues.append(f"[ORPHAN] routes/{u}.py exists but is NOT imported in __init__.py")

# 4. Check database.py for proper async setup
db_path = os.path.join(backend_dir, 'database.py')
with open(db_path, encoding='utf-8') as f:
    db_src = f.read()

if 'async_session_maker' not in db_src and 'AsyncSession' in db_src:
    issues.append("[DB] database.py uses AsyncSession but async_session_maker not defined")

if 'get_db' not in db_src:
    issues.append("[DB] database.py missing get_db dependency injection function")

# 5. Check scheduler.py for broken imports
sched_path = os.path.join(backend_dir, 'scheduler.py')
with open(sched_path, encoding='utf-8') as f:
    sched_src = f.read()

for m in re.finditer(r'from\s+models\s+import\s+([^;\n(]+)', sched_src):
    for name in [n.strip().rstrip(',') for n in m.group(1).split(',')]:
        if name and name not in model_classes and name not in ('Base',):
            issues.append(f"[MODEL] scheduler.py imports unknown model: {name}")

# 6. Check for duplicate route paths within a single file
for fname in sorted(os.listdir(route_dir)):
    if not fname.endswith('.py') or fname.startswith('__'):
        continue
    fpath = os.path.join(route_dir, fname)
    with open(fpath, encoding='utf-8') as f:
        src = f.read()
    
    endpoints = {}
    for m in re.finditer(r'@router\.(get|post|put|delete|patch)\(["\']([^"\']+)', src):
        method = m.group(1).upper()
        path = m.group(2)
        key = f"{method} {path}"
        if key in endpoints:
            line = src[:m.start()].count('\n') + 1
            issues.append(f"[DUPE] routes/{fname}:{line} - Duplicate endpoint: {key}")
        endpoints[key] = True

# Report
print(f"\nTotal issues: {len(issues)}")
model_issues = [i for i in issues if '[MODEL]' in i]
orphans = [i for i in issues if '[ORPHAN]' in i]
db_issues = [i for i in issues if '[DB]' in i]
dupes = [i for i in issues if '[DUPE]' in i]

if model_issues:
    print(f"\n--- BROKEN MODEL IMPORTS ({len(model_issues)}) ---")
    for i in model_issues:
        print(f"  {i}")

if orphans:
    print(f"\n--- ORPHANED ROUTE FILES ({len(orphans)}) ---")
    for i in orphans:
        print(f"  {i}")

if db_issues:
    print(f"\n--- DATABASE ISSUES ({len(db_issues)}) ---")
    for i in db_issues:
        print(f"  {i}")

if dupes:
    print(f"\n--- DUPLICATE ENDPOINTS ({len(dupes)}) ---")
    for i in dupes:
        print(f"  {i}")

if not issues:
    print("\nAll backend structural checks passed!")
