"""Time identity across the legacy composite, including offset and midnight controls."""
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

import pytest
from services import surf_conditions as sc


@pytest.fixture
def provider(monkeypatch):
    payload, requests = {}, []

    class Client:
        def __init__(self, **kwargs):
            pass

        async def __aenter__(self):
            return self

        async def __aexit__(self, *args):
            pass

        async def get(self, url, **kwargs):
            requests.append(kwargs['params'])
            return type('Response', (), {'status_code': 200, 'json': lambda _: payload})()

    monkeypatch.setattr(sc.httpx, 'AsyncClient', Client)
    return payload, requests


@pytest.mark.asyncio
@pytest.mark.parametrize('offset', [-6, 0, 9])
async def test_wrapper_passes_one_utc_hour_to_all_sources(monkeypatch, offset):
    sources = [AsyncMock(return_value={}) for _ in range(3)]
    for name, mock in zip(['get_surf_conditions', 'get_wind_conditions', 'get_noaa_tide_data'], sources):
        monkeypatch.setattr(sc, name, mock)
    target = datetime(2026, 9, 16, 0, 35, tzinfo=timezone.utc)
    await sc.get_conditions_for_spot('pipeline', target.astimezone(timezone(timedelta(hours=offset))))
    for source in sources:
        assert source.await_args.kwargs['target_datetime'] == target.replace(minute=0)


@pytest.mark.asyncio
@pytest.mark.parametrize('speed', [0, 10, None])
async def test_explicit_wind_never_uses_current(provider, speed):
    payload, requests = provider
    payload.update(current={'wind_speed_10m': 99, 'wind_direction_10m': 180}, hourly={
        'time': ['2026-09-16T00:00'], 'wind_speed_10m': [speed], 'wind_direction_10m': [0]})
    result = await sc.get_wind_conditions(21.66, -158.05, datetime(2026, 9, 16, tzinfo=timezone.utc))
    assert result.get('wind_speed_mph') == (None if speed is None else round(speed * .621371, 1))
    assert requests[0]['start_hour'] == '2026-09-16T00:00'
    assert requests[0]['end_hour'] == '2026-09-16T00:00'


@pytest.mark.asyncio
async def test_midnight_tide_query_brackets_utc_day(provider):
    payload, requests = provider
    payload['predictions'] = [{'t': '2026-09-15 22:00', 'v': '0', 'type': 'L'},
                              {'t': '2026-09-16 04:00', 'v': '6', 'type': 'H'}]
    target = datetime(2026, 9, 15, 18, tzinfo=timezone(timedelta(hours=-6)))
    result = await sc.get_noaa_tide_data('1612340', target)
    assert requests[0]['begin_date'] == '20260915'
    assert requests[0]['end_date'] == '20260917'
    assert result['tide_height_ft'] == 2
    assert result['tide_method'] == 'linear_hilo_estimate'
    assert result['tide_datum'] == 'MLLW'


@pytest.mark.asyncio
async def test_unbracketed_tide_is_not_persisted(provider):
    payload, _ = provider
    payload['predictions'] = [{'t': '2026-09-15 22:00', 'v': '6', 'type': 'H'}]
    result = await sc.get_noaa_tide_data('1612340', datetime(2026, 9, 16, tzinfo=timezone.utc))
    assert result.get('tide_height_ft') is None
    assert result['tide_status'] == 'unknown'


@pytest.mark.asyncio
async def test_default_wind_still_uses_current(provider):
    payload, requests = provider
    payload['current'] = {'wind_speed_10m': 10, 'wind_direction_10m': 0}
    assert (await sc.get_wind_conditions(21.66, -158.05))['wind_speed_mph'] == 6.2
    assert 'start_hour' not in requests[0]


@pytest.mark.asyncio
async def test_actual_composite_replay_preserves_time_quantity_and_tide_provenance(provider, monkeypatch):
    payload, requests = provider
    monkeypatch.setattr(sc, '_breaking_ft', lambda *args: (4.2, 'test_breaking'))
    payload.update(current={'wave_height': 99, 'wind_speed_10m': 99}, hourly={
        'time': ['2026-09-16T00:00'], 'wave_height': [2], 'wave_period': [12],
        'swell_wave_height': [0.5], 'wind_speed_10m': [10], 'wind_direction_10m': [0]},
        predictions=[{'t': '2026-09-15 22:00', 'v': '0', 'type': 'L'},
                     {'t': '2026-09-16 04:00', 'v': '6', 'type': 'H'}])
    result = await sc.get_conditions_for_spot('pipeline', datetime(2026, 9, 16, 0, 35, tzinfo=timezone.utc))
    assert len(requests) == 3
    assert result['requested_time'] == '2026-09-16T00:00:00+00:00'
    assert result['wave_height_ft'] == 4.2
    assert result['swell_height_ft'] == 1.6
    assert result['offshore_height_ft'] == 6.6
    assert result['wind_speed_mph'] == 6.2
    assert result['tide_height_ft'] == 2
    assert result['tide_method'] == 'linear_hilo_estimate'
    assert result['tide_datum'] == 'MLLW'


@pytest.mark.asyncio
async def test_absent_wind_hour_does_not_borrow_current(provider):
    payload, _ = provider
    payload.update(current={'wind_speed_10m': 99}, hourly={
        'time': ['2026-09-15T00:00'], 'wind_speed_10m': [80]})
    result = await sc.get_wind_conditions(21.66, -158.05, datetime(2026, 9, 16, tzinfo=timezone.utc))
    assert result.get('wind_speed_mph') is None
