"""GFS wind grids must be GFS: the hurricane eye that moved on a one-stop zoom (owner, 2026-10-09).

WHAT HAPPENED
-------------
At a fixed forecast hour the owner zoomed one stop in and out over the Gulf hurricane and the eye
changed place, size and shape. Each stop's viewport snapped to a different box, and the two boxes
had been built by two different upstreams under ONE label (model GFS, source_dataset gfs_seamless):

  * viewport_gfs_wind_wind_20261009T150000Z_-90.00_25.00_-78.00_32.00: Open-Meteo's breaker was open
    (15:21:49Z), so the wind native recovery filled it from NOAA's GFS 0.25 GRIB, run 06Z;
  * viewport_gfs_wind_wind_20261009T150000Z_-92.00_25.00_-79.00_32.00: Open-Meteo answered (15:22:31Z)
    with models=gfs_seamless, which inside HRRR's domain IS HRRR (3 km): the served speeds equal
    Open-Meteo's models=gfs_hrrr at 405 of 405 nodes, and gfs_global at 2 of 405.

The world base under both is NOAA GFS. Drawn through the real engine (frontend wind bench, eye mode,
fixtures from those two products), the eye's centre moved 38.3 km, its weakest wall point fell 16 kn
(closed to 48 kn -> 32 kn) and its area at 32 kn grew 2.17x, at every zoom 5.5-7. The same data in
the other box drew the identical eye (0 km), so the renderer is not the cause; the label is.

THE FIX (dark, D-001: it moves served wind speeds inside HRRR's domain)
-----------------------------------------------------------------------
WIND_GRID_GFS_GLOBAL=1 makes every Open-Meteo GFS WIND GRID request ask for models=gfs_global, the
same model as the NOAA base and the native recovery. Bench, same pair of boxes: 9.1 km, -2 kn, area
0.71x (the residue is Open-Meteo's own GFS resampling at the eye cell, up to 17.5 kn there); two boxes
from the same lane draw the same eye. Point forecasts, pressure/precipitation and ICON/EURO are untouched.
"""
import httpx
import pytest

from services.weather_pipeline.providers import open_meteo_provider as provider


def _capture(monkeypatch):
    monkeypatch.setattr(provider, 'is_test_environment', lambda: False)
    monkeypatch.setattr(provider.OpenMeteoProvider, '_GRID_CACHE', {})
    monkeypatch.setattr(provider.OpenMeteoProvider, '_breaker_open', classmethod(lambda cls: False))
    monkeypatch.setenv('USE_WEATHER_PROXY', 'false')
    sent = []

    class Client:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def post(self, url, **kwargs):
            body = kwargs['data']
            sent.append(body.get('models'))
            lats = list(map(float, body['latitude'].split(',')))
            lons = list(map(float, body['longitude'].split(',')))
            return httpx.Response(200, request=httpx.Request('POST', url), json=[
                {'latitude': la, 'longitude': lo, 'hourly': {'time': ['2026-10-09T15:00'], 'wind_speed_10m': [10.0],
                                                            'wind_direction_10m': [90.0], 'pressure_msl': [1010.0]}}
                for la, lo in zip(lats, lons)
            ])

    monkeypatch.setattr(provider.httpx, 'AsyncClient', Client)
    return sent


async def _models_sent(monkeypatch, model, domain, layer):
    sent = _capture(monkeypatch)
    await provider.OpenMeteoProvider().fetch_grid(
        model=model, domain=domain, layer=layer, bbox={}, inter_batch_delay=0,
        precomputed_coords=([27.5, 28.0], [-87.5, -87.0]))
    assert sent, 'the provider made no request'
    return set(sent)


@pytest.mark.asyncio
async def test_default_is_unchanged_gfs_wind_grid_still_asks_for_gfs_seamless(monkeypatch):
    # The pre-lane default. Since D-017 the HRRR wind lane (WIND_HRRR_LANE, default on) implies gfs_global too
    # (tests/test_wind_hrrr_lane.py), so the pre-lane behaviour is pinned with the lane killed.
    monkeypatch.delenv('WIND_GRID_GFS_GLOBAL', raising=False)
    monkeypatch.setenv('WIND_HRRR_LANE', '0')
    assert await _models_sent(monkeypatch, 'GFS', 'wind', 'wind') == {'gfs_seamless'}


@pytest.mark.asyncio
async def test_flag_on_gfs_wind_grid_asks_for_gfs_global(monkeypatch):
    monkeypatch.setenv('WIND_GRID_GFS_GLOBAL', '1')
    assert await _models_sent(monkeypatch, 'GFS', 'wind', 'wind') == {'gfs_global'}


@pytest.mark.asyncio
@pytest.mark.parametrize('model,domain,layer,expected', [
    ('ICON', 'wind', 'wind', 'dwd_icon'),
    ('EURO', 'wind', 'wind', 'ecmwf_ifs'),
    ('GFS', 'weather', 'pressure', 'gfs_seamless'),
])
async def test_flag_on_touches_only_gfs_wind(monkeypatch, model, domain, layer, expected):
    monkeypatch.setenv('WIND_GRID_GFS_GLOBAL', '1')
    assert await _models_sent(monkeypatch, model, domain, layer) == {expected}


@pytest.mark.parametrize('value,on', [('1', True), ('0', False), ('', False), ('true', False)])
def test_flag_reads_the_environment_at_call_time(monkeypatch, value, on):
    monkeypatch.setenv('WIND_HRRR_LANE', '0')          # the flag alone (the lane implies it; D-017)
    monkeypatch.setenv('WIND_GRID_GFS_GLOBAL', value)
    assert provider.wind_grid_gfs_global() is on


def test_flag_is_declared_dark_in_the_registry():
    from routes.admin.surf_forecast import _RATING_FLAGS
    default, controls, where = _RATING_FLAGS['WIND_GRID_GFS_GLOBAL']
    assert default == '0' and 'gfs_global' in controls and where == 'Render env'
