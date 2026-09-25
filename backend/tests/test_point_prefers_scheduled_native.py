"""
A15-04 (audit 15.0, measured live 2026-09-25 18Z): `/point` must answer from the product the map
draws, not from whichever cached viewport box happens to contain the point.

At Sebastian Inlet and Cocoa Beach, `/point` returned an Open-Meteo `viewport_gfs_marine_*` product
(model cycle unknown) that another request had built, while the heatmap drew the NOAA-direct 12Z
`florida_east_coast` tile — ~8% apart offshore, with `infoboxHeatmapParity` false.
"""
from datetime import timedelta
from types import SimpleNamespace as S

import pytest

from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.dynamic_cycle_policy import prefers_scheduled_native
from tests.test_dynamic_cycle_selection import fixture


def _sebastian_fixture():
    """`old` = the unknown-cycle Open-Meteo viewport box; `new`/`item` = the scheduled NOAA tile."""
    old, new, item = fixture()
    old.model_run_time = None
    old.model_run_time_status = 'missing'
    old.upstream_provider = 'open-meteo'
    old.product_id = 'viewport_gfs_marine_waves_test.json'
    item.upstream_provider = new.upstream_provider = 'noaa'
    return old, new, item


def _manifest(item):
    return S(products=[item])


@pytest.mark.asyncio
async def test_point_answers_from_the_scheduled_native_tile(monkeypatch):
    async def passthrough(response, *args):
        return response
    monkeypatch.setattr('services.weather_pipeline.point_resolution.augment_with_surf', passthrough)
    old, new, item = _sebastian_fixture()
    store = S(get_manifest=lambda: _manifest(item),
              load_product=lambda name: {old.product_id: old, new.product_id: new}[name])
    index = S(find_product_containing=lambda **kw: {'product_id': old.product_id})
    resolver = PointResolutionService(store=store, dynamic_index=index, provider=S())
    response = await resolver.resolve_point('GFS', 'marine', 'waves', 28, -80, new.valid_time.isoformat())
    assert response.product_id == new.product_id
    assert response.point.speed == 2                  # the drawn tile's value, not the box's 1
    assert response.is_dynamic_viewport_product is False
    assert response.model_run_time == new.model_run_time


def test_the_rule_fires_on_the_measured_case():
    old, new, item = _sebastian_fixture()
    assert prefers_scheduled_native(_manifest(item), old, 28, -80, new.valid_time)


@pytest.mark.parametrize('difference', [
    'dynamic_cycle_known', 'scheduled_coarser', 'scheduled_estimated', 'scheduled_global',
    'scheduled_global_tile_mode', 'scheduled_cycle_missing', 'scheduled_off_by_1h',
    'point_outside_scheduled', 'wind_domain', 'kill_switch', 'no_manifest',
])
def test_the_dynamic_product_keeps_its_place(monkeypatch, difference):
    old, new, item = _sebastian_fixture()
    manifest, lat, lng = _manifest(item), 28, -80
    if difference == 'dynamic_cycle_known':
        old.model_run_time, old.model_run_time_status = new.model_run_time, 'known'
    elif difference == 'scheduled_coarser':
        item.resolution = 8
    elif difference == 'scheduled_estimated':
        item.is_estimated = True
    elif difference == 'scheduled_global':
        item.filename = 'gfs_marine_waves_global_mid_20260101T000000Z.json'
    elif difference == 'scheduled_global_tile_mode':
        item.coverage_mode = 'global_tile'
    elif difference == 'scheduled_cycle_missing':
        item.model_run_time_status = 'missing'
    elif difference == 'scheduled_off_by_1h':
        item.valid_time_start += timedelta(hours=1)
    elif difference == 'point_outside_scheduled':
        lat, lng = 40, -60
    elif difference == 'wind_domain':
        old.domain = 'wind'
    elif difference == 'kill_switch':
        monkeypatch.setenv('POINT_PREFER_SCHEDULED_NATIVE', '0')
    elif difference == 'no_manifest':
        manifest = None
    assert not prefers_scheduled_native(manifest, old, lat, lng, new.valid_time)


def test_thirty_minutes_is_the_time_window():
    old, new, item = _sebastian_fixture()
    item.valid_time_start = new.valid_time + timedelta(minutes=30)
    assert prefers_scheduled_native(_manifest(item), old, 28, -80, new.valid_time)
    item.valid_time_start = new.valid_time + timedelta(minutes=31)
    assert not prefers_scheduled_native(_manifest(item), old, 28, -80, new.valid_time)
