"""PF03/LIVE04: actual HTTP concurrency, serialization ownership and rollback."""
import asyncio
import copy
import threading
import time

import httpx
import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse

from routes import weather
from services.weather_pipeline import grid_resolver, grid_series_helper
from services.weather_pipeline import grid_response as G, series_response as S

GRID = dict(model='GFS', domain='marine', layer='waves',
            valid_time='2026-10-09T00:00:00Z', bbox='-90,20,-80,35')
SERIES = dict(model='GFS', layer='waves', bbox=GRID['bbox'], hours='0')


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '1')
    monkeypatch.setenv('GRID_RESPONSE_DEADLINE_S', '1')
    monkeypatch.setattr(S, 'ADMISSION', S.SeriesAdmission())


def app():
    instance = FastAPI()
    instance.include_router(weather.router, prefix='/api')
    instance.add_middleware(G.GridResponseIngress)
    return instance


async def drain():
    for _ in range(200):
        if not G.OWNED_TASKS:
            break
        await asyncio.sleep(.01)
    assert not G.OWNED_TASKS
    assert S.ADMISSION.active == {'mini': 0, 'page': 0}
    assert not any(S.ADMISSION.queue.values())


@pytest.mark.parametrize('hung', [False, True])
def test_four_io_requests_start_together_and_one_hang_does_not_block_fast_grids(monkeypatch, hung):
    async def run():
        release, entered = asyncio.Event(), asyncio.Event()
        starts = []

        async def resolve(*args, **kwargs):
            starts.append(True)
            if len(starts) == 4:
                entered.set()
            await release.wait()
            if hung and len(starts) == 4 and asyncio.current_task() is first_worker[0]:
                await hanging.wait()
            return JSONResponse({'height': 1.25, 'period': None, 'fixture': 'retained'})

        # Identify the actual owned worker rather than its HTTP waiter.
        first_worker = []
        hanging = asyncio.Event()
        original = resolve

        async def observed(*args, **kwargs):
            if not first_worker:
                first_worker.append(asyncio.current_task())
            return await original(*args, **kwargs)

        monkeypatch.setattr(grid_resolver, 'resolve_grid', observed)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            tasks = [asyncio.create_task(client.get('/api/weather/grid', params=GRID)) for _ in range(4)]
            try:
                await asyncio.wait_for(entered.wait(), .3)
                release.set()
                fast = tasks[1:] if hung else tasks
                results = await asyncio.wait_for(asyncio.gather(*fast), .5)
                assert all(r.status_code == 200 for r in results)
                if hung:
                    additional = await asyncio.gather(*[client.get('/api/weather/grid', params=GRID) for _ in range(4)])
                    assert all(r.status_code == 200 for r in additional)
                    assert not tasks[0].done() and S.ADMISSION.active['mini'] == 1
            finally:
                release.set()
                hanging.set()
                await asyncio.gather(*tasks, return_exceptions=True)
                await drain()

    asyncio.run(run())


@pytest.mark.parametrize('series_flag', ['0', '1'])
def test_grid_bounds_series_encoding_runs_off_loop_and_preserves_payload(monkeypatch, series_flag):
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', series_flag)
    payload = {'frames': [{'height': 0.0, 'period': None, 'direction': 217.5,
                          'is_estimated': True, 'estimate_basis': {'native': .25, 'donor': .75}}],
               'frame_count': 1}
    retained = copy.deepcopy(payload)
    threads = []
    encode = S.encode_response

    def observed(*args):
        threads.append(threading.get_ident())
        return encode(*args)

    async def build(*args, **kwargs):
        return payload

    monkeypatch.setattr(S, 'encode_response', observed)
    monkeypatch.setattr(grid_series_helper, 'build_grid_series', build)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            main_thread = threading.get_ident()
            bounded = await client.get('/api/weather/grid_series', params=SERIES, headers={'accept-encoding': 'identity'})
            assert bounded.status_code == 200 and bounded.json() == retained
            assert threads and all(t != main_thread for t in threads)
            monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
            monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', '0')
            legacy = await client.get('/api/weather/grid_series', params=SERIES, headers={'accept-encoding': 'identity'})
            assert legacy.content == bounded.content and payload == retained
            await drain()

    asyncio.run(run())


def test_io_slots_and_queue_are_bounded_while_workers_remain_owned(monkeypatch):
    async def run():
        release = asyncio.Event()
        starts = []

        async def resolve(*args, **kwargs):
            starts.append(True)
            await release.wait()
            return JSONResponse({'fixture': 'complete'})

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            tasks = [asyncio.create_task(client.get('/api/weather/grid', params=GRID)) for _ in range(8)]
            try:
                await asyncio.sleep(.1)
                assert len(starts) == 4 and S.ADMISSION.active['mini'] == 4
                assert len(S.ADMISSION.queue['mini']) == 4
                refused = await client.get('/api/weather/grid', params=GRID)
                assert refused.status_code == 429 and refused.headers['retry-after'] == '1'
                tasks[0].cancel()
                await asyncio.gather(tasks[0], return_exceptions=True)
                await asyncio.sleep(.05)
                assert len(starts) == 4 and S.ADMISSION.active['mini'] == 4
            finally:
                release.set()
                await asyncio.gather(*tasks, return_exceptions=True)
                await drain()
            assert len(starts) == 8

    asyncio.run(run())


def test_encoding_worker_retains_cpu_gate_after_http_deadline(monkeypatch):
    async def run():
        entered = asyncio.Event()
        release = threading.Event()
        loop = asyncio.get_running_loop()
        encodes = []
        encode = S.encode_response

        def stalled(*args):
            encodes.append(True)
            loop.call_soon_threadsafe(entered.set)
            assert release.wait(4)
            return encode(*args)

        async def build(*args, **kwargs):
            return {'frames': [], 'frame_count': 0}

        monkeypatch.setattr(S, 'encode_response', stalled)
        monkeypatch.setattr(grid_series_helper, 'build_grid_series', build)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            tasks = [asyncio.create_task(client.get('/api/weather/grid_series', params=SERIES))]
            try:
                await asyncio.wait_for(entered.wait(), .3)
                tasks.append(asyncio.create_task(client.get('/api/weather/grid_series', params=SERIES)))
                results = await asyncio.wait_for(asyncio.gather(*tasks), 1.5)
                assert [r.status_code for r in results] == [503, 503]
                assert len(encodes) == 1 and S.ADMISSION.active['mini'] >= 1
            finally:
                release.set()
                await asyncio.gather(*tasks, return_exceptions=True)
                await drain()
            assert len(encodes) == 1  # expired queued CPU work never starts later

    asyncio.run(run())


@pytest.mark.parametrize('mutant', [None, 'period', 'direction'])
def test_serialization_jacobian_matches_legacy_and_detects_one_percent_mutants(monkeypatch, mutant):
    """Nine heterogeneous input columns; compare sensitivities before value parity."""
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', '0')
    current = {}
    encode = S.encode_response

    def altered(payload, compress):
        payload = copy.deepcopy(payload)
        payload['frames'][0][mutant] *= 1.01
        return encode(payload, compress)

    if mutant:
        monkeypatch.setattr(S, 'encode_response', altered)

    async def build(*args, **kwargs):
        return {'frames': [copy.deepcopy(current)], 'frame_count': 1}

    monkeypatch.setattr(grid_series_helper, 'build_grid_series', build)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            async def sample(flag, state):
                current.clear()
                current.update(state)
                monkeypatch.setenv('GRID_RESPONSE_BOUNDS', flag)
                response = await client.get('/api/weather/grid_series', params=SERIES)
                assert response.status_code == 200
                return response.json()['frames'][0]

            for state in (dict(height=.3, period=4.5, direction=7.),
                          dict(height=1.25, period=11.3, direction=217.5),
                          dict(height=4.7, period=17., direction=359.)):
                before, after = await sample('0', state), await sample('1', state)
                for key, step in (('height', .01), ('period', .1), ('direction', 1.)):
                    changed = {**state, key: state[key] + step}
                    b, a = await sample('0', changed), await sample('1', changed)
                    for output in state:
                        before_slope = (b[output] - before[output]) / step
                        after_slope = (a[output] - after[output]) / step
                        assert abs(before_slope - after_slope) < 1e-10
                assert before == after == state
            await drain()

    if mutant:
        with pytest.raises(AssertionError):
            asyncio.run(run())
    else:
        asyncio.run(run())
