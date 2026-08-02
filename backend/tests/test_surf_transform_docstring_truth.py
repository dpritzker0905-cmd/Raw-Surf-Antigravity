"""
test_surf_transform_docstring_truth.py — the module docstring must not describe live physics as
unbuilt.

WHY A TEST FOR PROSE
--------------------
`surf_transform.py`'s header said, for months after it stopped being true:

    "Refraction (Kr, needs a per-point shore-normal) and bottom friction are deliberate
     PHASE-2 refinements."

Both had shipped. `shelf_dissipation()` implements bottom friction and is ON by default
(`SURF_SHELF_KF_FLOOR`), and `_height_exposure_factor(swell_from_deg, shore_normal_deg)` has been
applied to the height inside `estimate_surf` since 2026-07-17.

⛔ THE COST IS NOT TIDINESS. Anyone implementing Kr would read that line, believe the chain is
direction-blind, and fit a refraction coefficient that ABSORBS DIRECTION — on top of an exposure
factor already doing the job. Measured through the live function, direction alone moves the served
height:

    off-normal    0°     30°      45°      60°      75°      90°
    height      0.0%   -5.4%   -11.9%   -20.2%   -30.0%   -40.5%

So a Kr fitted against a "direction-blind" baseline would double-count by up to 40%. That is the
M5 work this repo has queued, and the queue entry itself repeated the docstring's claim.

★ THIS IS THE SMALLEST USEFUL INSTANCE OF M6 (self-invalidating descriptions). The rule it encodes:
a docstring may not call a capability unbuilt while the module exports and USES it. The check is
derived from the code — it cannot pass by someone updating a copy of the fact.
"""
import inspect
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import surf_transform as st  # noqa: E402

# (human name, symbol that proves it is built, phrases that would be a lie once it is)
_LIVE_PHYSICS = [
    ("bottom friction", "shelf_dissipation",
     ["bottom friction are deliberate PHASE-2", "bottom friction is a PHASE-2",
      "bottom friction are PHASE-2"]),
    ("refraction / directional exposure", "_height_exposure_factor",
     ["Kr, needs a per-point shore-normal", "needs a per-point shore-normal"]),
]


def test_the_symbols_that_prove_the_physics_is_live_still_exist():
    """POSITIVE CONTROL. Without this the docstring test passes vacuously the day someone deletes
    the implementation — the description would then be true again and the guard would agree,
    silently, with a regression."""
    for name, symbol, _ in _LIVE_PHYSICS:
        assert hasattr(st, symbol), f"{name}: {symbol} is gone — the guard below is now vacuous"
        assert callable(getattr(st, symbol)), f"{symbol} is not callable"


def test_directional_exposure_is_actually_APPLIED_not_merely_defined():
    """A defined-but-unwired function would make the docstring true and this file wrong. Assert the
    factor reaches the height, and that it MOVES it."""
    src = inspect.getsource(st.estimate_surf)
    assert "_height_exposure_factor(" in src, \
        "_height_exposure_factor is no longer applied inside estimate_surf"
    head_on = st._height_exposure_factor(180.0, 180.0)
    oblique = st._height_exposure_factor(255.0, 180.0)          # 75 deg off-normal
    assert head_on == 1.0
    assert oblique < 0.75, f"exposure at 75 deg off-normal is {oblique} — expected a real reduction"


def test_bottom_friction_is_on_by_default():
    """`SURF_SHELF_KF_FLOOR` gates the FLOOR, not the dissipation itself — friction runs regardless.
    A shelf that dissipates nothing would mean Kf == 1.0 everywhere."""
    kf = st.shelf_dissipation(16.0, 30.0, 139.0)
    assert 0.0 < kf < 1.0, f"shelf_dissipation returned {kf} — friction is not doing anything"


def test_the_docstring_does_not_call_live_physics_unbuilt():
    """★ THE GUARD. Derived from the code above, so it cannot be satisfied by editing a duplicate
    of the fact somewhere else."""
    doc = st.__doc__ or ""
    stale = []
    for name, symbol, phrases in _LIVE_PHYSICS:
        if not hasattr(st, symbol):
            continue                      # not built -> the docstring may legitimately say so
        for phrase in phrases:
            if phrase in doc:
                stale.append(f"{name}: docstring still says {phrase!r} but {symbol} is implemented")
    assert not stale, (
        "surf_transform's header describes shipped physics as unbuilt:\n  " + "\n  ".join(stale)
        + "\n\nAn implementer reading this would fit Kr against a chain they believe is "
          "direction-blind and DOUBLE-COUNT direction (up to -40.5% of height at 90 deg off-normal)."
    )


def test_the_docstring_still_says_what_is_genuinely_absent():
    """Not a licence to delete the caveats. The transform really is a BULK-parameter estimate with
    no directional spectrum, and callers really must tag it — those statements stay true and must
    stay present, or the correction to this header would have overshot into the opposite error."""
    doc = st.__doc__ or ""
    assert "is_estimated" in doc, "the header no longer tells callers to tag the output"
    assert "spectrum" in doc.lower(), "the header no longer states this is not a spectral model"
