"""SH01: actual shared producer, frozen clock, cached/direct offline dependency seams."""
from datetime import datetime, timezone
from types import SimpleNamespace as S

import pytest
from services.weather_pipeline import spot_conditions as sc

NOW = datetime(2026, 10, 4, 12, tzinfo=timezone.utc)


class FrozenDatetime(datetime):
    @classmethod
    def now(cls, tz=None):
        return NOW if tz else NOW.replace(tzinfo=None)


class Resolver:
    def __init__(self, mode, height):
        self.mode, self.height = mode, height
        self.sampler = S(sample_point=self.sample)
        self.provider = S(fetch_point=self.fetch)
        self.wind_calls = 0

    async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
        if self.mode in ("missing", "direct_empty") or (self.mode == "current_only" and dt != NOW):
            return None
        return S(layer=layer, value_unit="m", estimate_basis=None, product_id="fixture.json",
                 upstream_provider="fixture", source_dataset="synthetic")

    def sample(self, product, lat, lng):
        return S(point=S(speed=self.height, direction=90, period=12,
                         is_valid=self.mode != "invalid",
                         interpolation_method="unavailable" if self.mode == "masked" else "bilinear"))

    async def fetch(self, **kw):
        if self.mode == "direct_empty":
            return {"hourly": {"time": [NOW.strftime('%Y-%m-%dT%H:%M:%SZ')], "wave_height": [], "wave_period": []}}
        return {}

    async def resolve_point(self, **kw):
        self.wind_calls += 1
        return S(point=S(speed=5, direction=270))


async def read(monkeypatch, mode, height, enabled="1"):
    monkeypatch.setenv("SURF_STRICT_AVAILABILITY", enabled)
    monkeypatch.setenv("SURF_PARTITIONS", "0")
    monkeypatch.setattr(sc, "datetime", FrozenDatetime)
    monkeypatch.setattr("services.weather_pipeline.rating_confirmation.gate_single_model_surface",
                        lambda score, *args: (score, "fair", True, score))
    resolver = Resolver(mode, height)
    result = await sc.resolve_spot_conditions_impl(resolver, "GFS", 28.3664, -80.6015, forecast_days=1)
    return result, resolver


@pytest.mark.asyncio
@pytest.mark.parametrize("mode,height", [("missing", None), ("direct_empty", None), ("cached", None),
                                        ("cached", float("nan")), ("cached", float("inf")),
                                        ("cached", -1), ("masked", 1), ("invalid", 1)])
async def test_missing_or_invalid_sea_is_unavailable(monkeypatch, mode, height):
    data, resolver = await read(monkeypatch, mode, height)
    current = data["current_conditions"]
    assert current["wave_height_ft"] is None and current["offshore_height_ft"] is None
    assert current["label"] == "Unavailable" and current["status"] == "no_data"
    assert current.get("rating") is None and resolver.wind_calls == 0
    for day in data["forecast"]:
        assert day["wave_height_min"] is None and day["wave_height_max"] is None
        assert day["label"] == "Unavailable" and day["status"] == "no_data"


@pytest.mark.asyncio
async def test_measured_calm_still_is_flat(monkeypatch):
    data, resolver = await read(monkeypatch, "cached", 0)
    assert data["current_conditions"]["wave_height_ft"] == 0
    assert data["current_conditions"]["label"] == "Flat" and resolver.wind_calls == 1
    assert all(day["wave_height_max"] == 0 and day["label"] == "Flat" for day in data["forecast"])


@pytest.mark.asyncio
async def test_current_sea_cannot_fill_missing_future_days(monkeypatch):
    data, _ = await read(monkeypatch, "current_only", 1.5)
    assert data["current_conditions"]["wave_height_ft"] > 0
    assert all(day["wave_height_max"] is None for day in data["forecast"])


@pytest.mark.asyncio
@pytest.mark.parametrize("enabled", ["0", "true"])
async def test_dark_switch_keeps_legacy_flat(monkeypatch, enabled):
    data, _ = await read(monkeypatch, "missing", None, enabled)
    assert data["current_conditions"]["wave_height_ft"] == 0
    assert data["current_conditions"]["label"] == "Flat"
