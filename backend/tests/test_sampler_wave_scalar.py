"""Hs is a scalar: directional cancellation must not manufacture calm seas."""
import math
from datetime import datetime, timezone
import pytest
from services.weather_pipeline.schemas import NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
from services.weather_pipeline.sampler import PointSampler


def product(domain='marine', masked=False, directions=(0, 180, 0, 180), heights=(2, 2, 2, 2)):
    bounds = CoverageBounds(west=0, east=1, south=0, north=1)
    vectors = [GridVector(lat=lat, lng=lon, speed=h, direction=d,
                          u=-h*math.sin(math.radians(d)), v=-h*math.cos(math.radians(d)),
                          period=12, is_valid=not(masked and i >= 2))
               for i, ((lat, lon), d, h) in enumerate(zip([(0,0),(0,1),(1,0),(1,1)], directions, heights))]
    return NormalizedProduct(model='GFS', provider='noaa', domain=domain,
        layer='waves' if domain == 'marine' else 'wind',
        run_time=datetime(2026,9,17,tzinfo=timezone.utc), valid_time=datetime(2026,9,17,tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors),
        value_kind='wave_height', value_unit='m', display_unit_hint='m',
        product_id='scalar-regression', source_variables=['wave_height'], freshness_sec=0)


@pytest.mark.parametrize('masked', [False, True])
@pytest.mark.parametrize('directions', [(0,180,0,180), (359,1,359,1), (90,90,90,90)])
def test_constant_height_is_independent_of_direction(masked, directions):
    response = PointSampler().sample_point(product(masked=masked, directions=directions), .5, .5)
    assert response.point.speed == 2
    assert response.point.period == 12


@pytest.mark.parametrize('masked,expected', [(False, 4), (True, 2)])
def test_height_weights_are_normalized_over_valid_corners(masked, expected):
    assert PointSampler().sample_point(product(masked=masked, heights=(1,3,5,7)), .5,.5).point.speed == expected


def test_wind_still_uses_vector_magnitude():
    assert PointSampler().sample_point(product(domain='wind'), .5,.5).point.speed == 0
