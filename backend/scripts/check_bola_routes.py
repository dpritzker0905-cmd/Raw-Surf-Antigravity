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

WIDENED 2026-10-08: the acting user is not always called `user_id`. Routes that take `payer_id`,
`surfer_id`, `captain_id`, `photographer_id`, `buyer_id`, `sender_id`, ... from the client moved
money with no token check while this guard stayed green, because it matched one name. It now
checks every name in ACTOR_ARGS. Limits, stated rather than hidden: an actor id carried inside a
request-body model is not seen (AST only sees the handler's own arguments), and an auth marker
in the signature clears a route without proving the handler compares it with the actor id.

The baseline stores a short SHA-256 of each `file::function` instead of the name, so the
public repository does not carry a ready-made list of routes that still need binding. New
offenders are still printed by name (they are in the change under review, not yet live), and
`--list` prints names locally.

Usage:
  python scripts/check_bola_routes.py                  # scan + compare against baseline (CI mode)
  python scripts/check_bola_routes.py --write-baseline # regenerate the baseline after triage work
  python scripts/check_bola_routes.py --list           # print every current offender
"""
import ast
import hashlib
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

# Argument names that say WHO is acting, paying, being charged or credited. A route that takes
# one of these from the client with no auth marker lets the caller name the actor.
ACTOR_ARGS = {
    "user_id", "payer_id", "surfer_id", "requester_id", "buyer_id", "captain_id", "photographer_id",
    "sender_id", "owner_id", "creator_id", "author_id", "follower_id", "viewer_id", "host_id",
    "member_id", "giver_id", "claimer_id", "seller_id", "sponsor_id", "inviter_id", "invitee_id",
    "from_user_id",
}


def route_key_hash(key):
    """The stored form of a `file::function` key: short, stable, and not a readable route list."""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


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
                if not any(a.arg in ACTOR_ARGS for a in all_args):
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
        write_baseline(offenders)
        print(f"Baseline written: {len(offenders)} known offender(s) -> {BASELINE_PATH}")
        return 0

    if not os.path.exists(BASELINE_PATH):
        print("ERROR: bola_baseline.json missing — run with --write-baseline first.")
        return 1
    new, fixed_count, baseline_size = compare(offenders, load_baseline())
    print(f"BOLA route scan: {len(offenders)} route(s) take an actor id without an auth marker; "
          f"baseline {baseline_size}.")
    if fixed_count:
        print(f"\n[TIGHTEN] {fixed_count} baseline route(s) are now bound — tighten the ratchet with "
              f"`python scripts/check_bola_routes.py --write-baseline`.")
    if new:
        print(f"\n[FAIL] {len(new)} NEW route(s) take an actor id ({', '.join(sorted(ACTOR_ARGS)[:6])}, ...) "
              f"without an auth dependency (OWASP API1 BOLA — see "
              f"docs/runbooks/HANDOFF-2026-07-12-USERID-AUTH-ARCHITECTURE-BOLA-REVIEW.md):")
        for r in new:
            print(f"   - {r}")
        print("\nFix: take the caller identity from `Depends(get_user_id_from_jwt_or_query)`, or add "
              "`Depends(get_current_user_id)` and reject a different actor id with 403.")
        return 1
    print("OK — no new route takes an actor id without an auth dependency.")
    return 0


def write_baseline(offenders, path=None):
    with open(path or BASELINE_PATH, "w", encoding="utf-8") as fh:
        json.dump({"count": len(offenders),
                   "note": "sha256(file::function)[:16] of each known offender; see check_bola_routes.py",
                   "hashes": sorted(route_key_hash(r) for r in offenders)}, fh, indent=1)


def load_baseline(path=None):
    """Hashed baseline; a legacy plain-name baseline ("routes") is hashed on read."""
    with open(path or BASELINE_PATH, "r", encoding="utf-8") as fh:
        data = json.load(fh)
    return set(data.get("hashes", [])) | {route_key_hash(r) for r in data.get("routes", [])}


def compare(offenders, baseline_hashes):
    """(new offenders by name, count of baseline entries now bound, baseline size)."""
    current = {route_key_hash(r): r for r in offenders}
    new = sorted(name for h, name in current.items() if h not in baseline_hashes)
    fixed = len(baseline_hashes - set(current))
    return new, fixed, len(baseline_hashes)


if __name__ == "__main__":
    sys.exit(main())
