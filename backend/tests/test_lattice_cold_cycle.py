"""Cold-cycle ordering and bounded regional wind coverage regressions."""
from datetime import timedelta
from types import SimpleNamespace
from unittest.mock import AsyncMock
import pytest
from tests.test_lattice_inband_fill import T0,RUN,_product,_four,_scheduler_with,_manifest_entry
from services.weather_pipeline.lattice_fill import fill_inband_lattice_gaps_impl

@pytest.mark.parametrize('mode',['include','skip','only'])
@pytest.mark.parametrize('armed',[True,False])
def test_real_cycle_places_one_lattice_pass_after_all_selected_producers(monkeypatch,mode,armed):
    from scheduler import forecast
    import services.weather_pipeline.scheduler as module
    import services.weather_pipeline.store as stores
    import services.weather_pipeline.wind_lane_ingest as hrrr
    names=[n for n in vars(module.WeatherPipelineScheduler) if n.startswith('ingest_')]
    calls=[]
    class FakeScheduler:
        def __init__(self,store):self.store=store
    for name in names:
        async def job(self,_name=name):calls.append(_name);return True
        setattr(FakeScheduler,name,job)
    monkeypatch.setattr(module,'WeatherPipelineScheduler',FakeScheduler)
    monkeypatch.setattr(stores,'ProductStore',lambda:SimpleNamespace(prune_old_products=lambda _:None))
    monkeypatch.setattr(forecast,'ingest_global_model',AsyncMock(return_value=True))
    monkeypatch.setattr(hrrr,'ingest_hrrr_wind_lane',AsyncMock(return_value=None))
    monkeypatch.setattr(forecast.asyncio,'sleep',AsyncMock())
    monkeypatch.setattr(forecast.gc,'collect',lambda:None)
    monkeypatch.setenv('INGEST_PILOTS',mode)
    monkeypatch.setenv('MARINE_INGEST_ALL','1')
    monkeypatch.setenv('LATTICE_FILL_AFTER_PILOTS','1' if armed else '0')
    monkeypatch.setenv('CONSENSUS_INGEST','0')
    monkeypatch.setenv('COPERNICUS_ISLAND_INGEST','0')
    monkeypatch.setenv('WIND_PILOT_INGEST','1')
    forecast.ingest_marine_forecast_task()
    lattice='ingest_lattice_inband_fill'
    if armed:
        assert calls.count(lattice)==1
        assert calls[-1]==lattice
        if mode!='skip':assert calls.index('ingest_euro_wind_pilot')<calls.index(lattice)
    elif mode=='only':assert lattice not in calls
    else:
        assert calls.count(lattice)==1
        if mode=='include':assert calls.index(lattice)<calls.index('ingest_euro_marine_global_mid')


def regional_pair():
    a=_product(T0,_four(2,180,None),domain='wind',layer='wind',region_id='coast')
    b=_product(T0+timedelta(hours=6),_four(4,180,None),domain='wind',layer='wind',region_id='coast')
    for p in (a,b):
        p.coverage_mode='regional_tile';p.tile_id='coast'
        p.model_run_time_status='known';p.model_run_time=RUN
        p.value_kind='wind_speed';p.value_unit='m/s'
    return a,b

@pytest.mark.asyncio
async def test_real_regional_wind_fill_keeps_values_resolution_and_provenance(monkeypatch):
    monkeypatch.setenv('LATTICE_REGIONAL_WIND_FILL','1')
    a,b=regional_pair();before=(a.model_dump(),b.model_dump())
    sched=_scheduler_with({'a.json':_manifest_entry(a,'a.json',.25),'b.json':_manifest_entry(b,'b.json',.25)})
    assert await fill_inband_lattice_gaps_impl(sched)
    batch=sched.store.save_products_batch.call_args.args[0]
    assert len(batch)==1
    est,res=batch[0]
    assert res==.25 and est.region_id==est.tile_id=='coast'
    assert est.coverage_mode=='regional_tile'
    assert est.valid_time==T0+timedelta(hours=3)
    assert est.grid.vectors[0].speed==pytest.approx(3)
    assert est.is_estimated and not est.is_forecast_authoritative
    assert est.estimate_basis['bracket_a_product_id']==a.product_id
    assert est.estimate_basis['bracket_b_product_id']==b.product_id
    assert est.model_run_time_status=='known' and est.model_run_time==RUN
    assert (a.model_dump(),b.model_dump())==before

@pytest.mark.asyncio
@pytest.mark.parametrize('fault',['off','fixture','estimated','unknown_cycle','conflicting_cycle','shifted_cell','wide_gap','marine'])
async def test_regional_fill_refuses_unqualified_brackets(monkeypatch,fault):
    monkeypatch.setenv('LATTICE_REGIONAL_WIND_FILL','0' if fault=='off' else '1')
    a,b=regional_pair()
    if fault=='fixture':a.is_test_fixture=True
    if fault=='estimated':b.is_estimated=True;b.is_forecast_authoritative=False
    if fault=='unknown_cycle':a.model_run_time_status='missing';a.model_run_time=None
    if fault=='conflicting_cycle':b.model_run_time=RUN+timedelta(hours=6)
    if fault=='shifted_cell':b.grid.vectors[0].lat+=1
    if fault=='wide_gap':b.valid_time=T0+timedelta(hours=12)
    if fault=='marine':
        for p in (a,b):p.domain='marine';p.layer='waves'
    sched=_scheduler_with({'a.json':_manifest_entry(a,'a.json',.25),'b.json':_manifest_entry(b,'b.json',.25)})
    assert not await fill_inband_lattice_gaps_impl(sched)
    sched.store.save_products_batch.assert_not_called()
