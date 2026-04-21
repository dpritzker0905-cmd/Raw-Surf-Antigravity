import ast, os

route_dir = r'C:\Users\dprit\.gemini\antigravity\scratch\raw-surf\Raw-Surf-main\backend\routes'
errors = []

for f in sorted(os.listdir(route_dir)):
    if not f.endswith('.py'):
        continue
    path = os.path.join(route_dir, f)
    try:
        with open(path, 'r', encoding='utf-8') as fh:
            ast.parse(fh.read())
    except SyntaxError as e:
        txt = e.text.strip() if e.text else ''
        errors.append((f, e.lineno, e.msg, txt))

if errors:
    print(f"Found {len(errors)} syntax errors:")
    for fname, lineno, msg, txt in errors:
        print(f"  {fname}:{lineno} => {msg}")
        print(f"    {txt}")
else:
    print("All route files clean!")
