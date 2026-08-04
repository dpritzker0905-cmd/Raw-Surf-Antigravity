"""The TWO directional-exposure reductions, and the harness that cannot grade either of them.

The composition reduces the forecast by swell/shore misalignment in TWO places:

    quality   surf_rating.swell_exposure          = clamp(0.10 + 0.90*max(0, cos dtheta))
    height    surf_transform._height_exposure_factor = 0.55 + 0.45 * <that exposure>

Both are hand-chosen, neither is derived, and they disagree with each other. This file pins the
relationship as it stands TODAY so that changing either becomes a deliberate act with a visible
diff, and records the physics and the instrument blindness that a future change has to reckon with.

⛔⛔ THE BLIND HARNESS — THE MOST IMPORTANT THING HERE.
`memory/owner-anchors-are-a-constraint-system` says "`test_owner_calibration_anchors.py` IS the A/B
harness — use it before ANY calibration change." For a DIRECTIONAL change it grades nothing: every
anchor sets `SWELL_FROM = SHORE_NORMAL = 90.0`, i.e. exactly head-on, where every candidate
exposure curve equals 1.0 by construction. Measured: swapping the height factor for sqrt(exposure)
moves all five anchors by EXACTLY 0.0.
⇒ Following that instruction on a directional change returns GREEN and means NOTHING. That is the
five-ways-an-instrument-reports-success class, and this test exists so the next person meets it as
a failing assertion rather than a false all-clear.

★ THE PHYSICS, for whoever does change them (`scripts/directional_exposure_science.py` computes it,
with a control that converges on the engine's own cosine as the spectrum narrows to a ray):
a real sea is a directional spectrum G(phi) = cos^2s(phi/2), s ~ 70 swell / s ~ 10 windsea. Onshore
energy flux beyond 90 deg is NOT one constant — at dtheta=100 it is 0.013 for swell and 0.106 for
windsea, an 8x spread that a single 0.10 floor cannot represent in either direction.
⚠️ But those are DEEP-WATER LOWER BOUNDS: refraction narrows spread toward shore-normal, and
ultra-refraction (>90 deg turning over short distances) has "a powerful influence on coastal areas
that otherwise appear sheltered". The empirical ERA5 per-spot answer remains the principled fix.
"""
import math
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

import services.weather_pipeline.surf_transform as ST  # noqa: E402
from services.weather_pipeline.surf_rating import (  # noqa: E402
    compute_surf_rating, swell_exposure,
)

FT = 0.3048
# the owner anchors, verbatim from test_owner_calibration_anchors.py
WIND_MS, WIND_FROM, SHORE_NORMAL, SWELL_FROM = 2.0, 270.0, 90.0, 90.0
ANCHORS = ((2.5, 9.0), (3.5, 9.0), (4.0, 9.0), (7.0, 11.0), (9.0, 12.0))
FL_REF = 0.75


def _rate_anchors():
    return [compute_surf_rating(ft * FT, tp, WIND_MS, WIND_FROM, SHORE_NORMAL, SWELL_FROM,
                                reference_size_m=FL_REF) for ft, tp in ANCHORS]


def test_the_owner_anchor_harness_CANNOT_grade_a_directional_change():
    """⛔ Measured, not asserted: swap the height-exposure curve for sqrt(exposure) — a change that
    cuts height 47% at the floor — and every owner anchor moves by exactly 0.0."""
    before = _rate_anchors()

    original = ST._height_exposure_factor
    ST._height_exposure_factor = lambda s, n: (
        1.0 if (s is None or n is None)
        else math.sqrt(max(1e-9, swell_exposure(s, n))))
    try:
        after = _rate_anchors()
    finally:
        ST._height_exposure_factor = original

    assert before == after, "harness moved — re-derive this test's premise"
    # ...and the mutation was REAL: at the floor the two curves differ by 1.88x. If this assertion
    # ever fails, the swap did nothing and the test above proved nothing either.
    assert abs((0.55 + 0.45 * 0.10) - math.sqrt(0.10)) > 0.25, "the mutation is not a real change"


def test_the_two_directional_factors_disagree_by_3_5x_in_energy():
    """`_height_exposure_factor`'s docstring justifies itself as 'height scales gentler than energy
    with incidence' — i.e. H ~ sqrt(E). Squaring the implemented curve recovers the energy it is
    consistent with, and at the floor that is 0.354 against the quality factor's 0.10."""
    e_floor = swell_exposure(180.0, 0.0)                 # swell from directly behind -> the floor
    assert abs(e_floor - 0.10) < 1e-9

    h_floor = ST._height_exposure_factor(180.0, 0.0)
    assert abs(h_floor - 0.595) < 1e-9

    implied_energy = h_floor ** 2
    assert abs(implied_energy - 0.354) < 0.002
    assert implied_energy / e_floor > 3.5, (
        "the two reductions of the same physical quantity have converged — good, but this test's "
        "documented 3.5x inconsistency is now stale and the docstring must be re-derived")

    # they agree only at head-on, which is exactly why the head-on anchors cannot see the gap
    assert abs(ST._height_exposure_factor(90.0, 90.0) - 1.0) < 1e-9
    assert abs(swell_exposure(90.0, 90.0) - 1.0) < 1e-9


def test_both_factors_are_CONSTANT_beyond_90_degrees():
    """The property the spectral calculation contradicts: one number for every off-angle sea, when
    the onshore flux at dtheta=100 differs ~8x between swell (0.013) and windsea (0.106)."""
    q = {round(swell_exposure(d, 0.0), 6) for d in (90, 100, 120, 150, 180)}
    h = {round(ST._height_exposure_factor(d, 0.0), 6) for d in (90, 100, 120, 150, 180)}
    assert q == {0.1}, "the quality floor is no longer flat beyond 90 deg — re-read the science file"
    assert h == {0.595}, "the height floor is no longer flat beyond 90 deg"


def test_unknown_geometry_still_fails_OPEN_on_both():
    """A missing shore normal must never penalise a spot — the 2026-07-03 lesson, and the reason
    neither factor may be re-derived as 'multiply by whatever we computed'."""
    assert swell_exposure(None, 90.0) == 1.0
    assert swell_exposure(90.0, None) == 1.0
    assert ST._height_exposure_factor(None, 90.0) == 1.0
    assert ST._height_exposure_factor(90.0, None) == 1.0


def test_the_science_instrument_reproduces_the_engine_as_the_spectrum_narrows():
    """★ THE CONTROL for the whole argument: the spectral model must converge on the engine's own
    single-ray cosine as s -> infinity. If it does not, the science file is wrong, not the engine,
    and none of its numbers may be quoted."""
    import importlib.util
    spec = importlib.util.spec_from_file_location(
        "_dir_sci", Path(__file__).resolve().parents[1] / "scripts" / "directional_exposure_science.py")
    sci = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(sci)

    for dtheta in (30.0, 60.0, 80.0):
        narrow = sci.onshore_flux(dtheta, 400.0)
        assert abs(narrow - math.cos(dtheta * math.pi / 180.0)) < 0.01, (
            f"at s=400 the spectrum is effectively a ray; flux({dtheta}) should be cos({dtheta})")

    # and a broad windsea genuinely delivers more past the cutoff than a narrow swell does
    assert sci.onshore_flux(100.0, 10.0) > 5 * sci.onshore_flux(100.0, 70.0)
