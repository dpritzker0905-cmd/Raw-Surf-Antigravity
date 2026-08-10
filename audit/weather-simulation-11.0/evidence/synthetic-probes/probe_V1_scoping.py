"""V1 Q1/Q2 -- re-derive the band's rating call and prove/refute the function-scoping claim.

Run from backend/:  python ../audit/.../probe_V1_scoping.py
ASCII output only (cp1252 stdout).
"""
import ast
import inspect
import sys

sys.path.insert(0, ".")

from services.weather_pipeline import surf_rating, sim_rating, spot_ratings, spot_conditions
from services.weather_pipeline.surf_rating import rating_score, compute_surf_rating

SIG = list(inspect.signature(rating_score).parameters)
SIG_CSR = list(inspect.signature(compute_surf_rating).parameters)

print("=== Q1: signatures ===")
print("rating_score        :", SIG)
print("compute_surf_rating :", SIG_CSR)
print("IDENTICAL ORDER     :", SIG == SIG_CSR)
print()


def walk(module, function=None):
    """Reimplementation of _rating_call's discovery, but reporting LINE numbers too."""
    tree = ast.parse(inspect.getsource(module))
    if function is not None:
        scoped = [n for n in ast.walk(tree)
                  if isinstance(n, (ast.FunctionDef, ast.AsyncFunctionDef)) and n.name == function]
        assert scoped, "no such function"
        assert len(scoped) == 1, "ambiguous"
        tree = scoped[0]
    out = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name in ("compute_surf_rating", "rating_score"):
            supplied = set(SIG[:len(node.args)]) | {k.arg for k in node.keywords if k.arg}
            out.append((node.lineno, name, len(node.args),
                        [k.arg for k in node.keywords if k.arg], sorted(supplied)))
    return out


print("=== Q2: surf_rating WHOLE MODULE ===")
whole = walk(surf_rating)
for lineno, name, npos, kw, supplied in whole:
    print("  line %-5d %-20s npos=%-3d kwargs=%-22s -> %d factors" %
          (lineno, name, npos, ",".join(kw) or "-", len(supplied)))
sets = [tuple(s[4]) for s in whole]
print("  call sites: %d ; ALL AGREE: %s" % (len(whole), len(set(sets)) == 1))
print()

print("=== Q2: surf_rating SCOPED to rating_transform_grid ===")
scoped = walk(surf_rating, "rating_transform_grid")
for lineno, name, npos, kw, supplied in scoped:
    print("  line %-5d %-20s npos=%-3d kwargs=%-22s -> %s" %
          (lineno, name, npos, ",".join(kw) or "-", supplied))
print("  call sites: %d" % len(scoped))
print()

print("=== Q2 control: do the OTHER three surfaces have >1 call site? ===")
for label, mod in (("spot_ratings", spot_ratings), ("spot_conditions", spot_conditions),
                   ("sim_rating", sim_rating)):
    w = walk(mod)
    sets = set(tuple(x[4]) for x in w)
    print("  %-18s call sites=%d  agree=%s  lines=%s" %
          (label, len(w), len(sets) == 1, [x[0] for x in w]))
print()

print("=== Q2 counterfactual: what would the UNSCOPED walk do to the band entry? ===")
sets = set(tuple(s[4]) for s in whole)
if len(sets) == 1:
    print("  UNSCOPED WOULD PASS -> scoping is NOT load-bearing for the agreement assert")
else:
    print("  UNSCOPED WOULD FAIL the agreement assert -> scoping IS load-bearing")
    for s in sorted(sets):
        print("     ", list(s))
