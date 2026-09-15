"""Exercise real cache-hit paths without network or large production allocations."""
import gc
import hashlib
import weakref
from datetime import datetime, timezone

import pytest
from services.weather_pipeline.providers import open_meteo_provider as module


class Payload:
    def __init__(self):
        self.buffer = bytearray(65536)


@pytest.mark.asyncio
@pytest.mark.parametrize('lane', ['grid', 'point'])
@pytest.mark.parametrize('expired_count', [0, 8, 32])
async def test_warm_read_releases_unrelated_expired_payloads(monkeypatch, lane, expired_count):
    class Clock(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime.fromtimestamp(1000, timezone.utc)

    monkeypatch.setattr(module, 'datetime', Clock)
    monkeypatch.setattr(module.httpx, 'AsyncClient', lambda *a, **k: pytest.fail('warm read used network'))
    provider = module.OpenMeteoProvider
    grid, point = {}, {}
    monkeypatch.setattr(provider, '_GRID_CACHE', grid)
    monkeypatch.setattr(provider, '_POINT_CACHE', point)
    refs = []
    for cache in (grid, point):
        for index in range(expired_count):
            payload = Payload()
            refs.append(weakref.ref(payload))
            # Exactly at TTL is expired, just like the existing lookup contract.
            cache[f'expired-{index}'] = (1000, payload)
            del payload
        cache['other-warm'] = (1001, {'unrelated': True})
    coords = ([0.0], [10.0])
    digest = hashlib.sha256(repr((tuple(coords[0]), tuple(coords[1]))).encode()).hexdigest()
    grid_key = f'GFS_marine_waves_{digest}_0.25_2'
    point_key = 'GFS_marine_waves_0.0000_10.0000_2'
    response = {'hourly': {'wave_height': [1.25]}}
    grid[grid_key] = (1001, response)
    point[point_key] = (1001, response)
    instance = provider()
    args = dict(model='GFS', domain='marine', layer='waves', forecast_days=2)
    if lane == 'grid':
        result = await instance.fetch_grid(**args, bbox={}, precomputed_coords=coords)
    else:
        result = await instance.fetch_point(**args, lat=0.0, lng=10.0)
    gc.collect()
    retained = sum(ref() is not None for ref in refs)
    print(f'lane={lane} expired_per_cache={expired_count} retained_payload_bytes={retained * 65536}')
    assert result is response, 'warm values and object identity must remain unchanged'
    assert grid['other-warm'][0] == point['other-warm'][0] == 1001
    assert retained == 0, 'expired payloads should not survive unrelated warm requests'
