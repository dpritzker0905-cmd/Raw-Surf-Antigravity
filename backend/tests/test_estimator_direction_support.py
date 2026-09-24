"""Unresolved angular support must not become a valid north-facing forecast."""
import asyncio
from datetime import datetime, timedelta, timezone
import json
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest

from services.weather_pipeline import estimator
from services.weather_pipeline.lattice_fill import interpolate_between
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.surf_point import SurfGeometry
from services.weather_pipeline.spot_ratings import rate_one_spot

NOW = datetime(2026, 9, 20, tzinfo=timezone.utc)


@pytest.mark.parametrize("direction", [None, math.nan, math.inf, -math.inf, True, "90"])
def test_active_invalid_direction_refuses_the_blend(direction):
    assert estimator.blend_direction([2, 2], [90, direction], [.5, .5]) is None


@pytest.mark.parametrize("scale", [1e-9, 1, 1e9])
@pytest.mark.parametrize("delta", [-1e-8, 0, 1e-8])
def test_numerically_unresolved_resultant_is_scale_independent(scale, delta):
    assert estimator.blend_direction([2 * scale, (2 + delta) * scale], [0, 180], [.5, .5]) is None


@pytest.mark.parametrize("heights,directions,weights,expected", [
    ([2, 2], [0, 0], [.5, .5], 0),
    ([2, 2], [359, 1], [.5, .5], 0),
    ([2, 2], [90, math.inf], [1, 0], 90),
    ([2, 0], [90, math.inf], [.5, .5], 90),
    ([0, 0], [45, 90], [.5, .5], 45),
])
def test_direction_positive_and_inactive_support_controls(heights, directions, weights, expected):
    actual = estimator.blend_direction(heights, directions, weights)
    assert abs((actual - expected + 180) % 360 - 180) < 1e-10


def prepare_point(monkeypatch, *, layer="waves", icon=False, euro_h=3.0, target_h=2.0, target_hour=None):
    anchor = NOW + timedelta(hours=48 if icon else 240)
    target = NOW + timedelta(hours=target_hour if target_hour is not None else (96 if icon else 264))
    prefix = {"waves": "wave", "swell_1": "swell_wave", "swell_2": "secondary_swell_wave",
              "wind_waves": "wind_wave"}[layer]
    key = f"{prefix}_direction"

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return NOW

    def payload(times, heights):
        return {"hourly": {"time": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times],
                           f"{prefix}_height": heights, key: [90.0] * len(times),
                           f"{prefix}_period": [12.0] * len(times)}}

    rows = {"EURO": payload([NOW, anchor], [euro_h, euro_h]),
            "GFS": payload([anchor, target], [euro_h, target_h]),
            "ICON": payload([anchor, target], [euro_h, 4.0])}

    async def fetch(**kwargs):
        return rows[kwargs["model"]]

    monkeypatch.setattr(estimator, "datetime", Clock)
    monkeypatch.delenv("POINT_SKIP_NATIVE_COPERNICUS", raising=False)
    monkeypatch.delenv("POINT_BATCH_DEGRADED", raising=False)
    monkeypatch.setattr("services.copernicus_marine_service.fetch_euro_marine",
                        AsyncMock(return_value=[rows["EURO"]]))
    monkeypatch.setattr("services.weather_pipeline.surf_point.resolve_surf_geometry",
                        lambda *a: SurfGeometry(30., 10., True, 0., "fixture", 1., None, 5., True))
    monkeypatch.setattr("services.weather_pipeline.spot_conditions.cached_primary_swell", AsyncMock(return_value=None))
    monkeypatch.setattr("services.weather_pipeline.shore_normal_asset.break_depth_at", lambda *a: 5.)
    provider = SimpleNamespace(fetch_point=AsyncMock(side_effect=fetch))
    service = PointResolutionService(
        store=SimpleNamespace(get_manifest=Mock(return_value=SimpleNamespace(products=[]))),
        dynamic_index=SimpleNamespace(find_product_containing=Mock(return_value=None)), provider=provider)
    monkeypatch.setattr(service, "_resolve_partitions", AsyncMock(return_value=None))

    def resolve():
        return asyncio.run(service.resolve_point("EURO", "marine", layer, 0., 0., target.isoformat()))

    return rows, key, resolve, target


@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
def test_served_missing_direction_refuses_each_partition(monkeypatch, layer):
    rows, key, resolve, _ = prepare_point(monkeypatch, layer=layer)
    rows["GFS"]["hourly"][key][-1] = None
    result = resolve()
    assert result.status_code == 404
    body = json.loads(result.body)
    assert "point" not in body
    assert body["is_forecast_authoritative"] is False


@pytest.mark.parametrize("source", ["EURO", "GFS"])
@pytest.mark.parametrize("direction", [math.nan, math.inf])
def test_served_nonfinite_required_direction_refuses(monkeypatch, source, direction):
    rows, key, resolve, _ = prepare_point(monkeypatch)
    rows[source]["hourly"][key][-1] = direction
    assert resolve().status_code == 404


@pytest.mark.parametrize("direction", [None, math.nan, math.inf])
def test_optional_icon_bad_target_direction_uses_existing_unavailable_weights(monkeypatch, direction):
    rows, key, resolve, _ = prepare_point(monkeypatch, icon=True)
    rows["ICON"]["hourly"][key][-1] = direction
    result = resolve()
    assert result.point.speed == 2.7
    assert result.point.direction == 90.0
    assert result.estimate_basis["weights"] == {"persistence": .7, "gfs": .3, "icon": 0.}
    assert result.estimate_basis["type"] == "euro_persistence_gfs_blend"


def test_unconsumed_provider_anchor_bearings_do_not_remove_healthy_support(monkeypatch):
    rows, key, resolve, _ = prepare_point(monkeypatch, icon=True)
    rows["GFS"]["hourly"][key][0] = math.inf
    rows["ICON"]["hourly"][key][0] = math.nan
    result = resolve()
    assert result.point.speed == 2.8
    assert result.point.direction == 90.
    assert result.estimate_basis["weights"]["icon"] == .1


def test_point_zero_persistence_weight_does_not_require_euro_bearing(monkeypatch):
    rows, key, resolve, _ = prepare_point(monkeypatch, target_hour=384)
    rows["EURO"]["hourly"][key][-1] = None
    response = resolve()
    assert response.estimate_basis["weights"]["persistence"] == 0.
    assert response.point.speed == 2. and response.point.direction == 90.


@pytest.mark.parametrize("delta", [-1e-8, 0, 1e-8])
def test_unresolved_point_cannot_reach_a_numeric_surf_rating(monkeypatch, delta):
    rows, key, resolve, target = prepare_point(monkeypatch, target_h=2 + delta)
    rows["EURO"]["hourly"][key][-1] = 0.
    rows["GFS"]["hourly"][key][-1] = 180.
    response = resolve()
    assert response.status_code == 404

    async def resolve_input(**kwargs):
        return response if kwargs["domain"] == "marine" else None

    rating = asyncio.run(rate_one_spot(SimpleNamespace(resolve_point=resolve_input),
                                      {"id": "direction-control", "latitude": 0., "longitude": 0.},
                                      "EURO", target.isoformat()))
    assert rating["score"] is None and rating["level"] == "unknown"
    assert rating["surf_height_m"] is None


@pytest.mark.parametrize("euro_direction,gfs_direction,calm", [(0., 0., False), (359., 1., False), (90., 180., True)])
def test_actual_point_transform_and_rating_positive_controls(monkeypatch, euro_direction, gfs_direction, calm):
    rows, key, resolve, target = prepare_point(monkeypatch, euro_h=0. if calm else 3., target_h=0. if calm else 2.)
    rows["EURO"]["hourly"][key][-1] = euro_direction
    rows["GFS"]["hourly"][key][-1] = gfs_direction
    response = resolve()
    assert response.point.speed == (0. if calm else 2.4)
    assert response.point.direction == (90. if calm else 0.)
    assert response.surf_height_m == (0. if calm else 3.2975)
    assert type(response).model_validate_json(response.model_dump_json()).point.direction == response.point.direction

    async def resolve_input(**kwargs):
        return response if kwargs["domain"] == "marine" else None

    rating = asyncio.run(rate_one_spot(SimpleNamespace(resolve_point=resolve_input),
                                      {"id": "direction-control", "latitude": 0., "longitude": 0.},
                                      "EURO", target.isoformat()))
    assert rating["score"] == (0. if calm else 68.)


def product(height, direction, when, *, zero_vector=False, domain="marine"):
    bounds = CoverageBounds(west=0., east=1., south=0., north=1.)
    u = 0. if zero_vector else -height * math.sin(math.radians(direction))
    v = 0. if zero_vector else -height * math.cos(math.radians(direction))
    grid = NormalizedGrid(bounds=bounds, rows=2, cols=2,
                          vectors=[GridVector(lat=y, lng=x, speed=height, direction=direction,
                                              u=u, v=v, period=12.)
                                   for x, y in ((0, 0), (1, 0), (0, 1), (1, 1))])
    return NormalizedProduct(model="EURO", provider="fixture", domain=domain,
                             layer="waves" if domain == "marine" else "wind",
                             run_time=NOW, valid_time=when, is_forecast_authoritative=True,
                             is_estimated=False, coverage=bounds, grid=grid, value_kind="wave_height",
                             value_unit="m", display_unit_hint="ft", source_variables=["wave_height"], freshness_sec=1800)


@pytest.mark.parametrize("mixed", [False, True])
def test_grid_unresolved_direction_is_invalid_instead_of_valid_north(mixed):
    euro, ga, gt = product(3, 0, NOW), product(3, 180, NOW), product(2, 180, NOW + timedelta(hours=24))
    if mixed:
        gt.grid.vectors[0].v = -2.
        gt.grid.vectors[0].u = 0.
    result = estimator.estimate_euro_grid(264, 240, "waves", euro, gt, ga)
    if not mixed:
        assert result is None
    else:
        assert [v.is_valid for v in result.grid.vectors] == [True, False, False, False]
        assert result.grid.vectors[0].direction == 0.
        assert result.grid.diagnostics["nonzeroCount"] == 1


def test_grid_resampling_cancellation_cannot_be_amplified_back_to_full_height():
    euro, ga, gt = product(2, 90, NOW), product(2, 0, NOW), product(2, 0, NOW + timedelta(hours=24))
    # Every EURO node samples the middle of a GFS stencil with equal opposite vectors.
    for v in euro.grid.vectors:
        v.lat = v.lng = .5
    for v in gt.grid.vectors[2:]:
        v.v = 2.
    assert estimator.resample_from_grid(.5, .5, gt.grid)["speed"] == 2.
    assert estimator.estimate_euro_grid(264, 240, "waves", euro, gt, ga) is None


def test_grid_zero_persistence_weight_does_not_require_anchor_bearing():
    euro = product(3, 0, NOW, zero_vector=True)
    ga, gt = product(3, 90, NOW), product(2, 90, NOW)
    result = estimator.estimate_euro_grid(384, 240, "waves", euro, gt, ga)
    assert all(v.is_valid and v.speed == 2. and v.direction == 90. for v in result.grid.vectors)


def test_invalid_icon_grid_direction_uses_existing_per_cell_redistribution():
    euro, ga, gt = product(3, 90, NOW), product(3, 90, NOW), product(2, 90, NOW + timedelta(hours=24))
    ia, it = product(3, 90, NOW), product(4, 90, NOW + timedelta(hours=24), zero_vector=True)
    result = estimator.estimate_euro_grid(96, 240, "waves", euro, gt, ga, it, ia)
    assert all(v.is_valid and v.speed == 2.6 and v.direction == 90 for v in result.grid.vectors)
    # Product-wide weights are not generally a per-cell audit: this fixture has uniform support.
    assert result.estimate_basis["weights"] == {"persistence": .6, "gfs": .4, "icon": 0.}


@pytest.mark.parametrize("calm", [False, True])
def test_grid_positive_wrap_and_calm_controls(calm):
    euro, ga, gt = (product(0 if calm else 2, d, NOW) for d in (359, 0, 1))
    result = estimator.estimate_euro_grid(264, 240, "waves", euro, gt, ga)
    assert all(v.is_valid for v in result.grid.vectors)
    assert result.grid.vectors[0].speed == (0 if calm else 2)
    assert abs(result.grid.vectors[0].direction) < 1.


@pytest.mark.parametrize("domain", ["marine", "wind"])
@pytest.mark.parametrize("mixed", [False, True])
def test_lattice_unresolved_direction_has_no_valid_north_fallback(domain, mixed):
    a = product(2, 0, NOW, domain=domain)
    b = product(2, 180, NOW + timedelta(hours=6), domain=domain)
    if mixed:
        b.grid.vectors[0].u, b.grid.vectors[0].v = 0., -2.
    result = interpolate_between(a, b, NOW + timedelta(hours=3))
    if mixed:
        assert [v.is_valid for v in result.grid.vectors] == [True, False, False, False]
    else:
        assert result is None


@pytest.mark.parametrize("calm", [False, True])
def test_lattice_positive_wrap_and_calm_controls(calm):
    a = product(0 if calm else 2, 359, NOW)
    b = product(0 if calm else 2, 1, NOW + timedelta(hours=6))
    result = interpolate_between(a, b, NOW + timedelta(hours=3))
    assert all(v.is_valid and v.speed == (0 if calm else 2) for v in result.grid.vectors)
    assert abs(result.grid.vectors[0].direction % 360) < 1e-10


@pytest.mark.parametrize("height", [math.nan, math.inf, -math.inf])
def test_lattice_nonfinite_height_cannot_bypass_unresolved_direction_refusal(height):
    a, b = product(2, 90, NOW), product(2, 90, NOW + timedelta(hours=6))
    for v in b.grid.vectors:
        v.speed = height
    assert interpolate_between(a, b, NOW + timedelta(hours=3)) is None
