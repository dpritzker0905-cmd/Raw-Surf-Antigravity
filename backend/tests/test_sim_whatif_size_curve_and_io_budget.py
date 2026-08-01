"""The what-if's I/O BUDGET and its SIZE CURVE — two things that were keyed off the wrong fact.

`allow_reference_lookup` was passed as a literal `True` at `base_calc`, justified by a comment
saying that line is "reached ONLY when the caller has already paid for the fetch". `baseline is not
None` is satisfied by THREE branches, and two of them pay nothing: a PEEKED cache hit and a staged
`_SIM_OVERRIDES` entry. Measured 2026-08-01 by spying on `load_size_climatology_l2` (the function
that actually performs HTTP, TTL left intact):

    all five inputs, no hour, COLD cache -> 0 dials      all five, no hour, WARM cache -> 2 dials

And `calc` omitted the flag entirely while `base_calc` passed it, so the two sides of
`baseline_delta` graded on DIFFERENT size curves: at Mavericks with a 1.9 m reference the tool
reported "+16.9 better" where the like-for-like answer is +9.8 — **7.1 points, 42% of the reported
delta, was a curve switch the caller never asked for.**

⚠️ These tests must NOT use the hand-tuned `CATALOG_DEFAULTS` row. It carries an explicit
`reference_size_m` (4.0), and `reference_size_for` returns an explicit value BEFORE it consults
`allow_lookup` — so both sides would agree at 4.0 and the mismatch would be INVISIBLE. A
live-catalogue-shaped row (real id, no explicit reference) is the only shape that can observe it.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

# ✅ NEITHER EXCLUDED NOR SKIPPED ANY MORE. This module imports `weather_sim_mcp`, which now
# reaches FastMCP through `sim_mcp_shim` — a stand-in when the framework is absent — so these
# guards RUN in CI. That matters more here than anywhere: this file holds the ZERO-NETWORK
# invariant, whose regression (`576dcbdd`) was 42.2 s of blocking, past where an MCP client
# reports a timeout. It was verified only on laptops for as long as it was excluded.
import weather_sim_mcp  # noqa: E402  (follows the sys.path setup above)
from services.weather_pipeline import sim_forecast, sim_rating, sim_spots  # noqa: E402
from services.weather_pipeline import spot_size_climatology as SSC  # noqa: E402

SIM = getattr(weather_sim_mcp.simulate_weather_change, "fn",
              weather_sim_mcp.simulate_weather_change)

MAV_ID = "264de2b4-fefc-4101-bb2c-c0557b9ca190"
LIVE_ROWS = [{"id": MAV_ID, "name": "Mavericks", "region": "Half Moon Bay",
              "latitude": 37.4915, "longitude": -122.5083}]
FULL = dict(wind_speed_knots=7.0, wind_direction_deg=45.0, swell_height_m=3.5,
            swell_period_sec=16.0, swell_direction_deg=290.0)
BASE = {"swell_height_m": 1.6, "swell_period_sec": 11.0, "swell_direction_deg": 265.0,
        "wind_speed_knots": 18.0, "wind_direction_deg": 200.0}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    monkeypatch.setattr(sim_forecast, "fetch_catalog", lambda: list(LIVE_ROWS))
    sim_forecast._CATALOG_CACHE.clear()
    sim_forecast._FORECAST_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()
    hist = SSC.empty_hist()
    hist[9] = 40
    blob = {"schema_version": SSC.SCHEMA_VERSION, "spots": {MAV_ID: {"hist": hist}}}
    # ⚠️ ASSERTED, not `hasattr`-guarded — and this reset has now pointed at BOTH memos in turn,
    # which is the whole lesson. It first targeted `spot_size_climatology._ref_map_memo` when that
    # name lived only in a concurrent session's UNCOMMITTED tree, so it cleared nothing and said
    # nothing; it was repointed at `sim_rating._REF_MAP_MEMO` (`50e441bd`); and that memo has since
    # been DELETED, because `reference_size_for` now delegates to `reference_for_spot` and two
    # caches over one composition can disagree about which blob snapshot they describe.
    # ⇒ the target is `SSC._ref_map_memo` again, and the `assert` is what makes the next move loud
    # instead of silent. **A cleanup guarded by `hasattr` degrades into a no-op the moment the thing
    # moves** — and this one has moved twice.
    assert hasattr(SSC, "_ref_map_memo"), (
        "the reference-map memo moved; this reset is no longer clearing anything")
    SSC._ref_map_memo["cell"] = (None, {})
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached", lambda *a, **kw: blob)
    yield
    sim_forecast._CATALOG_CACHE.clear()
    sim_forecast._FORECAST_CACHE.clear()
    weather_sim_mcp._SIM_OVERRIDES.clear()


@pytest.fixture
def dials(monkeypatch):
    """Spy on the function that performs HTTP. ★ It RETURNS rather than raises: the lookup sits
    inside a fail-open `except Exception`, which would swallow an AssertionError and leave the
    control unable to fail (fade0c69 shipped exactly that mistake and mutation-caught it)."""
    seen = []

    def _spy(*a, **kw):
        seen.append(1)
        return None

    monkeypatch.setattr(SSC, "load_size_climatology_l2", _spy)
    # Undo the blob stub so the spy is genuinely reachable through the cached wrapper.
    monkeypatch.setattr(SSC, "load_size_climatology_l2_cached",
                        lambda *a, **kw: SSC.load_size_climatology_l2())
    return seen


def _warm_the_forecast_cache():
    key = (round(LIVE_ROWS[0]["latitude"], 4), round(LIVE_ROWS[0]["longitude"], 4),
           sim_forecast.current_valid_time())
    sim_forecast._remember(key, (dict(BASE), {"model": "GFS", "valid_time": key[2]}))


def _ref_of(out):
    sso = out.get("simulated_surf_output") or {}
    return ((sso.get("why") or {}).get("inputs") or {}).get("reference_size_m")


# ── THE I/O BUDGET ──────────────────────────────────────────────────────────────────────────────

def test_a_warm_cache_whatif_does_not_dial_the_climatology(dials):
    """THE REGRESSION. A peeked baseline pays no network, so nothing downstream of it may dial."""
    _warm_the_forecast_cache()
    out = SIM("Mavericks", **FULL)
    assert out["success"] is True
    assert dials == [], (
        f"the zero-network what-if dialled the climatology {len(dials)} time(s) on a WARM cache. "
        f"`baseline is not None` is not the same fact as 'the caller paid for a fetch'.")


def _forecast_without_a_served_reference(monkeypatch):
    """Stub the live lane to a baseline whose provenance carries NO `served_reference_size_m`.

    ⚠️⚠️ THIS STUB IS LOAD-BEARING, AND ITS ABSENCE SILENTLY EMPTIED THE CONTROL BELOW. Unstubbed,
    the opt-in path performs a REAL fetch against production, and since 2026-08-01 that response
    carries the app's own `reference_size_m` (Mavericks 1.931 measured live) — which
    `reference_size_for` answers from BEFORE the blob is ever consulted. So the negative control
    stopped observing a dial, not because the spy broke but because there was legitimately nothing
    left to dial. ★ A control that depends on a REMOTE server's payload is not a control; it is a
    second system under test. Provenance without the key is a real production state anyway (an
    older deploy, RATING_LOCAL_SIZE off upstream, or no climatology at that cell), and it is
    exactly the state in which the blob lookup must still be the source.
    """
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (
                            dict(BASE), {"model": "GFS", "valid_time": "2026-08-01T15:00:00Z"}))


def test_NEGATIVE_CONTROL_opting_in_does_reach_the_lookup(dials, monkeypatch):
    """The test above must be able to observe a dial at all. Omit an input -> the caller opts in."""
    _forecast_without_a_served_reference(monkeypatch)
    out = SIM("Mavericks", wind_direction_deg=45.0, swell_height_m=3.5,
              swell_period_sec=16.0, swell_direction_deg=290.0)   # wind_speed omitted
    assert out["success"] is True
    assert dials, ("no dial on the opt-in path either — the spy is not wired to anything, so the "
                   "zero-dial assertion above proves nothing")


def test_a_SERVED_reference_removes_the_dial_even_on_the_opt_in_path(dials, monkeypatch):
    """★ THE I/O BUDGET GOT STRICTLY BETTER, and this pins it rather than leaving it to be
    rediscovered as a broken control. When the app itself sends the reference on the response the
    sim already fetched, there is nothing to look up: the blocking 10 s climatology dial disappears
    from a path that previously HAD to make it. Same opt-in call as the control above — the ONLY
    difference is one key in provenance."""
    monkeypatch.setattr(sim_forecast, "fetch_live_forecast",
                        lambda lat, lng, valid_time=None: (
                            dict(BASE), {"model": "GFS", "valid_time": "2026-08-01T15:00:00Z",
                                         "served_reference_size_m": 1.931}))
    out = SIM("Mavericks", wind_direction_deg=45.0, swell_height_m=3.5,
              swell_period_sec=16.0, swell_direction_deg=290.0)
    assert out["success"] is True
    assert _ref_of(out) == pytest.approx(1.931), "the served reference did not reach the rating"
    assert dials == [], (
        f"a served reference must short-circuit the climatology loader; dialled {len(dials)}x")


# ── THE SIZE CURVE ──────────────────────────────────────────────────────────────────────────────

def test_baseline_delta_grades_both_sides_on_the_same_size_curve():
    """★ THE ARITHMETIC GUARD: change NOTHING and the delta must be exactly 0.

    Omitting all five inputs holds every field at the forecast's own value, so the what-if IS the
    baseline. Any non-zero quality delta is therefore pure composition mismatch — which is exactly
    what a global-curve what-if compared against a local-curve baseline produced. This cannot pass
    by accident: it is real arithmetic over two independently computed ratings."""
    out = SIM("Mavericks")
    assert out["success"] is True
    bd = out.get("baseline_delta")
    assert bd is not None and bd["changed"] == {}, "nothing should have changed"
    assert bd["quality_rating"]["delta"] == 0, (
        f"the what-if and its own baseline disagree by {bd['quality_rating']['delta']} while "
        f"NOTHING changed — the two sides graded on different size curves")
    assert _ref_of(out) is not None, "the caller opted in, so the local curve must be in use"


def test_the_zero_network_whatif_keeps_the_global_curve_on_both_sides():
    """The other state: no opt-in -> neither side may use the local curve, and the delta stays
    composition-matched. A delta is only meaningful when both sides share a composition."""
    _warm_the_forecast_cache()
    out = SIM("Mavericks", **FULL)
    assert _ref_of(out) is None, "the zero-network path must not acquire a local reference"
    base_from = out["baseline_delta"]["quality_rating"]["from"]
    assert isinstance(base_from, (int, float))
