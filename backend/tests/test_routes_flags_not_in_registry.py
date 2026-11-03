"""
Routes-flags blind spot: os.environ.get() calls in backend/routes/ that match
DRIFT_PREFIXES but are absent from _RATING_FLAGS.

test_flag_lane_parity.py scans only _RATING_SURFACES (13 files in
backend/services/).  This test closes the gap for backend/routes/.

Any flag with a drift prefix that appears in backend/routes/ and is NOT in
_RATING_FLAGS must be listed in _ROUTES_EXEMPT with a comment explaining why.
That list is shrink-only: remove an entry only when the flag is added to
_RATING_FLAGS or disappears from routes.  Never add a new exemption silently.
"""
import ast
import os
import re

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGISTRY_SRC = os.path.join(REPO, "backend", "routes", "admin", "surf_forecast.py")
ROUTES_DIR = os.path.join(REPO, "backend", "routes")

# Same prefixes as test_flag_lane_parity.py — keep in sync.
DRIFT_PREFIXES = ("RATING_", "SURF_", "MARINE_", "SPOT_RATINGS_", "SHORE_NORMAL_", "ECMWF_")

# Flags in backend/routes/ that intentionally bypass _RATING_FLAGS.
# This list is SHRINK-ONLY: remove an entry only when the flag has been added
# to _RATING_FLAGS.  Each entry must have a comment explaining why it is
# exempt (not a value-producing computation flag).
_ROUTES_EXEMPT = {
    # Concurrency cap for live /spot-ratings parallel fetches.
    # Operational tuning (how many threads); changes no surf-height or rating
    # value.  Located in backend/routes/weather.py.
    "SPOT_RATINGS_LIVE_MAX_CONCURRENT",
    # Stale-data tolerance window (seconds) for the conditions endpoint.
    # Controls cache expiry, not a value-producing computation flag.
    # Located in backend/routes/surf_data/conditions.py.
    "SPOT_RATINGS_STALE_TOLERANCE_S",
}

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _load_registry():
    """
    Return _RATING_FLAGS as {flag_name: tuple(values)} by AST-parsing
    backend/routes/admin/surf_forecast.py (no FastAPI import required).
    """
    with open(REGISTRY_SRC, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if "_RATING_FLAGS" in names:
                return {k: tuple(v) for k, v in ast.literal_eval(node.value).items()}
    raise AssertionError(f"_RATING_FLAGS not found in {REGISTRY_SRC}")


def _scan_routes_flags():
    """
    Walk backend/routes/ recursively and collect every env-var name read via
    os.environ.get("NAME") whose name starts with one of DRIFT_PREFIXES.

    Returns {flag_name: [repo-relative path, ...]} — a flag may appear in
    multiple files.
    """
    pattern = re.compile(r'os\.environ\.get\(\s*["\']([A-Z_0-9]+)["\']')
    found: dict[str, list[str]] = {}
    for dirpath, _dirs, files in os.walk(ROUTES_DIR):
        if "__pycache__" in dirpath:
            continue
        for fname in files:
            if not fname.endswith(".py"):
                continue
            fpath = os.path.join(dirpath, fname)
            rel = os.path.relpath(fpath, REPO).replace("\\", "/")
            try:
                text = open(fpath, encoding="utf-8").read()
            except OSError:
                continue
            for m in pattern.finditer(text):
                name = m.group(1)
                if name.startswith(DRIFT_PREFIXES):
                    found.setdefault(name, []).append(rel)
    return found


# ---------------------------------------------------------------------------
# Tests
# ---------------------------------------------------------------------------

def test_routes_flags_in_registry_or_exempt():
    """
    Every DRIFT_PREFIX flag read via os.environ.get() inside backend/routes/
    must either appear in _RATING_FLAGS (the documented registry) or be listed
    in _ROUTES_EXEMPT with an explicit reason.

    Failure means a new operational flag has been added to a routes file
    without being registered.

    Fix: add the flag to _RATING_FLAGS, or add it to _ROUTES_EXEMPT here
    with a one-line comment explaining why it is not a value-producing flag.
    """
    registry = _load_registry()
    routes_flags = _scan_routes_flags()

    unaccounted = {
        name: files
        for name, files in routes_flags.items()
        if name not in registry and name not in _ROUTES_EXEMPT
    }

    assert not unaccounted, (
        "The following flags are read in backend/routes/ but absent from "
        "both _RATING_FLAGS and _ROUTES_EXEMPT:\n"
        + "\n".join(
            f"  {name}  (in {', '.join(files)})"
            for name, files in sorted(unaccounted.items())
        )
        + "\n\nFix: add to _RATING_FLAGS (backend/routes/admin/surf_forecast.py), "
        "or add to _ROUTES_EXEMPT in this test with a reason."
    )


def test_routes_exempt_list_is_tight():
    """
    Every entry in _ROUTES_EXEMPT must actually appear in backend/routes/.

    A phantom exemption (flag removed from routes without updating this list)
    would silently prevent the list from shrinking.  This test enforces that
    the exempt list stays tight.
    """
    routes_flags = _scan_routes_flags()
    phantom = _ROUTES_EXEMPT - set(routes_flags.keys())
    assert not phantom, (
        "The following flags are in _ROUTES_EXEMPT but NOT found in "
        "backend/routes/:\n"
        + "\n".join(f"  {f}" for f in sorted(phantom))
        + "\n\nRemove them from _ROUTES_EXEMPT (list is shrink-only)."
    )
