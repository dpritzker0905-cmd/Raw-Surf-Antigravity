"""Exercise the actual legacy HTTP consumer; total sea must never masquerade as swell."""
from datetime import datetime, timezone, timedelta
from unittest.mock import AsyncMock

import pytest

from services import surf_conditions as sc


@pytest.fixture
def provider(monkeypatch):
    payload = {}
    requests = []

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
    monkeypatch.setattr(sc, '_breaking_ft', lambda *args: (4.2, 'test_breaking'))
    return payload, requests


@pytest.mark.asyncio
@pytest.mark.parametrize('total', [1.0, 3.0, 6.0])
@pytest.mark.parametrize('swell', [None, 0.0, 0.5])
async def test_current_quantity_independence(provider, total, swell):
    payload, requests = provider
    payload['current'] = {'wave_height': total, 'wave_period': 12,
                          'swell_wave_height': swell}
    result = await sc.get_surf_conditions(28.3, -80.6)
    expected = sc.meters_to_feet(swell) if swell is not None else None
    assert result.get('swell_height_ft') == expected
    assert result['offshore_height_ft'] == sc.meters_to_feet(total)
    assert result['wave_height_ft'] == 4.2
    assert 'swell_wave_height' in requests[0]['current']


@pytest.mark.asyncio
async def test_hourly_fallback_uses_same_row_for_both_quantities(provider):
    payload, _ = provider
    payload['hourly'] = {'time': ['2026-09-15T00:00', '2026-09-15T12:00'],
                         'wave_height': [6.0, 2.0], 'wave_period': [8, 12],
                         'swell_wave_height': [4.0, 0.5]}
    result = await sc.get_surf_conditions(
        28.3, -80.6, datetime(2026, 9, 15, 12, tzinfo=timezone.utc))
    assert result['swell_height_ft'] == sc.meters_to_feet(0.5)
    assert result['offshore_height_ft'] == sc.meters_to_feet(2.0)


@pytest.mark.asyncio
async def test_short_swell_array_stays_unknown(provider):
    payload, _ = provider
    payload['hourly'] = {'time': ['2026-09-15T12:00'], 'wave_height': [2.0],
                         'wave_period': [12], 'swell_wave_height': []}
    result = await sc.get_surf_conditions(
        28.3, -80.6, datetime(2026, 9, 15, 12, tzinfo=timezone.utc))
    assert result.get('swell_height_ft') is None


@pytest.mark.asyncio
async def test_full_conditions_preserves_quantity_names(monkeypatch):
    monkeypatch.setattr(sc, 'get_surf_conditions', AsyncMock(return_value={
        'wave_height_ft': 4.2, 'swell_height_ft': 1.6, 'offshore_height_ft': 6.6,
        'surf_regime': 'test_breaking'}))
    monkeypatch.setattr(sc, 'get_wind_conditions', AsyncMock(return_value={}))
    result = await sc.get_full_conditions(28.3, -80.6)
    assert result['offshore_height_ft'] == 6.6
    assert result['swell_height_ft'] == 1.6
    assert result['wave_height_ft'] == 4.2


@pytest.mark.asyncio
@pytest.mark.parametrize('offset', [0, -6, 9])
async def test_explicit_time_selects_same_instant_in_any_timezone(provider, offset):
    payload, requests = provider
    payload['current'] = {'wave_height': 6, 'wave_period': 5, 'swell_wave_height': 4}
    payload['hourly'] = {'time': ['2026-09-16T12:00'], 'wave_height': [2],
                         'wave_period': [12], 'swell_wave_height': [0.5]}
    target = datetime(2026, 9, 16, 12, 35, tzinfo=timezone.utc)
    result = await sc.get_surf_conditions(28.3, -80.6, target.astimezone(timezone(timedelta(hours=offset))))
    assert result['offshore_height_ft'] == sc.meters_to_feet(2)
    assert result['swell_height_ft'] == sc.meters_to_feet(0.5)
    assert result['wave_period_sec'] == 12
    assert requests[0]['start_hour'] == '2026-09-16T12:00'
    assert requests[0]['end_hour'] == '2026-09-16T12:00'


@pytest.mark.asyncio
@pytest.mark.parametrize('values', [[6, None], [6]])
async def test_missing_target_height_never_borrows_first_hour(provider, values):
    payload, _ = provider
    payload['hourly'] = {'time': ['2026-09-15T00:00', '2026-09-15T12:00'],
                         'wave_height': values, 'wave_period': [5, 12],
                         'swell_wave_height': [4, 0.5]}
    result = await sc.get_surf_conditions(28.3, -80.6, datetime(2026, 9, 15, 12, tzinfo=timezone.utc))
    assert result.get('offshore_height_ft') is None
    assert result.get('wave_height_ft') is None
    assert result['swell_height_ft'] == sc.meters_to_feet(0.5)


@pytest.mark.asyncio
async def test_out_of_range_request_remains_unavailable(provider):
    payload, _ = provider
    payload['current'] = {'wave_height': 6, 'wave_period': 5}
    payload['hourly'] = {'time': ['2026-09-15T00:00'], 'wave_height': [4], 'wave_period': [8]}
    result = await sc.get_surf_conditions(28.3, -80.6, datetime(2026, 9, 16, 12, tzinfo=timezone.utc))
    assert result.get('offshore_height_ft') is None
    assert result.get('wave_period_sec') is None
