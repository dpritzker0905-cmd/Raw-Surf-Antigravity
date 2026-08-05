"""THE WEGGEL SLOPE TERM IS FED A DEPTH THAT IS NOT A SHELF DEPTH — and it currently does nothing.

Both halves are measured, and BOTH are pinned here, because the finding is only safe to leave alone
while the second half holds.

THE CONTAMINATION (measured 2026-08-05 over 701 live spots, through `resolve_surf_geometry`):
`_slope_proxy = depth_m / (shelf_width_km * 1000)` is called a "shelf-scale slope", but `depth_m` is
a ~139 km MEDIAN — the right quantity for cross-shelf friction, and not a shelf depth at all at
island and deep-water spots.

    slope m: p50 0.0017 · p90 0.046 · p99 0.080 · max 0.181
    m > 0.03 ("volcanic reef coast" per surf_transform's own note): 111/701 = 15.8%
    gamma SATURATED at GAMMA_MAX_STEEP: 29/701 = 4.1%
    worst: Tobacco Bay depth=4250 m / width=23.4 km -> m=0.181

A 4,250 m "shelf" is open ocean, and 0.181 is an 18% grade — a cliff, not a shelf.

WHY IT IS LEFT ALONE: the served number barely moves, because the depth-limited cap almost never
binds. A/B through `SURF_V3_SLOPE_GAMMA` over 9 spots x 5 seas: gamma goes 0.821 -> 1.250 (1.523x)
and the served height changes in 1 of 45 cases, by 0.3%.

⇒ Sensitivity x uncertainty = Jacobian ~ 0 TODAY. This file exists so that stops being taken on
faith: if anything makes the cap bind more often (a larger `SURF_V3_JACK_MAX`, a shallower
`break_depth_m`, a steeper shoaling term), the inertness test goes RED and forces the conversation
that a silent behaviour change would not.

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


# ── half 2: and it still does not move the served height ─────────────────────────────────────────

_SPOTS = [("Tobacco Bay", 32.37, -64.68), ("Scar Reef", -8.45, 116.02), ("G-Land", -8.72, 114.35),
          ("Frigates Passage", -18.28, 177.90), ("Pipeline", 21.6637, -158.0515),
          ("Mavericks", 37.4915, -122.5083), ("Cocoa Beach Pier", 28.3676, -80.6012)]
_SEAS = [(1.0, 10.0), (2.0, 12.0), (3.5, 14.0), (5.0, 16.0), (8.0, 18.0)]


def test_the_1_52x_gamma_swing_still_does_not_move_the_served_height():
    """The premise behind leaving the contamination in place. Measured 2026-08-05: 1 of 45 cases
    moved, by 0.3%."""
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
        f"the slope term now moves the served height by {worst*100:.1f}% (worst of {len(pairs)} "
        f"pairs, {len(moved)} moved). The depth-limited cap has started BINDING, so the "
        f"contaminated slope input in surf_transform.py is no longer inert and must be fixed — "
        f"`depth_m` is a ~139 km median, not a shelf depth. See this file's header."
    )
