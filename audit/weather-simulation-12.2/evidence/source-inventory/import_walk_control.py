import ast, os, sys, collections
ROOT = r"C:\Users\dprit\Raw-Surf\backend"

def mod_to_path(m):
    p = os.path.join(ROOT, *m.split(".")) + ".py"
    if os.path.exists(p): return p
    p2 = os.path.join(ROOT, *m.split("."), "__init__.py")
    if os.path.exists(p2): return p2
    return None

def imports_of(path, toplevel_only, skip_edge=None):
    try: tree = ast.parse(open(path, encoding="utf-8").read())
    except Exception: return []
    out = []
    # mark function/class-local nodes
    local = set()
    for n in ast.walk(tree):
        if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
            for c in ast.walk(n):
                local.add(id(c))
    pkg = os.path.relpath(os.path.dirname(path), ROOT).replace(os.sep, ".")
    for n in ast.walk(tree):
        if not isinstance(n, (ast.Import, ast.ImportFrom)): continue
        if toplevel_only and id(n) in local: continue
        if isinstance(n, ast.Import):
            for a in n.names: out.append(a.name)
        else:
            if n.level and n.level > 0:
                base = pkg if n.level == 1 else ".".join(pkg.split(".")[:-(n.level-1)])
                m = f"{base}.{n.module}" if n.module else base
            else:
                m = n.module or ""
            out.append(m)
            for a in n.names:
                if mod_to_path(f"{m}.{a.name}"): out.append(f"{m}.{a.name}")
    res = []
    for m in out:
        if skip_edge and (os.path.relpath(path, ROOT).replace(os.sep,"/"), m) == skip_edge: continue
        res.append(m)
    return res

def walk(entry, toplevel_only, skip_edge=None):
    seen, q = set(), collections.deque()
    start = os.path.join(ROOT, entry)
    q.append(start); seen.add(os.path.relpath(start, ROOT).replace(os.sep,"/"))
    files = {os.path.relpath(start, ROOT).replace(os.sep,"/")}
    parent = {}
    while q:
        p = q.popleft()
        for m in imports_of(p, toplevel_only, skip_edge):
            np = mod_to_path(m)
            if not np: continue
            rel = os.path.relpath(np, ROOT).replace(os.sep,"/")
            if rel in files: continue
            files.add(rel); parent[rel] = os.path.relpath(p, ROOT).replace(os.sep,"/")
            q.append(np)
    return files, parent

for entry in ["scripts/precompute_ci.py", "scripts/ingest_forecast_ci.py"]:
    for tl in (True, False):
        f, par = walk(entry, tl)
        ecmwf = sorted(x for x in f if "ecmwf" in x.lower())
        print(f"{entry:34s} toplevel_only={str(tl):5s} files={len(f):4d} ecmwf={len(ecmwf)} {ecmwf[:3]}")

print("\n=== CONTROL: drop ONLY services/weather_pipeline/point_resolution.py -> routes.weather ===")
EDGE = ("services/weather_pipeline/point_resolution.py", "routes.weather")
for entry in ["scripts/precompute_ci.py", "scripts/ingest_forecast_ci.py"]:
    base,_ = walk(entry, False)
    ctl,_  = walk(entry, False, skip_edge=EDGE)
    def wp(s): return len([x for x in s if x.startswith("services/weather_pipeline/")])
    def ec(s): return sorted(x for x in s if "ecmwf" in x.lower())
    print(f"{entry:32s} files {len(base)}->{len(ctl)}  wp-modules {wp(base)}->{wp(ctl)}  ecmwf {len(ec(base))}->{len(ec(ctl))}")
    if entry.startswith("scripts/precompute"):
        gone = sorted(base - ctl)
        print(f"  modules leaving precompute closure: {len(gone)}")
        for g in gone:
            if any(k in g for k in ("scheduler","ingestion","ecmwf")): print("   -", g)
