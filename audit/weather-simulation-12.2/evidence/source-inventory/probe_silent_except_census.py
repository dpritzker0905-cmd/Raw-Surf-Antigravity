"""12.2 REFUTATION PROBE 2: AST census of SILENT exception handlers.

A handler is SILENT when its body contains no logging call, no raise, no warnings.warn,
and no print. Scope is stated explicitly so the number is reproducible (their claim gave
neither the file set nor the command).
READ-ONLY.
"""
import ast, os, sys, io

ROOTS = ["backend/services/weather_pipeline", "backend/routes"]

def silent(handler):
    for n in ast.walk(handler):
        if isinstance(n, ast.Raise):
            return False
        if isinstance(n, ast.Call):
            f = n.func
            name = ""
            if isinstance(f, ast.Attribute):
                name = f.attr
            elif isinstance(f, ast.Name):
                name = f.id
            if name in ("debug", "info", "warning", "warn", "error", "exception", "critical", "print"):
                return False
    return True

total = 0
per_func = {}
for root in ROOTS:
    for dp, _, fns in os.walk(root):
        for fn in fns:
            if not fn.endswith(".py"):
                continue
            p = os.path.join(dp, fn).replace("\\", "/")
            src = io.open(p, encoding="utf-8").read()
            try:
                tree = ast.parse(src)
            except SyntaxError:
                continue
            # map lineno -> enclosing function
            fmap = []
            for n in ast.walk(tree):
                if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    fmap.append((n.lineno, getattr(n, "end_lineno", n.lineno), n.name))
            for n in ast.walk(tree):
                if isinstance(n, ast.ExceptHandler) and silent(n):
                    total += 1
                    owner = "<module>"
                    best = -1
                    for s, e, nm in fmap:
                        if s <= n.lineno <= e and s > best:
                            best, owner = s, nm
                    per_func.setdefault((p, owner), []).append(n.lineno)

print("SCOPE:", ROOTS)
print("TOTAL silent handlers:", total)
print()
print("TOP 12 functions by silent-handler count:")
for (p, f), lines in sorted(per_func.items(), key=lambda kv: -len(kv[1]))[:12]:
    print("  %2d  %s :: %s  lines=%s" % (len(lines), p, f, lines))
print()
k = ("backend/services/weather_pipeline/surf_rating.py", "rating_transform_grid")
print("THE CITED FUNCTION:", k, "->", per_func.get(k))
