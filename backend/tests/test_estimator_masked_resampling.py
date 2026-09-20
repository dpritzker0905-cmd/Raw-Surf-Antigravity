"""Coastal masks must not become calm observations in extended marine forecasts."""
import asyncio
from datetime import datetime, timedelta, timezone
import math
from types import SimpleNamespace
from unittest.mock import AsyncMock

import pytest

from services.weather_pipeline.estimator import resample_from_grid, resolve_euro_estimate_point
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid


def marine_grid(*, bounds=None):
    bounds = bounds or CoverageBounds(west=0, south=0, east=1, north=1)
    return NormalizedGrid(
        bounds=bounds, cols=2, rows=2,
        vectors=[GridVector(lat=y, lng=x, speed=2, u=-2, v=0, period=10)
                 for x, y in ((bounds.west, bounds.south), (bounds.east, bounds.south),
                              (bounds.west, bounds.north), (bounds.east, bounds.north))],
    )


def test_dry_placeholders_do_not_dilute_wet_height_or_period():
    grid = marine_grid()
    for cell in grid.vectors[1:]:
        cell.is_valid = False
        cell.speed = cell.u = cell.v = 0
        cell.period = None
    assert resample_from_grid(.5, .5, grid) == {"speed": 2, "u": -2, "v": 0, "period": 10}
    # A wet neighbor with zero interpolation weight cannot rescue the exact dry corner.
    assert resample_from_grid(1, 1, grid) is None


def test_no_wet_support_is_missing():
    grid = marine_grid()
    for cell in grid.vectors:
        cell.is_valid = False
    assert resample_from_grid(.5, .5, grid) is None


def test_valid_calm_water_remains_a_real_zero():
    grid = marine_grid()
    for cell in grid.vectors:
        cell.speed = cell.u = cell.v = 0
        cell.period = None
    assert resample_from_grid(.5, .5, grid) == {"speed": 0, "u": 0, "v": 0, "period": None}


@pytest.mark.parametrize("field", ["speed", "u", "v"])
@pytest.mark.parametrize("bad", [float("nan"), float("inf"), -float("inf")])
def test_nonfinite_cells_are_excluded_even_at_zero_weight(field, bad):
    grid = marine_grid()
    setattr(grid.vectors[0], field, bad)
    assert resample_from_grid(.5, .5, grid) == {"speed": 2, "u": -2, "v": 0, "period": 10}
    assert resample_from_grid(1, 1, grid) == {"speed": 2, "u": -2, "v": 0, "period": 10}
    assert resample_from_grid(0, 0, grid) is None


@pytest.mark.parametrize("bad_period", [None, 0, -1, float("nan"), float("inf")])
def test_missing_period_has_its_own_support_instead_of_becoming_zero(bad_period):
    grid = marine_grid()
    for cell in grid.vectors[1:]:
        cell.period = bad_period
    assert resample_from_grid(.5, .5, grid)["period"] == 10
    assert resample_from_grid(1, 1, grid)["period"] is None


def test_wet_support_retains_bilinear_weights_not_a_flat_average():
    grid = marine_grid()
    for cell, height in zip(grid.vectors, (1, 3, 5, 99)):
        cell.speed = height
        cell.u = -height
    grid.vectors[3].is_valid = False
    # x=.25,y=.5: surviving weights .375,.125,.375 normalize by .875.
    sample = resample_from_grid(.5, .25, grid)
    assert sample["speed"] == pytest.approx((.375 + .125 * 3 + .375 * 5) / .875)
    assert sample["u"] == pytest.approx(-sample["speed"])


def test_all_wet_bilinear_control_and_wrapped_direction():
    grid = marine_grid()
    for cell, height, period, direction in zip(grid.vectors, (1, 3, 5, 7), (6, 8, 10, 12),
                                               (350, 10, 350, 10)):
        cell.speed, cell.period = height, period
        cell.u, cell.v = -math.sin(math.radians(direction)), -math.cos(math.radians(direction))
    sample = resample_from_grid(.5, .5, grid)
    assert sample["speed"] == 4
    assert sample["period"] == 9
    assert math.degrees(math.atan2(-sample["u"], -sample["v"])) == pytest.approx(0, abs=1e-12)


@pytest.mark.parametrize("lat,lng", [(-.1, .5), (1.1, .5), (.5, -.1), (.5, 1.1),
                                    (float("nan"), .5), (.5, float("inf"))])
def test_invalid_or_outside_coordinates_have_no_support(lat, lng):
    assert resample_from_grid(lat, lng, marine_grid()) is None


def test_antimeridian_support_works_on_both_longitude_representations():
    grid = marine_grid(bounds=CoverageBounds(west=179, south=0, east=-179, north=1))
    assert resample_from_grid(.5, 180, grid) == resample_from_grid(.5, -180, grid)
    assert resample_from_grid(.5, 180, grid)["speed"] == 2
    assert resample_from_grid(.5, 0, grid) is None


def direct_estimate(monkeypatch, euro_period=8.0, gfs_anchor_period=8.0,
                    gfs_target_period=10.0, icon=False, icon_target_period=8.0,
                    euro_height=2.0, gfs_anchor_height=1.8, gfs_target_height=2.2,
                    icon_anchor_height=1.5, icon_target_height=1.5, layer="waves", truncate_gfs=False):
    now = datetime(2026, 9, 20, tzinfo=timezone.utc)
    anchor = now + timedelta(hours=48 if icon else 240)
    target = now + timedelta(hours=96 if icon else 264)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    def payload(times, heights, periods):
        prefix = {"waves": "wave", "swell_1": "swell_wave", "swell_2": "secondary_swell_wave",
                  "wind_waves": "wind_wave"}[layer]
        return {"hourly": {"time": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times],
                           f"{prefix}_height": heights, f"{prefix}_direction": [90.0] * len(times),
                           f"{prefix}_period": periods}}

    async def fetch_point(**kwargs):
        if kwargs["model"] == "GFS":
            heights = [gfs_anchor_height] if truncate_gfs else [gfs_anchor_height, gfs_target_height]
            return payload([anchor, target], heights, [gfs_anchor_period, gfs_target_period])
        if icon and kwargs["model"] == "ICON":
            return payload([anchor, target], [icon_anchor_height, icon_target_height], [8.0, icon_target_period])
        return None

    monkeypatch.setattr("services.weather_pipeline.estimator.datetime", Clock)
    provider = SimpleNamespace(fetch_point=AsyncMock(side_effect=fetch_point))
    return asyncio.run(resolve_euro_estimate_point(
        provider, "marine", layer, 0, 0, target, payload([anchor], [euro_height], [euro_period])))


@pytest.mark.parametrize("changes,expected", [
    ({"euro_period": None}, None),
    ({"euro_period": float("inf")}, None),
    ({"gfs_target_period": None}, 8.0),
    ({"gfs_target_period": float("nan")}, 8.0),
    ({"gfs_anchor_period": None}, 8.0),
])
def test_direct_period_missingness_matches_grid_contract(monkeypatch, changes, expected):
    response = direct_estimate(monkeypatch, **changes)
    assert response.point.period == expected
    assert response.point.speed == 2.24
    assert response.is_estimated and not response.is_forecast_authoritative
    # The actual wire schema preserves null; missing does not become a numeric zero.
    assert type(response).model_validate_json(response.model_dump_json()).point.period == expected


def test_direct_healthy_period_trend_remains_unchanged(monkeypatch):
    response = direct_estimate(monkeypatch)
    assert response.point.period == 9.2  # .4 * 8 + .6 * (8 + 10 - 8)
    assert response.point.speed == 2.24


def test_direct_missing_icon_period_retains_euro_anchor(monkeypatch):
    response = direct_estimate(monkeypatch, icon=True, icon_target_period=None)
    assert response.point.period == 8.6  # .6 * 8 + .3 * 10 + .1 * 8
    assert response.estimate_basis["weights"]["icon"] == .1


def test_direct_healthy_icon_cannot_invent_a_missing_euro_anchor(monkeypatch):
    response = direct_estimate(monkeypatch, icon=True, euro_period=None)
    assert response.point.period is None
    assert response.point.speed == 2.12


@pytest.mark.parametrize("layer", ["waves", "swell_1", "swell_2", "wind_waves"])
@pytest.mark.parametrize("field", ["euro_height", "gfs_anchor_height", "gfs_target_height"])
def test_direct_missing_required_height_refuses_each_partition(monkeypatch, layer, field):
    assert direct_estimate(monkeypatch, layer=layer, **{field: None}) is None


@pytest.mark.parametrize("height", [-1.0, float("nan"), float("inf"), float("-inf"), True, "2.2"])
def test_direct_invalid_height_cannot_enter_a_trend(monkeypatch, height):
    assert direct_estimate(monkeypatch, gfs_target_height=height) is None


def test_direct_truncated_height_series_is_missing_not_calm(monkeypatch):
    assert direct_estimate(monkeypatch, truncate_gfs=True) is None


@pytest.mark.parametrize("height", [None, float("nan"), -1.0])
@pytest.mark.parametrize("field", ["icon_anchor_height", "icon_target_height"])
def test_direct_unusable_icon_is_excluded_with_truthful_weights(monkeypatch, height, field):
    response = direct_estimate(monkeypatch, icon=True, **{field: height})
    assert response.point.speed == 2.12
    assert response.estimate_basis["weights"] == {"persistence": .7, "gfs": .3, "icon": 0.0}
    assert response.estimate_basis["type"] == "euro_persistence_gfs_blend"


@pytest.mark.parametrize("field,expected", [("euro_height", .24), ("gfs_anchor_height", 3.32),
                                             ("gfs_target_height", .92)])
def test_direct_explicit_calm_zero_remains_usable(monkeypatch, field, expected):
    response = direct_estimate(monkeypatch, **{field: 0.0})
    assert response.point.speed == expected


def test_direct_all_calm_water_remains_a_numeric_zero(monkeypatch):
    response = direct_estimate(monkeypatch, euro_height=0.0, gfs_anchor_height=0.0, gfs_target_height=0.0)
    assert response.point.speed == 0.0
