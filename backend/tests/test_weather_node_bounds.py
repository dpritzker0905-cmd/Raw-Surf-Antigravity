"""Grid bounds must describe emitted node endpoints, not a larger requested bbox."""
from copy import deepcopy
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

NOW = datetime(2026, 9, 11, 21, tzinfo=timezone.utc)
BOOT_BBOX = dict(west=-81.4416, south=27.3454, east=-78.9584, north=29.3124)


def normalize(bbox, resolution, raw=None):
    if raw is None:
        lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        raw = [dict(latitude=lat, longitude=lon, hourly_units={'wave_height': 'm'},
                    hourly=dict(time=['2026-09-11T21:00:00Z'], wave_height=[(200 + i) / 100],
                                wave_direction=[270], wave_period=[8]))
               for i, (lat, lon) in enumerate(zip(lats, lons))]
    return WeatherNormalizer().normalize('GFS', 'open-meteo', 'marine', 'waves', raw,
                                         bbox, resolution, NOW, run_time=NOW), raw


@pytest.mark.parametrize('bbox,resolution', [
    (BOOT_BBOX, 0.25),
    (dict(west=179, south=0, east=-178.7, north=2.3), 1),
    (dict(west=179.1234, south=0.1234, east=-178.7, north=2.3), 0.25),
    (dict(west=179.1234, south=-10, east=-95.33, north=10), 10),
    (dict(west=179.0003, south=0, east=-127.9, north=2), 1),
    (dict(west=-180, south=-80, east=180, north=85), 10),
    (dict(west=-180, south=-80, east=180, north=85), 2),
    (dict(west=-81.123456, south=29, east=-79.31, north=27.23), 0.25),
    (dict(west=-80, south=28, east=-80, north=28), 0.25),
])
def test_bounds_follow_actual_node_endpoints_and_preserve_the_request(bbox, resolution):
    original = deepcopy(bbox)
    product, _ = normalize(bbox, resolution)
    grid = product.grid
    first, last = grid.vectors[0], grid.vectors[-1]
    assert grid.bounds.model_dump() == dict(west=first.lng, south=first.lat, east=last.lng, north=last.lat)
    assert product.coverage == grid.bounds
    assert grid.diagnostics['requested_bounds'] == original
    assert bbox == original
    assert len(grid.vectors) == grid.cols * grid.rows
    assert all(-180 <= v.lng <= 180 for v in grid.vectors)


def test_recorded_boot_geometry_changes_no_physical_values_or_coordinates():
    product, raw = normalize(BOOT_BBOX, 0.25)
    expected_bounds = dict(west=-81.4416, south=27.3454, east=-79.1916, north=29.0954)
    aligned, _ = normalize(expected_bounds, 0.25, raw)
    assert product.grid.bounds.model_dump() == expected_bounds
    assert (product.grid.cols, product.grid.rows) == (10, 8)
    assert product.grid.vectors == aligned.grid.vectors
    assert product.valid_time == aligned.valid_time == NOW
    assert product.value_unit == aligned.value_unit == 'm'
    assert [v.speed for v in product.grid.vectors] == [(200 + i) / 100 for i in range(80)]


def test_full_wrap_mirror_remains_a_distinct_copy_of_the_real_west_column():
    bbox = dict(west=-180, south=0, east=180, north=10)
    _, raw = normalize(bbox, 10)
    raw = [p for p in raw if p['longitude'] != 180]
    product, _ = normalize(bbox, 10, raw)
    grid = product.grid
    assert grid.bounds.west == -180 and grid.bounds.east == 180
    west = [v for v in grid.vectors if v.lng == -180]
    east = [v for v in grid.vectors if v.lng == 180]
    assert len(west) == len(east) == grid.rows
    for left, right in zip(west, east):
        assert left is not right
        assert left.speed == right.speed and left.is_valid == right.is_valid
        assert left.direction == right.direction and left.period == right.period
