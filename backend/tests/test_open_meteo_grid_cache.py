"""Coordinate identity must survive warm-cache reads in both transport lanes."""
import httpx
import pytest
from services.weather_pipeline.providers import open_meteo_provider as provider


@pytest.mark.asyncio
@pytest.mark.parametrize('proxy', [False, True])
@pytest.mark.parametrize('middle', [([1.0, 4.0], [11.0, 14.0]), ([2.0, 1.0], [12.0, 11.0])])
async def test_cache_respects_every_coordinate_and_order(monkeypatch, proxy, middle):
    monkeypatch.setattr(provider, 'is_test_environment', lambda: False)
    monkeypatch.setattr(provider.OpenMeteoProvider, '_GRID_CACHE', {})
    monkeypatch.setattr(provider.OpenMeteoProvider, '_breaker_open', classmethod(lambda cls: False))
    monkeypatch.setenv('USE_WEATHER_PROXY', str(proxy).lower())
    calls = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            body = kwargs['json']['body'] if proxy else kwargs['data']
            lats, lons = body['latitude'], body['longitude']
            if not proxy:
                lats = list(map(float, lats.split(',')))
                lons = list(map(float, lons.split(',')))
            calls.append((list(lats), list(lons)))
            return httpx.Response(200, request=httpx.Request('POST', url), json=[
                {'latitude': lat, 'longitude': lon, 'hourly': {'wave_height': [lat]}}
                for lat, lon in zip(lats, lons)
            ])

    monkeypatch.setattr(provider.httpx, 'AsyncClient', Client)
    instance = provider.OpenMeteoProvider()
    first = ([0.0, 1.0, 2.0, 3.0], [10.0, 11.0, 12.0, 13.0])
    second = ([0.0, *middle[0], 3.0], [10.0, *middle[1], 13.0])
    args = dict(model='GFS', domain='marine', layer='waves', bbox={}, inter_batch_delay=0)
    await instance.fetch_grid(**args, precomputed_coords=first)
    changed = await instance.fetch_grid(**args, precomputed_coords=second)
    assert [row['latitude'] for row in changed] == second[0]
    assert [row['longitude'] for row in changed] == second[1]
    assert len(calls) == 2, 'Changed interior coordinates must fetch their own weather'
    repeated = await instance.fetch_grid(**args, precomputed_coords=second)
    assert repeated == changed
    assert len(calls) == 2, 'Identical coordinates must still use the warm cache'
