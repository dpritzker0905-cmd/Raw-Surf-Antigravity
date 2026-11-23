"""Ablation for the MOP-lite truth readers: they move NO served number.

A served surf height or rating can change only through a module the serving path imports. `nearshore_lite.truth` is an
offline scoring reader; this pins that no serving module imports it, and that the served chain's height is the same with the
module present or its import blocked.
"""
import ast
import pathlib
import sys

ROOT = pathlib.Path(__file__).resolve().parents[1]
SERVING = [ROOT / "routes", ROOT / "services"]


def _imports_truth(path):
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return False
    for n in ast.walk(tree):
        names = []
        if isinstance(n, ast.ImportFrom):
            names = [(n.module or "")] + [f"{n.module or ''}.{a.name}" for a in n.names]
        elif isinstance(n, ast.Import):
            names = [a.name for a in n.names]
        if any(x.endswith("nearshore_lite.truth") or x == "truth" and "nearshore_lite" in str(path) for x in names):
            return True
    return False


def test_no_serving_module_imports_truth():
    offenders = []
    for base in SERVING:
        for p in base.rglob("*.py"):
            if "nearshore_lite" in p.parts:
                continue
            if _imports_truth(p):
                offenders.append(str(p.relative_to(ROOT)))
    assert offenders == [], offenders


def test_served_height_identical_with_truth_import_blocked(monkeypatch):
    """Interior of the swell range (LESSONS L-S10), two periods, the real estimate_surf signature, flag off."""
    from services.weather_pipeline import surf_transform as st
    grid = [(h, t) for h in (0.5, 1.0, 2.0, 4.0) for t in (8.0, 14.0)]

    def run():
        return [st.estimate_surf(h, t, 30.0, True, 0.0, 315.0, 300.0) for h, t in grid]
    before = run()
    assert all(b is not None for b in before)
    monkeypatch.setitem(sys.modules, "services.weather_pipeline.nearshore_lite.truth", None)
    assert run() == before
