"""Bounded local-storage integration; no provider or Supabase traffic."""
from datetime import datetime, timezone
from types import SimpleNamespace as S
from functools import partial

import pytest
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.grid_resolver import resolve_grid
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.spot_ratings import rate_one_spot
from tests.test_dynamic_cycle_selection import fixture


@pytest.mark.asyncio
async def test_disk_index_point_grid_series_and_rating(tmp_path, monkeypatch):
    old, new, item = fixture()
    now = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    old.valid_time = new.valid_time = item.valid_time_start = item.valid_time_end = now
    store = ProductStore(tmp_path)
    monkeypatch.setattr(ProductStore, '_cached_manifest', None)
    for p in [old, new]:
        (tmp_path/p.product_id).write_text(p.model_dump_json(), encoding='utf-8')
    store.manifest_path.write_text(PipelineManifest(last_manifest_update=now, products=[item]).model_dump_json(), encoding='utf-8')
    index = DynamicProductIndex(tmp_path)
    bbox = '-82,26,-78,30'
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    # Keep rating's optional swell lookup local and absent in this single-layer fixture.
    async def no_swell(*args):
        return None
    monkeypatch.setattr('services.weather_pipeline.spot_conditions.cached_primary_swell', no_swell)
    resolver = PointResolutionService(store=store, dynamic_index=index, provider=S())
    reads = []
    original_load = store.load_product
    def load(name, **kw):
        reads.append(name)
        return original_load(name, **kw)
    monkeypatch.setattr(store, 'load_product', load)
    async def dynamic(**kw):
        match = index.find_product_containing('GFS', 'marine', 'waves', now, 28, -80)
        return store.load_product(match['product_id']) if match else None
    vp = S(is_viewport_enabled=lambda *a, **kw: True, get_cached_dynamic_product=dynamic)
    grid_resolve = partial(resolve_grid, store, vp)
    results = []
    for warm in [False, True]:
        if warm:
            index.add_product(old.product_id, 'GFS', 'marine', 'waves', now, bbox, bbox,
                              'regional', 4, 'fixture', 'fixture')
        reads.clear()
        point = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, now.isoformat())
        assert reads == ([old.product_id, new.product_id] if warm else [new.product_id])
        grid = await grid_resolve(model='GFS', domain='marine', layer='waves', valid_time=now.isoformat(), bbox=bbox)
        assert point.model_run_time == grid.model_run_time == new.model_run_time
        assert point.point.speed == 2
        series = await build_grid_series(grid_resolve, vp, 'GFS', 'marine', 'waves', bbox, '0')
        assert series['frames'][0]['model_run_time'] == new.model_run_time.isoformat()
        # Wind is deliberately absent; avoid the provider fallback while using real marine resolution.
        class RatingResolver:
            async def resolve_point(self, **kw):
                return await resolver.resolve_point(**kw) if kw['domain'] == 'marine' else None
        rating = await rate_one_spot(RatingResolver(), dict(id='fixture', name='fixture', latitude=28, longitude=-80), 'GFS', now.isoformat())
        assert rating['time_provenance']['marine']['model_run_time'].replace('Z', '+00:00') == new.model_run_time.isoformat()
        results.append((point.point.speed, rating['score']))
    assert results[0] == results[1]
    assert index.find_product_containing('GFS', 'marine', 'waves', now, 28, -77) is None
    entries = index._load_index()
    entries[0]['expires_at'] = '2000-01-01T00:00:00+00:00'
    index._save_index(entries)
    assert index.find_product_containing('GFS', 'marine', 'waves', now, 28, -80) is None
    assert not (tmp_path/old.product_id).exists()
    assert (await resolver.find_cached_grid_product('GFS', 'marine', 'waves', 28, -80, now)).model_run_time == new.model_run_time
