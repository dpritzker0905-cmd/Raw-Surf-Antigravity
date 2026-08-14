import os,re,json,sys
ROOT=r"C:\Users\dprit\Raw-Surf\frontend"
SRC=os.path.join(ROOT,"src")
exts=[".js",".jsx",".ts",".tsx",".mjs"]
def norm(p): return os.path.normpath(p).replace("\\","/")
allfiles=set()
for d,_,fs in os.walk(SRC):
    if "node_modules" in d: continue
    for f in fs:
        if os.path.splitext(f)[1] in exts: allfiles.add(norm(os.path.join(d,f)))
IMP=re.compile(r"""(?:import\s+[^;'"]*?from\s*|import\s*|export\s+[^;'"]*?from\s*|require\s*\(\s*|import\s*\(\s*|new\s+URL\s*\(\s*)['"]([^'"]+)['"]""")
def resolve(base,spec):
    if not spec.startswith("."): return None
    p=norm(os.path.join(os.path.dirname(base),spec))
    for c in [p]+[p+e for e in exts]+[norm(os.path.join(p,"index"+e)) for e in exts]:
        if c in allfiles: return c
    return None
edges={}
for f in allfiles:
    try: txt=open(f,encoding="utf-8",errors="replace").read()
    except: txt=""
    # strip block+line comments crudely to avoid prose false-positives
    txt=re.sub(r"/\*.*?\*/","",txt,flags=re.S)
    txt=re.sub(r"^\s*//.*$","",txt,flags=re.M)
    outs=set()
    for m in IMP.finditer(txt):
        r=resolve(f,m.group(1))
        if r: outs.add(r)
    edges[f]=outs
istest=lambda p: ".test." in p or ".spec." in p or "/__tests__/" in p or "/__mocks__/" in p or "setupTests" in p
entries=[p for p in allfiles if p.endswith("/src/index.js") or p.endswith("/src/index.jsx")]
seen=set(); stack=list(entries)
while stack:
    n=stack.pop()
    if n in seen: continue
    seen.add(n)
    for c in edges.get(n,()): 
        if c not in seen: stack.append(c)
prod=[p for p in allfiles if not istest(p)]
unreach=sorted(p for p in prod if p not in seen)
# which unreachable have zero NON-TEST importers at all (true roots of dead subtree)
importers={p:set() for p in allfiles}
for f,os_ in edges.items():
    for t in os_: importers[t].add(f)
zero=[p for p in unreach if not any(not istest(i) for i in importers[p])]
def loc(p):
    try: return sum(1 for _ in open(p,encoding="utf-8",errors="replace"))
    except: return 0
print("entries:",entries)
print("total non-test src files:",len(prod))
print("reachable from entry (incl tests excluded):",len([p for p in seen if not istest(p)]))
print("UNREACHABLE non-test files:",len(unreach),"LOC:",sum(loc(p) for p in unreach))
print("  of which ZERO non-test importers (dead roots):",len(zero),"LOC:",sum(loc(p) for p in zero))
print("\n--- dead roots ---")
for p in zero: print(f"{loc(p):5d}  {p.split('/frontend/src/')[-1]}")
print("\n--- unreachable but imported only by other unreachable ---")
for p in unreach:
    if p not in zero: print(f"{loc(p):5d}  {p.split('/frontend/src/')[-1]}")
