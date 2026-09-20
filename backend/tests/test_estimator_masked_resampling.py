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
                    gfs_target_period=10.0, icon=False, icon_target_period=8.0):
    now = datetime(2026, 9, 20, tzinfo=timezone.utc)
    anchor = now + timedelta(hours=48 if icon else 240)
    target = now + timedelta(hours=96 if icon else 264)

    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return now

    def payload(times, heights, periods):
        return {"hourly": {"time": [t.strftime("%Y-%m-%dT%H:%M:%SZ") for t in times],
                           "wave_height": heights, "wave_direction": [90.0] * len(times),
                           "wave_period": periods}}

    async def fetch_point(**kwargs):
        if kwargs["model"] == "GFS":
            return payload([anchor, target], [1.8, 2.2], [gfs_anchor_period, gfs_target_period])
        if icon and kwargs["model"] == "ICON":
            return payload([anchor, target], [1.5, 1.5], [8.0, icon_target_period])
        return None

    monkeypatch.setattr("services.weather_pipeline.estimator.datetime", Clock)
    provider = SimpleNamespace(fetch_point=AsyncMock(side_effect=fetch_point))
    return asyncio.run(resolve_euro_estimate_point(
        provider, "marine", "waves", 0, 0, target, payload([anchor], [2.0], [euro_period])))


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
