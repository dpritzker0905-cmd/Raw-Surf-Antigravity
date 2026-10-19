"""Recovery must supply real data and retain exact-time/coarser provenance."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as S
from unittest.mock import AsyncMock, Mock

import pytest

from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.scheduler_helpers import normalize_and_save_loop

NOW = datetime(2026, 10, 18, 12, tzinfo=timezone.utc)


def product(region='global_mid', valid=True):
    bounds = CoverageBounds(west=0, south=0, east=2, north=2)
    return NormalizedProduct(model='GFS', provider='noaa', domain='marine', layer='waves',
        run_time=NOW, model_run_time=NOW, model_run_time_status='known', valid_time=NOW,
        is_forecast_authoritative=True, is_estimated=False, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, rows=2, cols=2,
            vectors=[GridVector(lat=lat, lng=lon, speed=1.5, direction=30, period=9, is_valid=valid)
                     for lat in (0, 2) for lon in (0, 2)]),
        value_kind='wave_height', value_unit='m', display_unit_hint='m', source_variables=[],
        freshness_sec=0, source_dataset='ncep_gfswave025', region_id=region,
        coverage_mode='global_tile' if region=='global_mid' else 'regional_tile')


@pytest.mark.asyncio
async def test_empty_regional_frame_uses_real_exact_time_parent(monkeypatch, tmp_path):
    monkeypatch.setenv('L2_WRITER', '0')
    monkeypatch.setenv('MARINE_EMPTY_FRAME_FALLBACK', '1')
    store = ProductStore(cache_dir=tmp_path)
    parent = product()
    assert store.save_product(parent, 2)
    normalizer = S(normalize_async=AsyncMock(return_value=product('coast', False)))
    count = await normalize_and_save_loop(normalizer, store, [{'hourly': {'time': [NOW.isoformat()]}}],
        'GFS', 'noaa', 'marine', 'waves', dict(west=0,south=0,east=2,north=2), .25,
        NOW, region_id='coast', coverage_mode='regional_tile', step=1,
        estimated_after_index=0, estimate_basis={'type':'caller_horizon_tag'})
    assert count == 1
    row = next(p for p in store.get_manifest().products if p.region_id == 'coast')
    recovered = store.load_product(row.filename)
    assert any(v.is_valid for v in recovered.grid.vectors)
    assert recovered.is_estimated and not recovered.is_forecast_authoritative
    assert row.resolution == 2
    assert recovered.estimate_basis['source_product_id']
    assert recovered.valid_time == NOW and all(v.speed == 1.5 for v in recovered.grid.vectors)
    assert not parent.is_estimated and parent.region_id == 'global_mid'


@pytest.mark.asyncio
async def test_no_parent_never_saves_an_empty_recovery(monkeypatch, tmp_path):
    monkeypatch.setenv('L2_WRITER', '0')
    monkeypatch.setenv('MARINE_EMPTY_FRAME_FALLBACK', '1')
    store = ProductStore(cache_dir=tmp_path)
    normalizer = S(normalize_async=AsyncMock(return_value=product('coast', False)))
    count = await normalize_and_save_loop(normalizer, store, [{'hourly': {'time': [NOW.isoformat()]}}],
        'GFS', 'noaa', 'marine', 'waves', dict(west=0,south=0,east=2,north=2), .25,
        NOW, region_id='coast', coverage_mode='regional_tile', step=1)
    assert count == 0


@pytest.mark.asyncio
async def test_euro_fallback_reuses_noaa_cache_without_second_gfs_fetch(monkeypatch):
    import services.weather_pipeline.euro_marine_coarse_ingestion as module
    import services.copernicus_marine_service as cmems
    monkeypatch.setenv('EURO_MARINE_FALLBACK_CACHE_REUSE', '1')
    monkeypatch.setattr(cmems, 'fetch_euro_marine_global_coarse', AsyncMock(return_value=None))
    monkeypatch.setattr(module, 'get_env_flags', lambda: {'is_test_env': False})
    cached = [{'hourly': {'time': [NOW.isoformat()]}}]
    fetch = AsyncMock(side_effect=[None, RuntimeError('redundant GFS request')])
    save = AsyncMock(return_value=1)
    monkeypatch.setattr(module, 'normalize_and_save_loop', save)
    scheduler = S(_gfs_coarse_marine_cache=cached, _fetch_or_mock=fetch, om_provider=None,
                  normalizer=None, store=S(prune_superseded_products=Mock()), _cleanup_and_pause=AsyncMock())
    assert await module.ingest_euro_marine_global_impl(scheduler)
    assert fetch.await_count == 1
    assert {call.kwargs['layer'] for call in save.await_args_list} == {'swell_1','swell_2','wind_waves'}
    assert all(call.args[2] is cached and call.kwargs['estimated_after_index']==0 for call in save.await_args_list)
    assert all(call.kwargs['step']==1 for call in save.await_args_list), 'Cached NOAA steps are already three-hourly'


@pytest.mark.parametrize('first_status,first_body', [(503, ''), (200, '<html>unavailable</html>')])
def test_index_recovers_once_but_preserves_selected_messages(monkeypatch, first_status, first_body):
    import services.noaa_gfs_wave_fetcher as module
    monkeypatch.setenv('NOAA_WAVE_INDEX_RETRY', '1')
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    body = '\n'.join(f'{i+1}:{i*100}:d=2026101812:{key[0]}:{key[1]}:0 hour fcst:'
                     for i,(key,_,_) in enumerate(module.IDX_TO_OM))
    get = Mock(side_effect=[S(status_code=first_status,text=first_body,headers={}),
                            S(status_code=200,text=body,headers={})])
    assert len(module._fetch_selected_index(S(get=get), 'https://example.invalid/wave')) == 12
    assert get.call_count == 2


@pytest.mark.parametrize('status', [401,403,404,429])
def test_index_refusal_is_not_hammered(monkeypatch, status):
    from services.noaa_gfs_wave_fetcher import _fetch_selected_index
    monkeypatch.setenv('NOAA_WAVE_INDEX_RETRY', '1')
    get = Mock(return_value=S(status_code=status,text='',headers={}))
    with pytest.raises(RuntimeError):
        _fetch_selected_index(S(get=get), 'https://example.invalid/wave')
    assert get.call_count == 1


def test_index_retry_off_and_persistent_incomplete_are_bounded(monkeypatch):
    import services.noaa_gfs_wave_fetcher as module
    monkeypatch.setattr(module.time, 'sleep', lambda _: None)
    for flag, expected in [('0',1),('1',2)]:
        monkeypatch.setenv('NOAA_WAVE_INDEX_RETRY', flag)
        get=Mock(return_value=S(status_code=200,text='incomplete',headers={}))
        with pytest.raises(RuntimeError, match='missing wave messages'):
            module._fetch_selected_index(S(get=get), 'https://example.invalid/wave')
        assert get.call_count == expected


@pytest.mark.asyncio
async def test_empty_fallback_off_preserves_legacy_and_wrong_time_parent_is_refused(monkeypatch, tmp_path):
    monkeypatch.setenv('L2_WRITER', '0')
    store=ProductStore(cache_dir=tmp_path)
    from services.weather_pipeline.empty_frame_recovery import recover_empty_gfs_frame
    parent=product()
    parent.valid_time=NOW.replace(hour=15)
    store.save_product(parent,2)
    assert recover_empty_gfs_frame(product('coast',False),store,dict(west=0,south=0,east=2,north=2),NOW) is None
    monkeypatch.delenv('MARINE_EMPTY_FRAME_FALLBACK', raising=False)
    count=await normalize_and_save_loop(S(normalize_async=AsyncMock(return_value=product('coast',False))),
        store,[{'hourly':{'time':[NOW.isoformat()]}}],'GFS','noaa','marine','waves',
        dict(west=0,south=0,east=2,north=2),.25,NOW,region_id='coast',step=1)
    assert count==1
    row=next(p for p in store.get_manifest().products if p.region_id=='coast')
    assert not any(v.is_valid for v in store.load_product(row.filename).grid.vectors)


def test_narrow_box_keeps_real_overlapping_coarse_cells(monkeypatch, tmp_path):
    from services.weather_pipeline.empty_frame_recovery import recover_empty_gfs_frame
    monkeypatch.setenv('L2_WRITER','0')
    store=ProductStore(cache_dir=tmp_path)
    store.save_product(product(),2)
    bbox=dict(west=.5,south=.5,east=1.5,north=1.5)
    recovered,resolution=recover_empty_gfs_frame(product('coast',False),store,bbox,NOW)
    assert resolution==2 and len(recovered.grid.vectors)==4
    assert {(v.lat,v.lng,v.speed) for v in recovered.grid.vectors} == {
        (0,0,1.5),(0,2,1.5),(2,0,1.5),(2,2,1.5)}
    assert recovered.estimate_basis['requested_region_bounds']==bbox
    assert recovered.estimate_basis['cell_support_margin_degrees']==1


def test_fixture_or_estimated_parent_cannot_supply_recovery(monkeypatch, tmp_path):
    from services.weather_pipeline.empty_frame_recovery import recover_empty_gfs_frame
    monkeypatch.setenv('L2_WRITER','0')
    store=ProductStore(cache_dir=tmp_path)
    for fixture,estimated in [(True,False),(False,True)]:
        parent=product()
        parent.is_test_fixture=fixture
        parent.is_estimated=estimated
        store.save_product(parent,2)
    assert recover_empty_gfs_frame(product('coast',False),store,dict(west=0,south=0,east=2,north=2),NOW) is None


@pytest.mark.parametrize('fault', ['unknown_cycle','non_finite'])
def test_unverified_or_nonfinite_parent_is_refused(fault):
    from services.weather_pipeline.empty_frame_recovery import recover_empty_gfs_frame
    parent=product()
    row=S(model='GFS',domain='marine',layer='waves',region_id='global_mid',valid_time_start=NOW,
          is_estimated=False,is_test_fixture=False,model_run_time_status='known',model_run_time=NOW,
          resolution=2,filename='native-parent.json')
    if fault=='unknown_cycle':
        parent.model_run_time_status='missing'
        parent.model_run_time=None
    else:
        parent.grid.vectors[0].speed=float('nan')
    store=S(get_manifest=lambda:S(products=[row]),load_product=lambda _:parent)
    assert recover_empty_gfs_frame(product('coast',False),store,dict(west=0,south=0,east=2,north=2),NOW) is None


@pytest.mark.asyncio
async def test_recovery_cannot_launder_fixture_input(monkeypatch, tmp_path):
    monkeypatch.setenv('L2_WRITER','0')
    monkeypatch.setenv('MARINE_EMPTY_FRAME_FALLBACK','1')
    store=ProductStore(cache_dir=tmp_path)
    store.save_product(product(),2)
    bad=product('coast',False)
    bad.is_test_fixture=True
    count=await normalize_and_save_loop(S(normalize_async=AsyncMock(return_value=bad)),store,
        [{'hourly':{'time':[NOW.isoformat()]}}],'GFS','noaa','marine','waves',
        dict(west=0,south=0,east=2,north=2),.25,NOW,region_id='coast',is_test_env=False,step=1)
    assert count==0


def test_real_lattice_product_survives_euro_validation_only_when_armed(monkeypatch,tmp_path):
    from services.weather_pipeline.lattice_fill import interpolate_between
    from services.weather_pipeline.copernicus_validator import validate_copernicus_product_helper
    monkeypatch.setenv('L2_WRITER','0')
    store=ProductStore(cache_dir=tmp_path)
    parents=[]
    for offset in (0,6):
        p=product()
        p.model='EURO'
        p.provider='copernicus'
        p.source_dataset='ecmwf_wam025'
        for vector in p.grid.vectors:
            vector.u=-.75
            vector.v=-1.299038105676658
        p.valid_time=NOW+timedelta(hours=offset)
        p.product_id=store.save_product(p,2)
        parents.append(p)
    fill=interpolate_between(*parents,NOW+timedelta(hours=3))
    monkeypatch.setenv('EURO_MARINE_LATTICE_VALIDATION','1')
    valid,reason=validate_copernicus_product_helper(store,fill)
    assert valid,reason
    monkeypatch.delenv('EURO_MARINE_LATTICE_VALIDATION')
    assert not validate_copernicus_product_helper(store,fill)[0]
    monkeypatch.setenv('EURO_MARINE_LATTICE_VALIDATION','1')
    for key, value in [('weight', .8), ('bracket_b_valid_time', (NOW+timedelta(hours=12)).isoformat())]:
        original=fill.estimate_basis[key]
        fill.estimate_basis[key]=value
        assert not validate_copernicus_product_helper(store,fill)[0]
        fill.estimate_basis[key]=original
    fill.estimate_basis['bracket_a_product_id']='missing.json'
    assert not validate_copernicus_product_helper(store,fill)[0]

@pytest.mark.asyncio
@pytest.mark.parametrize('cached,stride,enabled,ecmwf', [(c,h,e,w) for c,h in ((False,1),(True,1),(True,3)) for e in (False,True) for w in (False,True)])
async def test_native_euro_tail_preserves_source_cadence(monkeypatch, cached, stride, enabled, ecmwf):
    import services.weather_pipeline.euro_marine_coarse_ingestion as module
    import services.copernicus_marine_service as cmems
    import services.ecmwf_wave_service as waves
    monkeypatch.setenv('EURO_MARINE_NATIVE_TAIL_CADENCE', '1' if enabled else '0')
    monkeypatch.setenv('EURO_MARINE_COARSE_ECMWF', '1' if ecmwf else '0')
    monkeypatch.setenv('EURO_MARINE_COARSE_GFS_FILL', '0')
    monkeypatch.setenv('EURO_MARINE_GFS_REUSE_CACHE', '1')
    monkeypatch.setattr(module, 'get_env_flags', lambda: {'is_test_env': False})
    native = [{'hourly': {'time': [NOW.isoformat()]}}]
    hybrid = [{'hourly': {'time': [(NOW+timedelta(hours=3)).isoformat()]}}]
    times = [(NOW+timedelta(hours=h)).isoformat() for h in range(0,22,stride)]
    source = [{'hourly': {'time': times, 'wave_height': list(range(len(times)))}}]
    monkeypatch.setattr(cmems, 'fetch_euro_marine_global_coarse', AsyncMock(return_value=native))
    monkeypatch.setattr(waves, 'fetch_euro_marine_waves_global', AsyncMock(return_value=hybrid))
    save = AsyncMock(return_value=1)
    monkeypatch.setattr(module, 'normalize_and_save_loop', save)
    fetch = AsyncMock(return_value=source)
    scheduler = S(_gfs_coarse_marine_cache=source if cached else None, _fetch_or_mock=fetch,
                  om_provider=None, normalizer=None, store=S(prune_superseded_products=Mock()),
                  _cleanup_and_pause=AsyncMock())
    assert await module.ingest_euro_marine_global_impl(scheduler)
    assert fetch.await_count == (0 if cached else 1)
    tails = [call for call in save.await_args_list if call.kwargs.get('estimated_after_index') == 0]
    assert {call.kwargs['layer'] for call in tails} == {'waves','swell_1','swell_2','wind_waves'}
    for call in tails:
        cutoff = NOW+timedelta(hours=3 if ecmwf and call.kwargs['layer']=='waves' else 0)
        indices = [i for i,t in enumerate(times) if datetime.fromisoformat(t)>cutoff]
        expected = indices if enabled and cached and stride==3 else indices[::3]
        hourly = call.args[2][0]['hourly']
        selected = list(range(0,len(hourly['time']),call.kwargs['step']))
        assert [hourly['time'][i] for i in selected] == [times[i] for i in expected]
        assert [hourly['wave_height'][i] for i in selected] == expected
        assert call.kwargs['estimate_basis'] == {'type':'gfs_estimated_fallback','method':'gfs_wave_fallback','source_model':'ncep_gfswave025'}
    assert all(call.kwargs['step']==1 for call in save.await_args_list if 'estimated_after_index' not in call.kwargs)
    assert scheduler._gfs_coarse_marine_cache is None

def complete_extension_store(monkeypatch,tmp_path):
    monkeypatch.setenv('L2_WRITER','0')
    store=ProductStore(cache_dir=tmp_path/'weather_products')
    for layer in ('waves','swell_1','swell_2','wind_waves'):
        native=product('global_coarse');native.model='EURO';native.provider='copernicus';native.layer=layer
        native.coverage_mode='global_tile';native.source_dataset='cmems_native'
        store.save_product(native,2)
        for offset in (3,6):
            parent=product('global_coarse');parent.layer=layer;parent.coverage_mode='global_tile'
            parent.valid_time=NOW+timedelta(hours=offset);store.save_product(parent,2)
            tail=parent.model_copy(deep=True);tail.model='EURO';tail.provider='copernicus'
            tail.source_dataset='gfs_estimated_fallback';tail.is_estimated=True;tail.is_forecast_authoritative=False
            tail.estimate_basis={'type':'gfs_estimated_fallback','method':'gfs_wave_fallback','source_model':'ncep_gfswave025'}
            store.save_product(tail,2)
    return store


@pytest.mark.asyncio
async def test_completed_euro_extension_noop_is_observed_without_failure(monkeypatch,tmp_path):
    import scheduler
    from scripts.local_full_forecast_cycle import install_full_cycle_probe
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    monkeypatch.setenv('EURO_MARINE_NATIVE_TAIL_CADENCE','1')
    store=complete_extension_store(monkeypatch,tmp_path)
    for name,method in list(vars(WeatherPipelineScheduler).items()):
        if name.startswith('ingest_'):monkeypatch.setattr(WeatherPipelineScheduler,name,method)
    monkeypatch.setattr(WeatherPipelineScheduler,'ingest_euro_marine_extended_estimates',AsyncMock(return_value=False))
    monkeypatch.setattr(scheduler,'ingest_marine_forecast_task',scheduler.ingest_marine_forecast_task)
    install_full_cycle_probe('complete-noop-test',tmp_path)
    assert await WeatherPipelineScheduler(store=store).ingest_euro_marine_extended_estimates() is False
    import json
    report=json.loads((tmp_path/'full-forecast-cycle.json').read_text())
    assert report['jobs'][0]['status']=='no_op'
    assert report['jobs'][0]['returned'] is False
    proof=json.loads((tmp_path/'extension-noop-proof.json').read_text())
    assert proof['tail_products_checked']==8 and len(proof['checks'])==4


@pytest.mark.parametrize('fault',['complete','interior_missing','missing_file','unusable','fixture','wrong_identity','mismatched_parent','later_tier','missing_gfs_layer','missing_native'])
def test_noop_requires_complete_real_parent_backed_tail(monkeypatch,tmp_path,fault):
    from scripts.local_full_forecast_cycle import _verified_euro_extension_noop
    store=complete_extension_store(monkeypatch,tmp_path);manifest=store.get_manifest()
    target=next(x for x in manifest.products if x.model=='EURO' and x.layer=='waves' and x.valid_time_start==NOW+timedelta(hours=3))
    if fault in ('interior_missing','missing_gfs_layer','missing_native','later_tier'):
        rows=list(manifest.products)
        if fault=='interior_missing':rows=[x for x in rows if x.filename!=target.filename]
        elif fault=='missing_gfs_layer':rows=[x for x in rows if not (x.model=='GFS' and x.layer=='swell_2')]
        elif fault=='missing_native':rows=[x for x in rows if not (x.model=='EURO' and x.layer=='swell_2' and not x.is_estimated)]
        else:rows.append(target.model_copy(update={'region_id':'global_mid'}))
        monkeypatch.setattr(store,'get_manifest',lambda:manifest.model_copy(update={'products':rows}))
    elif fault!='complete':
        original=store.load_product
        def load(name):
            p=original(name)
            if name!=target.filename:return p
            if fault=='missing_file':return None
            p=p.model_copy(deep=True)
            if fault=='unusable':
                for v in p.grid.vectors:v.is_valid=False
            elif fault=='fixture':p.is_test_fixture=True
            elif fault=='wrong_identity':p.model='ICON'
            elif fault=='mismatched_parent':p.grid.vectors[0].speed+=1
            return p
        monkeypatch.setattr(store,'load_product',load)
    proof=_verified_euro_extension_noop(store)
    assert bool(proof)==(fault=='complete')
    if proof:assert proof['tail_products_checked']==8


@pytest.mark.parametrize('flag,name,value,expected',[
    ('0','ingest_euro_marine_extended_estimates',False,'failed'),
    (None,'ingest_euro_marine_extended_estimates',False,'failed'),
    ('1','ingest_euro_marine_extended_estimates',False,'no_op'),
    ('1','ingest_gfs_marine_global',False,'failed'),
    ('0','ingest_euro_marine_extended_estimates',True,'returned')])
def test_noop_classification_is_narrow_and_default_off(monkeypatch,tmp_path,flag,name,value,expected):
    from scripts.local_full_forecast_cycle import _completed_job_status
    store=complete_extension_store(monkeypatch,tmp_path)
    if flag is None:monkeypatch.delenv('EURO_MARINE_NATIVE_TAIL_CADENCE',raising=False)
    else:monkeypatch.setenv('EURO_MARINE_NATIVE_TAIL_CADENCE',flag)
    status,proof=_completed_job_status(name,value,store)
    assert status==expected
    assert bool(proof)==(expected=='no_op')
