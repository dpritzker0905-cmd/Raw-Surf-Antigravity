"""Select identical grids without constructing the rejected Cartesian products."""
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from services.weather_pipeline import grid_series_helper as series, route_helpers
from services.weather_pipeline.series_coordinates import generate_series_coords, RESOLUTIONS


def legacy(w, s, e, n):
    for resolution in RESOLUTIONS:
        lats, lons = route_helpers.generate_bbox_coords(w, s, e, n, resolution)
        if len(lats) <= 500 or resolution == RESOLUTIONS[-1]:
            return resolution, lats, lons


@pytest.mark.parametrize('bbox', [
    (-180,-80,180,84), (170,-2,-170,2), (180,0,-180,0),
    (-81,27,-80.5,27.5), (-1,0,1,0), (0,0,0,0),
    (0,0,4.99989,4.99989), (0,0,4.99991,4.99991),
    (-179.9999,-79.9999,179.9999,84.9999), (0,1,1,0),
    (0,0,124.75,0), (0,0,125,0), (-10000,0,10000,0),
    (170,-1,-170,1), (0,0,124.99991,0),
])
def test_selected_grid_matches_historical_generator_exactly(monkeypatch, bbox):
    expected = legacy(*bbox)
    original = route_helpers.generate_bbox_coords
    calls = []
    def measured(*args):
        result = original(*args)
        calls.append(len(result[0]))
        return result
    monkeypatch.setattr(route_helpers, 'generate_bbox_coords', measured)
    assert generate_series_coords(*bbox) == expected
    assert calls == [len(expected[1])], 'Rejected candidates were materialized'


@pytest.mark.parametrize('position', range(4))
@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')])
def test_nonfinite_coordinates_refused_without_materialization(monkeypatch, position, value):
    bbox = [-81.,27.,-80.5,27.5]
    bbox[position] = value
    def forbidden(*args):
        pytest.fail('Nonfinite coordinates reached allocation')
    monkeypatch.setattr(route_helpers, 'generate_bbox_coords', forbidden)
    with pytest.raises(ValueError, match='finite'):
        generate_series_coords(*bbox)


def test_unrepresentable_step_refused_instead_of_hanging():
    with pytest.raises(ValueError, match='advance'):
        generate_series_coords(1e300, 0., 1e300, 1.)


@pytest.mark.asyncio
@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
async def test_actual_fast_path_only_materializes_selected_coordinates(monkeypatch, model):
    from services.weather_pipeline.normalizer import WeatherNormalizer
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
    original = route_helpers.generate_bbox_coords
    allocated, requested = [], []
    def measured(*args):
        result = original(*args)
        allocated.append(len(result[0]))
        return result
    base = datetime(2026, 9, 14, 12, tzinfo=timezone.utc)
    async def fetch(self, **kw):
        requested.append(kw)
        lats, lons = kw['precomputed_coords']
        return [dict(latitude=lat, longitude=lon, hourly=dict(
            time=['2026-09-14T12:00'], wave_height=[1.5], wave_direction=[90.], wave_period=[10.]))
            for lat, lon in zip(lats, lons)]
    monkeypatch.setattr(route_helpers, 'generate_bbox_coords', measured)
    monkeypatch.setattr(OpenMeteoProvider, 'fetch_grid', fetch)
    monkeypatch.setattr(CopernicusProvider, 'fetch_grid', fetch)
    viewport = SimpleNamespace(normalizer=WeatherNormalizer())
    if model == 'EURO':
        result = await series._build_euro_marine_series(viewport, 'waves', '-180,-80,180,84', [0], base)
    else:
        result = await series._build_openmeteo_marine_series(viewport, model, 'waves', '-180,-80,180,84', [0], base)
    assert len(requested) == 1 and result['frame_count'] == 1
    assert requested[0]['resolution'] == 15.
    assert len(result['frames'][0]['vectors']) == 275
    assert allocated == [275], f'{model} allocated rejected candidate grids: {allocated}'
