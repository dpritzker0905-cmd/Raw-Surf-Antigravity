"""The post composer's auto-fill reads the spot hub's composition (audit 15.0 A15-05(c), 2026-09-26).

`/api/surf-conditions` auto-fills a session in the post composer. Its breaking height already ran
`estimate_surf_at`, but from its OWN Open-Meteo marine fetch, so a post and the spot hub could record
different numbers for the same spot and hour, and the post carried no quality. Current-hour requests
now take surf + wind from the hub's producer (pipeline products -> estimate_surf_at ->
compute_surf_rating); tides stay NOAA; explicit hours and any failure keep the provider path.
"""
import asyncio
from datetime import datetime, timezone

import pytest

from services import surf_conditions as sc

HUB_CURRENT = {"wave_height_ft": 4.5, "offshore_height_ft": 4.4, "surf_regime": "shelf",
               "swell_height_ft": 3.2, "wave_period": 11.6, "wave_direction": 292.0,
               "wind_speed_kts": 10.0, "wind_direction": 45.0, "rating": 11.5, "rating_level": "very_poor"}


class _Resolver:
    def __init__(self, current=HUB_CURRENT, boom=False):
        self.current, self.boom, self.calls = current, boom, []

    async def resolve_spot_conditions(self, model, lat, lng, forecast_days=1, spot_id=None):
        self.calls.append((model, lat, lng))
        if self.boom:
            raise RuntimeError("resolver down")
        return {"current_conditions": dict(self.current)} if self.current is not None else {}


def _providers_must_not_run(monkeypatch):
    async def _no(*a, **k):
        raise AssertionError("the provider path ran although the pipeline answered")
    monkeypatch.setattr(sc, "get_surf_conditions", _no)
    monkeypatch.setattr(sc, "get_wind_conditions", _no)


def _stub_providers(monkeypatch, seen):
    async def surf(*a, **k):
        seen.append("surf")
        return {"source": "open-meteo", "wave_height_ft": 2.0}

    async def wind(*a, **k):
        seen.append("wind")
        return {"wind_speed_mph": 5.0, "wind_direction": "N"}
    monkeypatch.setattr(sc, "get_surf_conditions", surf)
    monkeypatch.setattr(sc, "get_wind_conditions", wind)


@pytest.fixture(autouse=True)
def _tides(monkeypatch):
    async def tide(station, **k):
        return {"source": "noaa", "tide_height_ft": 2.3, "tide_status": "rising"}
    monkeypatch.setattr(sc, "get_noaa_tide_data", tide)


def test_the_hub_producer_maps_onto_the_composer_fields():
    out = asyncio.run(sc.pipeline_current_conditions(36.95, -122.02, resolver=_Resolver()))
    assert out["source"] == "pipeline"
    assert out["wave_height_ft"] == 4.5 and out["offshore_height_ft"] == 4.4 and out["surf_regime"] == "shelf"
    assert out["wave_period_sec"] == 11 and out["wave_direction"] == "W" and out["wave_direction_degrees"] == 292.0
    assert out["wind_speed_mph"] == round(10.0 * 1.15078, 1) and out["wind_direction"] == "NE"
    assert (out["rating"], out["rating_level"]) == (11.5, "very_poor")


@pytest.mark.parametrize("resolver", [_Resolver(boom=True), _Resolver(current=None),
                                      _Resolver(current={"wave_period": 10.0})])
def test_no_answer_means_none_never_an_exception(resolver):
    assert asyncio.run(sc.pipeline_current_conditions(36.95, -122.02, resolver=resolver)) is None


def test_full_conditions_use_the_pipeline_and_keep_noaa_tides(monkeypatch):
    _providers_must_not_run(monkeypatch)
    override = asyncio.run(sc.pipeline_current_conditions(36.95, -122.02, resolver=_Resolver()))
    out = asyncio.run(sc.get_full_conditions(36.95, -122.02, "Steamer Lane", "9413745", current_override=override))
    assert out["wave_height_ft"] == 4.5 and out["surf_source"] == "pipeline"
    assert out["wind_speed_mph"] == round(10.0 * 1.15078, 1)
    assert (out["rating"], out["rating_level"]) == (11.5, "very_poor")
    assert out["tide_height_ft"] == 2.3 and out["tide_source"] == "noaa"


def test_an_explicit_hour_keeps_the_provider_path(monkeypatch):
    seen = []
    _stub_providers(monkeypatch, seen)
    override = {"source": "pipeline", "wave_height_ft": 4.5}
    out = asyncio.run(sc.get_full_conditions(36.95, -122.02, None, None,
                                             target_datetime=datetime(2026, 9, 20, 7, tzinfo=timezone.utc),
                                             current_override=override))
    assert seen == ["surf", "wind"] and out["wave_height_ft"] == 2.0 and out["surf_source"] == "open-meteo"


def test_no_override_keeps_the_provider_path(monkeypatch):
    seen = []
    _stub_providers(monkeypatch, seen)
    out = asyncio.run(sc.get_full_conditions(36.95, -122.02, None, None))
    assert seen == ["surf", "wind"] and out["surf_source"] == "open-meteo" and "rating" not in out


def test_the_route_asks_the_hub_first(monkeypatch):
    from routes.surf_spots import conditions as route
    resolver = _Resolver()
    real = sc.pipeline_current_conditions
    monkeypatch.setattr(sc, "pipeline_current_conditions",
                        lambda lat, lng, **k: real(lat, lng, resolver=resolver))
    _providers_must_not_run(monkeypatch)
    out = asyncio.run(route.get_surf_conditions(latitude=36.95, longitude=-122.02, spot_id=None,
                                                spot_name=None, db=None))
    assert resolver.calls == [("GFS", 36.95, -122.02)] and out["surf_source"] == "pipeline"


def test_the_named_spot_path_asks_the_hub_first(monkeypatch):
    resolver = _Resolver()
    real = sc.pipeline_current_conditions
    monkeypatch.setattr(sc, "pipeline_current_conditions",
                        lambda lat, lng, **k: real(lat, lng, resolver=resolver))
    _providers_must_not_run(monkeypatch)
    out = asyncio.run(sc.get_conditions_for_spot("pipeline"))
    assert len(resolver.calls) == 1 and out["surf_source"] == "pipeline"
