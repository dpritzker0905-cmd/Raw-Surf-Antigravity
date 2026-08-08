"""A blocking L2 read inside `async def` freezes the whole worker — and one of three siblings had it.

THE DEFECT (measured 2026-08-06, MASTER-AUDIT-9.0 section 5.1). `routes/weather.py` holds THREE
TTL-cached Supabase-Storage loaders, all the same shape: a synchronous `requests.get(timeout=10)`
behind a 300 s cache. Two were correctly handed to `asyncio.to_thread`; the third was called bare,
directly on the event loop:

    /buoy-calibration   load_calibration_l2_cached        await asyncio.to_thread(...)   OK
    /report-calibration load_report_calibration_cached    await asyncio.to_thread(...)   OK
    /spot-ratings       load_spot_ratings_l2_cached       load_spot_ratings_l2_cached()  <- ON THE LOOP

Reproduced with a co-tenant coroutine standing in for every other in-flight request: while the bare
call ran, **0 of ~100 expected co-tenant ticks fired** — 100% starvation for the full duration of the
blocking call. Scaled to the real `timeout=10`, one bad Supabase round trip freezes the worker for
ten seconds, once per 300 s TTL per process.

⭐ AND THE ASYMMETRY IS THE TELL: the two that were fixed are low-traffic DIAGNOSTIC endpoints; the
one that was missed is `/spot-ratings`, the map-glyph path hit on every viewport pan. Nobody would
choose that priority deliberately, which is why this reads as an oversight rather than a decision.

WHY TWO TESTS AND NOT ONE. `test_..._does_not_starve...` proves THIS instance is fixed. It cannot
stop the next one: `14c9caf6` already fixed "FastAPI event-loop blocking" in this very file, and the
class came back anyway. So the second test bans the SHAPE — the repo's recorded lesson that a fix
applied at the site of an incident is not a fix applied to the class (the disclosure that reached
1 of 4 renderers, `f1bd00bd`; the salvage that reached 1 of 7 GRIB fetchers).

⭐ THE AST SIGNATURE IS A NEEDLE ONLY THE DEFECT PRODUCES, which is why this is not a substring scan
(`"x" in src` matches comments, docstrings and unrelated prose — the repo has been bitten by exactly
that). Offloaded, the loader is passed to `to_thread` as a bare **Name**; blocking, it is a **Call**.
So the rule is simply: inside an `async def` in this module, these loaders must never appear as a
Call node. Verified to discriminate before it was relied on — 1 Call (the defect) vs 2 Names (the
correct siblings).
"""
import ast
import asyncio
import importlib
import inspect
import os
import time

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

# The surface list: every synchronous, TTL-cached L2 loader reachable from an async route here.
# ⚠️ Each entry is SELF-CHECKED below — if a name is renamed or deleted this test FAILS rather than
# silently passing on an empty set. A guard that cannot tell "clean" from "not looking" must refuse
# (standing rule 27); a stale surface list is how the sim's disclosure guard stayed green while
# missing 2 of 5 consumers.
BLOCKING_L2_LOADERS = {
    "load_spot_ratings_l2_cached": "services.weather_pipeline.spot_ratings",
    "load_calibration_l2_cached": "services.weather_pipeline.buoy_calibration",
    "load_report_calibration_cached": "services.weather_pipeline.report_calibration",
    # ⭐ ADDED 2026-08-07: a FOURTH loader of the identical shape (`requests.get(timeout=10)` behind
    # a 600 s TTL), found only because the scan below was widened past `routes/weather.py`.
    "load_grid_size_climatology_l2_cached": "services.weather_pipeline.grid_size_climatology",
}

# ⭐⭐⭐ THE SCAN USED TO BE ONE FILE, AND THAT IS WHY THE CLASS CAME BACK.
# This guard was written for `routes/weather.py` and shipped with the note that "a fix applied at the
# site of an incident is not a fix applied to the class" — then the class recurred in
# `grid_resolver_surf.py`, which it structurally could not see. Measured there 2026-08-07: FOUR
# blocking calls inside one `async def apply_surf_overlay` — two `requests.get(timeout=10)` loaders
# and two per-cell CPU loops — on the map-overlay path. ⇒ A GUARD SCOPED TO ONE FILE IS A GUARD
# AGAINST ONE INCIDENT. Scan the tree.
_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_SCAN_DIRS = [os.path.join(_BACKEND, "routes"), os.path.join(_BACKEND, "services", "weather_pipeline")]

# Per-cell grid transforms: pure CPU, but a stall is proportional to DURATION, not to grid size.
# Measured on the largest RATED frame production was observed to serve (7,081 cells): 4.27 s with a
# co-tenant getting 0 of ~426 ticks (0%). Even the WARM 0.10 s case took 0 of ~10 — there is no
# "small enough" frame that makes a bare call safe.
BLOCKING_GRID_TRANSFORMS = {
    "rating_transform_grid": "services.weather_pipeline.surf_rating",
    "surf_transform_grid": "services.weather_pipeline.surf_transform",
}


def _scan_files():
    out = []
    for d in _SCAN_DIRS:
        for root, _dirs, files in os.walk(d):
            if "__pycache__" in root:
                continue
            out.extend(os.path.join(root, f) for f in files if f.endswith(".py"))
    return sorted(out)


def _async_defs(tree):
    return [n for n in ast.walk(tree) if isinstance(n, ast.AsyncFunctionDef)]


def test_the_surface_list_is_not_stale():
    """REFUSE rather than pass vacuously: every named loader must still exist and still be sync."""
    missing, became_async = [], []
    for name, module_path in BLOCKING_L2_LOADERS.items():
        try:
            mod = importlib.import_module(module_path)
        except Exception as e:  # pragma: no cover - an import break is itself the signal
            missing.append(f"{module_path} did not import: {e!r}")
            continue
        fn = getattr(mod, name, None)
        if fn is None:
            missing.append(f"{module_path}.{name} no longer exists")
        elif inspect.iscoroutinefunction(fn):   # asyncio's alias is removed in 3.16
            became_async.append(f"{module_path}.{name}")

    assert not missing, (
        "This guard's surface list has gone stale, so it is no longer checking what it claims:\n  "
        + "\n  ".join(missing)
        + "\nUpdate BLOCKING_L2_LOADERS deliberately — do not delete the entry to make this pass.")
    assert not became_async, (
        "These loaders became coroutines, so the Call-node ban below no longer describes them:\n  "
        + "\n  ".join(became_async)
        + "\nRemove them from BLOCKING_L2_LOADERS and confirm every call site now awaits them.")


def _bare_calls(names):
    """Every place one of `names` is CALLED (not merely referenced) inside an `async def`, across
    the whole scanned tree."""
    offenders = []
    for path in _scan_files():
        try:
            tree = ast.parse(open(path, encoding="utf-8").read())
        except Exception:
            continue
        rel = os.path.relpath(path, _BACKEND).replace("\\", "/")
        for fn in _async_defs(tree):
            for node in ast.walk(fn):
                if (isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
                        and node.func.id in names):
                    offenders.append(
                        f"{rel}:{node.lineno} — `{ast.unparse(node)[:70]}` is called directly "
                        f"inside `async def {fn.name}`")
    return offenders


def test_the_scan_actually_reaches_more_than_one_file():
    """REFUSE rather than pass vacuously. The original guard read ONE path; if this ever collapses
    back to a single file the class-level claim below becomes false while staying green."""
    files = _scan_files()
    assert len(files) > 50, f"the scan reached only {len(files)} files — it is not scanning the tree"
    names = {os.path.basename(f) for f in files}
    for required in ("weather.py", "grid_resolver_surf.py", "spot_ratings.py"):
        assert required in names, f"{required} is not in the scanned set"


def test_no_blocking_l2_loader_is_called_on_the_event_loop():
    """THE CLASS GUARD. Inside `async def`, these loaders may be REFERENCED (handed to to_thread)
    but never CALLED — a call runs the blocking socket read on the loop itself."""
    offenders = _bare_calls(BLOCKING_L2_LOADERS)

    assert not offenders, (
        "A synchronous Supabase L2 read is running on the event loop, which starves every other\n"
        "in-flight request on that worker for the duration (measured: 0 of ~100 co-tenant ticks):\n  "
        + "\n  ".join(offenders)
        + "\n\nFix: `await asyncio.to_thread(<loader>)` — the pattern already used at "
          "/buoy-calibration and /report-calibration in this same file.")


def test_no_per_cell_grid_transform_is_called_on_the_event_loop():
    """THE CPU HALF OF THE SAME CLASS. A blocking socket read and a blocking CPU loop starve the
    loop identically; only the cause differs, so the ban is the same shape.

    Measured 2026-08-07 on `rating_transform_grid` at 7,081 cells — the largest RATED frame
    production was observed to serve (`/api/weather/grid?surf=true`, hemisphere bbox):
        bare on the loop   4.27 s,  co-tenant ticks 0 of ~426  (0%)
        await to_thread    1.27 s,  co-tenant ticks 81 of ~126 (64%)
    ⚠️ And the WARM case (0.10 s) still took 0 of ~10 ticks. The stall is proportional to DURATION,
    not to grid size — there is no frame small enough to make a bare call safe, which is why this
    bans the shape rather than gating on a cell count.
    """
    offenders = _bare_calls(BLOCKING_GRID_TRANSFORMS)
    assert not offenders, (
        "A per-cell grid transform is running on the event loop, starving every other in-flight\n"
        "request on the worker for its full duration (measured: 0 of ~426 co-tenant ticks):\n  "
        + "\n  ".join(offenders)
        + "\n\nFix: `await asyncio.to_thread(<transform>, ...)`. The injected fns are pure sync\n"
          "closures over already-loaded data, so the thread is safe.")


def test_the_grid_transform_surface_list_is_not_stale():
    """REFUSE rather than pass vacuously — same contract as the loader list above."""
    missing = []
    for name, module_path in BLOCKING_GRID_TRANSFORMS.items():
        mod = importlib.import_module(module_path)
        if getattr(mod, name, None) is None:
            missing.append(f"{module_path}.{name} no longer exists")
    assert not missing, "\n".join(missing) + "\nUpdate BLOCKING_GRID_TRANSFORMS deliberately."


def test_the_guard_can_actually_catch_the_defect():
    """MUTATION CONTROL. A guard that has never failed is not known to work — this feeds it the
    exact pre-fix source and asserts it fires. Without this, deleting the check above would look
    identical to fixing the bug."""
    pre_fix_src = (
        "import asyncio\n"
        "async def get_spot_ratings():\n"
        "    pre = select_precomputed_laddered(load_spot_ratings_l2_cached(), None)\n"
        "    return pre\n"
    )
    tree = ast.parse(pre_fix_src)
    caught = [
        node for fn in _async_defs(tree) for node in ast.walk(fn)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        and node.func.id in BLOCKING_L2_LOADERS
    ]
    assert caught, "The AST rule failed to flag a known-blocking call — the guard is inert."

    fixed_src = (
        "import asyncio\n"
        "async def get_spot_ratings():\n"
        "    obj = await asyncio.to_thread(load_spot_ratings_l2_cached)\n"
        "    return obj\n"
    )
    tree = ast.parse(fixed_src)
    false_alarms = [
        node for fn in _async_defs(tree) for node in ast.walk(fn)
        if isinstance(node, ast.Call) and isinstance(node.func, ast.Name)
        and node.func.id in BLOCKING_L2_LOADERS
    ]
    assert not false_alarms, "The AST rule flagged a correctly offloaded call — it would block the fix."


@pytest.mark.timeout(30)
async def test_spot_ratings_l2_read_does_not_starve_the_event_loop(monkeypatch):
    """THE BEHAVIOURAL PROOF, against the real route handler.

    A co-tenant coroutine stands in for every other request in flight on this worker. The L2 loader
    is replaced with a stand-in that BLOCKS for a known wall time (`time.sleep` releases the GIL
    exactly as a socket read does), and the precomputed selector returns an empty frame so the
    handler returns immediately after the read — isolating the read as the only thing under test.
    """
    import routes.weather as rw
    from services.weather_pipeline import spot_ratings as sr

    BLOCK_S = 0.5

    def blocking_l2_read():
        time.sleep(BLOCK_S)
        return {"frames": []}

    monkeypatch.setattr(rw, "load_spot_ratings_l2_cached", blocking_l2_read)
    monkeypatch.setattr(sr, "select_precomputed_laddered",
                        lambda *a, **k: ([], "precomputed", "2026-08-06T12:00:00Z"))

    ticks = []
    stop = asyncio.Event()

    async def co_tenant():
        while not stop.is_set():
            ticks.append(time.perf_counter())
            await asyncio.sleep(0.01)

    hb = asyncio.create_task(co_tenant())
    await asyncio.sleep(0.05)                      # let the co-tenant settle
    before = len(ticks)

    resp = await rw.get_spot_ratings(
        bbox="-125,32,-117,38", valid_time="2026-08-06T12:00:00Z",
        model="GFS", limit=40, db=None)

    stop.set()
    await hb
    served = len(ticks) - before

    assert resp is not None and resp.source == "precomputed", (
        f"the handler did not take the precomputed path (source={getattr(resp, 'source', None)!r}), "
        "so this test was not measuring the L2 read")
    assert served >= 2, (
        f"the event loop was starved: only {served} co-tenant ticks ran during a {BLOCK_S}s L2 read "
        f"(~{int(BLOCK_S / 0.01)} were possible). A synchronous read is blocking the loop — every "
        "other request on this worker is stalled for the full Supabase round trip.")
