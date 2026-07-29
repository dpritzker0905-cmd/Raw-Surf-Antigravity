"""A new pin gets its own geometry — the overlay, the gate, and the three audited blockers.

The 2026-07-29 audit found that everything in the chain follows a new pin EXCEPT fine per-coordinate
geometry, which lives only in a git-committed asset rebuilt by a manual `workflow_dispatch`. It also
found three specific ways an automatic fix would go wrong. Each has a test here:

  1. ⛔ APScheduler runs ON the FastAPI event loop, so a scheduled resolve would freeze the app
     (~23 s per spot). `resolve_many` is a plain BLOCKING function and must stay one — pinned by
     asserting it is not a coroutine function.
  2. ⛔ Nearest-wins lookup means a newly-resolved entry could DISPLACE a correct committed
     neighbour within 1 km. Made impossible by construction: the overlay is consulted only when the
     committed asset returns nothing.
  3. ⛔ `resolve_surf_geometry` reads the normal and the break depth at two separate sites, so
     wiring one leaves the depth-limited cap dead. Both now go through one `_nearest`.
"""
import json
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import resolve_spot_geometry as R
from services.weather_pipeline import shore_normal_asset as sna

PIPE = {"id": "1", "name": "Pipeline", "latitude": 21.6654, "longitude": -158.0521}


@pytest.fixture(autouse=True)
def _isolated(tmp_path, monkeypatch):
    """Point BOTH stores at temp files so nothing reads or writes the shipped asset."""
    monkeypatch.setattr(sna, "_ASSET", str(tmp_path / "asset.json"))
    monkeypatch.setattr(sna, "_OVERLAY", str(tmp_path / "overlay.json"))
    monkeypatch.delenv("SHORE_NORMAL_ASSET", raising=False)
    monkeypatch.delenv("SHORE_NORMAL_OVERLAY", raising=False)
    sna._reset_for_tests()
    yield
    sna._reset_for_tests()


def _write(path, entries):
    with open(path, "w") as fh:
        json.dump({"entries": entries}, fh)
    sna._reset_for_tests()


def _fake_gate(row, ok=True, reason=None):
    return (lambda spot: dict(row), lambda r: (ok, reason))


ROW = {"lat": 21.6654, "lng": -158.0521, "normal": 309.6, "spread": 5.2,
       "break_depth_m": 11.1, "status": "ok"}


# ── BLOCKER 1: it must never be schedulable onto the event loop ─────────────────────────────────

def test_the_resolver_is_BLOCKING_not_async():
    """The app's APScheduler runs ON the FastAPI event loop. An `async def` here would invite
    somebody to schedule it there, freezing every request for ~23 s a tick (up to 279 s for a
    backlog). Being plainly blocking is the design, so it is pinned as one."""
    import inspect
    assert not inspect.iscoroutinefunction(R.resolve_many)
    assert not inspect.iscoroutinefunction(R.resolve_one)


def test_importing_the_module_does_not_drag_in_numpy():
    """The gate is imported lazily. A function-level numpy import inside a worker thread under a
    running event loop is what deadlocked the sim MCP server for 480 s — so merely importing this
    module must not pull it in and make that reachable from a new place."""
    import ast
    import inspect
    tree = ast.parse(inspect.getsource(R))     # not open() — it defaults to cp1252 on Windows
    # MODULE-level imports only — prose in the docstring naming the module is fine, an import is not.
    top = [n for n in tree.body if isinstance(n, (ast.Import, ast.ImportFrom))]
    names = {a.name for n in top if isinstance(n, ast.Import) for a in n.names}
    names |= {n.module or "" for n in top if isinstance(n, ast.ImportFrom)}
    assert not any("numpy" in n or "build_shore_normals" in n for n in names), \
        f"the numpy-carrying module must be imported lazily, found {sorted(names)}"


# ── BLOCKER 2: an overlay entry may never displace a committed one ──────────────────────────────

def test_the_committed_asset_always_WINS_over_the_overlay(tmp_path):
    """Nearest-wins is what makes displacement possible. The overlay is consulted only when the
    committed asset matched nothing, so a newly-resolved entry cannot take over from a
    gate-passed neighbour — by construction, not by tuning a radius."""
    _write(sna._ASSET, [[21.6654, -158.0521, 309.6, 5.2, 11.1]])
    # An overlay entry 100 m away — NEARER to the query point than the committed one.
    sna.add_overlay_entry(21.6660, -158.0521, 42.0, 1.0, 99.9)
    got = sna.shore_normal_at(21.6659, -158.0521)
    assert got[0] == pytest.approx(309.6), "the committed entry must still answer"
    assert sna.break_depth_at(21.6659, -158.0521) == pytest.approx(11.1)
    assert sna.source_at(21.6659, -158.0521) == "asset"


def test_the_overlay_answers_ONLY_where_the_asset_is_silent():
    _write(sna._ASSET, [[21.6654, -158.0521, 309.6, 5.2, 11.1]])
    far_lat, far_lng = 33.3819, -117.5885            # Trestles: nothing committed nearby
    assert sna.shore_normal_at(far_lat, far_lng) == (None, None)
    sna.add_overlay_entry(far_lat, far_lng, 219.0, 4.0, 9.3)
    assert sna.shore_normal_at(far_lat, far_lng)[0] == pytest.approx(219.0)
    assert sna.source_at(far_lat, far_lng) == "overlay"


# ── BLOCKER 3: the bearing and the break depth must arrive together ─────────────────────────────

def test_an_overlay_entry_reaches_the_BEARING_AND_the_break_depth():
    """The audit's third blocker: the two used to be separate searches, so wiring one left the
    depth-limited breaking cap dead — a half-resolved spot reporting as resolved."""
    lat, lng = 33.3819, -117.5885
    sna.add_overlay_entry(lat, lng, 219.0, 4.0, 9.3)
    assert sna.shore_normal_at(lat, lng)[0] == pytest.approx(219.0)
    assert sna.break_depth_at(lat, lng) == pytest.approx(9.3), \
        "the break depth did NOT follow the bearing — the oversize gate's capacity tier stays dead"


def test_both_accessors_share_one_lookup():
    """Structural: there must be a single `_nearest`, so the next geometry source cannot reach one
    accessor and miss the other."""
    import inspect
    for fn in (sna.shore_normal_at, sna.break_depth_at):
        assert "_nearest(" in inspect.getsource(fn)


# ── publishing takes effect IMMEDIATELY ─────────────────────────────────────────────────────────

def test_publishing_invalidates_the_memoised_lookup():
    """`_nearest` is lru_cached, so a spot asked about BEFORE resolution has None cached against its
    coordinate. Without the clear the job would report success while the spot stayed blind until a
    process restart."""
    lat, lng = 43.4079, -2.6977
    assert sna.shore_normal_at(lat, lng) == (None, None)      # caches the miss
    sna.add_overlay_entry(lat, lng, 12.5, 3.0, 7.0)
    assert sna.shore_normal_at(lat, lng)[0] == pytest.approx(12.5)


def test_the_overlay_kill_switch_leaves_the_asset_alone(monkeypatch):
    _write(sna._ASSET, [[21.6654, -158.0521, 309.6, 5.2, 11.1]])
    sna.add_overlay_entry(33.3819, -117.5885, 219.0, 4.0, 9.3)
    monkeypatch.setenv("SHORE_NORMAL_OVERLAY", "0")
    sna._nearest.cache_clear()
    assert sna.shore_normal_at(33.3819, -117.5885) == (None, None)
    assert sna.shore_normal_at(21.6654, -158.0521)[0] == pytest.approx(309.6)


# ── the gate is the SAME gate ───────────────────────────────────────────────────────────────────

def test_a_gate_passing_fit_is_published():
    m, a = _fake_gate(ROW)
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "published"
    assert sna.shore_normal_at(21.6654, -158.0521)[0] == pytest.approx(309.6)
    assert sna.break_depth_at(21.6654, -158.0521) == pytest.approx(11.1)


def test_a_REJECTED_fit_is_not_published_and_names_the_reason():
    """The reason is the actionable half: placement needs the pin moved and re-running fixes none
    of it, while an ambiguous coastline is simply hard."""
    m, a = _fake_gate(ROW, ok=False, reason="not_on_open_ocean_inland")
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "rejected"
    assert out["reason"] == "not_on_open_ocean_inland"
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None), "a rejected fit must not ship"


def test_a_gate_pass_with_no_bearing_is_still_refused():
    """A None bearing in the index would make every lookup near it raise."""
    m, a = _fake_gate(dict(ROW, normal=None))
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "rejected" and out["reason"] == "gate_passed_without_a_bearing"
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)


def test_a_failed_FETCH_is_reported_as_retryable_not_rejected():
    """A rejection is a verdict about the spot; a fetch failure is a verdict about the network.
    Conflating them would tell an owner to move a correctly-placed pin."""
    m, a = _fake_gate(dict(ROW, status="fetch_failed: HTTP 500"))
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "failed"
    assert "fetch_failed" in out["reason"]


def test_a_spot_that_already_has_full_geometry_is_SKIPPED(monkeypatch):
    """~22 s of a public NOAA endpoint's time, spent on a spot that needed nothing."""
    monkeypatch.setattr(R, "needs_geometry", lambda s: False)
    called = []
    out = R.resolve_one(PIPE, lambda s: called.append(1) or dict(ROW), lambda r: (True, None))
    assert out["status"] == "skipped"
    assert called == [], "the fit must not run at all"


def test_measure_raising_is_caught_not_fatal():
    def boom(spot):
        raise RuntimeError("ERDDAP down")
    out = R.resolve_one(PIPE, boom, lambda r: (True, None))
    assert out["status"] == "failed" and "ERDDAP down" in out["reason"]


# ── the sweep ───────────────────────────────────────────────────────────────────────────────────

def test_resolve_many_is_BOUNDED():
    """A sweep that quietly tried 1,773 spots at ~22 s each would run for hours against a public
    endpoint."""
    spots = [{"id": str(i), "name": f"s{i}", "latitude": 40.0 + i * 0.5, "longitude": -70.0}
             for i in range(20)]
    m, a = _fake_gate(ROW)
    out = R.resolve_many(spots, limit=3, measure=m, accepted=a)
    assert sum(out["counts"].values()) == 3, "the cap must stop the sweep, not the spot list"
    assert len(out["results"]) == 3


def test_the_sweep_reports_rejection_REASONS_not_just_a_count():
    """'12 failed' hides the only actionable distinction there is. The existing build writes these
    to a CI-only review CSV that never reaches the product."""
    spots = [{"id": str(i), "name": f"s{i}", "latitude": 40.0 + i * 0.5, "longitude": -70.0}
             for i in range(3)]
    m = lambda spot: dict(ROW, lat=spot["latitude"], lng=spot["longitude"])
    out = R.resolve_many(spots, limit=3, measure=m,
                         accepted=lambda r: (False, "not_on_open_ocean_inland"))
    assert out["counts"]["rejected"] == 3
    assert out["reasons"] == {"not_on_open_ocean_inland": 3}, out["reasons"]


def test_persist_writes_the_overlay_and_reloads_it(tmp_path):
    sna.add_overlay_entry(33.3819, -117.5885, 219.0, 4.0, 9.3)
    n = R.persist_overlay()
    assert n == 1
    assert os.path.exists(sna._OVERLAY)
    sna._reset_for_tests()                       # simulate a restart
    assert sna.shore_normal_at(33.3819, -117.5885)[0] == pytest.approx(219.0)
    assert sna.break_depth_at(33.3819, -117.5885) == pytest.approx(9.3)


def test_a_missing_overlay_file_is_the_NORMAL_state_not_an_error():
    assert not os.path.exists(sna._OVERLAY)
    assert sna.shore_normal_at(33.3819, -117.5885) == (None, None)
    assert sna.break_depth_at(33.3819, -117.5885) is None


# ── THE GATE IS ALL-OR-NOTHING; THE MEASUREMENTS ARE NOT ────────────────────────────────────────
# Measured live 2026-07-30 at Bondi Beach: the gate REJECTED `ambiguous_coastline` (bearing spread
# 48.0 deg) and the SAME fit produced `break_depth_m = 21.0` — for a spot that has no break depth at
# all. `nearshore_depth_m` takes only the elevation grid and the coordinate; it never sees the
# bearing fit, and it self-gates below _MIN_TRUSTWORTHY_DEPTH_M. break_depth is missing at 707 of
# 1,773 spots (39.9%) — the largest single gap in the catalogue.

@pytest.mark.parametrize("reason", ["ambiguous_coastline", "too_few_windows"])
def test_a_BEARING_ONLY_rejection_still_publishes_the_depth(reason):
    m, a = _fake_gate(ROW, ok=False, reason=reason)
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "depth_only"
    assert out["reason"] == reason
    assert sna.break_depth_at(21.6654, -158.0521) == pytest.approx(11.1)
    # ★ and the BEARING must NOT be published — that is the half the gate refused.
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)


@pytest.mark.parametrize("reason", ["not_on_open_ocean_inland", "not_on_open_ocean_no_ocean",
                                    "spot_misplaced", "spot_misplaced_at_sea"])
def test_a_PLACEMENT_rejection_publishes_NOTHING(reason):
    """The pin is in the wrong place, so the depth was measured somewhere meaningless too."""
    m, a = _fake_gate(ROW, ok=False, reason=reason)
    out = R.resolve_one(PIPE, m, a)
    assert out["status"] == "rejected"
    assert sna.break_depth_at(21.6654, -158.0521) is None
    assert sna.shore_normal_at(21.6654, -158.0521) == (None, None)


def test_no_shoreline_in_window_publishes_NOTHING():
    """Excluded on purpose: no coastline was found at all, which makes a 'nearshore' depth as
    doubtful as the bearing."""
    m, a = _fake_gate(ROW, ok=False, reason="no_shoreline_in_window")
    assert R.resolve_one(PIPE, m, a)["status"] == "rejected"
    assert sna.break_depth_at(21.6654, -158.0521) is None


def test_an_UNKNOWN_rejection_reason_publishes_NOTHING():
    """ALLOW-list, not deny-list. A new PLACEMENT clause added to `accepted()` must not slip through
    and publish a depth measured at a coordinate the gate just condemned."""
    assert R.depth_is_publishable("some_new_placement_clause") is False
    assert R.depth_is_publishable(None) is False
    m, a = _fake_gate(ROW, ok=False, reason="some_new_placement_clause")
    assert R.resolve_one(PIPE, m, a)["status"] == "rejected"
    assert sna.break_depth_at(21.6654, -158.0521) is None


def test_a_bearing_only_rejection_with_NO_depth_is_just_rejected():
    m, a = _fake_gate(dict(ROW, break_depth_m=None), ok=False, reason="ambiguous_coastline")
    assert R.resolve_one(PIPE, m, a)["status"] == "rejected"


def test_a_depth_only_entry_leaves_the_COARSE_bearing_standing():
    """THE SAFETY PROPERTY. `resolve_surf_geometry` only overwrites the coarse normal when the asset
    returns a NON-None bearing, so a depth-only entry cannot blank a spot's bearing. That ordering
    is load-bearing: a None normal disables the directional gate entirely and scores every swell
    head-on — mean LEVEL error 4.12 vs 1.04 for a merely-coarse bearing."""
    import inspect
    from services.weather_pipeline import surf_point
    src = inspect.getsource(surf_point.resolve_surf_geometry)
    assert "if _fine is not None:" in src, \
        "the asset now overwrites the coarse normal unconditionally — a depth-only entry would " \
        "BLANK the bearing, which measurement says is far worse than a coarse one"
