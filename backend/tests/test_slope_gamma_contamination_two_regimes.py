"""THE WEGGEL SLOPE TERM IS FED A DEPTH THAT IS NOT A SHELF DEPTH — inert at normal seas, NOT at big ones.

Both regimes are measured, and BOTH are pinned here, because "leave it alone" is only correct for
one of them.

THE CONTAMINATION (measured 2026-08-05 over 701 live spots, through `resolve_surf_geometry`):
`_slope_proxy = depth_m / (shelf_width_km * 1000)` is called a "shelf-scale slope", but `depth_m` is
a ~139 km MEDIAN — the right quantity for cross-shelf friction, and not a shelf depth at all at
island and deep-water spots.

    slope m: p50 0.0017 · p90 0.046 · p99 0.080 · max 0.181
    m > 0.03 ("volcanic reef coast" per surf_transform's own note): 111/701 = 15.8%
    gamma SATURATED at GAMMA_MAX_STEEP: 29/701 = 4.1%
    worst: Tobacco Bay depth=4250 m / width=23.4 km -> m=0.181

A 4,250 m "shelf" is open ocean, and 0.181 is an 18% grade — a cliff, not a shelf.

⛔⛔ CORRECTED 2026-08-05 (self-audit). THE ORIGINAL VERSION OF THIS FILE SAID "IT CHANGES
NOTHING". THAT WAS MEASURED ON TOO NARROW A RANGE AND IS WRONG AT THE EXTREMES.

    9 spots x 5 seas   (Hs <= 8 m):   1 of 45  moved, by 0.3%     <- the original claim
    10 spots x 54 seas (Hs <= 18 m): 33 of 540 moved (6.1%),
                                     WORST Pipeline 18 m/8 s -> +75.4%

Every mover is Pipeline, and its geometry says why:

    Pipeline     depth = 2534.5 m / width 25.8 km -> slope 0.0983 -> gamma 1.250 (SATURATED)
    Mavericks    depth =  101.5 m / width 44.0 km -> slope 0.0023 -> gamma 0.838
    Cocoa Beach  depth =   24.0 m / width 73.3 km -> slope 0.0003 -> gamma 0.823

A 2,534 m "shelf depth" is not a shelf — Oahu's north shore drops into deep ocean. Mavericks and
Cocoa Beach, which have real shelves, are unaffected.

⇒ THE HONEST STATEMENT, and it is worse than the original:
   * at TYPICAL seas (Hs <= 8 m) the slope term is inert — the cap does not bind;
   * at BIG-WAVE seas (Hs 12-18 m) it binds and moves the served height by up to +75% at
     deep-water spots, which is exactly the safety-critical regime;
   * the gamma driving that comes from a depth that is not a shelf depth.
   ⚠️ Whether 1.25 is even WRONG at Pipeline is a separate question — it is a genuinely steep
     plunging reef and the literature puts gamma near 1.0-1.2 there, so the value may be roughly
     right BY ACCIDENT, reached from a number that is not a slope. That is this repo's recurring
     "right by cancellation" shape and it must not be patched blind.

⇒ Still NOT changed here, but for a narrower reason than before: the fix is to give the slope term
a real nearshore slope, and doing that changes big-wave heights at deep-water spots by up to 75%,
which needs an owner decision and a directional/size A/B — not a quiet edit. The tests below now
pin BOTH regimes so neither can drift unnoticed.

⛔ A RED HERE IS NOT NECESSARILY A BUG. It means the premise that made "leave it alone" correct has
expired. Re-measure, then either fix the slope input or re-pin with new numbers.
"""
import importlib
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)


def _reload(slope_on):
    os.environ["SURF_V3_SLOPE_GAMMA"] = "1" if slope_on else "0"
    import services.weather_pipeline.surf_transform as st
    importlib.reload(st)
    return st


@pytest.fixture(autouse=True)
def _restore_flag():
    before = os.environ.get("SURF_V3_SLOPE_GAMMA")
    yield
    if before is None:
        os.environ.pop("SURF_V3_SLOPE_GAMMA", None)
    else:
        os.environ["SURF_V3_SLOPE_GAMMA"] = before
    import services.weather_pipeline.surf_transform as st
    importlib.reload(st)          # leave the module as production imports it


# ── half 1: the kill switch is live, and the contamination reaches gamma ─────────────────────────

@pytest.mark.parametrize("m", [0.0886, 0.1814])   # measured live: Scar Reef / Tobacco Bay
def test_a_deep_water_slope_saturates_gamma__THE_CONTROL(m):
    """Without this the inertness test below could pass because the slope term does NOTHING at all,
    which would be a different (and larger) defect wearing the same green tick."""
    on, off = _reload(True).breaker_index(12.0, slope=m), _reload(False).breaker_index(12.0, slope=m)
    assert off == pytest.approx(0.821, abs=0.01), "the legacy no-slope centre moved"
    assert on == pytest.approx(1.250, abs=0.01), (
        f"slope m={m} no longer saturates gamma at GAMMA_MAX_STEEP — the contamination described "
        f"in this file's header has changed shape; re-measure the 701-spot distribution."
    )
    assert on / off > 1.4, "the slope term stopped being a large lever on gamma"


# ── half 2: TYPICAL seas — the cap does not bind ────────────────────────────────────────────────

_SPOTS = [("Tobacco Bay", 32.37, -64.68), ("Scar Reef", -8.45, 116.02), ("G-Land", -8.72, 114.35),
          ("Frigates Passage", -18.28, 177.90), ("Pipeline", 21.6637, -158.0515),
          ("Mavericks", 37.4915, -122.5083), ("Cocoa Beach Pier", 28.3676, -80.6012)]
_SEAS = [(1.0, 10.0), (2.0, 12.0), (3.5, 14.0), (5.0, 16.0), (8.0, 18.0)]


def test_at_TYPICAL_seas_the_1_52x_gamma_swing_does_not_move_the_served_height():
    """Hs <= 8 m. Measured 2026-08-05: 1 of 45 cases moved, by 0.3%.

    ⚠️ THIS RANGE IS THE POINT, AND THE ORIGINAL VERSION OF THIS FILE MISTOOK IT FOR THE WHOLE
    STORY. It says nothing about big-wave seas — see the test below, which is where the cap
    actually binds. A bound measured on a narrow range is a bound on that range only."""
    def heights(on):
        _reload(on)
        import services.weather_pipeline.surf_point as sp
        importlib.reload(sp)
        return {(n, h, t): sp.estimate_surf_at(la, lo, h, t)[0]
                for n, la, lo in _SPOTS for h, t in _SEAS}

    on, off = heights(True), heights(False)
    pairs = [(k, on[k], off[k]) for k in on
             if on[k] is not None and off[k] is not None and off[k] > 0]

    # SETUP ASSERTION: an empty or tiny comparison set would make the bound below vacuous.
    assert len(pairs) >= 30, (
        f"only {len(pairs)} comparable spot/sea pairs — geometry stopped resolving for most "
        f"fixtures, so this test is not measuring what it claims."
    )

    worst = max(abs(a / b - 1.0) for _k, a, b in pairs)
    moved = [k for k, a, b in pairs if abs(a / b - 1.0) > 0.001]

    assert worst < 0.05, (
        f"the slope term now moves the served height by {worst*100:.1f}% at TYPICAL seas (worst of "
        f"{len(pairs)} pairs, {len(moved)} moved). The cap has started binding in the everyday "
        f"regime too, so the contaminated slope input in surf_transform.py is no longer confined to "
        f"big-wave days. See this file's header."
    )


# ── half 3: BIG-WAVE seas — the cap DOES bind, and this pins how much ───────────────────────────

_BIG_SEAS = [(12.0, 11.0), (12.0, 14.0), (18.0, 5.0), (18.0, 8.0), (18.0, 11.0), (18.0, 14.0)]


def test_at_BIG_WAVE_seas_the_contaminated_slope_DOES_move_the_height():
    """Hs 12-18 m. Measured 2026-08-05 over 10 spots x 54 seas: 33 of 540 pairs moved (6.1%), worst
    Pipeline 18 m / 8 s at +75.4%. EVERY mover was Pipeline, whose "shelf depth" is 2,534.5 m —
    Oahu's north shore drops into deep ocean, so that is not a shelf and 0.0983 is not a slope.

    ⛔ THIS TEST ASSERTS THE DEFECT IS STILL THERE. It is a pin, not an approval: it exists so the
    magnitude cannot drift silently in EITHER direction while the input stays contaminated. If a
    real nearshore slope is wired in, this goes red — and that is the intended signal, because it
    changes big-wave heights at deep-water spots by up to 75% and needs an owner decision.
    """
    def heights(on):
        _reload(on)
        import services.weather_pipeline.surf_point as sp
        importlib.reload(sp)
        return {(h, t): sp.estimate_surf_at(21.6637, -158.0515, h, t)[0] for h, t in _BIG_SEAS}

    on, off = heights(True), heights(False)
    pairs = [(k, on[k], off[k]) for k in on
             if on[k] is not None and off[k] is not None and off[k] > 0]

    # SETUP ASSERTION: Pipeline's geometry must still be the deep-water case, or this pins nothing.
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    geo = resolve_surf_geometry(21.6637, -158.0515)
    assert geo.depth_m and geo.depth_m > 1000, (
        f"Pipeline's depth_m is now {geo.depth_m} — no longer the deep-water median this test was "
        f"built on. Re-measure the 701-spot distribution before trusting either regime."
    )
    assert len(pairs) >= 4, f"only {len(pairs)} big-wave pairs resolved — fixture broken"

    worst = max(a / b for _k, a, b in pairs)
    assert worst > 1.2, (
        f"the slope term no longer inflates big-wave heights at Pipeline (worst ratio {worst:.3f}). "
        f"If the slope input was fixed, delete this test WITH the change and record the new "
        f"numbers. If it was not, the cap stopped binding for some other reason and the header's "
        f"measurement is stale."
    )
    assert worst < 2.0, (
        f"big-wave inflation has GROWN to {worst:.3f}x (was 1.754x on 2026-08-05). Something made "
        f"the cap bind harder — re-measure before shipping."
    )
