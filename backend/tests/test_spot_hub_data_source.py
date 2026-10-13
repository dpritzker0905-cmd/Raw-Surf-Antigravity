"""W-34 (2026-09-30): the spot hub names WHERE its sea came from, instead of a hard-coded source.

SpotConditions.js printed "Data from Open-Meteo Marine API" on every spot, while `/conditions/{id}`
sampled the stored NOAA product whenever the manifest held one (measured 2026-09-29 at Spanish House:
the map beneath was `gfs_marine_waves_florida_east_coast`, source ncep_gfswave025). "Open-Meteo" is
true only on the cache-miss lane, the direct point query. The producer now records the source where
the value is taken, and the route's whitelist carries it (the same wire boundary that once dropped
`forecast_confidence`, see test_conditions_route_wire_contract.py).

These tests EXECUTE the producer (both lanes) and the route.
"""
import asyncio
import os
import sys
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace as NS

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline import spot_conditions as SC  # noqa: E402


def _hold_physics(monkeypatch):
    """Isolate provenance: flags at default, no geometry, a fixed breaking transform."""
    from services.weather_pipeline import surf_point
    for flag in ['SURF_PARTITIONS', 'RATING_TIDE', 'RATING_BREAKER_TYPE', 'RATING_LOCAL_SIZE']:
        monkeypatch.setenv(flag, '0')
    monkeypatch.setattr(surf_point, 'resolve_surf_geometry', lambda *a: None)
    monkeypatch.setattr(SC, '_breaking_ft', lambda *a, **k: (3.9, 'test'))


class _Resolver:
    """The service surface the producer uses: a manifest lookup, a sampler and a point provider."""

    def __init__(self, product=None, hourly=None):
        self.product = product
        self.hourly = hourly
        self.upstream_calls = 0
        self.sampler = NS(sample_point=lambda prod, *a: NS(point=prod.point))
        self.provider = NS(fetch_point=self.fetch_point)

    async def resolve_point(self, **kw):
        return None

    async def find_cached_grid_product(self, model, domain, layer, *args):
        return self.product if layer == 'waves' else None

    async def fetch_point(self, **kw):
        self.upstream_calls += 1
        return {'hourly': self.hourly} if self.hourly else {'hourly': {}}


def _three_hourly(days=12, h=1.2):
    t0 = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0) - timedelta(hours=6)
    times = [(t0 + timedelta(hours=3 * i)).strftime('%Y-%m-%dT%H:%M') for i in range(days * 8)]
    n = len(times)
    return {'time': times, 'wave_height': [h] * n, 'wave_direction': [90.0] * n, 'wave_period': [11.0] * n,
            'swell_wave_height': [1.0] * n, 'swell_wave_direction': [95.0] * n}


def test_stored_lane_names_the_product_it_sampled(monkeypatch):
    _hold_physics(monkeypatch)
    product = NS(point=NS(speed=1.2, direction=90.0, period=11.0), product_id='gfs_marine_waves_florida_east_coast_20260930T000000Z.json',
                 upstream_provider='noaa', source_dataset='ncep_gfswave025')
    r = _Resolver(product=product)
    out = asyncio.run(SC.resolve_spot_conditions_impl(r, 'GFS', 27.9, -80.5, 1))
    assert out['current_conditions']['data_source'] == {
        'kind': 'stored_product', 'model': 'GFS', 'product_id': 'gfs_marine_waves_florida_east_coast_20260930T000000Z.json',
        'upstream': 'noaa', 'dataset': 'ncep_gfswave025'}


def test_fallback_lane_says_it_was_a_point_query(monkeypatch):
    _hold_physics(monkeypatch)
    r = _Resolver(product=None, hourly=_three_hourly())
    out = asyncio.run(SC.resolve_spot_conditions_impl(r, 'GFS', 27.9, -80.5, 1))
    assert r.upstream_calls >= 1, 'the cache missed, so the point query ran'
    src = out['current_conditions']['data_source']
    assert src['kind'] == 'point_query' and src['model'] == 'GFS'
    assert out['current_conditions']['wave_height_ft'] == 3.9          # the value the source describes


def test_no_sea_names_no_source(monkeypatch):
    _hold_physics(monkeypatch)
    r = _Resolver(product=None, hourly=None)                            # cache miss and an empty answer
    out = asyncio.run(SC.resolve_spot_conditions_impl(r, 'GFS', 27.9, -80.5, 1))
    assert 'data_source' not in out['current_conditions']


def test_the_point_query_label_comes_from_the_real_provider_class():
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    provider = OpenMeteoProvider.__new__(OpenMeteoProvider)             # no network, only the identity
    assert SC.point_query_source(provider, 'EURO') == {'kind': 'point_query', 'model': 'EURO', 'upstream': 'open-meteo'}


@pytest.mark.parametrize('source', [
    {'kind': 'stored_product', 'model': 'GFS', 'product_id': 'p.json', 'upstream': 'noaa', 'dataset': 'ncep_gfswave025'},
    {'kind': 'point_query', 'model': 'ICON', 'upstream': 'open-meteo'},
])
def test_the_route_carries_the_source_through_its_whitelist(monkeypatch, source):
    from routes.surf_data import conditions as C

    async def fake_resolve(*a, **k):
        return {'current_conditions': {
            'wave_height_ft': 2.3, 'wave_direction': 65.6, 'wave_period': 9.1, 'swell_height_ft': 1.0,
            'label': 'Knee High', 'updated_at': '2026-09-30T00:00:00Z', 'data_source': source}}

    async def fake_fetch_point(*a, **k):
        return {'hourly': {}}

    monkeypatch.setattr(C.point_resolution_service, 'resolve_spot_conditions', fake_resolve, raising=False)
    monkeypatch.setattr(C.point_resolution_service.provider, 'fetch_point', fake_fetch_point, raising=False)
    monkeypatch.setattr(C, 'resolve_surf_geometry', lambda *a: None, raising=False)

    class _Res:
        def scalar_one_or_none(self):
            return NS(id='s', name='Spanish House', latitude=27.935, longitude=-80.483)

    class _DB:
        async def execute(self, *a, **k):
            return _Res()

    out = asyncio.run(C.get_spot_conditions('s', model='GFS', db=_DB()))
    assert out['current']['data_source'] == source
