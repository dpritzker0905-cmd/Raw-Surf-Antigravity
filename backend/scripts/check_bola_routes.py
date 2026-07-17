"""
check_bola_routes.py — BOLA/IDOR drift guard (Phase 0-B of the 2026-07-12 user-ID auth review).

The governance root cause from HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md §2.4:
this exact debt was "fixed and declared complete" twice (c1526cdc, 84236b0c) and silently
reaccumulated to 221 routes, because nothing ENFORCES the pattern on new code. This scanner is
that enforcement: AST-based (regex breaks on nested parens like Query(None, description="...") —
the review's own §2.1 self-correction), it flags every @router.*-decorated function that takes a
bare `user_id` parameter without ANY of the real auth-dependency markers in its signature.

RATCHET MODEL (mirrors the review's recommendation: protect NEW routes immediately, triage the
existing debt by domain later):
  * `bola_baseline.json` holds the known offenders (file::function). CI FAILS only on offenders
    NOT in the baseline — a new bare-user_id route breaks the build the day it's written.
  * Fixed offenders produce a warning asking to shrink the baseline (run --write-baseline), so
    the ratchet only ever tightens. The baseline is never auto-grown.

Usage:
  python scripts/check_bola_routes.py                  # scan + compare against baseline (CI mode)
  python scripts/check_bola_routes.py --write-baseline # regenerate the baseline after triage work
  python scripts/check_bola_routes.py --list           # print every current offender
"""
import ast
import json
import os
import sys

ROUTES_DIR = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes")
BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "bola_baseline.json")

# The five real auth-dependency names in this codebase — verified exhaustive in the review's
# final pass (every def matching get_current_*/get_optional_*/get_user_id_*/require_* in
# deps/ + core/ was enumerated; exactly these five exist).
AUTH_MARKERS = {
    "get_current_admin",
    "get_current_user_id",
    "get_user_id_from_jwt_or_query",
    "get_optional_user_id_from_jwt_or_query",
    "get_optional_user_id",
}


def _names_in_expr(node):
    """Every bare Name/Attribute-tail identifier inside an expression (handles Depends(fn),
    Depends(module.fn), Query(None), nested calls)."""
    out = set()
    for sub in ast.walk(node):
        if isinstance(sub, ast.Name):
            out.add(sub.id)
        elif isinstance(sub, ast.Attribute):
            out.add(sub.attr)
    return out


def _is_router_decorated(fn):
    for dec in fn.decorator_list:
        # @router.get("/x") / @router.post(...) — a Call whose func is Attribute on Name 'router'-ish
        target = dec.func if isinstance(dec, ast.Call) else dec
        if isinstance(target, ast.Attribute) and isinstance(target.value, ast.Name):
            if "router" in target.value.id.lower():
                return True
    return False


def scan(routes_dir=ROUTES_DIR):
    offenders = []
    for root, _dirs, files in os.walk(routes_dir):
        if "__pycache__" in root:
            continue
        for fname in sorted(files):
            if not fname.endswith(".py"):
                continue
            path = os.path.join(root, fname)
            try:
                # utf-8-sig: five route files carry a BOM (U+FEFF) that plain utf-8 ast.parse
                # rejects — a skipped file is an invisible hole in the guard.
                with open(path, "r", encoding="utf-8-sig") as fh:
                    tree = ast.parse(fh.read())
            except (SyntaxError, UnicodeDecodeError) as exc:
                print(f"WARN: could not parse {path}: {exc}")
                continue
            rel = os.path.relpath(path, routes_dir).replace(os.sep, "/")
            for node in ast.walk(tree):
                if not isinstance(node, (ast.FunctionDef, ast.AsyncFunctionDef)):
                    continue
                if not _is_router_decorated(node):
                    continue
                args = node.args
                all_args = list(args.posonlyargs) + list(args.args) + list(args.kwonlyargs)
                has_bare_user_id = any(a.arg == "user_id" for a in all_args)
                if not has_bare_user_id:
                    continue
                # any auth marker anywhere in the signature's default expressions clears the route
                # (e.g. current_user = Depends(get_current_user_id) alongside a target user_id).
                defaults = list(args.defaults) + [d for d in args.kw_defaults if d is not None]
                sig_names = set()
                for d in defaults:
                    sig_names |= _names_in_expr(d)
                if sig_names & AUTH_MARKERS:
                    continue
                offenders.append(f"{rel}::{node.name}")
    return sorted(offenders)


def main():
    offenders = scan()
    if "--list" in sys.argv:
        print("\n".join(offenders))
        print(f"\n{len(offenders)} offender route(s).")
        return 0
    if "--write-baseline" in sys.argv:
        with open(BASELINE_PATH, "w", encoding="utf-8") as fh:
            json.dump({"count": len(offenders), "routes": offenders}, fh, indent=1)
        print(f"Baseline written: {len(offenders)} known offender(s) -> {BASELINE_PATH}")
        return 0

    if not os.path.exists(BASELINE_PATH):
        print("ERROR: bola_baseline.json missing — run with --write-baseline first.")
        return 1
    with open(BASELINE_PATH, "r", encoding="utf-8") as fh:
        baseline = set(json.load(fh).get("routes", []))
    current = set(offenders)

    new = sorted(current - baseline)
    fixed = sorted(baseline - current)
    print(f"BOLA route scan: {len(current)} bare-user_id route(s); baseline {len(baseline)}.")
    if fixed:
        print(f"\n✅ {len(fixed)} baseline route(s) now clean — tighten the ratchet with "
              f"`python scripts/check_bola_routes.py --write-baseline`:")
        for r in fixed[:20]:
            print(f"   - {r}")
    if new:
        print(f"\n❌ {len(new)} NEW route(s) accept a bare `user_id` without an auth dependency "
              f"(OWASP API1 BOLA — see docs/runbooks/HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md):")
        for r in new:
            print(f"   - {r}")
        print("\nFix: take the caller identity from `Depends(get_user_id_from_jwt_or_query)` "
              "(or get_current_user_id) instead of trusting a client-supplied user_id.")
        return 1
    print("OK — no new unauthenticated user_id routes.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
