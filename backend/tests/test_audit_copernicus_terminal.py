"""Actual tile loop and async cache wrapper; no Copernicus credentials or subprocess."""
from unittest.mock import Mock

import pytest
from services import copernicus_marine_service as cm


@pytest.fixture(autouse=True)
def clean_cache(monkeypatch):
    cm._point_cache.clear()
    monkeypatch.setattr(cm, 'is_test_environment', lambda: False)
    monkeypatch.setenv('COPERNICUS_TERMINAL_TIME_GUARD', '1')
    yield
    cm._point_cache.clear()


def sample(lat=1, lon=1, height=2):
    return {'latitude': lat, 'longitude': lon,
            'hourly': {'time': ['2026-10-04T12:00:00Z'], 'wave_height': [height]}}


@pytest.mark.asyncio
@pytest.mark.parametrize('rows', [[{'hourly': {'time': []}}], [sample(height=None)],
                                 [sample(height=float('nan'))], [sample(height=True)]])
async def test_empty_or_invalid_forecasts_never_enter_success_cache(monkeypatch, rows):
    fetch = Mock(return_value=rows)
    monkeypatch.setattr(cm, '_fetch_sync', fetch)
    for _ in range(2):
        assert await cm.fetch_euro_marine([1], [1], valid_time='2026-10-04T12:00:00Z') == rows
    assert fetch.call_count == 2 and cm._point_cache == {}


@pytest.mark.asyncio
@pytest.mark.parametrize('height', [0, 2])
async def test_genuine_zero_and_positive_samples_still_cache_and_copy(monkeypatch, height):
    fetch = Mock(return_value=[sample(height=height)])
    monkeypatch.setattr(cm, '_fetch_sync', fetch)
    first = await cm.fetch_euro_marine([1], [1])
    first[0]['hourly']['wave_height'][0] = 99
    second = await cm.fetch_euro_marine([1], [1])
    assert second[0]['hourly']['wave_height'] == [height] and fetch.call_count == 1


@pytest.mark.asyncio
async def test_existing_empty_batched_entry_cannot_short_circuit_recovery(monkeypatch):
    import time
    cm._point_cache[((1,), (1,), 3, None, None)] = ([{'hourly': {'time': []}}], time.time())
    fetch = Mock(return_value=[sample()])
    monkeypatch.setattr(cm, '_fetch_sync', fetch)
    assert (await cm.fetch_euro_marine([1], [1], variables=['wave_height']))[0]['hourly']['wave_height'] == [2]
    assert fetch.call_count == 1


@pytest.mark.asyncio
@pytest.mark.parametrize('enabled', ['0', 'true', 'unset'])
async def test_default_off_keeps_legacy_empty_success_cache(monkeypatch, enabled):
    if enabled == 'unset':
        monkeypatch.delenv('COPERNICUS_TERMINAL_TIME_GUARD', raising=False)
    else:
        monkeypatch.setenv('COPERNICUS_TERMINAL_TIME_GUARD', enabled)
    fetch = Mock(return_value=[{'hourly': {'time': []}}])
    monkeypatch.setattr(cm, '_fetch_sync', fetch)
    await cm.fetch_euro_marine([1], [1])
    await cm.fetch_euro_marine([1], [1])
    assert fetch.call_count == 1


def test_tile_local_failure_does_not_suppress_other_spatial_tiles(monkeypatch):
    fetch = Mock(side_effect=[RuntimeError('synthetic spatial failure'), [sample(30, 80)]])
    monkeypatch.setattr(cm, '_fetch_sync', fetch)
    rows = cm._fetch_tiled_sync([1, 30], [1, 80], 3)
    assert fetch.call_count == 2 and len(rows) == 2
    assert rows[0]['hourly']['time'] == [] and rows[1]['hourly']['wave_height'] == [2]


@pytest.mark.parametrize('enabled,attempts', [('1', 1), ('0', 4), ('true', 4), ('unset', 4)])
def test_real_subprocess_boundary_stops_only_dataset_wide_temporal_failure(monkeypatch, enabled, attempts):
    from types import SimpleNamespace
    if enabled == 'unset':
        monkeypatch.delenv('COPERNICUS_TERMINAL_TIME_GUARD', raising=False)
    else:
        monkeypatch.setenv('COPERNICUS_TERMINAL_TIME_GUARD', enabled)
    monkeypatch.setattr(cm, '_check_credentials', lambda: (None, None))
    fetch = Mock(return_value=SimpleNamespace(returncode=65, stdout='ERROR_CODE:COPERNICUS_TIME_UNAVAILABLE\n', stderr=''))
    monkeypatch.setattr('subprocess.run', fetch)
    rows = cm._fetch_tiled_sync([1, 30, 60, -30], [1, 80, 140, -80], 3, valid_time='2026-10-13T21:00:00Z')
    assert fetch.call_count == attempts
    assert rows == [] if enabled == '1' else len(rows) == 4


@pytest.mark.parametrize('code,stdout', [(1, 'ERROR_CODE:COPERNICUS_TIME_UNAVAILABLE'),
                                      (65, 'ERROR: something else'),
                                      (65, 'log prefix ERROR_CODE:COPERNICUS_TIME_UNAVAILABLE')])
def test_untyped_subprocess_outage_remains_local_to_tile(monkeypatch, code, stdout):
    from types import SimpleNamespace
    monkeypatch.setattr(cm, '_check_credentials', lambda: (None, None))
    fetch = Mock(return_value=SimpleNamespace(returncode=code, stdout=stdout, stderr=''))
    monkeypatch.setattr('subprocess.run', fetch)
    rows = cm._fetch_tiled_sync([1, 30], [1, 80], 3)
    assert fetch.call_count == 2 and len(rows) == 2


@pytest.mark.parametrize('dimension,code', [('time', 65), ('longitude', 1), ('latitude', 1)])
def test_actual_fetcher_encodes_only_sdk_time_dimension_failure(monkeypatch, capsys, dimension, code):
    import json
    import sys
    from types import SimpleNamespace
    from services import copernicus_fetcher

    class CoordinatesOutOfDatasetBounds(Exception):
        pass

    def subset(**kw):
        raise CoordinatesOutOfDatasetBounds(f'Coordinates out of dataset bounds: selection for the {dimension} dimension exceeds dataset coordinates')

    monkeypatch.setitem(sys.modules, 'copernicusmarine', SimpleNamespace(subset=subset))
    payload = dict(dataset_id='fixture', variables=['VHM0'], minimum_longitude=1, maximum_longitude=2,
                   minimum_latitude=1, maximum_latitude=2, start_datetime='2026-10-13T18:00:00',
                   end_datetime='2026-10-14T00:00:00', output_directory='.', output_filename='unused.nc',
                   username=None, password=None)
    monkeypatch.setattr(sys, 'argv', ['copernicus_fetcher.py', json.dumps(payload)])
    with pytest.raises(SystemExit) as error:
        copernicus_fetcher.main()
    assert error.value.code == code
    output = capsys.readouterr().out
    assert ('ERROR_CODE:COPERNICUS_TIME_UNAVAILABLE' in output) == (dimension == 'time')


def test_transient_sdk_error_that_mentions_time_is_not_dataset_wide(monkeypatch, capsys):
    import json
    import sys
    from types import SimpleNamespace
    from services import copernicus_fetcher

    def subset(**kw):
        raise RuntimeError('network failure for time dimension')

    monkeypatch.setitem(sys.modules, 'copernicusmarine', SimpleNamespace(subset=subset))
    payload = dict(dataset_id='fixture', variables=[], minimum_longitude=1, maximum_longitude=2,
                   minimum_latitude=1, maximum_latitude=2, start_datetime='2026-10-04T12:00:00',
                   end_datetime='2026-10-04T18:00:00', output_directory='.', output_filename='unused.nc',
                   username=None, password=None)
    monkeypatch.setattr(sys, 'argv', ['copernicus_fetcher.py', json.dumps(payload)])
    with pytest.raises(SystemExit) as error:
        copernicus_fetcher.main()
    assert error.value.code == 1
    assert 'ERROR_CODE:' not in capsys.readouterr().out
