"""No module-level bare numeric env parse may survive in the serving tree (MC-09 class guard).

The class, measured 2026-08-15: 22 sites shaped `NAME = int(os.environ.get(...))` at module level
across routes/ + weather_pipeline. Each is an import-time crash on a config typo, and several feed
sharp edges (Semaphore(0) = deadlock — conditions.py:73 had no floor while weather.py:563 clamped
the SAME env var). The repair routes every one through `config_env.env_int/env_float`, which
default-on-typo and clamp-on-range, loudly.

This file holds the guard that keeps the class closed, with a positive control on the scanner
(a census that cannot find its own fixture is grading nothing), and the reload-proof that the
one confirmed deadlock input can no longer reach the semaphore.
"""
import ast
import importlib
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

SCAN_ROOTS = ("routes", os.path.join("services", "weather_pipeline"))


def _module_level_bare_parses(source: str):
    """Top-level `X = int(...)`/`X = float(...)` whose call subtree reads os.environ."""
    out = []
    try:
        tree = ast.parse(source)
    except SyntaxError:
        return out
    for node in tree.body:                                   # module level ONLY — that is the class
        if not (isinstance(node, ast.Assign) and isinstance(node.value, ast.Call)):
            continue
        fn = node.value.func
        if getattr(fn, "id", None) not in ("int", "float"):
            continue
        env_read = any(
            isinstance(sub, ast.Attribute) and sub.attr in ("environ", "getenv")
            for sub in ast.walk(node.value)
        )
        if env_read:
            out.append(node.lineno)
    return out


def test_the_scanner_can_find_the_shape__THE_CONTROL():
    fixture = "import os\nX = int(os.environ.get('A', '1'))\nY = float(os.getenv('B', '2'))\n"
    assert len(_module_level_bare_parses(fixture)) == 2, "the scanner went blind to its own fixture"
    guarded = "import os\ndef f():\n    return int(os.environ.get('A', '1'))\n"
    assert _module_level_bare_parses(guarded) == [], "call-time parses are OUT of this guard's class"


def test_no_module_level_bare_numeric_env_parse_in_the_serving_tree():
    offenders = []
    for root in SCAN_ROOTS:
        base = os.path.join(BACKEND, root)
        for dirpath, _dirs, files in os.walk(base):
            for f in files:
                if not f.endswith(".py"):
                    continue
                path = os.path.join(dirpath, f)
                rel = os.path.relpath(path, BACKEND)
                src = open(path, encoding="utf-8").read()
                for line in _module_level_bare_parses(src):
                    offenders.append(f"{rel}:{line}")
    assert not offenders, (
        "module-level bare numeric env parses — an import-time crash on a config typo; route "
        "them through config_env.env_int/env_float:\n  " + "\n  ".join(sorted(offenders)))


def test_a_zero_concurrency_cannot_deadlock_the_batch_semaphore(monkeypatch):
    """THE confirmed sharp edge: SPOT_RATINGS_CONCURRENCY=0 reached Semaphore(0) in
    conditions.py:73 unfloored — every /conditions/batch request would wait forever. After the
    repair the module resolves 0 → 1, loudly, at parse time."""
    import routes.surf_data.conditions as cond
    try:
        monkeypatch.setenv("SPOT_RATINGS_CONCURRENCY", "0")
        importlib.reload(cond)
        assert cond._BATCH_CONCURRENCY >= 1, (
            f"_BATCH_CONCURRENCY={cond._BATCH_CONCURRENCY} — Semaphore(0) is a request that "
            f"never returns")
        monkeypatch.setenv("SPOT_RATINGS_CONCURRENCY", "six")
        importlib.reload(cond)                                # a typo must not kill the import
        assert cond._BATCH_CONCURRENCY == 6, "typo must fall back to the shipped default"
    finally:
        monkeypatch.delenv("SPOT_RATINGS_CONCURRENCY", raising=False)
        importlib.reload(cond)                                # restore the module for other tests
    assert cond._BATCH_CONCURRENCY == 6
