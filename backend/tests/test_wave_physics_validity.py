"""A SERVED WAVE MUST BE ABLE TO EXIST — and if it cannot, it must not claim authority.

Guards `services/weather_pipeline/wave_physics.py` and, critically, that it is REACHED from
`PointResolutionService.resolve_point` — the one method the ratings precompute, the spot hub, buoy
calibration and `/api/weather/point` all call.

⭐ THE REACHABILITY TEST IS THE POINT OF THIS FILE. This repo has shipped a guard with zero call
sites, and a guard that checked a REFERENCE while being unable to reach the defective surface
(2026-08-03, twice). A unit test on the predicate would pass in both of those worlds. So the last
test here drives `resolve_point` itself with an impossible point and asserts the flag comes back on
the response — the only assertion that can tell "implemented" from "wired".

⚠️ Built on the REAL `NormalizedPointResponse`, never a duck-typed stand-in: a guard built on
`SimpleNamespace` was green for 11 days in this repo while the real pydantic type raised.
"""
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import wave_physics as WP                       # noqa: E402
from services.weather_pipeline.schemas import (                                # noqa: E402
    NormalizedPointDetail, NormalizedPointResponse,
)

# Measured live 2026-08-04 on the served EURO wind_waves layer -- pairs that cannot occur.
IMPOSSIBLE = [
    ("Nusa Dua", 0.681, 1.27),
    ("Supersuck", 0.710, 0.89),
    ("Alotau Reef", 1.280, 0.09),
    ("Sloat Boulevard", 0.402, 1.30),
]

# ★ THE KNOWN-GOOD CONTROL, and it is the one that matters. Open-Meteo's own best_match publishes
# SHORT wind-wave periods that are entirely valid because the height is small. A range check on
# "period must be > 4 s" would reject every one of these. The physics does not.
VALID_SHORT_PERIOD = [
    ("open-meteo best_match wind wave", 0.16, 1.85),
    ("ripple", 0.05, 1.0),
    ("small windsea", 0.30, 3.0),
]

VALID_ORDINARY = [
    ("Pipeline groundswell", 1.469, 11.84),
    ("big long-period", 4.0, 18.0),
    ("Nusa Dua total field", 1.934, 14.78),
]


def _detail(speed, period):
    return NormalizedPointDetail(
        requested_lat=0.0, requested_lng=0.0, sampled_lat=0.0, sampled_lng=0.0,
        speed=speed, direction=90.0, u=0.0, v=0.0, period=period,
        interpolation_method="bilinear")


def _response(speed, period, layer="wind_waves", domain="marine"):
    return NormalizedPointResponse(
        model="EURO", provider="copernicus", domain=domain, layer=layer,
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=_detail(speed, period),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wind_wave_height", "wind_wave_period"], freshness_sec=1800)


# ── the law ─────────────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name,h,t", IMPOSSIBLE)
def test_pairs_measured_in_production_are_flagged(name, h, t):
    s = WP.steepness(h, t)
    assert s is not None and s > WP.STEEPNESS_BREAKING_LIMIT, f"{name}: steepness {s}"
    assert WP.is_physically_impossible(h, t)
    assert WP.WARNING_CODE in WP.describe(h, t)


@pytest.mark.parametrize("name,h,t", VALID_SHORT_PERIOD + VALID_ORDINARY)
def test_valid_seas_are_not_flagged(name, h, t):
    """The control that stops this becoming a range check. A 1.85 s wind wave at 0.16 m is real."""
    assert not WP.is_physically_impossible(h, t), f"{name} wrongly flagged"
    assert WP.describe(h, t) is None


def test_the_limit_is_the_breaking_limit_and_the_boundary_is_not_flagged():
    """Exactly at 1/7 is the limiting wave, not an impossible one -- only strictly above is."""
    t = 10.0
    h_at_limit = WP.STEEPNESS_BREAKING_LIMIT * WP.deep_water_wavelength_m(t)
    assert not WP.is_physically_impossible(h_at_limit, t)
    assert WP.is_physically_impossible(h_at_limit * 1.01, t)


@pytest.mark.parametrize("h,t", [(None, 5.0), (1.0, None), (0.0, 0.0), (0.0, 5.0), (1.0, 0.0),
                                (float("nan"), 5.0), (1.0, float("nan")), ("x", 5.0)])
def test_absent_or_degenerate_inputs_REFUSE_rather_than_accuse(h, t):
    """A check that cannot tell "not sampled" from "broken" must refuse. Zero height with zero
    period is the no-data signature `point_resolution` already owns -- not this module's business,
    and flagging it here would double-report one defect as two."""
    assert WP.steepness(h, t) is None
    assert WP.is_physically_impossible(h, t) is False
    assert WP.describe(h, t) is None


# ── the stamp, on the real model ────────────────────────────────────────────────────────────────

def test_stamp_marks_an_impossible_point_non_authoritative():
    r = _response(0.681, 1.27)
    assert r.is_forecast_authoritative is True and r.is_estimated is False and r.warnings == []
    out = WP.stamp_point_validity(r, "marine", "wind_waves")
    assert out.is_estimated is True
    assert out.is_forecast_authoritative is False
    assert len(out.warnings) == 1 and WP.WARNING_CODE in out.warnings[0]
    assert "0.681" in out.warnings[0] and "1.27" in out.warnings[0]


def test_stamp_leaves_a_valid_point_completely_untouched():
    r = _response(1.934, 14.78, layer="waves")
    out = WP.stamp_point_validity(r, "marine", "waves")
    assert out.is_estimated is False
    assert out.is_forecast_authoritative is True
    assert out.warnings == []


def test_stamp_is_idempotent():
    """Two passes must not stack duplicate warnings -- the response is post-processed more than once
    in some paths, and a duplicated warning reads as two defects."""
    r = _response(0.710, 0.89)
    WP.stamp_point_validity(r, "marine", "wind_waves")
    WP.stamp_point_validity(r, "marine", "wind_waves")
    assert len(r.warnings) == 1


@pytest.mark.parametrize("domain,layer", [("wind", "wind"), ("weather", "precipitation"),
                                          ("marine", "not_a_layer")])
def test_stamp_ignores_domains_and_layers_it_does_not_own(domain, layer):
    r = _response(0.681, 1.27, layer=layer, domain=domain)
    out = WP.stamp_point_validity(r, domain, layer)
    assert out.is_forecast_authoritative is True and out.warnings == []


def test_kill_switch_restores_previous_behaviour(monkeypatch):
    monkeypatch.setenv("MARINE_PHYSICS_VALIDITY", "0")
    r = _response(0.681, 1.27)
    out = WP.stamp_point_validity(r, "marine", "wind_waves")
    assert out.is_forecast_authoritative is True and out.is_estimated is False and out.warnings == []


def test_stamp_never_raises_on_a_malformed_response():
    """A validity check that can break a forecast is worse than the value it polices."""
    for junk in (None, object(), {"point": {"speed": 1.0}}, 42):
        assert WP.stamp_point_validity(junk, "marine", "waves") is junk


# ── ⭐ REACHABILITY: is it actually WIRED into the one method every consumer calls? ──────────────

async def test_resolve_point_actually_applies_the_stamp(monkeypatch):
    """The assertion a unit test cannot make. Drives `resolve_point` end to end with an impossible
    point and asserts the flag is on the RETURNED response.

    Both collaborators are stubbed so the test needs no network, no grid on disk, and no product
    store -- what is under test is the wiring, not the sampling."""
    from services.weather_pipeline import point_resolution as PR

    impossible = _response(1.280, 0.09)

    async def fake_internal(*a, **k):
        return impossible

    async def fake_augment(response, *a, **k):
        return response

    svc = PR.PointResolutionService.__new__(PR.PointResolutionService)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
    monkeypatch.setattr(PR, "augment_with_surf", fake_augment)

    out = await svc.resolve_point("EURO", "marine", "wind_waves", 0.0, 0.0, "2026-08-04T15:00:00Z")

    assert out.is_estimated is True, "resolve_point returned an impossible point still authoritative"
    assert out.is_forecast_authoritative is False
    assert any(WP.WARNING_CODE in w for w in out.warnings)


async def test_resolve_point_leaves_a_physical_point_authoritative(monkeypatch):
    """The paired control: the wiring must not flag everything it touches."""
    from services.weather_pipeline import point_resolution as PR

    fine = _response(1.934, 14.78, layer="waves")

    async def fake_internal(*a, **k):
        return fine

    async def fake_augment(response, *a, **k):
        return response

    svc = PR.PointResolutionService.__new__(PR.PointResolutionService)
    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
    monkeypatch.setattr(PR, "augment_with_surf", fake_augment)

    out = await svc.resolve_point("EURO", "marine", "waves", 0.0, 0.0, "2026-08-04T15:00:00Z")
    assert out.is_forecast_authoritative is True and out.warnings == []
