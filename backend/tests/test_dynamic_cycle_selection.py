from datetime import timedelta
from types import SimpleNamespace as S

import pytest
from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.schemas import GridVector
from tests.test_grid_series_frame_provenance import _product, _BASE_RUN
from tests.test_point_tiebreak_resolution import _prod
from services.weather_pipeline.dynamic_cycle_policy import superseded_dynamic


def fixture():
    old, new = _product(_BASE_RUN), _product(_BASE_RUN)
    for p, hour, height, name in [(old, 0, 1, 'dynamic.json'), (new, 6, 2, 'scheduled.json')]:
        p.valid_time = _BASE_RUN + timedelta(hours=6)
        p.model_run_time = _BASE_RUN.replace(hour=hour)
        p.model_run_time_status = 'known'
        p.product_id = name
        p.grid.vectors = [GridVector(lat=lat, lng=lng, speed=height, u=-height, v=0, period=10, direction=90)
                          for lat in [26, 30] for lng in [-82, -78]]
    item = _prod(4, -82, 26, -78, 30)
    item.filename = new.product_id
    item.valid_time_start = new.valid_time
    item.model_run_time = new.model_run_time
    item.model_run_time_status = 'known'
    item.upstream_provider = new.upstream_provider
    item.source_dataset = new.source_dataset
    return old, new, item


@pytest.mark.asyncio
async def test_equivalent_newer_scheduled_product_wins_cold_and_warm(monkeypatch):
    # Isolate selection and actual grid sampling; coastal transformation is a separate stage.
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    old, new, item = fixture()
    for warm in [False, True]:
        store = S(get_manifest=lambda: S(products=[item]),
                  load_product=lambda name: {old.product_id: old, new.product_id: new}[name])
        index = S(find_product_containing=lambda **kw: {'product_id': old.product_id} if warm else None)
        resolver = PointResolutionService(store=store, dynamic_index=index, provider=S())
        response = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, new.valid_time.isoformat())
        assert response.product_id == new.product_id
        assert response.point.speed == 2
        assert response.model_run_time == new.model_run_time
        assert await resolver.find_cached_grid_product('GFS', 'marine', 'waves', 28, -80, new.valid_time) is new


@pytest.mark.asyncio
@pytest.mark.parametrize('difference', ['source', 'time', 'coverage', 'resolution', 'authority',
                                      'missing_cycle', 'missing_file', 'stale_file', 'equal_cycle', 'global_coarse'])
async def test_non_equivalent_or_unavailable_candidate_cannot_displace_dynamic(difference):
    old, new, item = fixture()
    if difference == 'source':
        item.source_dataset = 'different'
    elif difference == 'time':
        item.valid_time_start += timedelta(hours=1)
    elif difference == 'coverage':
        item.coverage = item.coverage.model_copy(update={'west': -83})
    elif difference == 'resolution':
        item.resolution = 2
    elif difference == 'authority':
        item.is_estimated = True
    elif difference == 'missing_cycle':
        old.model_run_time_status = 'missing'
    elif difference == 'stale_file':
        new.model_run_time = old.model_run_time
    elif difference == 'equal_cycle':
        item.model_run_time = old.model_run_time
    elif difference == 'global_coarse':
        item.filename = 'global_coarse.json'
    store = S(get_manifest=lambda: S(products=[item]),
              load_product=lambda name: None if difference == 'missing_file' else new)
    assert not await superseded_dynamic(store, old)


@pytest.mark.asyncio
@pytest.mark.parametrize('method', ['point', 'cached'])
async def test_validated_replacement_is_not_loaded_again_after_pruning(monkeypatch, method):
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    old, new, item = fixture()
    loads = []
    def load(name):
        loads.append(name)
        if name == old.product_id:
            return old
        return new if loads.count(name) == 1 else None
    store = S(get_manifest=lambda: S(products=[item]), load_product=load)
    resolver = PointResolutionService(store=store, provider=S(),
        dynamic_index=S(find_product_containing=lambda **kw: {'product_id': old.product_id}))
    if method == 'point':
        result = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, new.valid_time.isoformat())
        assert result.product_id == new.product_id
        assert result.point.speed == 2
        assert result.is_dynamic_viewport_product is False
    else:
        assert await resolver.find_cached_grid_product('GFS', 'marine', 'waves', 28, -80, new.valid_time) is new
    assert loads == [old.product_id, new.product_id]
