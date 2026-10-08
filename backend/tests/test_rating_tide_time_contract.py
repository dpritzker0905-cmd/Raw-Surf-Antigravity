"""WC-02: unsupported tide hours must remain unknown through the served rating."""
from datetime import timedelta
import math
from urllib.parse import parse_qs, urlsplit

import pytest

from services.weather_pipeline import tide as T
from services.weather_pipeline import spot_ratings_precompute as P
from services.weather_pipeline.spot_ratings import rate_one_spot
from test_rating_band_canonical import NOW, SPOTS, setup


@pytest.fixture(autouse=True)
def offline(monkeypatch):
    for flag in ('RATING_LOCAL_SIZE', 'RATING_OBS_GATE', 'SURF_PARTITIONS', 'SURF_NEARSHORE_MOP',
                 'SURF_TIDE_DEPTH', 'RATING_BREAKER_TYPE'):
        monkeypatch.setenv(flag, '0')
    monkeypatch.setenv('RATING_TIDE', '1')
    monkeypatch.setattr(T.time, 'time', lambda: NOW.timestamp())
    T._reset_tide_cache_for_test()
    yield
    T._reset_tide_cache_for_test()


def series(start=NOW.replace(hour=0), hours=72):
    return {'time': [(start + timedelta(hours=h)).isoformat() for h in range(hours)],
            'level': [round(math.sin(h * math.pi / 6), 3) for h in range(hours)]}


class Client:
    def __init__(self, truncate=False, expired=False):
        self.urls = []
        self.truncate = truncate
        self.expired = expired

    async def get(self, url):
        self.urls.append(url)
        q = parse_qs(urlsplit(url).query)
        days = int(q['forecast_days'][0])
        s = series(start=NOW.replace(hour=0) - timedelta(days=4) if self.expired else NOW.replace(hour=0),
                   hours=72 if self.truncate or self.expired else days * 24)
        payload = {'hourly': {'time': s['time'], 'sea_level_height_msl': s['level']}}
        data = [payload for _ in q['latitude'][0].split(',')]
        class Response:
            status_code = 200
            def json(self):
                return data if len(data) > 1 else data[0]
        return Response()


@pytest.mark.parametrize('hours', [-1, 72, 75, 84, 216])
def test_distant_endpoint_is_not_a_tide_measurement(hours):
    s = series()
    assert T.tide_state_at(s['time'], s['level'], NOW.replace(hour=0) + timedelta(hours=hours)) is None


@pytest.mark.parametrize('bad', [None, float('nan'), float('inf'), 'invalid'])
def test_missing_hour_does_not_borrow_another_hour(bad):
    s = series()
    s['level'][12] = bad
    assert T.tide_state_at(s['time'], s['level'], NOW) is None


def test_half_hour_boundary_and_valid_positive_control():
    s = series()
    assert T.tide_state_at(s['time'], s['level'], NOW)['height_m'] == 0.
    assert T.tide_state_at(s['time'], s['level'], NOW - timedelta(minutes=30)) is not None
    assert T.tide_state_at(s['time'], s['level'], NOW.replace(hour=0) - timedelta(minutes=30, seconds=1)) is None


@pytest.mark.parametrize('hour,days', [(0, 3), (48, 3), (72, 4), (84, 5), (156, 8), (180, None), (-13, None)])
async def test_public_acquisition_requests_bounded_utc_horizon(hour, days):
    c = Client()
    state = await T.tide_norm_at(28.4, -80.6, NOW + timedelta(hours=hour), client=c)
    assert (state is not None) == (days is not None)
    assert len(c.urls) == (0 if days is None else 1)
    if days:
        assert parse_qs(urlsplit(c.urls[0]).query)['forecast_days'] == [str(days)]


async def test_timezone_uses_utc_calendar_and_invalid_time_avoids_io():
    c = Client()
    assert await T.tide_norm_at(0, 0, '2026-10-11T23:00:00-02:00', client=c) is not None
    assert 'forecast_days=5' in c.urls[0]
    assert await T.tide_norm_at(0, 0, 'invalid', client=c) is None
    assert len(c.urls) == 1


async def test_requested_coverage_is_not_proof_of_returned_samples():
    c = Client(truncate=True)
    for _ in range(2):
        assert await T.tide_norm_at(0, 0, NOW + timedelta(hours=84), client=c) is None
    assert len(c.urls) == 1  # bounded cache reuse; no desperate refetch loop


@pytest.mark.parametrize('spot', SPOTS)
async def test_expired_tide_is_neutral_and_disclosed_at_actual_rating_wire(tmp_path, monkeypatch, spot):
    _, _, _, resolver, _, _ = setup(tmp_path, spot)
    c = Client(expired=True)
    fetch = T.fetch_tide_hourly
    async def injected(lat, lng, client=None, **kw):
        return await fetch(lat, lng, client=c, **kw)
    monkeypatch.setattr(T, 'fetch_tide_hourly', injected)
    sp = {'id': 'fixture', 'name': spot[0], 'latitude': spot[1], 'longitude': spot[2], 'best_tide': 'Low'}
    actual = await rate_one_spot(resolver, sp, 'GFS', NOW.isoformat())
    neutral = await rate_one_spot(resolver, sp, 'GFS', NOW.isoformat(), tide_state_override=None)
    assert actual['tide'] is None
    assert actual['score'] == neutral['score']
    assert actual['tide_status'] == 'unavailable'
    assert 'tide adjustment unavailable' in actual['why']
    from routes.weather import SpotRatingsResponse
    wire = SpotRatingsResponse(model='GFS', valid_time=NOW.isoformat(), count=1, source='live',
                               spots=[actual]).model_dump(mode='json')
    assert wire['spots'][0]['tide_status'] == 'unavailable'
    assert wire['spots'][0]['tide'] is None
    assert len(c.urls) == 1


async def test_batched_horizon_seeds_all_supported_frames_once(monkeypatch):
    c = Client()
    warm = T.prewarm_tide_cache
    async def injected(coords, **kw):
        return await warm(coords, client=c, **kw)
    monkeypatch.setattr(T, 'prewarm_tide_cache', injected)
    seen = []
    async def rate(resolver, sp, model, vt, **kw):
        state = await T.tide_norm_at(sp['latitude'], sp['longitude'], vt, client=c)
        seen.append(state)
        return {'spot_id': sp['id'], 'score': 50., 'level': 'fair', 'tide': state}
    monkeypatch.setattr(P, 'rate_one_spot', rate)
    spots = [{'id': str(i), 'latitude': lat, 'longitude': lng} for i, (_, lat, lng) in enumerate(SPOTS)]
    await P.precompute_spot_ratings(None, spots, ['GFS'], [0, 84, 156, 180], base_dt=NOW)
    assert len(c.urls) == 1
    assert 'forecast_days=8' in c.urls[0]
    assert all(s is not None for s in seen[:9]) and all(s is None for s in seen[9:])


@pytest.mark.parametrize('spot', SPOTS)
async def test_valid_hour_keeps_real_tide_and_the_existing_grade(tmp_path, monkeypatch, spot):
    _, _, _, resolver, _, _ = setup(tmp_path, spot)
    c = Client()
    fetch = T.fetch_tide_hourly
    async def injected(lat, lng, client=None, **kw):
        return await fetch(lat, lng, client=c, **kw)
    monkeypatch.setattr(T, 'fetch_tide_hourly', injected)
    sp = {'id': 'fixture', 'name': spot[0], 'latitude': spot[1], 'longitude': spot[2], 'best_tide': 'Low'}
    actual = await rate_one_spot(resolver, sp, 'GFS', NOW.isoformat())
    same = await rate_one_spot(resolver, sp, 'GFS', NOW.isoformat(), tide_state_override=actual['tide'])
    assert actual['tide_status'] == 'available' and actual['tide']['norm'] == .5
    assert actual['score'] == same['score']
    assert 'tide adjustment unavailable' not in actual['why']
    assert len(c.urls) == 1


async def test_disabled_tide_is_unassessed_without_fetch_or_new_warning(tmp_path, monkeypatch):
    monkeypatch.setenv('RATING_TIDE', '0')
    calls = []
    async def forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError('disabled tide cannot acquire data')
    monkeypatch.setattr(T, 'tide_norm_at', forbidden)
    _, _, _, resolver, _, _ = setup(tmp_path, SPOTS[1])
    sp = {'id': 'fixture', 'name': 'Cocoa Beach', 'latitude': SPOTS[1][1], 'longitude': SPOTS[1][2], 'best_tide': 'Low'}
    actual = await rate_one_spot(resolver, sp, 'GFS', NOW.isoformat())
    assert actual['tide_status'] is None and actual['tide'] is None
    assert 'tide adjustment unavailable' not in actual['why']
    assert not calls


async def test_unsupported_batch_does_not_prewarm(monkeypatch):
    calls = []
    async def forbidden(*args, **kwargs):
        calls.append((args, kwargs))
        raise AssertionError('unsupported batch cannot prewarm')
    monkeypatch.setattr(T, 'prewarm_tide_cache', forbidden)
    async def rate(*args, **kw):
        return {'spot_id': 'fixture', 'score': 50., 'level': 'fair'}
    monkeypatch.setattr(P, 'rate_one_spot', rate)
    await P.precompute_spot_ratings(None, [{'id': 'fixture', 'latitude': 0., 'longitude': 0.}],
                                   ['GFS'], [180, 216], base_dt=NOW)
    assert not calls
