"""Regular direct-point serving exposes selected time/cycle without changing values or guards."""
import asyncio
import json
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.schemas import NormalizedPointResponse
from tests.test_estimator_direction_support import NOW, prepare_point

PATHS = [(model, domain, layer) for model in ("GFS", "ICON", "EURO")
         for domain, layer in [("marine", x) for x in ("waves", "swell_1", "swell_2", "wind_waves")]
         + [("wind", "wind"), ("weather", "pressure"), ("weather", "precipitation")]
         if not (model == "ICON" and layer == "swell_2")]
BUILDERS = [("GFS", "marine", "waves"), ("ICON", "wind", "wind"), ("EURO", "weather", "pressure")]


def stamp(date):
    return date.strftime("%Y-%m-%dT%H:%M:%SZ")


def prepare_direct(monkeypatch, model="GFS", domain="marine", layer="waves", minutes=0, fallback=False):
    rows, _, _, _ = prepare_point(monkeypatch, layer=layer if domain == "marine" else "waves")
    target = NOW + timedelta(hours=12)
    donor = rows[model]
    donor["hourly"]["time"] = [stamp(NOW), stamp(target + timedelta(minutes=minutes))]
    donor["hourly"].update({"wind_speed_10m": [14., 14.], "wind_direction_10m": [90., 90.],
                            "wind_gusts_10m": [20., 20.], "pressure_msl": [1012., 1012.],
                            "precipitation": [1.5, 1.5]})
    provider = SimpleNamespace(fetch_point=AsyncMock(return_value=donor),
                               MARINE_MODELS=OpenMeteoProvider.MARINE_MODELS,
                               FORECAST_MODELS=OpenMeteoProvider.FORECAST_MODELS)
    service = PointResolutionService(
        store=SimpleNamespace(get_manifest=Mock(return_value=SimpleNamespace(products=[]))),
        dynamic_index=SimpleNamespace(find_product_containing=Mock(return_value=None)), provider=provider)
    monkeypatch.setattr(service, "_resolve_partitions", AsyncMock(return_value=None))
    monkeypatch.setattr("services.copernicus_marine_service.fetch_euro_marine",
                        AsyncMock(return_value=[] if fallback else [donor]))

    def resolve():
        return asyncio.run(service.resolve_point(model, domain, layer, 0., 0., target.isoformat()))

    return donor, resolve, target, provider


@pytest.mark.parametrize("model,domain,layer", PATHS)
@pytest.mark.parametrize("hours", [-3, 0, 3])
def test_actual_serving_preserves_ask_and_serializes_selected_sample(monkeypatch, model, domain, layer, hours):
    donor, resolve, target, _ = prepare_direct(monkeypatch, model, domain, layer, minutes=hours * 60)
    donor["__model_run_time"] = stamp(NOW)
    result = resolve()
    body = result.model_dump(mode="json")
    assert body["valid_time"] == stamp(target)
    assert body["served_valid_time"] == stamp(target + timedelta(hours=hours))
    assert body["frame_offset_hours"] == hours
    assert body["frame_substituted"] is (hours != 0)
    assert result.model_run_time == NOW and result.model_run_time_status == "known"
    assert result.run_time != result.model_run_time
    assert body["source"] == "backend_direct_point" and not body["is_estimated"]
    assert body["is_forecast_authoritative"]
    assert result.grid_parity == ("point_only" if layer == "precipitation" else False)
    if domain == "marine":
        assert result.point.speed == {"GFS": 2., "ICON": 4., "EURO": 3.}[model]
        assert result.point.direction == 90. and result.point.period == 12.
        assert result.surf_height_m is not None
    elif domain == "wind":
        assert result.point.speed == 14. and result.point.direction == 90. and result.point.gust == 20.
    else:
        assert result.point.value == (1012. if layer == "pressure" else 1.5)


@pytest.mark.parametrize("model,domain,layer", BUILDERS)
@pytest.mark.parametrize("minutes,substituted", [(30, False), (31, True)])
def test_common_thirty_minute_threshold(monkeypatch, model, domain, layer, minutes, substituted):
    _, resolve, _, _ = prepare_direct(monkeypatch, model, domain, layer, minutes=minutes)
    result = resolve()
    assert result.frame_substituted is substituted
    assert result.frame_offset_hours == round(minutes / 60, 2)


@pytest.mark.parametrize("model,domain,layer", BUILDERS)
@pytest.mark.parametrize("cycle,status", [(None, "missing"), ("garbage", "invalid"),
                                         ("2026-09-20T00:00:00", "invalid"),
                                         ("2026-09-19T20:00:00-04:00", "known"), (False, "invalid")])
def test_cycle_requires_supplied_timezone_qualified_identity(monkeypatch, model, domain, layer, cycle, status):
    donor, resolve, target, _ = prepare_direct(monkeypatch, model, domain, layer)
    donor["__model_run_time"] = cycle
    donor["run_time"] = stamp(NOW)  # receipt/payload timestamps are never model cycle evidence
    result = resolve()
    assert result.model_run_time_status == status
    assert result.model_run_time == (NOW if status == "known" else None)
    assert result.served_valid_time == stamp(target)


@pytest.mark.parametrize("model,domain,layer", BUILDERS)
def test_time_selection_guard_still_refuses_beyond_three_hours(monkeypatch, model, domain, layer):
    _, resolve, _, _ = prepare_direct(monkeypatch, model, domain, layer, minutes=181)
    assert resolve().status_code == 404


@pytest.mark.parametrize("model,domain,layer", BUILDERS)
def test_provider_naive_hourly_samples_keep_existing_utc_semantics(monkeypatch, model, domain, layer):
    donor, resolve, target, _ = prepare_direct(monkeypatch, model, domain, layer, minutes=60)
    donor["hourly"]["time"] = [t.removesuffix("Z") for t in donor["hourly"]["time"]]
    result = resolve()
    assert result.served_valid_time == stamp(target + timedelta(hours=1))
    assert result.frame_offset_hours == 1. and result.frame_substituted


@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
@pytest.mark.parametrize("minutes", [-60, 60])
def test_native_euro_miss_stamps_actual_fallback_donor(monkeypatch, layer, minutes):
    donor, resolve, target, provider = prepare_direct(monkeypatch, "EURO", "marine", layer, minutes, fallback=True)
    donor["__model_run_time"] = stamp(NOW)
    result = resolve()
    assert result.is_estimated and not result.is_forecast_authoritative
    assert result.provider == ("open-meteo" if layer == "waves" else "gfs_estimated_fallback")
    assert result.fallback_reason == "copernicus_missing_fallback"
    assert result.served_valid_time == stamp(target + timedelta(minutes=minutes))
    assert result.frame_offset_hours == minutes / 60 and result.frame_substituted
    assert result.model_run_time == NOW and result.model_run_time_status == "known"
    assert provider.fetch_point.call_args.kwargs["model"] == ("EURO" if layer == "waves" else "GFS")
    assert result.point.speed == 3.


@pytest.mark.parametrize("height,period,status", [(None, 12., 404), (0., 0., 404), (0., 12., 200)])
def test_marine_no_data_and_true_calm_contracts_are_preserved(monkeypatch, height, period, status):
    donor, resolve, _, _ = prepare_direct(monkeypatch)
    donor["hourly"]["wave_height"][-1] = height
    donor["hourly"]["wave_period"][-1] = period
    result = resolve()
    assert (200 if isinstance(result, NormalizedPointResponse) else result.status_code) == status


def test_unsupported_icon_swell2_stays_unsupported_without_fetch(monkeypatch):
    _, resolve, _, provider = prepare_direct(monkeypatch, "ICON", "marine", "swell_2")
    result = resolve()
    assert result.status_code == 200
    body = json.loads(result.body)
    assert body["status"] == "unsupported" and not body["renderable"]
    assert not body["is_forecast_authoritative"]
    provider.fetch_point.assert_not_called()
