"""Spot-hub phase 2 (SPOT_HUB_RATE_ONE_SPOT, ON by default, '0' kills): the hub on THE ONE composition.

Pins three things:
  1. PARITY: with the flag on, the hub, /point-rating and /spot-ratings give the IDENTICAL height and rating for
     the same spot and hour, on both lanes (the glyph's precomputed frame, and the live `rate_one_spot`).
  2. M1: a daily row is the spot's LOCAL day and the real max / min over its frames, not one 12:00 UTC sample
     labelled "max" with min = 0.6 x max.
  3. KILL SWITCH ('0'): the hub payload is byte-identical to the chain it always ran, and the routes call it
     exactly as before (no new kwargs reach a killed call). Unset is ON (owner policy 2026-11-04 ~01:41Z).
"""
import json
import math
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import point_rating as PR  # noqa: E402
from services.weather_pipeline import rating_confirmation as RC  # noqa: E402
from services.weather_pipeline import spot_conditions as SC  # noqa: E402
from services.weather_pipeline import spot_hub_composition as HUB  # noqa: E402
from services.weather_pipeline import spot_ratings as SPR  # noqa: E402
from services.weather_pipeline.schemas import NormalizedPointDetail, NormalizedPointResponse  # noqa: E402
from services.weather_pipeline.spot_ratings_precompute import select_precomputed_laddered  # noqa: E402

NOW = datetime(2026, 11, 3, 17, 20, tzinfo=timezone.utc)
TRESTLES = {"id": "trestles", "name": "Lower Trestles", "latitude": 33.3819, "longitude": -117.5885,
            "accuracy_flag": "verified", "is_verified_peak": True, "best_tide": None}


def _height_at(dt: datetime) -> float:
    """A sea that peaks at 21Z (13:00 solar local at -117.6) and is smallest at 09Z, so a 12Z sample is wrong."""
    return round(1.3 + 0.3 * math.cos(2 * math.pi * (dt.hour - 21) / 24.0), 4)


class FakeResolver:
    """`resolve_point` as the point lane answers it; no cached grids (so primary swell is honestly unknown)."""

    def __init__(self):
        self.calls = []

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        self.calls.append((domain, valid_time_str))
        dt = datetime.fromisoformat(valid_time_str.replace("Z", "+00:00"))
        if domain == "marine":
            h = _height_at(dt)
            r = NormalizedPointResponse(
                model=model, provider="test", domain="marine", layer="waves", run_time=dt - timedelta(hours=6),
                valid_time=dt, is_forecast_authoritative=True, is_estimated=False,
                point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                            sampled_lng=lng, interpolation_method="nearest",
                                            speed=h * 0.9, direction=265.0, period=13.0 + dt.hour / 24.0),
                value_kind="wave", value_unit="m", display_unit_hint="ft", source_variables=["wave_height"],
                freshness_sec=3600)
            r.surf_height_m = h + 0.01234            # NOT a round number: the 0.1 ft pre-rounding would show
            r.surf_regime = "breaking"
            r.shore_normal_deg = 219.0
            return r
        return NormalizedPointResponse(
            model=model, provider="test", domain="wind", layer="wind", run_time=dt - timedelta(hours=6),
            valid_time=dt, is_forecast_authoritative=True, is_estimated=False,
            point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat, sampled_lng=lng,
                                        interpolation_method="nearest", speed=6.0 + dt.hour % 5, direction=40.0),
            value_kind="wind", value_unit="kn", display_unit_hint="kn", source_variables=["wind"],
            freshness_sec=3600)

    async def find_cached_grid_product(self, *a, **k):
        return None


def _fake_gate(score, *a):
    """The single-model cap (69.9 unless confirmed) without the network read of the confirmation object."""
    from services.weather_pipeline.surf_rating import score_to_level
    if score is None:
        return None, None, None, None
    gated = min(score, 69.9) if score >= 70 else score
    return gated, score_to_level(gated), None, round(float(score), 1)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("SPOT_HUB_RATE_ONE_SPOT", "RATING_TIDE", "RATING_BREAKER_TYPE", "RATING_LOCAL_SIZE",
              "SURF_PARTITIONS", "SURF_STRICT_AVAILABILITY", "SURF_REQUESTED_HORIZON"):
        monkeypatch.delenv(k, raising=False)
    # The real gate reads the L2 ratings object over the network; the cap itself is pinned elsewhere.
    monkeypatch.setattr(RC, "gate_single_model_surface", _fake_gate)
    HUB.clear_caches()
    PR._CACHE.clear()
    yield
    HUB.clear_caches()
    PR._CACHE.clear()


async def _hub(resolver, horizon_hours=None, forecast_days=11, load_l2=lambda: None, spot=TRESTLES):
    return await HUB.resolve_hub_conditions(resolver, "GFS", spot["latitude"], spot["longitude"], forecast_days,
                                            spot_id=spot["id"], spot_meta=spot, horizon_hours=horizon_hours,
                                            now=NOW, load_l2=load_l2)


# ── 1. PARITY ──────────────────────────────────────────────────────────────────────────────────────────────

async def test_live_lane_hub_equals_point_rating_equals_rate_one_spot(monkeypatch):
    """Same spot, same hour, no precomputed frame: all three surfaces answer with the same height and rating."""
    res = FakeResolver()
    hub = await _hub(res, forecast_days=1)
    vt = HUB.valid_time_str(HUB.current_valid_time(NOW))
    cur = hub["current_conditions"]

    ref = await SPR.rate_one_spot(res, dict(TRESTLES), "GFS", vt)            # what /spot-ratings' live lane rates
    pr_item, pr_source, _ = await PR.rate_point(res, TRESTLES["latitude"], TRESTLES["longitude"], "GFS", vt,
                                                load_l2=lambda: None)
    assert pr_source == "live"
    assert cur["surf_height_m"] == ref["surf_height_m"] == pr_item["surf_height_m"]
    gated = min(ref["score"], 69.9) if ref["score"] >= 70 else ref["score"]
    assert cur["rating"] == pr_item["score"] == gated
    assert cur["rating_level"] == pr_item["level"]
    assert cur["rating_raw"] == round(ref["score"], 1), "the ungated score stays auditable"
    assert cur["rating_source"] == "live" and cur["valid_time"] == vt


async def test_precomputed_lane_hub_serves_the_glyph_item_verbatim(monkeypatch):
    """A catalogued spot in the glyph's frame: the hub, /point-rating and /spot-ratings serve ONE item."""
    vt = HUB.valid_time_str(HUB.current_valid_time(NOW))
    item = {"spot_id": "trestles", "name": "Lower Trestles", "latitude": TRESTLES["latitude"],
            "longitude": TRESTLES["longitude"], "score": 61.3, "level": "fair_good", "confidence": "high",
            "surf_height_m": 1.437, "period_s": 14.2, "swell_from_deg": 262.0, "offshore_hs_m": 1.21,
            "primary_swell_hs_m": None, "tide": {"height_m": 0.4, "norm": 0.6, "trend": "rising"},
            "why": "~4.7 ft surf", "confirmed": "good", "raw_score": 61.3}
    obj = {"frames": [{"model": "GFS", "valid_time": vt, "spots": [item]}]}
    res = FakeResolver()
    hub = await _hub(res, forecast_days=1, load_l2=lambda: obj)
    cur = hub["current_conditions"]
    pr_item, pr_source, _ = await PR.rate_point(res, TRESTLES["latitude"], TRESTLES["longitude"], "GFS", vt,
                                                load_l2=lambda: obj)
    glyph = select_precomputed_laddered(obj, (-117.6, 33.37, -117.58, 33.39), "GFS", vt)[0][0]
    assert pr_source == "precomputed" and pr_item is glyph
    assert (cur["surf_height_m"], cur["rating"], cur["rating_level"]) == (1.437, 61.3, "fair_good")
    assert cur["rating_source"] == "precomputed" and cur["tide"] == item["tide"]
    assert ("marine", vt) not in res.calls, "a precomputed frame must not be re-rated"
    assert cur["wind_speed_kts"] is not None, "the display wind is resolved once, beside the glyph's verdict"


async def test_the_tide_and_breaker_terms_reach_the_hub(monkeypatch):
    """The old hub left out tide_norm, best_tide and breaker_xi. With the spot's own dict they are the glyph's."""
    monkeypatch.setenv("RATING_TIDE", "1")

    async def fake_tide(lat, lng, vt):
        return {"height_m": 0.1, "norm": 0.05, "trend": "falling"}
    import services.weather_pipeline.tide as T
    monkeypatch.setattr(T, "tide_norm_at", fake_tide)
    spot = dict(TRESTLES, best_tide="high")
    res = FakeResolver()
    hub = await _hub(res, forecast_days=1, spot=spot)
    vt = HUB.valid_time_str(HUB.current_valid_time(NOW))
    ref = await SPR.rate_one_spot(res, dict(spot), "GFS", vt)
    no_tide = await SPR.rate_one_spot(res, dict(spot, best_tide=None), "GFS", vt)
    assert ref["score"] != no_tide["score"], "SETUP: the tide term must bind here or this asserts nothing"
    assert hub["current_conditions"]["rating_raw"] == round(ref["score"], 1)
    assert hub["current_conditions"]["tide"]["trend"] == "falling"


async def test_every_forecast_frame_is_rate_one_spot_at_its_hour():
    """The daily max is the max of rate_one_spot over the day's frames, recomputed independently here."""
    res = FakeResolver()
    hub = await _hub(res, horizon_hours=72, forecast_days=4)
    off = HUB.solar_utc_offset_hours(TRESTLES["longitude"])
    for row in hub["forecast"]:
        if row["status"] != "available":
            continue
        frames = [t for t in HUB.frame_plan(TRESTLES["longitude"], NOW, 72)
                  if HUB.local_date(t, off).isoformat() == row["date"]]
        rated = [await SPR.rate_one_spot(res, dict(TRESTLES), "GFS", HUB.valid_time_str(t)) for t in frames]
        assert row["frames_rated"] == len(rated) > 0
        assert row["surf_height_max_m"] == max(r["surf_height_m"] for r in rated)
        assert row["surf_height_min_m"] == min(r["surf_height_m"] for r in rated)
        best = max(r["score"] for r in rated)
        assert row["rating"] == (min(best, 69.9) if best >= 70 else best)


# ── 2. M1: the LOCAL day and the real max ─────────────────────────────────────────────────────────────────

async def test_a_daily_row_is_not_the_12z_sample():
    res = FakeResolver()
    hub = await _hub(res, horizon_hours=72, forecast_days=3)
    row = hub["forecast"][0]
    off = HUB.solar_utc_offset_hours(TRESTLES["longitude"])
    assert off == -8 and row["utc_offset_hours"] == -8
    assert row["date"] == ((NOW + timedelta(hours=off)).date() + timedelta(days=1)).isoformat() == "2026-11-04"
    twelve_z = _height_at(datetime(2026, 11, 4, 12, tzinfo=timezone.utc)) + 0.01234
    assert row["surf_height_max_m"] > twelve_z, "the max must be the day's peak, not the 12:00 UTC instant"
    assert row["wave_height_min"] != round(row["wave_height_max"] * 0.6, 1), "min is measured, not 0.6 x max"
    assert row["frames_rated"] == 8 and row["sample_basis"] == "3-hourly"
    assert row["max_time"] == "2026-11-04T21:00:00Z"


def test_the_frame_plan_is_3_hourly_to_72h_then_three_local_day_parts():
    plan = HUB.frame_plan(-117.5885, NOW, 14 * 24)
    assert all(t.hour % 3 == 0 and t.minute == 0 for t in plan)
    assert plan[0] > NOW and plan[-1] <= NOW + timedelta(hours=336)
    dense = [t for t in plan if t <= NOW + timedelta(hours=72)]
    assert len(dense) == 24 and all((b - a) == timedelta(hours=3) for a, b in zip(dense, dense[1:]))
    later = [t for t in plan if t > NOW + timedelta(hours=72)]
    per_day = {}
    for t in later:
        per_day.setdefault(HUB.local_date(t, -8), []).append((t - timedelta(hours=8)).hour)
    full = [v for v in per_day.values() if len(v) == 3]
    # Local 06/12/18 solar, each snapped to the 3-hourly UTC grid the products sit on (here 07/13/19).
    assert len(full) >= 9 and all(all(abs(h - w) <= 1.5 for h, w in zip(v, (6, 12, 18))) for v in full), per_day
    assert len(plan) <= 60, "about 60 frames per spot to +336 h (the research budget)"


def test_the_plan_never_reaches_past_the_tier_window():
    plan = HUB.frame_plan(150.0, NOW, 72)
    assert plan and max(plan) <= NOW + timedelta(hours=72)


async def test_rows_beyond_the_tier_window_are_named_not_computed():
    from services.forecast_tier_window import apply_tier_window
    res = FakeResolver()
    hub = await _hub(res, horizon_hours=72)
    assert len(hub["forecast"]) == 10
    assert all(datetime.fromisoformat(vt.replace("Z", "+00:00")) <= NOW + timedelta(hours=72)
               for d, vt in res.calls if d == "marine")
    tail = hub["forecast"][-1]
    assert tail["status"] == "not_computed" and tail["wave_height_max"] is None
    payload = {"forecast": hub["forecast"]}
    apply_tier_window(payload, "free", "GFS", now=NOW)
    assert tail["date"] in payload["forecast_locked_dates"]


async def test_a_frame_that_fails_is_unknown_never_zero(monkeypatch):
    res = FakeResolver()

    async def broken(*a, **k):
        raise RuntimeError("no product")
    monkeypatch.setattr(res, "resolve_point", broken)
    hub = await _hub(res, horizon_hours=72, forecast_days=2)
    assert hub["current_conditions"]["wave_height_ft"] is None
    assert hub["current_conditions"]["label"] == "Unavailable"
    assert hub["forecast"][0]["status"] == "no_data" and hub["forecast"][0]["wave_height_max"] is None


async def test_one_build_serves_concurrent_and_repeat_viewers():
    """N viewers of one spot in one hour cost ONE build (the 1-CPU box), each getting its own copy."""
    import asyncio
    res = FakeResolver()
    a, b = await asyncio.gather(_hub(res, horizon_hours=72), _hub(res, horizon_hours=72))
    n = len(res.calls)
    c = await _hub(res, horizon_hours=72)
    assert len(res.calls) == n, "a repeat inside the hour must not resolve again"
    assert a == b == c and a is not b
    a["forecast"].clear()
    assert (await _hub(res, horizon_hours=72))["forecast"], "a caller mutating its copy must not reach the cache"
    marine = sum(1 for d, _ in res.calls if d == "marine")
    assert marine == 1 + len([t for t in HUB.frame_plan(TRESTLES["longitude"], NOW, 72)
                              if HUB.local_date(t, -8) >= (NOW - timedelta(hours=8)).date() + timedelta(days=1)])


def test_the_wind_word_is_the_why_texts_word():
    assert SPR.wind_relation(40.0, 219.0) == "offshore"
    assert SPR.wind_relation(219.0, 219.0) == "onshore"
    assert SPR.wind_relation(129.0, 219.0) == "cross-shore"
    assert "offshore" in SPR.rating_why("fair", 1.0, 10.0, 5.0, 40.0, 219.0)


# ── 3. FLAG OFF: nothing moves ────────────────────────────────────────────────────────────────────────────

class _Prod(SimpleNamespace):
    pass


class LegacyResolver:
    """The cached-grid lane the old hub samples: a product per layer, a fixed point, one wind resolve."""

    def __init__(self):
        self.sampler = SimpleNamespace(sample_point=self._sample)
        self.provider = SimpleNamespace(fetch_point=self._no_fetch)

    async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
        return _Prod(layer=layer, value_unit="m", estimate_basis=None, product_id=f"p-{layer}",
                     upstream_provider="noaa", source_dataset="gfswave", dt=dt)

    def _sample(self, prod, lat, lng):
        h = 1.3 if prod.layer == "waves" else 0.9
        return SimpleNamespace(point=SimpleNamespace(speed=h + prod.dt.day / 100.0, direction=262.0, period=13.0,
                                                     interpolation_method="bilinear", is_valid=True,
                                                     speed_spread=None))

    async def _no_fetch(self, **k):
        raise AssertionError("no cache miss expected")

    async def resolve_point(self, model, domain, layer, lat, lng, valid_time_str):
        return SimpleNamespace(point=SimpleNamespace(speed=7.0, direction=45.0))


class _Frozen(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


async def _legacy(**extra):
    return await SC.resolve_spot_conditions_impl(LegacyResolver(), "GFS", TRESTLES["latitude"],
                                                 TRESTLES["longitude"], 11, spot_id="trestles", **extra)


async def test_flag_off_is_byte_identical(monkeypatch):
    monkeypatch.setattr(SC, "datetime", _Frozen)
    monkeypatch.setenv("SPOT_HUB_RATE_ONE_SPOT", "0")
    base = json.dumps(await _legacy(), sort_keys=True, default=str)
    explicit_off = json.dumps(await _legacy(), sort_keys=True, default=str)
    with_kwargs = json.dumps(await _legacy(spot_meta=dict(TRESTLES), horizon_hours=72), sort_keys=True,
                             default=str)
    assert base == explicit_off == with_kwargs
    payload = json.loads(base)
    assert "composition" not in payload and len(payload["forecast"]) == 10
    assert payload["forecast"][0]["wave_height_min"] == round(payload["forecast"][0]["wave_height_max"] * 0.6, 1), (
        "SETUP: the legacy chain is what ran (min = 0.6 x max)")


@pytest.mark.parametrize("value", [None, "1"])
async def test_unset_or_any_non_kill_value_takes_the_one_composition_path(monkeypatch, value):
    """ON BY DEFAULT: only an explicit '0' restores the old chain."""
    if value is not None:
        monkeypatch.setenv("SPOT_HUB_RATE_ONE_SPOT", value)
    seen = {}

    async def fake(resolver, model, lat, lng, forecast_days=11, **kw):
        seen.update(kw, forecast_days=forecast_days)
        return {"current_conditions": {}, "forecast": [], "composition": {"flag": HUB.FLAG}}
    monkeypatch.setattr(HUB, "resolve_hub_conditions", fake)
    out = await _legacy(spot_meta=dict(TRESTLES), horizon_hours=72)
    assert out["composition"]["flag"] == "SPOT_HUB_RATE_ONE_SPOT"
    assert seen == {"spot_id": "trestles", "spot_meta": TRESTLES, "horizon_hours": 72, "forecast_days": 11}


def test_routes_send_no_new_kwargs_under_the_kill_switch(monkeypatch):
    spot = SimpleNamespace(**TRESTLES)
    monkeypatch.setenv("SPOT_HUB_RATE_ONE_SPOT", "0")
    assert HUB.call_kwargs(spot, 72) == {}
    monkeypatch.delenv("SPOT_HUB_RATE_ONE_SPOT")
    kw = HUB.call_kwargs(spot, 72)
    assert kw["horizon_hours"] == 72 and kw["spot_meta"]["best_tide"] is None
    assert set(kw["spot_meta"]) == {"id", "name", "latitude", "longitude", "accuracy_flag", "is_verified_peak",
                                    "best_tide"}, "the same keys /spot-ratings gives rate_one_spot"


def test_the_flag_is_declared_on_with_a_render_kill_switch():
    from routes.admin.surf_forecast import _RATING_FLAGS
    default, _why, lane = _RATING_FLAGS["SPOT_HUB_RATE_ONE_SPOT"][:3]
    assert default == "1" and lane == "Render env"


# ── 4. THE DEFAULT PATH THROUGH THE ROUTES (ON by default; the legacy files pin the kill switch) ─────────────

async def test_spot_details_sends_the_glyph_spot_and_the_tier_window_by_default(monkeypatch):
    """The full hub, default ON: the resolver gets the glyph's spot dict and the free 72 h window, and the
    route still withholds rows beyond the window (free = 72 h rolling, basic 7 d, premium 14 d)."""
    from unittest.mock import AsyncMock, Mock
    from routes.explore_discover import spot_details as route
    monkeypatch.delenv("SPOT_FORECAST_TIER_HORIZON", raising=False)
    spot = SimpleNamespace(id="tier-spot", name="Tier beach", region="Coast", difficulty=None, image_url=None,
                           latitude=28.4, longitude=-80.6, description=None, best_tide="mid",
                           accuracy_flag="verified", is_verified_peak=True)
    first = Mock()
    first.scalar_one_or_none.return_value = spot
    empty = Mock()
    empty.scalars.return_value.all.return_value = []
    db = SimpleNamespace(execute=AsyncMock(side_effect=[first, empty, empty, empty, empty]))
    rows = [{"date": (NOW.date() + timedelta(days=i)).isoformat(), "wave_height_max": 3.0} for i in range(1, 11)]
    resolver = AsyncMock(return_value={"current_conditions": {"wave_height_ft": 2.0}, "forecast": rows})
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    from services import forecast_tier_window as W
    real_split = W.split_forecast_rows
    monkeypatch.setattr(W, "split_forecast_rows", lambda r, hours, now=None: real_split(r, hours, NOW))
    for tier, hours in (("free", 72), ("basic", 168), ("premium", 336)):
        resolver.reset_mock()
        db.execute = AsyncMock(side_effect=[first, empty, empty, empty, empty])
        out = await route.get_spot_details("tier-spot", subscription_tier=tier, model="GFS", db=db)
        kw = resolver.await_args.kwargs
        assert kw["horizon_hours"] == min(hours, W.tier_horizon_hours("premium", "GFS"))
        assert kw["spot_meta"] == {"id": "tier-spot", "name": "Tier beach", "latitude": 28.4, "longitude": -80.6,
                                   "accuracy_flag": "verified", "is_verified_peak": True, "best_tide": "mid"}
        assert out["forecast_horizon_hours"] == kw["horizon_hours"]
    assert out["forecast_status"] == "ready"


async def test_the_drawer_route_sends_the_glyph_spot_by_default(monkeypatch):
    from unittest.mock import AsyncMock, Mock
    from routes.surf_data import conditions as route
    spot = SimpleNamespace(**TRESTLES)
    first = Mock()
    first.scalar_one_or_none.return_value = spot
    db = SimpleNamespace(execute=AsyncMock(return_value=first))
    resolver = AsyncMock(return_value={"forecast": []})
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    await route.get_spot_forecast("trestles", days=3, model="GFS", db=db)
    assert resolver.await_args.kwargs["spot_meta"]["best_tide"] is None
    assert "horizon_hours" not in resolver.await_args.kwargs, "the drawer applies its window client-side"


async def test_the_spots_own_size_reference_reaches_every_frame(monkeypatch):
    """RATING_LOCAL_SIZE: the hub grades against the spot's own good day, as the glyph does."""
    monkeypatch.setenv("RATING_LOCAL_SIZE", "1")
    import services.weather_pipeline.spot_size_climatology as C
    monkeypatch.setattr(C, "reference_for_spot", lambda sid: 1.37 if sid == "trestles" else None)
    seen = []
    real = SPR.rate_one_spot

    async def spy(resolver, spot, model, vt, reference_size_m=None):
        seen.append(reference_size_m)
        return await real(resolver, spot, model, vt, reference_size_m=reference_size_m)
    monkeypatch.setattr(SPR, "rate_one_spot", spy)
    await _hub(FakeResolver(), horizon_hours=72, forecast_days=2)
    assert seen and set(seen) == {1.37}
