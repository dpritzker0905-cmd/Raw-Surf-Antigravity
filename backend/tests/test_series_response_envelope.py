"""Actual FastAPI route, outer gzip, admission and running-worker ownership offline."""
import asyncio
import threading
import time
from datetime import datetime, timezone
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from fastapi.encoders import jsonable_encoder
from httpx import ASGITransport, AsyncClient
from starlette.middleware.gzip import GZipMiddleware

from services.weather_pipeline import series_response as S
from services.weather_pipeline.schemas import GridVector

PARAMS = dict(model='GFS', layer='waves', bbox='-81,20,-80,21', hours='0,3')


@pytest.fixture(autouse=True)
def envelope(monkeypatch):
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', '1')
    monkeypatch.setenv('GRID_SERIES_DEADLINE_S', '1')
    monkeypatch.setattr(S, 'ADMISSION', S.SeriesAdmission())


def app():
    from routes.weather import router
    instance = FastAPI()
    instance.include_router(router)
    instance.add_middleware(GZipMiddleware, minimum_size=500)
    return instance


@pytest.mark.parametrize('encoding', ['gzip', 'identity', 'gzip;q=0', 'br, gzip;q=1'])
def test_route_preserves_entire_payload_and_gzip_negotiation(encoding):
    payload = dict(model='GFS', frames=[dict(hour_offset=h, valid_time=f'2026-10-04T0{h}:00:00Z',
        served_valid_time=None, is_estimated=h == 3, estimate_basis={'native': 0, 'missing': None},
        vectors=[GridVector(lat=20, lng=-81, speed=0 if h == 0 else 2.3, period=None,
            is_valid=False, dir_confidence=0.0) for _ in range(20)]) for h in (0, 3)])
    async def build(*a, **k): return payload
    async def run():
        with patch('services.weather_pipeline.grid_series_helper.build_grid_series', build):
            async with AsyncClient(transport=ASGITransport(app=app()), base_url='http://offline.invalid') as c:
                r = await c.get('/weather/grid_series', params=PARAMS, headers={'accept-encoding': encoding})
                assert r.status_code == 200
                assert r.json() == jsonable_encoder(payload)
                assert r.headers.get('content-encoding') == ('gzip' if encoding in ('gzip', 'br, gzip;q=1') else 'identity')
                assert 'phys_speed' not in r.json()['frames'][0]['vectors'][0]
    asyncio.run(run())


@pytest.mark.parametrize('value', [datetime(2026, 10, 4, tzinfo=timezone.utc), b'NaN text', {'a', 'b'}, 2 ** 100])
def test_unsupported_exact_types_preserve_legacy_json(value):
    payload = {'context': value, 'height': 0, 'period': None}
    assert not S.finite_compatible(payload)
    assert S.encode_response(payload, False).body == __import__('starlette.responses', fromlist=['JSONResponse']).JSONResponse(jsonable_encoder(payload)).body


@pytest.mark.parametrize('value', [float('nan'), float('inf'), -float('inf')])
def test_nonfinite_values_refused_instead_of_silently_changed_to_null(value):
    with pytest.raises(ValueError):
        S.encode_response({'vectors': [GridVector(lat=0, lng=0, speed=value)]}, False)


def test_concurrent_actual_routes_reserve_mini_and_bound_page_builds():
    async def run():
        ready = asyncio.Event()
        active = 0
        peak = 0
        starts = []
        async def build(*args, **kwargs):
            nonlocal active, peak
            active += 1
            peak = max(active, peak)
            starts.append(args[6])
            await ready.wait()
            active -= 1
            return {'frames': [], 'frame_count': 0}
        with patch('services.weather_pipeline.grid_series_helper.build_grid_series', build):
            async with AsyncClient(transport=ASGITransport(app=app()), base_url='http://offline.invalid') as c:
                tasks = [asyncio.create_task(c.get('/weather/grid_series', params=PARAMS)) for _ in range(3)]
                tasks.append(asyncio.create_task(c.get('/weather/grid_series', params={**PARAMS, 'hours': '0'})))
                await asyncio.sleep(.1)
                assert sorted(starts) == ['0', '0,3']
                assert peak == 2
                ready.set()
                assert all(r.status_code == 200 for r in await asyncio.gather(*tasks))
                assert S.ADMISSION.active == {'mini': 0, 'page': 0}
    asyncio.run(run())


def test_queue_has_bounded_refusal_and_canceled_tickets_are_removed():
    async def run():
        admission = S.SeriesAdmission()
        await admission.acquire('page', None, time.monotonic() + 5)
        queued = [asyncio.create_task(admission.acquire('page', None, time.monotonic() + 5)) for _ in range(4)]
        await asyncio.sleep(.05)
        with pytest.raises(__import__('fastapi').HTTPException) as e:
            await admission.acquire('page', None, time.monotonic() + 5)
        assert e.value.status_code == 429 and e.value.headers['Retry-After'] == '1'
        for task in queued: task.cancel()
        await asyncio.gather(*queued, return_exceptions=True)
        assert not admission.queue['page']
        admission.release('page')
    asyncio.run(run())


def test_encoding_deadline_refuses_output_but_keeps_permit_until_worker_really_finishes(monkeypatch):
    started = threading.Event()
    finish = threading.Event()
    original = S.encode_response
    def stalled(*args):
        started.set()
        assert finish.wait(3)
        return original(*args)
    monkeypatch.setattr(S, 'encode_response', stalled)
    async def run():
        async def build(): return {'height': 0}
        try:
            with pytest.raises(__import__('fastapi').HTTPException) as e:
                await S.serve_series(build, '0,3', None)
            assert started.is_set() and e.value.status_code == 503
            assert S.ADMISSION.active['page'] == 1
        finally:
            finish.set()
        for _ in range(100):
            if S.ADMISSION.active['page'] == 0: break
            await asyncio.sleep(.01)
        assert S.ADMISSION.active['page'] == 0
    asyncio.run(run())


def test_canceled_http_waiter_keeps_running_encoder_owned(monkeypatch):
    started = threading.Event()
    finish = threading.Event()
    original = S.encode_response
    def stalled(*args):
        started.set()
        assert finish.wait(3)
        return original(*args)
    monkeypatch.setattr(S, 'encode_response', stalled)
    async def run():
        async def build(): return {'height': 0}
        task = asyncio.create_task(S.serve_series(build, '0,3', None))
        try:
            for _ in range(100):
                if started.is_set(): break
                await asyncio.sleep(.005)
            assert started.is_set()
            task.cancel()
            with pytest.raises(asyncio.CancelledError): await task
            assert S.ADMISSION.active['page'] == 1
        finally: finish.set()
        for _ in range(100):
            if S.ADMISSION.active['page'] == 0: break
            await asyncio.sleep(.01)
        assert S.ADMISSION.active['page'] == 0
    asyncio.run(run())


def test_disconnected_queue_does_not_build():
    class Gone:
        async def is_disconnected(self): return True
    async def run():
        with pytest.raises(__import__('fastapi').HTTPException) as e:
            await S.ADMISSION.acquire('mini', Gone(), time.monotonic() + 5)
        assert e.value.status_code == 499
        assert not S.ADMISSION.queue['mini'] and S.ADMISSION.active['mini'] == 0
    asyncio.run(run())


def test_disabled_route_retains_original_builder_response(monkeypatch):
    monkeypatch.delenv('GRID_SERIES_RESPONSE_BOUNDS')
    async def run():
        from routes.weather import get_grid_series
        payload = {'height': 0, 'frames': []}
        async def build(*a, **k): return payload
        with patch('services.weather_pipeline.grid_series_helper.build_grid_series', build):
            result = await get_grid_series(model='GFS', domain='marine', layer='waves', bbox='-81,20,-80,21', hours='0', surf=False, base_time=None, request=None)
            assert result is payload
    asyncio.run(run())
