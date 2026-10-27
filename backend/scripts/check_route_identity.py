"""
check_route_identity.py -- default-deny identity guard for WRITE routes (audit 2026-10-18, F-02 / LA-SEC-03).

WHY THIS EXISTS
---------------
`scripts/check_bola_routes.py` reads handler SIGNATURES and flags a route only when one of its own arguments is
named in ACTOR_ARGS. `tests/test_actor_route_binding.py` exercises only a hand-written list. Neither enumerates
the routes the running app actually serves, so a write route whose id is called something else, travels in the
request body, or does not exist at all was invisible to both. Measured at dev 2466e71e8: 109 write routes carry no
identity dependency anywhere in their dependency tree; 45 of them were not in the BOLA baseline.

WHAT IT DOES
------------
Walks `app.routes` (what is really mounted, including routers added by other routers) and classifies every
POST/PUT/PATCH/DELETE route by its FastAPI dependency tree:

  * ENFORCING dependency present  -> bound (the request is refused with 401 before the handler runs).
  * listed in PUBLIC_WRITES       -> public by design, with a stated reason.
  * otherwise                     -> an offender.

Offenders are compared with `route_identity_baseline.json` (RATCHET, same model as the BOLA baseline):
  * a NEW offender fails the build, printed by name (it is in the change under review, not yet live);
  * a baseline entry that is now bound ALSO fails, so a fixed route can never silently regress and the
    baseline only ever shrinks (run --write-baseline).
The baseline stores a short SHA-256 of "METHOD path", not the path, so this public repository does not carry a
readable list of the routes that still need binding. `--list` prints them locally.

LIMITS, stated rather than hidden
---------------------------------
  * A dependency clears a route; it does not prove the handler compares the token subject with the id it was
    given. Only a per-route negative test proves that (tests/test_actor_route_binding.py).
  * OPTIONAL identity dependencies (`get_optional_user_id*`) return None for an anonymous caller, so they do NOT
    count as enforcing here. The BOLA scanner accepts them; this one does not.
  * A route that parses the Authorization header by hand, or relies on a shared secret, is an offender until it
    is bound or listed in PUBLIC_WRITES with a reason.
  * Reads are out of scope: many are public by design. The BOLA scanner still covers actor-named read ids.

Usage (from backend/):
  python scripts/check_route_identity.py                   # CI mode: compare against the baseline
  python scripts/check_route_identity.py --write-baseline  # after binding routes (shrink only)
  python scripts/check_route_identity.py --list            # print every current offender (local use)
"""
import hashlib
import json
import os
import sys

from fastapi.routing import APIRoute

BASELINE_PATH = os.path.join(os.path.dirname(os.path.abspath(__file__)), "route_identity_baseline.json")
WRITE_METHODS = frozenset({"POST", "PUT", "PATCH", "DELETE"})

# (module, function name) of each dependency that REFUSES an anonymous request. Matching the module as well as
# the name means a lookalike function with the same name does not clear a route.
ENFORCING = frozenset({
    ("core.security", "get_current_user_id"),
    ("core.security", "get_user_id_from_jwt_or_query"),
    ("deps.admin_auth", "get_current_admin"),
    # routes/uploads/identity.py: each takes the token's subject (tests/test_upl01_upload_identity.py).
    ("routes.uploads.identity", "uploader_id"),
    ("routes.uploads.identity", "photographer_uploader_id"),
    # routes/auth_pkg/mfa.py: take the token's subject; also accept the enrol-only token that every other route refuses
    # (tests/test_mfa_login.py).
    ("routes.auth_pkg.mfa", "mfa_caller"),
    ("routes.auth_pkg.mfa", "full_session_caller"),
})

# Write routes that are public BY DESIGN. Every entry needs a reason; the test refuses an entry that no longer
# matches a mounted route, or that has since gained an identity dependency (the list must not rot).
PUBLIC_WRITES = {
    ("POST", "/api/auth/login"): "credential exchange: the caller has no token yet",
    ("POST", "/api/auth/signup"): "account creation: the caller has no token yet",
    ("POST", "/api/auth/forgot-password"): "password reset request: the caller cannot sign in",
    ("POST", "/api/auth/reset-password"): "authorised by the emailed reset token in the body",
    ("POST", "/api/auth/verify-reset-token"): "checks the emailed reset token in the body",
    ("POST", "/api/auth/login/mfa"): "second step of sign-in: authorised by the single-use challenge from a correct password",
    ("POST", "/api/auth/login/passkey/options"): "starts a passkey sign-in: the caller has no token yet; issues only a random challenge",
    ("POST", "/api/auth/login/passkey/verify"): "passkey sign-in: authorised by a signed assertion over a single-use challenge",
    ("POST", "/api/auth/login/mfa/passkey/options"): "passkey as the second step: needs the live single-use sign-in challenge",
    ("POST", "/api/auth/login/mfa/passkey/verify"): "passkey as the second step: a signed assertion plus the live single-use sign-in challenge",
    ("POST", "/api/site-access/verify"): "pre-login access-code check",
    ("POST", "/api/webhook/stripe"): "authorised by the Stripe signature; fails closed without STRIPE_WEBHOOK_SECRET",
    ("POST", "/api/email/webhook"):
        "authorised by the provider (Svix) signature; fails closed (503) without EMAIL_WEBHOOK_SECRET",
    ("POST", "/api/internal/events/broadcast"):
        "server-to-server: authorised by the X-Internal-Token shared secret; closed while INTERNAL_BROADCAST_TOKEN is unset",
}


def route_key(method, path):
    return f"{method} {path}"


def route_key_hash(key):
    """The stored form of a route key: short, stable, and not a readable route list."""
    return hashlib.sha256(key.encode("utf-8")).hexdigest()[:16]


def _dependency_ids(dependant, acc=None):
    """Every (module, name) in a route's dependency tree, sub-dependencies included."""
    acc = set() if acc is None else acc
    for sub in dependant.dependencies:
        call = sub.call
        if call is not None:
            acc.add((getattr(call, "__module__", ""), getattr(call, "__name__", str(call))))
        _dependency_ids(sub, acc)
    return acc


def has_enforcing_identity(route):
    return bool(_dependency_ids(route.dependant) & ENFORCING)


def scan(app, public=PUBLIC_WRITES):
    """Sorted route keys ("METHOD /path") of write routes with neither identity nor a PUBLIC_WRITES entry."""
    offenders = set()
    for route in app.routes:
        if not isinstance(route, APIRoute) or has_enforcing_identity(route):
            continue
        for method in route.methods & WRITE_METHODS:
            if (method, route.path) not in public:
                offenders.add(route_key(method, route.path))
    return sorted(offenders)


def mounted_write_routes(app):
    """Every (method, path) the app serves for a write method, for the stale-entry checks."""
    return {(m, r.path) for r in app.routes if isinstance(r, APIRoute) for m in r.methods & WRITE_METHODS}


def load_baseline(path=BASELINE_PATH):
    with open(path, "r", encoding="utf-8") as fh:
        return set(json.load(fh)["hashes"])


def write_baseline(offenders, path=BASELINE_PATH):
    hashes = sorted({route_key_hash(k) for k in offenders})
    with open(path, "w", encoding="utf-8", newline="\n") as fh:
        json.dump({"count": len(hashes),
                   "note": "sha256('METHOD path')[:16] of each write route with no identity dependency; "
                           "see check_route_identity.py. Shrink only.",
                   "hashes": hashes}, fh, indent=1)
        fh.write("\n")


def compare(offenders, baseline):
    """(new offender keys, number of baseline entries now bound, baseline size)."""
    current = {route_key_hash(k): k for k in offenders}
    new = sorted(k for h, k in current.items() if h not in baseline)
    bound = len(baseline - set(current))
    return new, bound, len(baseline)


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    backend = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
    if backend not in sys.path:
        sys.path.insert(0, backend)
    from server import app  # imported here: it loads every router

    offenders = scan(app)
    if "--list" in argv:
        print("\n".join(offenders))
        print(f"\n{len(offenders)} write route(s) with no identity dependency.")
        return 0
    if "--write-baseline" in argv:
        baseline = load_baseline() if os.path.exists(BASELINE_PATH) else None
        new, _bound, _size = compare(offenders, baseline) if baseline is not None else ([], 0, 0)
        if new:
            print("REFUSED: the baseline only shrinks. Bind these routes instead:\n  " + "\n  ".join(new))
            return 1
        write_baseline(offenders)
        print(f"baseline written: {len(offenders)} write route(s) still unbound.")
        return 0
    new, bound, size = compare(offenders, load_baseline())
    if new:
        print("NEW write routes with no identity dependency (bind them to the token, or list them in "
              "PUBLIC_WRITES with a reason):\n  " + "\n  ".join(new))
        return 1
    if bound:
        print(f"{bound} baseline route(s) are now bound: run --write-baseline so they cannot regress.")
        return 1
    print(f"ok: {size} known unbound write route(s), none new.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
