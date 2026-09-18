import asyncio
from services.weather_pipeline.series_evidence import cycle_census


def test_ingestion_time_does_not_prove_same_cycle():
    result = cycle_census([{'run_time':'2026-09-17T10:41:00Z'}]*2)
    assert result['unknown_cycle_frames'] == 2
    assert not result['same_cycle_verified']


def test_same_cycle_and_mixed_supplier_are_independent():
    frames=[{'model_run_time':'2026-09-17T06:00:00Z','model_run_time_status':'known','upstream_provider':p} for p in ['noaa','open-meteo']]
    result=cycle_census(frames)
    assert result['same_cycle_verified']
    assert result['mixed_sources']
    frames[1]['model_run_time']='2026-09-17T12:00:00Z'
    assert cycle_census(frames)['mixed_known_cycles']


def test_all_assembly_paths_get_bounded_correlated_timing(monkeypatch):
    from services.weather_pipeline import grid_series_helper as helper
    async def build(*args,**kwargs): return {'frames':[]}
    monkeypatch.setattr(helper,'_build_grid_series_impl',build)
    result=asyncio.run(helper.build_grid_series(None,None,'GFS','marine','waves','-90,12,-89,13','0'))
    timing=result['timing']
    assert len(timing['trace_id']) == 32
    assert timing['total_build_ms'] >= timing['assembly_ms'] >= 0
    assert not result['cycle_census']['same_cycle_verified']
