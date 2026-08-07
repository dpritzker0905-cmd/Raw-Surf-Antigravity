"""The hub and the glyphs must express confidence the SAME way, or the surfaces disagree again.

WHY THIS SUITE IS ABOUT PARITY AND NOT ABOUT A FIELD. `spot_conditions` (the hub) does not call
`rate_one_spot` (the glyphs) — it mirrors the composition chain at its own call site. That split is
this repo's most expensive recorded defect class:

  * the hub served the OFFSHORE height as the surf height for months ("2.4 ft" for chest-high surf);
  * a ten-positional-argument call silently stopped one short of `break_depth_m`, so the hub opted
    out of the oversize gate and graded the SAME SPOT differently from the map — measured at Tp 18 s:
    Mavericks hub 27.3 "poor" vs glyph 89.6 "epic" (+62.3), Trestles -42.5, signed BOTH ways;
  * the observation gate ran at the glyph surfaces and not here, so Moss Landing read 83.9 "good"
    on the map while the ungated lane said 95.9 "epic".

Every one of those was a second implementation of a shared idea. So these tests assert the two
surfaces call the SAME function on the SAME inputs, rather than each producing a plausible number.
"""
import ast
import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

_ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
_HUB = os.path.join(_ROOT, "services", "weather_pipeline", "spot_conditions.py")
_GLYPH = os.path.join(_ROOT, "services", "weather_pipeline", "spot_ratings.py")


def _src(p):
    return open(p, encoding="utf-8").read()


def test_both_surfaces_call_the_same_confidence_function():
    """MIRRORED, NOT RE-DERIVED — the ONE FORECAST COMPOSITION rule applied to confidence."""
    for path, name in ((_HUB, "spot_conditions"), (_GLYPH, "spot_ratings")):
        s = _src(path)
        assert "from services.weather_pipeline.forecast_spread import describe" in s, (
            f"{name} does not call forecast_spread.describe — if it computes a confidence some "
            "other way, the two surfaces will disagree about the same spot, which is exactly the "
            "defect class this file exists to prevent")


def test_both_surfaces_pair_the_spread_with_the_OFFSHORE_height():
    """⚠️ The recorded landmine, in a new place. Marine `point.speed` IS the offshore significant
    height. Dividing the spread by the BREAKING height would inflate the ratio by whatever the
    nearshore transform did — and would inflate it differently on each surface."""
    glyph = _src(_GLYPH)
    assert 'offshore_h = getattr(marine.point, "speed", None)' in glyph
    assert "_spread_describe(spread_m, offshore_h)" in glyph
    hub = _src(_HUB)
    assert 'current_waves.get("wave_height")' in hub, (
        "the hub no longer pairs the spread with its offshore wave_height")
    assert "surf_height" not in hub.split("_spread_describe(")[1].split(")")[0], (
        "the hub is dividing the spread by a breaking height — that ratio means nothing")


def test_the_hub_does_not_let_confidence_touch_the_rating():
    """Uncertainty is not quality. If `rating` were computed from or adjusted by the confidence, a
    groomed swell would score lower merely for being five days out."""
    hub = _src(_HUB)
    tree = ast.parse(hub)
    # the confidence must be attached AFTER the rating is set, and never feed compute_surf_rating
    for node in ast.walk(tree):
        if isinstance(node, ast.Call) and getattr(node.func, "id", "") == "compute_surf_rating":
            kwargs = {k.arg for k in node.keywords}
            for forbidden in ("spread", "spread_m", "forecast_confidence", "speed_spread"):
                assert forbidden not in kwargs, (
                    f"compute_surf_rating is being passed `{forbidden}` from the hub — the score is "
                    "being moved by uncertainty")


@pytest.mark.parametrize("site", ["grid", "fallback", "default"])
def test_every_waves_lane_defines_the_spread_key(site):
    """A key present on one lane and absent on another is how two code paths silently diverge — the
    lookup would return None on one and KeyError-or-default on the other."""
    hub = _src(_HUB)
    assert hub.count('"wave_height_spread"') >= 3, (
        "not every waves_data lane defines wave_height_spread; the grid lane, the open-meteo "
        f"fallback and the current-hour default must all set it (checking: {site})")


def test_the_fallback_lane_declares_None_rather_than_omitting_it():
    """The open-meteo point fallback has no ensemble. Writing None makes that explicit; omitting the
    key would make 'no ensemble on this lane' indistinguishable from 'nobody wired this lane'."""
    hub = _src(_HUB)
    assert '"wave_height_spread": None,' in hub


def test_the_block_is_absent_unless_it_binds():
    """ABSENT, not null — mirroring directional_conflict on this same surface. A caveat on every
    spot is a caveat nobody reads, and a null on every payload is bytes everybody downloads."""
    hub = _src(_HUB)
    assert 'if _fc:' in hub and 'current_conditions["forecast_confidence"] = _fc' in hub, (
        "the hub attaches the confidence unconditionally — it will now appear as null on every spot")


def test_a_deterministic_spot_yields_no_confidence_block():
    """END TO END on the pure path: no spread in, no block out. This is the state of EVERY spot
    today, since ECMWF_WAVE_ENSEMBLE is default off."""
    from services.weather_pipeline.forecast_spread import describe
    assert describe(None, 2.0) is None
    assert describe(None, None) is None


def test_an_ensemble_spot_yields_a_block_that_says_it_is_uncalibrated():
    from services.weather_pipeline.forecast_spread import describe
    d = describe(0.5, 2.0)
    assert d is not None and d["level"] == "moderate"
    assert d["calibrated"] is False, (
        "the hub would render this to a surfer — it must not imply a validated confidence")
