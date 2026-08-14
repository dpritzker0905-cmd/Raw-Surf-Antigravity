"""12.2 refutation probe: re-run the guard test's own AST logic against BOTH alert paths.

Read-only. Writes nothing. Mirrors backend/tests/test_surf_alert_states_the_quality.py:100-133.
"""
import ast
import os
import sys

BACKEND = r"C:\Users\dprit\Raw-Surf\backend"

TARGETS = [
    "scheduler/surf_alerts.py",
    "routes/surf_data/alerts.py",
]


def probe(rel):
    path = os.path.join(BACKEND, rel)
    src = open(path, encoding="utf-8").read()
    tree = ast.parse(src)
    docstrings = {
        node.body[0].value
        for node in ast.walk(tree)
        if isinstance(node, (ast.Module, ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef))
        and node.body and isinstance(node.body[0], ast.Expr)
        and isinstance(node.body[0].value, ast.Constant)
        and isinstance(node.body[0].value.value, str)
    }
    live = [n for n in ast.walk(tree)
            if isinstance(n, ast.Constant) and isinstance(n.value, str) and n not in docstrings]
    offenders = [(n.lineno, n.value[:70]) for n in live if "perfect condition" in n.value.lower()]
    called = any(
        isinstance(n, ast.Call)
        and (n.func.attr if isinstance(n.func, ast.Attribute) else getattr(n.func, "id", None))
        == "surf_alert_body"
        for n in ast.walk(tree)
    )
    # does the module ever READ rating / rating_level off a dict?
    reads_rating = any(
        isinstance(n, ast.Constant) and n.value == "rating" for n in live
    )
    reads_level = any(
        isinstance(n, ast.Constant) and n.value == "rating_level" for n in live
    )
    # POSITIVE CONTROL: the technique must find a literal we KNOW is there.
    control = [(n.lineno, n.value[:40]) for n in live if "surf_alert" == n.value]
    print("FILE %s" % rel)
    print("  LIVE 'perfect conditions' literals: %r" % (offenders,))
    print("  calls surf_alert_body: %s" % called)
    print("  reads 'rating'/'rating_level' literal: %s/%s" % (reads_rating, reads_level))
    print("  POSITIVE CONTROL live literal 'surf_alert': %r" % (control,))
    print("")


for t in TARGETS:
    probe(t)
