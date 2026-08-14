"""WS-CAN-0062 / WS-OBJ-207 — a rating must say what it was allowed to know.

THE DEFECT (Audit 12.1 LV-06, re-confirmed unchanged at HEAD by Audit 12.2):
`rate_one_spot` serves THREE orthogonal confidences and the only one that reaches a rendered
surface is the one that cannot see the forecast's inputs.

    confidence           grades the PIN     (accuracy_flag / is_verified_peak)  -> RENDERED
    geometry_readiness   grades the INPUTS  (full | degraded | blind)           -> mapped, dead
    forecast_confidence  grades the FORECAST(ensemble spread)                   -> absent unless binds

Live bbox n=24: geometry_readiness {full: 20, degraded: 4} against confidence {medium: 12, high: 11,
low: 1} — Kennedy Space Center (degraded) and Cape Canaveral (full) BOTH reported `medium`. A
post-12.0 census found 15 of 17 BLIND spots reporting `medium`, identical to full-geometry spots.

⛔ THE FIX IS NOT "make `confidence` a function of `geometry_readiness`". That collapses two
deliberately orthogonal axes (`spot_ratings.py` records the decision) and silently changes a served
field's meaning with nothing on the wire to distinguish the old semantic from the new — the
one-quantity-two-meanings class that has WS-CAN-0005 blocked. The disclosure is ADDITIVE, and it
goes in `why` because `why` is the only one of the three that a user reads today
(`MapMarkerLayers.js:285`) while the production frontend is frozen (WS-CAN-0039).

⚠️ These tests drive the REAL `rate_one_spot`. They do not assert on `inspect.getsource` — a source
string is not a behaviour, and this repo has been bitten by guards that graded text.
"""
import math
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse

# One real sea state, held constant across every case below, so the ONLY independent variable is
# the geometry verdict. Sebastian Inlet-ish: a clean 1.2 m / 13 s groundswell with light offshore.
LAT, LNG = 27.8608, -80.4478
SURF_H_M, PERIOD_S, SWELL_FROM = 1.2, 13.0, 80.0
SHORE_NORMAL, WIND_FROM, WIND_MS = 90.0, 270.0, 4.0


def _marine(readiness, shore_normal=SHORE_NORMAL):
    r = NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 8, 14, 6, 0, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=LAT, requested_lng=LNG, sampled_lat=LAT,
                                    sampled_lng=LNG, speed=1.6, period=PERIOD_S,
                                    direction=SWELL_FROM, interpolation_method="t"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800)
    r.surf_height_m = SURF_H_M
    r.shore_normal_deg = shore_normal
    r.geometry_readiness = readiness
    return r


def _wind():
    r = NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=datetime(2026, 8, 14, 6, 0, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 14, 12, 0, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=LAT, requested_lng=LNG, sampled_lat=LAT,
                                    sampled_lng=LNG, speed=WIND_MS, direction=WIND_FROM,
                                    interpolation_method="t"),
        value_kind="wind_speed", value_unit="m/s", display_unit_hint="kt",
        source_variables=["wind_speed_10m"], freshness_sec=1800)
    return r


class _Resolver:
    """The shape `PointResolutionService.resolve_point` produces, with the geometry verdict
    injected. Marine and wind are separate calls, exactly as the live path makes them."""

    def __init__(self, readiness, shore_normal=SHORE_NORMAL):
        self._readiness, self._shore_normal = readiness, shore_normal

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        if domain == "marine":
            return _marine(self._readiness, self._shore_normal)
        return _wind()


async def _rate(readiness, accuracy_flag="verified", is_verified_peak=True,
                shore_normal=SHORE_NORMAL):
    from services.weather_pipeline.spot_ratings import rate_one_spot
    spot = {"id": "sebastian-inlet", "name": "Sebastian Inlet", "latitude": LAT, "longitude": LNG,
            "accuracy_flag": accuracy_flag, "is_verified_peak": is_verified_peak}
    return await rate_one_spot(_Resolver(readiness, shore_normal), spot, "GFS",
                               "2026-08-14T12:00:00Z")


# ── THE DEFECT ──────────────────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
@pytest.mark.parametrize("readiness", ["blind", "degraded"])
async def test_a_spot_the_forecast_could_not_orient_says_so(readiness):
    """THE MISSION. A spot whose shore orientation is coarse or absent must disclose it on the
    surface a user reads. Known-bad: `why` reads "~3.9 ft surf, 13s period, 8kt offshore wind" —
    byte-identical to a full-geometry spot — while `confidence` reads "high" off the verified pin."""
    d = await _rate(readiness)
    assert d["geometry_readiness"] == readiness, "fixture did not reach the payload"
    why = d["why"] or ""
    assert why, "nothing to qualify — the fixture stopped producing a rating"
    full = (await _rate("full"))["why"] or ""
    assert why != full, (
        f"a {readiness!r}-geometry spot and a full-geometry spot produced BYTE-IDENTICAL user-facing "
        f"text ({why!r}). The forecast could not tell which way this beach faces, and the readout "
        f"does not say so.")


@pytest.mark.asyncio
async def test_the_verified_pin_still_reads_high__THE_CONTROL():
    """The pin axis is NOT what changed. `confidence` grades the pin and must keep grading only the
    pin — if this flips, two orthogonal axes have been collapsed and a served field has silently
    changed meaning (the one-quantity-two-meanings class that blocks WS-CAN-0005)."""
    for readiness in ("full", "degraded", "blind", None):
        d = await _rate(readiness)
        assert d["confidence"] == "high", (
            f"`confidence` moved to {d['confidence']!r} on {readiness!r} geometry. It grades the PIN "
            "(accuracy_flag/is_verified_peak) and nothing else; folding geometry into it destroys "
            "the distinction `geometry_readiness` exists to carry.")


# ── ABSENT UNLESS IT BINDS ──────────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_full_geometry_adds_nothing():
    """A caveat on every spot is a caveat nobody reads — the house rule `directional_conflict` and
    `forecast_confidence` already follow."""
    why = (await _rate("full"))["why"] or ""
    for noise in ("coarse", "unknown", "geometry", "orientation"):
        assert noise not in why.lower(), f"full geometry emitted a caveat ({why!r})"


@pytest.mark.asyncio
async def test_an_UNGRADED_spot_claims_nothing__REFUSE_DO_NOT_GUESS():
    """`geometry_readiness=None` means NOT ASSESSED — an older precomputed frame, or a resolve that
    failed. It does NOT mean full. Stamping either verdict onto an ungraded spot fabricates a
    measurement, which is the exact WS-OBJ-506 shape this program has closed three sites of."""
    why = (await _rate(None))["why"] or ""
    for noise in ("coarse", "unknown shore", "geometry"):
        assert noise not in why.lower(), (
            f"an UNGRADED spot was given a geometry verdict ({why!r}) — a check that cannot tell "
            "'not assessed' from 'assessed full' must refuse, not guess")


# ── THE SCIENCE MUST NOT MOVE ───────────────────────────────────────────────────────────────────

@pytest.mark.asyncio
async def test_the_score_and_level_are_IDENTICAL_across_every_verdict():
    """THE INVARIANT THAT MATTERS. This mission is a DISCLOSURE, not a correction. If the 0-100 or
    the level moves with the verdict, geometry has been folded into quality — a science change this
    mission is explicitly not authorized to make, and one that would make a coarsely-oriented spot
    score lower merely for being less well surveyed."""
    ref = await _rate("full")
    for readiness in ("degraded", "blind", None):
        d = await _rate(readiness)
        assert d["score"] == ref["score"], (
            f"score moved {ref['score']} -> {d['score']} on {readiness!r} geometry")
        assert d["level"] == ref["level"], (
            f"level moved {ref['level']!r} -> {d['level']!r} on {readiness!r} geometry")
        assert d["surf_height_m"] == ref["surf_height_m"], "the HEIGHT moved — this is not a disclosure"


@pytest.mark.asyncio
async def test_the_caveat_does_not_displace_what_why_already_said():
    """Additive. The wind/period/height text a user relies on must survive verbatim."""
    full = (await _rate("full"))["why"]
    blind = (await _rate("blind"))["why"]
    assert blind.startswith(full), (
        f"the geometry caveat rewrote the existing explanation rather than appending to it: "
        f"{full!r} -> {blind!r}")


@pytest.mark.asyncio
async def test_a_spot_with_nothing_to_rate_gets_no_caveat():
    """`why` is None when there is no height to explain. A caveat alone, with no rating to qualify,
    is a sentence about nothing."""
    from services.weather_pipeline.spot_ratings import rate_one_spot

    class _Empty:
        async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
            return None

    spot = {"id": "x", "name": "X", "latitude": LAT, "longitude": LNG,
            "accuracy_flag": "verified", "is_verified_peak": True}
    d = await rate_one_spot(_Empty(), spot, "GFS", "2026-08-14T12:00:00Z")
    assert d["why"] is None, f"a spot with no rating produced explanatory text: {d['why']!r}"


# ── ONE OWNER FOR THE VOCABULARY ────────────────────────────────────────────────────────────────

def test_the_readiness_vocabulary_has_ONE_owner():
    """`spot_geometry_readiness` already owns `full`/`degraded`/`blind` and their prose
    (`summarize`). A second module inventing its own phrasing is how two surfaces come to describe
    the same verdict differently (WS-OBJ-401)."""
    from services.weather_pipeline import spot_geometry_readiness as sgr
    assert hasattr(sgr, "caveat"), (
        "the caveat phrasing does not live beside `summarize` in the module that owns the verdict "
        "vocabulary")
    assert sgr.caveat(sgr.FULL) is None
    assert sgr.caveat(None) is None
    assert sgr.caveat("not-a-verdict") is None, "an unknown verdict must refuse, not guess"
    assert isinstance(sgr.caveat(sgr.BLIND), str) and sgr.caveat(sgr.BLIND)
    assert isinstance(sgr.caveat(sgr.DEGRADED), str) and sgr.caveat(sgr.DEGRADED)
    assert sgr.caveat(sgr.BLIND) != sgr.caveat(sgr.DEGRADED), (
        "blind and degraded are different failures — 'no orientation at all' and 'a coarse one' "
        "must not read the same")


def test_the_caveat_is_compact_enough_for_the_glyph_popup():
    """`why` renders in a 9px popup line at `MapMarkerLayers.js:280`. A paragraph there is a
    regression even if it is true — `summarize()` is the ADMIN-panel sentence, not this."""
    from services.weather_pipeline import spot_geometry_readiness as sgr
    for v in (sgr.BLIND, sgr.DEGRADED):
        assert len(sgr.caveat(v)) <= 40, f"{v}: {sgr.caveat(v)!r} is too long for the popup line"
        assert sgr.caveat(v) != sgr.summarize({"verdict": v}), (
            "the popup is being handed the admin-panel sentence")
