"""Pressure already has a provider and normalizer; its viewport gate must agree."""
from datetime import datetime, timezone
import pytest
from services.weather_pipeline.viewport_helper import is_viewport_enabled_helper
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.sampler import PointSampler
import asyncio
from types import SimpleNamespace
from services.weather_pipeline.viewport_upstream import fetch_upstream_raw, normalize_and_persist_layers
from services.weather_pipeline.schemas import NormalizedProduct
from services.weather_pipeline.phase_timing import trace_series_phases


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
def test_pressure_grid_can_reach_existing_provider(model):
    assert is_viewport_enabled_helper(model, 'weather', 'pressure', False, '-90,12,-89,13')
    assert not is_viewport_enabled_helper(model, 'weather', 'pressure', True, '-90,12,-89,13')
    assert not is_viewport_enabled_helper(model, 'weather', 'pressure', False, None)


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
def test_pressure_provider_payload_to_scalar_point(model):
    raw = [{'latitude': lat, 'longitude': lon,
            'hourly_units': {'pressure_msl':'hPa'},
            'hourly': {'time':['2026-09-17T12:00'], 'pressure_msl':[value]}}
           for lat,lon,value in [(12,-90,1000),(12,-89,1002),(13,-90,1004),(13,-89,1006)]]
    product = WeatherNormalizer().normalize(model=model, provider='open-meteo', domain='weather',
        layer='pressure', raw_results=raw, bbox={'west':-90,'south':12,'east':-89,'north':13},
        resolution=1, target_time=datetime(2026,9,17,12,tzinfo=timezone.utc))
    assert product.value_unit == 'hPa'
    assert PointSampler().sample_point(product,12.5,-89.5).point.value == 1003


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
def test_pressure_dispatch_persistence_and_served_diagnostics(model, tmp_path):
    """Use actual dispatch, normalization and disk serialization; stub only the supplier."""
    calls=[]
    indexed=[]
    class Provider:
        async def fetch_grid(self, **kwargs):
            calls.append(kwargs)
            lats,lons=kwargs['precomputed_coords']
            return [{'latitude':lat,'longitude':lon,'hourly_units':{'pressure_msl':'hPa'},
                     'hourly':{'time':['2026-09-17T12:00'],'pressure_msl':[1003]}}
                    for lat,lon in zip(lats,lons)]
    service=SimpleNamespace(provider=Provider(),normalizer=WeatherNormalizer(),
        store=SimpleNamespace(cache_dir=tmp_path),
        dynamic_index=SimpleNamespace(add_product=lambda **kw:indexed.append(kw)))
    @trace_series_phases
    async def run():
        raw,resolution,count,bbox=await fetch_upstream_raw(service,model,'weather','pressure',
            '2026-09-17T12:00:00Z',-90,12,-89,13,1,False,1)
        normalized = await normalize_and_persist_layers(service,model,'weather','pressure',raw,bbox,
            resolution,datetime(2026,9,17,12,tzinfo=timezone.utc),0,-90,12,-89,13,
            '-90,12,-89,13','test-pressure','regional',count)
        return {'product': normalized}
    result=asyncio.run(run())
    product=result['product']
    assert result['timing']['phases']['viewport_upstream']['calls']==1
    assert result['timing']['phases']['normalize_persist']['calls']==1
    assert calls[0]['model']==model and calls[0]['domain']=='weather' and calls[0]['layer']=='pressure'
    assert len(indexed)==1
    restored=NormalizedProduct.model_validate_json((tmp_path/product.product_id).read_text())
    assert restored.grid.diagnostics['renderable'] is True
    assert restored.grid.diagnostics['nonzeroCount']==4
    assert PointSampler().sample_point(restored,12.5,-89.5).point.value==1003
