"""Missing native corners versus calm and just-inside controls across model/layer."""
from datetime import datetime, timezone
import pytest
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.schemas import NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds


def product(model, layer, valid):
    bounds = CoverageBounds(west=-80, south=28, east=-79.8, north=28.2)
    vectors = [GridVector(lat=lat, lng=lng, speed=0, period=0, is_valid=valid)
               for lat in (28, 28.2) for lng in (-80, -79.8)]
    return NormalizedProduct(model=model, provider='offline', domain='marine', layer=layer,
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        coverage=bounds, grid=NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors),
        is_forecast_authoritative=True, is_estimated=False, product_id='fixture',
        value_kind='wave_height', value_unit='m', display_unit_hint='m', source_variables=['wave_height'], freshness_sec=0)


@pytest.mark.parametrize('model,layer', [(m, l) for m in ('GFS', 'ICON', 'EURO') for l in ('waves', 'swell_1', 'swell_2', 'wind_waves') if not (m == 'ICON' and l == 'swell_2')])
@pytest.mark.parametrize('lat,lng', [(28, -80), (28.2, -80), (28, -79.8), (28.2, -79.8), (28.00001, -79.99999), (28.0001, -79.9999)])
def test_masked_and_measured_calm_have_distinct_authority(monkeypatch, model, layer, lat, lng):
    monkeypatch.setenv('SAMPLER_EXACT_VALIDITY', '1')
    missing = PointSampler().sample_point(product(model, layer, False), lat, lng)
    assert missing.point.interpolation_method == 'unavailable'
    assert missing.is_forecast_authoritative is False
    calm = PointSampler().sample_point(product(model, layer, True), lat, lng)
    assert calm.is_forecast_authoritative is True and calm.point.speed == 0


def test_default_off_retains_legacy_corner(monkeypatch):
    monkeypatch.delenv('SAMPLER_EXACT_VALIDITY', raising=False)
    result = PointSampler().sample_point(product('GFS', 'waves', False), 28, -80)
    assert result.point.interpolation_method == 'exact_match' and result.is_forecast_authoritative
