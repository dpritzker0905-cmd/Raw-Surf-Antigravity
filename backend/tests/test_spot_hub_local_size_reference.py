"""The spot hub grades against the SPOT'S OWN good day — the last factor it sat out.

`test_rating_composition_parity.py` declares, per surface, a position on every optional rating
factor, and the hub's entry for `reference_size_m` was a waiver: "BLOCKED ON AN INTERFACE, not on a
decision." `resolve_spot_conditions(model, lat, lng, forecast_days)` never received a spot id, and
`spot_size_climatology.reference_map` is keyed by one, so the hub could not look a reference up.

That waiver priced the risk at level-differs-on-59.1%-of-evaluations. Then `3263031c` flipped
RATING_LOCAL_SIZE=1 in all three lanes and the price became the bill: every glyph moved to the
spot's own curve while the hub kept the global 1.2 m one. Re-measured 2026-07-30, hub vs glyph on
identical inputs across 540 spot/size/period/wind combinations:

    RATING_LOCAL_SIZE=0    |dScore| median  0.0    LEVEL differs   0.0%
    RATING_LOCAL_SIZE=1    |dScore| median 10.5    LEVEL differs  60.6%   p95 56.2   max 75.2

★ WHY THIS FILE EXISTS ON TOP OF THE REGISTRY. The registry test is an AST check: it reads the
hub's `compute_surf_rating` call and asserts the NAME `reference_size_m` appears in it. That is
exactly satisfied by `reference_size_m=None` — a call that supplies the factor and always supplies
nothing. Attachment is not consumption. These tests follow the VALUE: blob → gate → loader →
`reference_map` → the number the engine actually receives, with a known-present needle and a
negative control on both sides of the gate.

⚠️ The hub's whole rating block is a broad `except` that swallows and logs at debug. A test that
only asserted "the reference is not wrong" would pass just as happily if the rating never ran at
all, so every test here asserts the recorder was CALLED before asserting what it saw.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import spot_size_climatology as SSC

MAVS_LAT, MAVS_LNG = 37.4915, -122.5083

# A histogram whose reference is KNOWN, so a null result is distinguishable from a missing fixture.
# 20 samples (>= MIN_SAMPLES 12) all in bin 9 = [1.8, 2.0) m: the median lands inside that bin, well
# clear of both clamps, so this asserts a real derived number rather than a floor or a ceiling.
_BIG_SPOT_ID = "spot-with-climatology"
_SMALL_SPOT_ID = "spot-below-min-samples"


def _hist(bin_index, count):
    h = SSC.empty_hist()
    h[bin_index] = count
    return h


_BLOB = {"schema_version": SSC.SCHEMA_VERSION,
         "spots": {_BIG_SPOT_ID: {"hist": _hist(9, 20), "n": 20},
                   # Deliberately UNDER MIN_SAMPLES: a spot in the blob that still has no reference.
                   _SMALL_SPOT_ID: {"hist": _hist(3, 2), "n": 2}}}


@pytest.fixture(autouse=True)
def _blob(monkeypatch):
    """Serve the fixture blob and clear the memo, so no test inherits another's resolved map."""
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **k: _BLOB)
    monkeypatch.setattr(SSC, "_ref_map_memo", {"cell": (None, {})})
    yield


# ── the fixture is a KNOWN-PRESENT NEEDLE, not an assumption ────────────────────────────────────

def test_the_fixture_blob_actually_yields_a_reference():
    """THE CONTROL EVERY OTHER TEST DEPENDS ON. Without it, a fixture that silently produced no
    reference at all would make every "the hub passed the reference" assertion below unfalsifiable
    in the direction that matters — `None == None` reads as agreement."""
    ref = SSC.reference_for_spot(_BIG_SPOT_ID)
    assert ref is not None, "the fixture stopped producing a reference — the needle is gone"
    assert 1.8 <= ref < 2.0, f"expected the median inside bin 9, got {ref}"
    assert SSC.reference_for_spot(_SMALL_SPOT_ID) is None, "MIN_SAMPLES stopped being enforced"
    assert SSC.reference_for_spot("no-such-spot") is None
    assert SSC.reference_for_spot(None) is None


def test_the_one_spot_accessor_is_the_same_composition_as_the_batch_lanes():
    """`reference_for_spot` must be `reference_map(load_size_climatology_l2_cached())` indexed —
    not a second derivation free to drift from the two batch lanes. Compare against the map the
    reference implementation builds, over EVERY id in the blob."""
    batch = SSC.reference_map(SSC.load_size_climatology_l2_cached())
    for sid in list(_BLOB["spots"]) + ["no-such-spot"]:
        assert SSC.reference_for_spot(sid) == batch.get(str(sid)), \
            f"{sid}: the per-spot accessor disagrees with the batch map"


def test_a_spot_created_later_needs_no_code_change_to_get_its_own_reference(monkeypatch):
    """AUTO-SCALING, end to end on the REAL accumulation path — the requirement that this works for
    spots that do not exist yet.

    A spot created tomorrow is picked up by the precompute's own query (`is_active=eq.true` +
    non-null coordinates — a live filter, not a fixed roster), rated, and its breaking heights are
    folded into the climatology by `merge_frames_into_climatology` under `str(spot["id"])`. Once it
    crosses MIN_SAMPLES it has a reference, and every lane that indexes the map sees it in the same
    cycle. Nothing per-spot is configured anywhere.

    ⚠️ This test drives the PRODUCTION merge function, not a hand-built histogram, because the risk
    is a KEY-FORMAT mismatch between what the precompute writes and what a lookup reads — and that
    failure is invisible: a miss returns None, which is the global curve, which is exactly the
    behaviour the whole fix removes. A silent miss looks like a working fix."""
    new_id = "spot-created-tomorrow"
    blob = {"schema_version": SSC.SCHEMA_VERSION, "spots": {}}
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **k: blob)

    # Brand new: unknown to the climatology → the global curve, at EVERY lane.
    assert SSC.reference_for_spot(new_id) is None
    assert SSC.reference_map(blob).get(new_id) is None

    # Eleven precompute cycles: still short of MIN_SAMPLES, still the global curve.
    frames = [{"spots": [{"spot_id": new_id, "surf_height_m": 1.9}]} for _ in range(SSC.MIN_SAMPLES - 1)]
    grown = SSC.merge_frames_into_climatology(blob, frames)
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **k: grown)
    assert SSC.reference_for_spot(new_id) is None, "MIN_SAMPLES must still gate a young spot"

    # One more cycle crosses the threshold — and the id the precompute WROTE is the id a route READS.
    grown = SSC.merge_frames_into_climatology(
        grown, [{"spots": [{"spot_id": new_id, "surf_height_m": 1.9}]}])
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **k: grown)
    ref = SSC.reference_for_spot(new_id)
    assert ref is not None, (
        "a spot that accumulated MIN_SAMPLES still has no reference — the key the precompute writes "
        "does not match the key a lookup reads, and the miss is silent (None = the global curve)")
    assert 1.8 <= ref < 2.0, f"expected the spot's own ~1.9 m day, got {ref}"
    assert ref == SSC.reference_map(grown).get(new_id), "the per-spot lane diverged from the batch map"


def test_hub_and_glyph_resolve_THE_SAME_reference_in_every_climatology_state():
    """THE PARITY THAT MUST HOLD FOR ANY SPOT, EXISTING OR NEW. The hub and the batch lanes must
    agree on the reference in all four states a spot can be in — has one, too young, unknown, and
    no blob at all — because the score they produce is only equal if this input is.

    ★ Note the third and fourth rows are the states a NEW spot passes through. They resolve to None
    at BOTH lanes, which is the global curve at BOTH — so parity holds from the moment a spot is
    created, not only once it has climatology."""
    states = [
        ("has climatology", _BLOB, _BIG_SPOT_ID),
        ("below MIN_SAMPLES", _BLOB, _SMALL_SPOT_ID),
        ("unknown / brand new", _BLOB, "spot-created-tomorrow"),
        ("no blob at all", None, _BIG_SPOT_ID),
    ]
    for label, blob, sid in states:
        batch = SSC.reference_map(blob).get(str(sid))       # what spot_ratings / routes.weather index
        _memo = SSC._ref_map_memo["cell"]
        try:
            SSC._ref_map_memo["cell"] = (None, {})
            import unittest.mock as _m
            with _m.patch.object(SSC, "load_size_climatology_l2_cached", lambda *a, **k: blob):
                hub = SSC.reference_for_spot(sid)           # what the spot hub resolves
        finally:
            SSC._ref_map_memo["cell"] = _memo
        assert hub == batch, f"{label}: hub resolved {hub}, batch lanes resolved {batch}"


def test_the_memo_serves_a_new_blob_rather_than_a_stale_map(monkeypatch):
    """The map is memoised against the loaded object's IDENTITY. A refreshed blob must win, or the
    hub would keep grading against a reference the batch lanes have already moved off."""
    assert SSC.reference_for_spot(_BIG_SPOT_ID) is not None       # populate the memo
    moved = {"schema_version": SSC.SCHEMA_VERSION,
             "spots": {_BIG_SPOT_ID: {"hist": _hist(2, 20), "n": 20}}}
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **k: moved)
    assert SSC.reference_for_spot(_BIG_SPOT_ID) == pytest.approx(0.5, abs=0.11), \
        "the memo served a stale map after the blob refreshed"


# ── the HUB: does the number actually REACH the engine? ─────────────────────────────────────────

class _Pt:
    def __init__(self, speed, period, direction):
        self.speed, self.period, self.direction = speed, period, direction


class _Res:
    def __init__(self, pt):
        self.point = pt


class _FakeHub:
    """A hub whose grid cache answers one canned wave sample and never dials upstream."""

    def __init__(self):
        self.upstream_calls = []
        self.sampler = self
        self.provider = self

    async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
        return layer if layer in ("waves", "swell_1") else None

    def sample_point(self, prod, lat, lng):
        return _Res(_Pt(1.9, 14.0, 285.0))

    async def fetch_point(self, **kw):
        self.upstream_calls.append(kw)
        raise RuntimeError("this test permits no upstream dial")

    async def resolve_point(self, **kw):
        return _Res(_Pt(6.0, None, 285.0))            # the wind sample (knots)


async def _hub_reference(monkeypatch, **kwargs):
    """Run the hub and return (was_called, the reference_size_m the engine received)."""
    from services.weather_pipeline import spot_conditions, surf_rating
    seen = {}

    def recorder(*args, **kw):
        seen["called"] = True
        seen.update(kw)
        return (50.0, "fair")

    monkeypatch.setattr(surf_rating, "compute_surf_rating", recorder)
    hub = _FakeHub()
    await spot_conditions.resolve_spot_conditions_impl(hub, "GFS", MAVS_LAT, MAVS_LNG, **kwargs)
    assert hub.upstream_calls == [], "the reference lookup must not cost an upstream dial"
    return seen.get("called", False), seen.get("reference_size_m", "NOT-PASSED")


@pytest.mark.asyncio
async def test_the_hub_passes_the_spots_own_reference_when_the_flag_is_on(monkeypatch):
    """THE FIX. Flag on + an id whose spot has climatology → the engine grades against 1.9 m, not
    the global 1.2 m curve."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    called, ref = await _hub_reference(monkeypatch, spot_id=_BIG_SPOT_ID)
    assert called, "the rating never ran — the hub's broad `except` swallowed something"
    assert ref == SSC.reference_for_spot(_BIG_SPOT_ID) != None      # noqa: E711 — pin BOTH halves
    assert 1.8 <= ref < 2.0, f"the hub received {ref}, not this spot's own reference"


@pytest.mark.asyncio
async def test_the_flag_is_the_gate_and_it_lives_at_the_hub(monkeypatch):
    """NEGATIVE CONTROL #1. Same id, same blob, flag OFF → the global curve. A gate buried in the
    shared helper instead of here would flip every lane at once; a flag has a value PER LANE."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "0")
    called, ref = await _hub_reference(monkeypatch, spot_id=_BIG_SPOT_ID)
    assert called
    assert ref is None, f"RATING_LOCAL_SIZE=0 must keep the global curve, got {ref}"
    monkeypatch.delenv("RATING_LOCAL_SIZE", raising=False)
    called, ref = await _hub_reference(monkeypatch, spot_id=_BIG_SPOT_ID)
    assert called and ref is None, "an UNSET flag must default off, like every other lane"


@pytest.mark.asyncio
async def test_a_caller_without_a_spot_id_is_unchanged(monkeypatch):
    """NEGATIVE CONTROL #2. `spot_id` is optional by design — not every caller has one, and the
    ones that don't must get exactly the pre-change behaviour. `reference_size_m` is still SUPPLIED
    (the registry's claim stays true); its value is just None."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    called, ref = await _hub_reference(monkeypatch)
    assert called
    assert ref is None, f"no spot id must mean the global curve, got {ref}"
    called, ref = await _hub_reference(monkeypatch, spot_id=_SMALL_SPOT_ID)
    assert called and ref is None, "a spot under MIN_SAMPLES must fall back to the global curve"


@pytest.mark.asyncio
async def test_a_broken_climatology_read_costs_the_local_curve_and_nothing_else(monkeypatch):
    """FAILS OPEN. The reference sits in its own `try` because the rating block around it is a
    broad `except`: a blob-read failure must cost the LOCAL curve, never the whole rating."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")

    def _boom(*a, **k):
        raise RuntimeError("L2 unreachable")

    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", _boom)
    called, ref = await _hub_reference(monkeypatch, spot_id=_BIG_SPOT_ID)
    assert called, "a climatology failure must not cost the rating"
    assert ref is None


# ── the INTERFACE that was the blocker ──────────────────────────────────────────────────────────

def test_every_conditions_caller_that_has_a_spot_id_passes_it():
    """The waiver said the blocker was an interface reaching 7 call sites. Pin all 7: a new caller
    that forgets `spot_id` silently drops back to the global curve at one surface only, which is
    the divergence this whole change closes — and it would be invisible, because the hub still
    returns a perfectly plausible score."""
    import ast
    import inspect
    import importlib

    callers = [
        ("routes.explore_discover.explore", 1),
        ("routes.explore_discover.spot_details", 1),
        ("routes.surf_data.alerts", 1),
        ("routes.surf_data.conditions", 3),
        ("scheduler.surf_alerts", 1),
    ]
    for module_path, expected in callers:
        mod = importlib.import_module(module_path)
        calls = []
        for node in ast.walk(ast.parse(inspect.getsource(mod))):
            if not isinstance(node, ast.Call):
                continue
            fn = node.func
            name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
            if name == "resolve_spot_conditions":
                calls.append({k.arg for k in node.keywords if k.arg})
        assert len(calls) == expected, \
            f"{module_path}: expected {expected} conditions call(s), found {len(calls)}"
        for kw in calls:
            assert "spot_id" in kw, (
                f"{module_path} resolves spot conditions without a `spot_id`, so its rating keeps "
                f"the GLOBAL size curve while the map glyphs use the spot's own — the exact split "
                f"the `reference_size_m` waiver was closed to prevent.")


def test_the_explore_cache_key_is_keyed_by_spot_not_only_by_coordinate():
    """`explore.py` caches conditions under a key that ROUNDS coordinates to 2 dp (~1.1 km). Now
    that the payload carries a rating graded against the spot's own climatology, two catalogued
    peaks inside one rounded cell have different references — so a coordinate-only key would serve
    the first spot's score for the second."""
    from routes.explore_discover.explore import _get_cache_key
    a = _get_cache_key(37.4915, -122.5083, 11, "GFS", "spot-a")
    b = _get_cache_key(37.4915, -122.5083, 11, "GFS", "spot-b")
    assert a != b, "two spots in one rounded cell share a cache entry — and now a rating"
    assert a == _get_cache_key(37.4917, -122.5081, 11, "GFS", "spot-a"), \
        "the coordinate rounding that made the cache useful must survive"
