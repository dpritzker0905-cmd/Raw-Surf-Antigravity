"""The fetchers are SPAWNED BY PATH, so a `services.` import in them must be the package fallback, never the only one.

Production runs `python services/<fetcher>.py <payload>` (dwd_marine_service, ecmwf_wave_service, the NOAA
services): `sys.path[0]` is `services/` and the `services` package is not importable. Every fetcher therefore
imports its siblings as `try: from _x import ... except ImportError: from services._x import ...`.

⛔ 2026-09-29: #171 added a bare `from services._fetch_native_cell import ...` inside `fetch_global_coarse` in the
GFS, ICON and EURO fetchers. Every package-context test passed, and every by-path fetch of all three models (EURO
wind and pressure included) died on that line whatever REGRID_NATIVE_CELL said. The real-GRIB parity job, run
by path, caught it before any ingest cycle did. These pin the rule statically (every fetcher, every function) and
by running the three fetchers' imports exactly as the spawn does.
"""
import ast
import os
import subprocess
import sys
from pathlib import Path

import pytest

SERVICES = Path(__file__).resolve().parents[1] / "services"
SPAWNED = sorted(p for p in SERVICES.glob("*_fetcher.py") if '__name__ == "__main__"' in p.read_text(encoding="utf-8"))


def _unguarded_services_imports(path):
    """`from services... import` / `import services...` nodes NOT inside an `except ImportError` handler."""
    tree = ast.parse(path.read_text(encoding="utf-8"))
    parents = {}
    for node in ast.walk(tree):
        for child in ast.iter_child_nodes(node):
            parents[child] = node

    def guarded(node):
        n = node
        while n in parents:
            n = parents[n]
            if isinstance(n, ast.ExceptHandler):
                names = [n.type] if not isinstance(n.type, ast.Tuple) else list(n.type.elts)
                if any(isinstance(t, ast.Name) and t.id in ("ImportError", "ModuleNotFoundError") for t in names):
                    return True
        return False

    bad = []
    for node in ast.walk(tree):
        mods = ([node.module or ""] if isinstance(node, ast.ImportFrom)
                else [a.name for a in node.names] if isinstance(node, ast.Import) else [])
        if any(m == "services" or m.startswith("services.") for m in mods) and not guarded(node):
            bad.append(f"{path.name}:{node.lineno}")
    return bad


def test_the_spawned_fetchers_are_found():
    names = {p.name for p in SPAWNED}
    assert {"noaa_gfs_wave_fetcher.py", "dwd_gwam_fetcher.py", "ecmwf_opendata_fetcher.py"} <= names, names


@pytest.mark.parametrize("path", SPAWNED, ids=lambda p: p.name)
def test_a_spawned_fetcher_imports_services_only_as_the_package_fallback(path):
    assert _unguarded_services_imports(path) == []


def test_the_guard_sees_a_bare_import_inside_a_function(tmp_path):
    """The positive control: the #171 shape must be caught, and the idiom must pass."""
    f = tmp_path / "x_fetcher.py"
    f.write_text("try:\n    from _a import b\nexcept ImportError:\n    from services._a import b\n\n"
                 "def fetch():\n    from services._fetch_native_cell import enabled\n    return enabled\n",
                 encoding="utf-8")
    assert _unguarded_services_imports(f) == [f"{f.name}:7"]


def test_the_three_fetchers_import_by_path_as_production_spawns_them():
    env = {k: v for k, v in os.environ.items() if k != "PYTHONPATH"}
    code = ("import sys\n"
            "try:\n    import services\n    sys.exit('SETUP: services is importable, so this is not by-path')\n"
            "except ImportError:\n    pass\n"
            "import noaa_gfs_wave_fetcher, dwd_gwam_fetcher, ecmwf_opendata_fetcher\n"
            "for m in (noaa_gfs_wave_fetcher, dwd_gwam_fetcher, ecmwf_opendata_fetcher):\n"
            "    assert callable(m._native_enabled) and callable(m.is_native), m.__name__\n"
            "print('BY_PATH_OK')\n")
    r = subprocess.run([sys.executable, "-c", code], cwd=str(SERVICES), env=env, capture_output=True, text=True,
                       timeout=120)
    assert "BY_PATH_OK" in r.stdout, (r.stdout[-800:], r.stderr[-1500:])
