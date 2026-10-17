"""LA-PAY-08 guard: every first-party `from <module> import <name>` in the server must resolve.

Lazy imports (inside a function body) only fail when the route runs, so the app boots, the import check passes
and the route 500s. Three such imports pointed at helpers that had not existed at that path since 2026-05-08:
booking creation, crew-share payment and dispatch alerts all failed on their first line. This reads every module
statically (no import, no I/O), so it also covers modules that need credentials to import.
"""
import ast
from pathlib import Path

import pytest

ROOT = Path(__file__).resolve().parent.parent
SCAN = ("routes", "services", "utils", "core", "scheduler")
# (importing file relative to backend, imported module, name) that are known-bad and owned elsewhere.
KNOWN_BROKEN = set()


def _module_file(dotted):
    base = ROOT.joinpath(*dotted.split("."))
    if base.with_suffix(".py").is_file():
        return base.with_suffix(".py")
    if (base / "__init__.py").is_file():
        return base / "__init__.py"
    return None


def _defined_names(path, seen=None):
    """Top-level names a module offers, following `from x import *` and a try/if body; None if unknowable."""
    seen = seen or set()
    if path in seen:
        return set()
    seen.add(path)
    tree = ast.parse(path.read_bytes())
    names = set()

    def walk(body):
        for node in body:
            if isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef, ast.ClassDef)):
                names.add(node.name)
            elif isinstance(node, (ast.Assign, ast.AnnAssign, ast.AugAssign)):
                targets = node.targets if isinstance(node, ast.Assign) else [node.target]
                for t in targets:
                    for n in ast.walk(t):
                        if isinstance(n, ast.Name):
                            names.add(n.id)
            elif isinstance(node, (ast.Import, ast.ImportFrom)):
                for a in node.names:
                    if a.name == "*" and isinstance(node, ast.ImportFrom):
                        target = _resolve(node, path)
                        star = _module_file(target) if target else None
                        if star:
                            names.update(_defined_names(star, seen) or ())
                        else:
                            names.add("*")
                    else:
                        names.add((a.asname or a.name).split(".")[0])
            elif isinstance(node, (ast.If, ast.Try, ast.With)):
                for field in ("body", "orelse", "finalbody"):
                    walk(getattr(node, field, []) or [])
                for h in getattr(node, "handlers", []):
                    walk(h.body)

    walk(tree.body)
    return names


def _resolve(node, path):
    if node.level == 0:
        return node.module
    pkg = list(path.relative_to(ROOT).with_suffix("").parts)
    if path.name != "__init__.py":
        pkg = pkg[:-1]
    else:
        pkg = pkg[:-1]
    pkg = pkg[: len(pkg) - (node.level - 1)] if node.level > 1 else pkg
    return ".".join(pkg + ([node.module] if node.module else []))


def _unresolved():
    bad = []
    for top in SCAN:
        for path in sorted((ROOT / top).rglob("*.py")):
            tree = ast.parse(path.read_bytes())
            for node in ast.walk(tree):
                if not isinstance(node, ast.ImportFrom):
                    continue
                target = _resolve(node, path)
                if not target:
                    continue
                target_file = _module_file(target)
                if target_file is None:
                    continue  # third party, stdlib or a data path: not this guard's business
                offered = _defined_names(target_file)
                if "*" in offered:
                    continue
                for a in node.names:
                    if a.name == "*" or a.name in offered:
                        continue
                    if _module_file(f"{target}.{a.name}") is not None:
                        continue  # `from pkg import submodule`
                    key = (str(path.relative_to(ROOT)).replace("\\", "/"), target, a.name)
                    if key not in KNOWN_BROKEN:
                        bad.append(f"{key[0]}:{node.lineno} imports {a.name} from {target}, which does not define it")
    return bad


def test_no_first_party_import_names_a_missing_symbol():
    bad = _unresolved()
    assert not bad, "unresolvable imports:\n" + "\n".join(bad)


@pytest.mark.parametrize("module,name", [
    ("routes.notifications.push_payloads", "notify_booking"),
    ("routes.notifications.push_payloads", "notify_dispatch_alert"),
    ("routes.notifications.push_payloads", "notify_crew_payment_received"),
    ("routes.notifications.push_payloads", "notify_new_message"),
])
def test_the_helpers_the_money_routes_call_exist_where_they_import_them(module, name):
    assert name in _defined_names(_module_file(module))
