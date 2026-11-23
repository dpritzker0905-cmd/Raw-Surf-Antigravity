"""A sampler placeholder ("unavailable" / out-of-bounds zeros) is MISSING, never a measured zero (bug-hunt 2026-11-22, B).

The defect, measured on `dev` b7ef69f23 with the real `rate_one_spot` and `augment_with_surf`, 2 m @ 14 s at Pipeline:
a real 12 kt onshore wind gave 42.9 "fair"; the same hour with the wind sample "unavailable" (speed 0.0) gave 96.0 "epic",
because 0 kt grades as glassy. An "unavailable" marine sample gave 0 m of surf and `very_poor` instead of unknown.

With `RATING_MISSING_SAMPLE_UNKNOWN=1` a placeholder is treated exactly as a failed resolve (None):
  * wind  -> the engine's neutral for unknown wind (never glassy);
  * marine -> no surf height and no rating (score None, level "unknown").
ON by default since the owner's word 2026-11-22; the kill '0' restores the old reading byte-identically. Offline: no network, no credentials.
"""
import asyncio
from datetime import datetime, timezone

import pytest

from services.weather_pipeline import missing_sample
from services.weather_pipeline import spot_ratings as SRT
from services.weather_pipeline.point_surf_augment import augment_with_surf
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse

LAT, LNG = 21.6650, -158.0500          # Pipeline (the catalogue's pipeline sweep coordinate)
VT = "2026-11-22T12:00:00Z"
FLAG = missing_sample.FLAG


@pytest.fixture(autouse=True)
def _offline(monkeypatch):
    for k in ("SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "SUPABASE_KEY"):
        monkeypatch.setenv(k, "")
    # Inputs that would need I/O: held neutral so the test isolates the sample handling.
    for k in ("SURF_TIDE_DEPTH", "SURF_NEARSHORE_MOP", "RATING_TIDE", "SURF_FACE_RANGE"):
        monkeypatch.setenv(k, "0")


def _resp(domain, layer, speed, direction, period, method, lat=LAT, lng=LNG):
    return NormalizedPointResponse(
        model="GFS", provider="x", domain=domain, layer=layer,
        run_time=datetime(2026, 11, 22, 6, tzinfo=timezone.utc),
        valid_time=datetime(2026, 11, 22, 12, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, value_kind="x",
        value_unit="m" if domain == "marine" else "kn", display_unit_hint="x", source_variables=[], freshness_sec=0,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
                                    speed=speed, direction=direction, period=period, interpolation_method=method))


async def _no_partitions(*a, **k):
    return None


class _Resolver:
    """Hands back fixed marine and wind answers; marine goes through the real `augment_with_surf` as /point does."""

    def __init__(self, marine, wind):
        self.marine, self.wind = marine, wind

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        r = self.marine if domain == "marine" else self.wind
        if domain == "marine" and r is not None:
            r = await augment_with_surf(r.model_copy(deep=True), model, domain, layer, lat, lng, valid_time_str,
                                        _no_partitions)
        return r

    async def find_cached_grid_product(self, *a, **k):
        return None


def _rate(marine, wind, lat=LAT, lng=LNG):
    spot = {"id": "t", "name": "t", "latitude": lat, "longitude": lng}
    return asyncio.run(SRT.rate_one_spot(_Resolver(marine, wind), spot, "GFS", VT))


GOOD_MARINE = _resp("marine", "waves", 2.0, 315.0, 14.0, "bilinear")
ONSHORE_12KT = _resp("wind", "wind", 12.0, 315.0, None, "bilinear")


def _unavailable(domain, layer, method="unavailable"):
    return _resp(domain, layer, 0.0, 0.0, 0.0, method)


# ── the helper ──────────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("method,missing", [("unavailable", True), ("out_of_bounds_fallback", True),
                                            ("bilinear", False), ("nearest_ocean_fallback", False),
                                            ("exact_match", False)])
def test_is_missing_names_only_the_zero_placeholders(method, missing):
    assert missing_sample.is_missing(_resp("wind", "wind", 0.0, 0.0, 0.0, method)) is missing


def test_skip_is_on_by_default_and_the_kill_turns_it_off(monkeypatch):
    # ON by the owner's typed word 2026-11-22 ("Yes, ship #1181 on"); the kill switch is '0'.
    monkeypatch.delenv(FLAG, raising=False)
    assert missing_sample.skip(_unavailable("wind", "wind")) is True
    monkeypatch.setenv(FLAG, "0")
    assert missing_sample.skip(_unavailable("wind", "wind")) is False


# ── flag ON: the fix ────────────────────────────────────────────────────────────────────────────────────────────────
# Two shores with different normals (SubQ review 2026-11-23: one coordinate was a modest gap). Swell arrives head-on at
# each, so the sea is rated; the shore normals come from the served geometry (Pipeline 325 deg, Cocoa Beach 93 deg).
SHORES = [pytest.param(LAT, LNG, 315.0, id="pipeline-nnw"), pytest.param(28.3200, -80.6000, 93.0, id="cocoa-east")]


@pytest.mark.parametrize("lat,lng,swell_from", SHORES)
@pytest.mark.parametrize("method", ["unavailable", "out_of_bounds_fallback"])
def test_missing_wind_is_never_glassy(monkeypatch, method, lat, lng, swell_from):
    monkeypatch.setenv(FLAG, "1")
    sea = _resp("marine", "waves", 2.0, swell_from, 14.0, "bilinear", lat, lng)
    missing = _rate(sea, _resp("wind", "wind", 0.0, 0.0, 0.0, method, lat, lng), lat, lng)
    failed = _rate(sea, None, lat, lng)            # a failed wind resolve: the engine's neutral wind
    glassy = _rate(sea, _resp("wind", "wind", 0.0, 0.0, None, "bilinear", lat, lng), lat, lng)   # a REAL measured calm
    assert glassy["score"] is not None             # the sea is rated here, so the comparison means something
    assert missing["score"] == failed["score"]
    assert missing["score"] < glassy["score"]      # no glassy credit for a sample that has no data


@pytest.mark.parametrize("method", ["unavailable", "out_of_bounds_fallback"])
def test_missing_marine_gives_no_height_and_no_rating(monkeypatch, method):
    monkeypatch.setenv(FLAG, "1")
    d = _rate(_unavailable("marine", "waves", method), ONSHORE_12KT)
    assert d["surf_height_m"] is None
    assert d["score"] is None
    assert d["level"] == "unknown"


def test_missing_marine_point_has_no_surf_height(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    r = asyncio.run(augment_with_surf(_unavailable("marine", "waves"), "GFS", "marine", "waves", LAT, LNG, VT,
                                      _no_partitions))
    assert r.surf_height_m is None


def test_a_failed_marine_resolve_gives_no_rating(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    d = _rate(None, ONSHORE_12KT)
    assert d["score"] is None and d["level"] == "unknown"


def test_real_samples_are_untouched_when_on(monkeypatch):
    monkeypatch.setenv(FLAG, "0")
    off = _rate(GOOD_MARINE, ONSHORE_12KT)
    monkeypatch.setenv(FLAG, "1")
    on = _rate(GOOD_MARINE, ONSHORE_12KT)
    assert on["score"] == off["score"] and on["surf_height_m"] == off["surf_height_m"]


# ── flag OFF: byte-identical to before (the defect stays reproducible behind the switch) ─────────────────────────────
def test_off_keeps_the_old_reading(monkeypatch):
    monkeypatch.setenv(FLAG, "0")
    old_wind = _rate(GOOD_MARINE, _unavailable("wind", "wind"))
    calm = _rate(GOOD_MARINE, _resp("wind", "wind", 0.0, 0.0, 0.0, "bilinear"))
    assert old_wind["score"] == calm["score"]            # off: the placeholder still reads as 0 kt
    old_marine = _rate(_unavailable("marine", "waves"), ONSHORE_12KT)
    assert old_marine["surf_height_m"] == 0.0


# ── the weather sim (reads /point JSON): the same rule ─────────────────────────────────────────────────────────────
def _sim(monkeypatch, wind_method):
    from services.weather_pipeline import sim_forecast as SF
    monkeypatch.setattr(SF, "_recall", lambda key: None)
    monkeypatch.setattr(SF, "_remember", lambda key, out: None)
    monkeypatch.setattr(SF, "_is_down", lambda: False)

    def fake_fetch(domain, layer, lat, lng, valid_time, *a, **k):
        if domain == "marine":
            return {"point": {"speed": 2.0, "period": 14.0, "direction": 315.0, "interpolation_method": "bilinear"}}
        return {"point": {"speed": 0.0, "direction": 0.0, "interpolation_method": wind_method}}
    monkeypatch.setattr(SF, "fetch_point", fake_fetch)
    return SF.fetch_live_forecast(LAT, LNG, VT)


def test_sim_treats_a_placeholder_wind_as_no_data(monkeypatch):
    monkeypatch.setenv(FLAG, "1")
    baseline, info = _sim(monkeypatch, "unavailable")
    assert baseline is None and "no wind data" in info["reason"]


def test_sim_off_keeps_the_old_reading(monkeypatch):
    monkeypatch.setenv(FLAG, "0")
    baseline, _ = _sim(monkeypatch, "unavailable")
    assert baseline is not None and baseline["wind_speed_knots"] == 0.0


# ── the placeholder tally (the committed follow-up: how often production serves a placeholder) ─────────────────────
def test_tally_counts_every_rated_input_whatever_the_flag(monkeypatch):
    for value in ("0", "1"):
        monkeypatch.setenv(FLAG, value)
        missing_sample.reset_tally()
        _rate(GOOD_MARINE, _unavailable("wind", "wind"))
        _rate(_unavailable("marine", "waves", "out_of_bounds_fallback"), ONSHORE_12KT)
        _rate(GOOD_MARINE, None)
        t = missing_sample.tally_summary()
        assert t["GFS/marine"] == {"total": 3, "placeholder": 1, "none": 0, "out_of_bounds_fallback": 1,
                                   "share": round(1 / 3, 6)}
        assert t["GFS/wind"] == {"total": 3, "placeholder": 1, "none": 1, "unavailable": 1, "share": round(1 / 3, 6)}


def test_precompute_report_writes_the_step_summary(monkeypatch, tmp_path):
    import importlib
    import sys
    sys.path.insert(0, str(__import__("pathlib").Path(__file__).resolve().parents[1] / "scripts"))
    pc = importlib.import_module("precompute_ci")
    missing_sample.reset_tally()
    _rate(GOOD_MARINE, _unavailable("wind", "wind"))
    out = tmp_path / "summary.md"
    monkeypatch.setenv("GITHUB_STEP_SUMMARY", str(out))
    pc._report_placeholder_tally()
    text = out.read_text(encoding="utf-8")
    assert "Placeholder samples" in text and "| GFS/wind | 1 | 1 | 100.0000% | 0 |" in text
