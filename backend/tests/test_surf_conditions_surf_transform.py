"""`/api/surf-conditions` must serve the BREAKING height, not the offshore one.

WHY THIS EXISTS
---------------
`services/surf_conditions.py` fetched open-meteo marine directly and put `wave_height` — the
OFFSHORE significant wave height — into `wave_height_ft`, never calling the canonical chain
(`resolve_surf_geometry` + `estimate_surf_at`). Two CLAUDE.md rules broken at once:

  * "NEVER report marine `point.speed` as the surf height"
  * "Do not add a second forecast path 'just for this screen'"  (this was the FOURTH)

It is not a display-only bug: `CreatePostModal.js` auto-fills the session form from this endpoint
("Conditions auto-filled! Feel free to adjust."), so a surfer's own report was stamped with it.

Measured 2026-08-01 at 1.8 m / 13 s across this module's own 29 SPOT_COORDINATES, offshore vs
breaking at the same coordinate — SIGNED BOTH WAYS, which is exactly why no constant could have
corrected it and only the geometry can:

    pipeline   5.9 ft offshore -> 9.0 ft breaking  -34.1%   deep water, wave jacks up
    galveston  5.9 ft          -> 4.6 ft           +29.7%   166 km shelf @ 16 m, friction bleeds it

24 of 29 read LOW, 5 read HIGH. The sign tracks shelf width/depth, which is the transform working.

The fix MIRRORS `spot_conditions._breaking_ft` (`902f47a9`, the same defect closed at the spot hub)
rather than re-deriving it — same signature shape, same fail-open contract, same provenance tuple.
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.surf_conditions import _breaking_ft, meters_to_feet, SPOT_COORDINATES  # noqa: E402

M_TO_FT = 3.28084


def _offshore_ft(m):
    return round(m * M_TO_FT, 1)


# ── THE CONTRACT ────────────────────────────────────────────────────────────────────────────────

def test_the_transform_is_not_the_identity_on_a_deep_coast():
    """Pipeline sits in deep water: the wave shoals UP, so breaking must exceed offshore.

    A pass-through implementation (the defect) would return the offshore value unchanged, so this
    is the test that actually distinguishes fixed from broken."""
    lat, lng = 21.6650, -158.0530
    breaking, regime = _breaking_ft(lat, lng, 1.8, 13.0, None)
    assert regime != "offshore_estimate", "the transform failed open — it did not run"
    assert breaking > _offshore_ft(1.8) * 1.15, (
        f"Pipeline should shoal well above the offshore {_offshore_ft(1.8)} ft, got {breaking}"
    )


def test_the_transform_reduces_on_a_wide_shallow_shelf():
    """Galveston: ~166 km of shelf at ~16 m. Bottom friction must REDUCE the height.

    ★ This is the negative-direction control. Without it a transform that only ever amplifies would
    pass the test above and still be wrong — the measured error is signed BOTH ways."""
    lat, lng = SPOT_COORDINATES["galveston"]["lat"], SPOT_COORDINATES["galveston"]["lon"]
    breaking, regime = _breaking_ft(lat, lng, 1.8, 13.0, None)
    assert regime != "offshore_estimate"
    assert breaking < _offshore_ft(1.8), (
        f"a 166 km shelf must bleed energy; offshore {_offshore_ft(1.8)} ft -> got {breaking}"
    )


def test_the_two_directions_disagree_so_no_constant_could_fix_this():
    """The whole justification for routing through the geometry rather than scaling a number."""
    deep, _ = _breaking_ft(21.6650, -158.0530, 1.8, 13.0, None)          # pipeline
    g = SPOT_COORDINATES["galveston"]
    shallow, _ = _breaking_ft(g["lat"], g["lon"], 1.8, 13.0, None)
    off = _offshore_ft(1.8)
    assert (deep - off) > 0 > (shallow - off), (
        f"expected signed-both-ways, got deep={deep} shallow={shallow} offshore={off}"
    )


# ── FAIL-OPEN, mirroring the hub's contract exactly ─────────────────────────────────────────────

@pytest.mark.parametrize("offshore_m", [0.0, None, 0])
def test_calm_or_missing_height_is_calm_not_an_exception(offshore_m):
    assert _breaking_ft(37.4956, -122.5011, offshore_m, 13.0, None) == (0.0, "calm")


def test_a_missing_period_fails_OPEN_to_the_offshore_value_and_SAYS_SO():
    """No period => no transform is possible. It must degrade to the offshore number AND label it,
    because a silent fallback is indistinguishable from a working transform."""
    breaking, regime = _breaking_ft(21.6650, -158.0530, 1.8, None, None)
    assert regime == "offshore_estimate"
    assert breaking == _offshore_ft(1.8)


def test_an_inland_coordinate_does_not_raise():
    """Fail-open means the endpoint keeps answering. Mid-continental Kansas has no coast."""
    breaking, regime = _breaking_ft(38.5, -98.0, 1.8, 13.0, None)
    assert breaking > 0 and isinstance(regime, str)


# ── THE COMPOSITION RULE ────────────────────────────────────────────────────────────────────────

def test_this_module_routes_through_the_canonical_chain_and_owns_no_second_transform():
    """The defect was a FOURTH forecast path. Pin that it delegates rather than re-implements.

    ⚠️ Asserts on SOURCE, because the failure mode is someone re-adding a local height calculation
    that never calls the chain — which is exactly how this module drifted in the first place."""
    import services.surf_conditions as sc
    src = open(sc.__file__, encoding="utf-8").read()
    assert "estimate_surf_at" in src, "must delegate to the production chain"
    for banned in ("def estimate_surf", "def shoaling_coefficient", "def breaker_index"):
        assert banned not in src, f"{banned} re-implemented here; mirror the chain, never re-derive"


def test_the_offshore_value_is_preserved_under_its_own_name():
    """`swell_height_ft` keeps the model's offshore number. Deleting it would lose information;
    leaving it in `wave_height_ft` was the defect. Surfline splits swell/surf; so do we."""
    import services.surf_conditions as sc
    src = open(sc.__file__, encoding="utf-8").read()
    assert 'result["swell_height_ft"]' in src
    assert 'result["surf_regime"]' in src, "provenance must ride along, incl. 'offshore_estimate'"
