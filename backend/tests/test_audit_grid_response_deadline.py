"""Real grid HTTP boundary with controlled work; external network is never needed."""
import asyncio
import copy
from datetime import datetime, timedelta, timezone
import threading
import time
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI, HTTPException
from fastapi.responses import JSONResponse
from pydantic import create_model
from starlette.middleware.gzip import GZipMiddleware

from routes import weather
from services.weather_pipeline import grid_resolver, mid_res_tier, series_response
from services.weather_pipeline import grid_response as G
from services.weather_pipeline.schemas import ManifestProduct, NormalizedProduct, PipelineManifest

PARAMS = dict(model='GFS', domain='marine', layer='waves',
              valid_time='2026-10-09T00:00:00Z', bbox='-90,20,-80,35')


def app():
    instance = FastAPI()
    instance.include_router(weather.router, prefix='/api')
    instance.add_middleware(GZipMiddleware, minimum_size=500)
    instance.add_middleware(G.GridResponseIngress)
    return instance


@pytest.fixture(autouse=True)
def bounds(monkeypatch):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '1')
    monkeypatch.setenv('GRID_RESPONSE_DEADLINE_S', '1')
    monkeypatch.setattr(series_response, 'ADMISSION', series_response.SeriesAdmission())


@pytest.mark.parametrize('series_flag', ['0', '1'])
def test_single_grid_expiration_returns_retryable_response_without_canceling_work(monkeypatch, series_flag):
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', series_flag)

    async def run():
        entered, release, finished = asyncio.Event(), asyncio.Event(), asyncio.Event()
        canceled = []

        async def resolve(*args, **kwargs):
            entered.set()
            try:
                await release.wait()
                return JSONResponse({'fixture': 'finished'})
            except asyncio.CancelledError:
                canceled.append(True)
                raise
            finally:
                finished.set()

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()),
                                     base_url='https://offline.invalid') as client:
            task = asyncio.create_task(client.get('/api/weather/grid', params=PARAMS))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                start = time.monotonic()
                # Shield the diagnostic waiter so its failure cannot cancel the fixture worker.
                response = await asyncio.wait_for(asyncio.shield(task), 1.4)
                assert response.status_code == 503 and response.headers['retry-after'] == '1'
                assert time.monotonic() - start < 1.35
                assert not canceled and not finished.is_set()
                assert series_response.ADMISSION.active['mini'] == 1
            finally:
                release.set()
                await asyncio.wait_for(finished.wait(), 2)
                await asyncio.gather(task, return_exceptions=True)
                for _ in range(100):
                    if series_response.ADMISSION.active['mini'] == 0:
                        break
                    await asyncio.sleep(.01)
                assert series_response.ADMISSION.active == {'mini': 0, 'page': 0}

    asyncio.run(run())


def product(size=1):
    return dict(model='GFS', provider='fixture', domain='marine', layer='waves',
        run_time='2026-10-05T00:00:00Z', valid_time=PARAMS['valid_time'],
        is_forecast_authoritative=True, is_estimated=False,
        coverage=dict(west=-90, south=20, east=-80, north=35),
        grid=dict(bounds=dict(west=-90, south=20, east=-80, north=35), cols=size, rows=1,
            vectors=[dict(lat=30, lng=-87, speed=5.79 if i else 0, direction=107, period=None,
                is_valid=i != 0, phys_speed=2.3 if i == 1 else None) for i in range(size)]),
        value_kind='height', value_unit='m', display_unit_hint='ft',
        source_variables=['wave_height'], freshness_sec=60, product_id='offline.json',
        served_valid_time='2026-10-09T01:00:00Z', frame_offset_hours=1,
        frame_substituted=True, partial_coverage=True, coarse_fill={'source': 'fixture'},
        unknown_field='must not escape the response model')


@pytest.mark.parametrize('size', [1, 1500])
@pytest.mark.parametrize('kind', ['dict', 'model', 'subclass'])
@pytest.mark.parametrize('encoding', ['identity', 'gzip', 'gzip;q=0', 'br, gzip;q=1'])
def test_public_schema_numbers_provenance_and_cached_product_match_legacy(monkeypatch, size, kind, encoding):
    payload = product(size)
    if kind == 'model':
        payload = NormalizedProduct.model_validate(payload)
    elif kind == 'subclass':
        payload = create_model('ExtendedProduct', unknown_field=(str, 'private'),
                               __base__=NormalizedProduct).model_validate(payload)
    before = copy.deepcopy(payload)

    async def resolve(*args, **kwargs):
        assert kwargs['series_stride'] is None and kwargs['surf'] is False
        return payload

    monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()),
                                     base_url='https://offline.invalid') as client:
            monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
            legacy = await client.get('/api/weather/grid', params=PARAMS, headers={'accept-encoding': encoding})
            monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '1')
            bounded = await client.get('/api/weather/grid', params=PARAMS, headers={'accept-encoding': encoding})
            assert legacy.status_code == bounded.status_code == 200
            assert bounded.content == legacy.content  # decoded public JSON bytes, no replacement serializer
            assert bounded.headers['content-encoding'] == ('gzip' if encoding in ('gzip', 'br, gzip;q=1') else 'identity')
            body = bounded.json()
            assert 'unknown_field' not in body
            assert body['grid']['vectors'][0]['speed'] == 0
            assert 'phys_speed' not in body['grid']['vectors'][0]
            assert body['partial_coverage'] and body['frame_substituted']
            assert body['served_valid_time'] != body['valid_time']
            assert payload == before
            await drained()

    asyncio.run(run())


async def drained():
    for _ in range(200):
        if not G.OWNED_TASKS:
            break
        await asyncio.sleep(.01)
    assert not G.OWNED_TASKS
    assert series_response.ADMISSION.active == {'mini': 0, 'page': 0}


@pytest.mark.parametrize('stage', ['resolver', 'coarse', 'compression'])
@pytest.mark.parametrize('leave', ['deadline', 'cancel'])
def test_running_thread_keeps_lease_until_real_completion(monkeypatch, stage, leave):
    from services.weather_pipeline import coarse_gulf_fill

    async def run():
        entered = asyncio.Event()
        release, finished = threading.Event(), threading.Event()
        loop = asyncio.get_running_loop()

        def work():
            loop.call_soon_threadsafe(entered.set)
            try:
                assert release.wait(4), 'fixture worker was not released'
            finally:
                finished.set()

        async def resolve(*args, **kwargs):
            if stage == 'resolver':
                await asyncio.to_thread(work)
            return JSONResponse({'fixture': 'complete'})

        async def coarse(payload, *args):
            if stage == 'coarse':
                await asyncio.to_thread(work)
            return payload

        original_finish = G._finish_response

        def compress(*args):
            work()
            return original_finish(*args)

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        monkeypatch.setattr(coarse_gulf_fill, 'fill_coarse_enclosed_sea_from_gfs_served', coarse)
        if stage == 'compression':
            monkeypatch.setattr(G, '_finish_response', compress)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            task = asyncio.create_task(client.get('/api/weather/grid', params=PARAMS))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                if leave == 'cancel':
                    task.cancel()
                    with pytest.raises(asyncio.CancelledError):
                        await task
                else:
                    response = await asyncio.wait_for(task, 1.4)
                    assert response.status_code == 503 and response.headers['retry-after'] == '1'
                assert not finished.is_set()
                assert series_response.ADMISSION.active['mini'] == 1 and G.OWNED_TASKS
            finally:
                release.set()
                await drained()
                await asyncio.gather(task, return_exceptions=True)
                assert finished.is_set()

    asyncio.run(run())


def test_response_model_serialization_is_inside_budget(monkeypatch):
    import fastapi.routing

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        original = fastapi.routing.serialize_response

        async def serialize(*args, **kwargs):
            entered.set()
            await release.wait()
            return await original(*args, **kwargs)

        async def resolve(*args, **kwargs):
            return NormalizedProduct.model_validate(product())

        monkeypatch.setattr(fastapi.routing, 'serialize_response', serialize)
        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            task = asyncio.create_task(client.get('/api/weather/grid', params=PARAMS))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                assert (await asyncio.wait_for(task, 1.4)).status_code == 503
                assert series_response.ADMISSION.active['mini'] == 1
            finally:
                release.set()
                await drained()
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())


@pytest.mark.parametrize('series_flag', ['0', '1'])
def test_series_hour_cancellation_cannot_release_running_child_lease(monkeypatch, series_flag):
    from services.weather_pipeline import grid_series_helper
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', series_flag)

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        canceled = []

        async def resolve(*args, **kwargs):
            entered.set()
            try:
                await release.wait()
                return JSONResponse({'fixture': 'finished'})
            except asyncio.CancelledError:
                canceled.append(True)
                raise

        async def build(resolver, *args, **kwargs):
            # Mirrors the existing helper's per-hour wait_for cancellation boundary.
            with pytest.raises(asyncio.TimeoutError):
                await asyncio.wait_for(resolver(**PARAMS, surf=False, request=kwargs['request']), .05)
            return {'frames': [], 'frame_count': 0}

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        monkeypatch.setattr(grid_series_helper, 'build_grid_series', build)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            task = asyncio.create_task(client.get('/api/weather/grid_series', params={
                'model': 'GFS', 'layer': 'waves', 'bbox': PARAMS['bbox'], 'hours': '0,3'}))
            try:
                await asyncio.wait_for(entered.wait(), 2)
                response = await asyncio.wait_for(task, 1.4)
                assert response.status_code == 200 and response.json()['frame_count'] == 0
                assert not canceled and series_response.ADMISSION.active['page'] == 1
            finally:
                release.set()
                await drained()
                await asyncio.gather(task, return_exceptions=True)

    asyncio.run(run())


@pytest.mark.parametrize('late_output', [False, True])
def test_background_revalidation_runs_once_and_keeps_lease_even_after_output_expiry(monkeypatch, late_output):
    from starlette.background import BackgroundTask

    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def revalidate():
            calls.append(True)
            entered.set()
            await release.wait()

        async def resolve(*args, **kwargs):
            if late_output:
                await asyncio.sleep(1.05)
            return JSONResponse({'fixture': 'preview', 'stale': True}, background=BackgroundTask(revalidate))

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            try:
                response = await client.get('/api/weather/grid', params=PARAMS)
                assert response.status_code == (503 if late_output else 200)
                await asyncio.wait_for(entered.wait(), 2)
                assert calls == [True] and series_response.ADMISSION.active['mini'] == 1
            finally:
                release.set()
                await drained()
            assert calls == [True]

    asyncio.run(run())


@pytest.mark.parametrize('flag', ['0', '1'])
def test_invalid_product_still_fails_real_response_model_validation(monkeypatch, flag):
    from fastapi.exceptions import ResponseValidationError
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', flag)

    async def resolve(*args, **kwargs):
        return {'invalid_product': True}

    monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            with pytest.raises(ResponseValidationError):
                await client.get('/api/weather/grid', params=PARAMS)
        await drained()

    asyncio.run(run())


def test_grid_and_series_share_two_slots_fifo_and_joint_queue(monkeypatch):
    from services.weather_pipeline import grid_series_helper

    async def run():
        release = asyncio.Event()
        starts, active, peak = [], 0, 0

        async def work(label):
            nonlocal active, peak
            active += 1
            peak = max(active, peak)
            starts.append(label)
            await release.wait()
            active -= 1

        async def resolve(*args, **kwargs):
            await work('grid')
            return JSONResponse({'fixture': 'grid'})

        async def build(*args, **kwargs):
            await work('series')
            return {'frames': [], 'frame_count': 0}

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        monkeypatch.setattr(grid_series_helper, 'build_grid_series', build)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            tasks = []
            try:
                for _ in range(3):
                    tasks.append(asyncio.create_task(client.get('/api/weather/grid', params=PARAMS)))
                    tasks.append(asyncio.create_task(client.get('/api/weather/grid_series', params={
                        'model': 'GFS', 'layer': 'waves', 'bbox': PARAMS['bbox'], 'hours': '0,3'})))
                await asyncio.sleep(.1)
                assert sorted(starts) == ['grid', 'series'] and peak == 2
                assert sum(map(len, series_response.ADMISSION.queue.values())) == 4
                refusal = await client.get('/api/weather/grid', params=PARAMS)
                assert refusal.status_code == 429 and refusal.headers['retry-after'] == '1'
                release.set()
                assert all(r.status_code == 200 for r in await asyncio.gather(*tasks))
                assert peak == 2 and len(starts) == 6
            finally:
                release.set()
                await asyncio.gather(*tasks, return_exceptions=True)
                await drained()

    asyncio.run(run())


@pytest.mark.parametrize('lane', ['mini', 'page'])
def test_full_other_lane_queue_does_not_starve_reserved_slot(lane):
    async def run():
        admission = series_response.ADMISSION
        other = 'page' if lane == 'mini' else 'mini'
        await admission.acquire(other, None, time.monotonic() + 3)
        queued = [asyncio.create_task(admission.acquire(other, None, time.monotonic() + 3)) for _ in range(4)]
        try:
            await asyncio.sleep(.05)
            await admission.acquire(lane, None, time.monotonic() + 3)
            assert admission.active == {'mini': 1, 'page': 1}
            admission.release(lane)
        finally:
            for task in queued:
                task.cancel()
            await asyncio.gather(*queued, return_exceptions=True)
            admission.release(other)
            assert not any(admission.queue.values())

    asyncio.run(run())


@pytest.mark.parametrize('disconnected', [False, True])
def test_expired_or_disconnected_admission_builds_nothing(disconnected):
    class Connection:
        async def is_disconnected(self):
            return disconnected

    async def run():
        calls = []

        async def build():
            calls.append(True)
            return JSONResponse({})

        with pytest.raises(__import__('fastapi').HTTPException) as error:
            await G.serve_response(build, Connection(), 'mini', time.monotonic() + (1 if disconnected else -1))
        assert error.value.status_code == (499 if disconnected else 503)
        assert not calls and not G.OWNED_TASKS
        assert not any(series_response.ADMISSION.queue.values())

    asyncio.run(run())


def test_disconnect_after_admission_keeps_lease_and_consumes_late_failure():
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        gone = False
        errors = []
        asyncio.get_running_loop().set_exception_handler(lambda loop, context: errors.append(context))

        class Connection:
            headers = {}

            async def is_disconnected(self):
                return gone

        async def build():
            entered.set()
            await release.wait()
            raise ValueError('controlled late failure')

        task = asyncio.create_task(G.serve_response(build, Connection(), 'mini', time.monotonic() + 1))
        try:
            await entered.wait()
            gone = True
            with pytest.raises(__import__('fastapi').HTTPException) as error:
                await task
            assert error.value.status_code == 499 and series_response.ADMISSION.active['mini'] == 1
        finally:
            release.set()
            await drained()
        assert not errors

    asyncio.run(run())


def test_ingress_delay_counts_before_handler_and_build(monkeypatch):
    async def run():
        calls = []

        class Delay:
            def __init__(self, inner):
                self.inner = inner

            async def __call__(self, scope, receive, send):
                # Simulate already-spent ingress budget without wall-clock sleeps.
                scope['state'][G.INGRESS_KEY] -= 2
                await self.inner(scope, receive, send)

        async def resolve(*args, **kwargs):
            calls.append(True)
            return JSONResponse({})

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        instance = app()
        # Outer ingress -> delayed middleware -> original route/gzip stack.
        wrapped = G.GridResponseIngress(Delay(instance))
        # Inner app must not replace the outer timestamp in this composed stack.
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=wrapped), base_url='https://offline.invalid') as client:
            response = await client.get('/api/weather/grid', params=PARAMS)
            assert response.status_code == 503 and not calls

    asyncio.run(run())


def test_queued_expiration_and_repeated_retries_do_not_admit_replacement_workers():
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        calls = []

        async def original():
            entered.set()
            await release.wait()
            return JSONResponse({})

        async def replacement():
            calls.append(True)
            return JSONResponse({})

        first = asyncio.create_task(G.serve_response(original, None, 'mini', time.monotonic() + 3))
        try:
            await entered.wait()
            for _ in range(3):
                with pytest.raises(__import__('fastapi').HTTPException) as error:
                    await G.serve_response(replacement, None, 'mini', time.monotonic() + .04)
                assert error.value.status_code == 503
                assert not series_response.ADMISSION.queue['mini']
                assert series_response.ADMISSION.active['mini'] == 1 and not calls
            first.cancel()
            with pytest.raises(asyncio.CancelledError):
                await first
            assert G.OWNED_TASKS and series_response.ADMISSION.active['mini'] == 1
        finally:
            release.set()
            await drained()

    asyncio.run(run())


@pytest.mark.parametrize('flag', ['0', '1'])
def test_direct_series_resolver_call_outside_envelope_retains_product(monkeypatch, flag):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', flag)
    payload = NormalizedProduct.model_validate(product())

    async def resolve(*args, **kwargs):
        assert kwargs['series_stride'] is None
        return payload

    monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)

    async def run():
        result = await weather.get_grid(**PARAMS, surf=False, request=None)
        assert result is payload
        assert not G.OWNED_TASKS and series_response.ADMISSION.active == {'mini': 0, 'page': 0}

    asyncio.run(run())


@pytest.mark.parametrize('series_flag', ['0', '1'])
def test_real_series_helper_does_not_multiply_abandoned_hour_workers(monkeypatch, series_flag):
    from services.weather_pipeline import grid_series_helper
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', series_flag)
    monkeypatch.setenv('GFS_ICON_SERIES_FASTPATH', '0')
    monkeypatch.setattr(grid_series_helper, '_per_hour_timeout', lambda: .04)

    async def run():
        release = asyncio.Event()
        starts, canceled = [], []

        async def resolve(*args, **kwargs):
            starts.append(kwargs['valid_time'])
            try:
                await release.wait()
                return NormalizedProduct.model_validate(product())
            except asyncio.CancelledError:
                canceled.append(True)
                raise

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            try:
                # Actual helper, route, defaults and cancellation; only resolver work is controlled.
                response = await client.get('/api/weather/grid_series', params={
                    'model': 'GFS', 'layer': 'waves', 'bbox': PARAMS['bbox'], 'hours': '0,3,6,9'})
                assert response.status_code == 200 and response.json()['frame_count'] == 0
                assert len(starts) == 1, 'canceled hour waiters admitted replacement workers'
                assert not canceled and series_response.ADMISSION.active['page'] == 1
            finally:
                release.set()
                await drained()
            assert len(starts) == 1 and not canceled

    asyncio.run(run())


@pytest.mark.parametrize('series_flag', ['0', '1'])
def test_real_series_helper_ready_frames_match_legacy_with_child_gate(monkeypatch, series_flag):
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', series_flag)
    monkeypatch.setenv('GFS_ICON_SERIES_FASTPATH', '0')

    async def resolve(*args, **kwargs):
        payload = product(2)
        payload['valid_time'] = kwargs['valid_time']
        return NormalizedProduct.model_validate(payload)

    monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)

    async def run():
        params = {'model': 'GFS', 'layer': 'waves', 'bbox': PARAMS['bbox'], 'hours': '0,3,6,9',
                  'base_time': datetime.now(timezone.utc).replace(
                      minute=0, second=0, microsecond=0).isoformat()}
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()), base_url='https://offline.invalid') as client:
            monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
            legacy = await client.get('/api/weather/grid_series', params=params)
            monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '1')
            bounded = await client.get('/api/weather/grid_series', params=params)
            assert legacy.status_code == bounded.status_code == 200
            assert legacy.json() == bounded.json()
            body = bounded.json()
            assert body['frame_count'] == 4
            assert [frame['hour_offset'] for frame in body['frames']] == [0, 3, 6, 9]
            assert all(frame['vectors'][1]['speed'] == 5.79 for frame in body['frames'])
            await drained()

    asyncio.run(run())


def test_queued_grid_child_cannot_start_after_root_deadline(monkeypatch):
    async def run():
        entered, release = asyncio.Event(), asyncio.Event()
        starts = []

        async def resolve(*args, **kwargs):
            starts.append(True)
            entered.set()
            await release.wait()
            return JSONResponse({'fixture': 'finished'})

        async def build():
            await asyncio.gather(weather.get_grid(**PARAMS, surf=False), weather.get_grid(**PARAMS, surf=False))
            return JSONResponse({})

        monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
        task = asyncio.create_task(G.serve_response(build, None, 'page', time.monotonic() + .08))
        try:
            await entered.wait()
            with pytest.raises(HTTPException) as error:
                await task
            assert error.value.status_code == 503 and len(starts) == 1
            assert series_response.ADMISSION.active['page'] == 1
        finally:
            release.set()
            await drained()
        assert len(starts) == 1

    asyncio.run(run())


@pytest.mark.parametrize('bounds_flag', [None, '0', '1'])
@pytest.mark.parametrize('model', ['GFS', 'EURO', 'ICON'])
@pytest.mark.parametrize('layer', ['waves', 'swell_1'])
@pytest.mark.parametrize('island_flag', ['0', '1'])
def test_real_manifest_scan_preserves_candidates_and_leaves_loop_when_owned(
        monkeypatch, bounds_flag, model, layer, island_flag):
    if bounds_flag is None:
        monkeypatch.delenv('GRID_RESPONSE_BOUNDS', raising=False)
    else:
        monkeypatch.setenv('GRID_RESPONSE_BOUNDS', bounds_flag)
    monkeypatch.setenv('COPERNICUS_ISLAND_SERVE', island_flag)
    instant = datetime(2026, 10, 9, tzinfo=timezone.utc)

    def product(name, hour=0, **changes):
        data = dict(model=model, provider='offline', domain='marine', layer=layer,
                    run_time=instant, valid_time_start=instant + timedelta(hours=hour),
                    valid_time_end=instant + timedelta(hours=hour), resolution=2,
                    freshness_sec=3600, is_forecast_authoritative=True,
                    coverage=dict(west=-90, south=20, east=-80, north=35), filename=name)
        data.update(changes)
        return ManifestProduct(**data)

    rows = [product('exact'), product('minus3', -3), product('plus3', 3),
            product('estimated', 1, is_estimated=True), product('island', region_id='island_fixture'),
            product('outside', 3 + 1 / 3600), product('wrong-layer', layer='air_temp'),
            product('wrong-domain', domain='wind'), product('wrong-model', model='OTHER')]
    # Representative reported manifest size, without constructing or retaining grid cells.
    manifest = PipelineManifest(last_manifest_update=instant, products=rows + [rows[-1]] * 19998)
    scan_threads = []

    class ObservedRows(list):
        def __iter__(self):
            scan_threads.append(threading.get_ident())
            return super().__iter__()

    manifest.products = ObservedRows(manifest.products)
    observed = {}

    class SelectionComplete(Exception):
        pass

    def capture(authoritative, estimated):
        observed['authoritative'] = [(item.filename, diff) for item, diff in authoritative]
        observed['estimated'] = [(item.filename, diff) for item, diff in estimated]
        raise SelectionComplete

    monkeypatch.setattr(mid_res_tier, 'split_mid_candidates', capture)
    store = SimpleNamespace(get_manifest=lambda: manifest)

    async def run():
        loop_thread = threading.get_ident()
        with pytest.raises(SelectionComplete):
            await grid_resolver.resolve_grid(store, None, model=model.lower(), domain='MARINE',
                                             layer=layer.upper(), valid_time=instant.isoformat())
        assert observed['authoritative'] == (
            [('exact', 0), ('minus3', 10800), ('plus3', 10800)]
            + ([('island', 0)] if island_flag == '1' else []))
        assert observed['estimated'] == [('estimated', 3600)]
        assert len(scan_threads) == 1
        if bounds_flag == '1':
            assert scan_threads[0] != loop_thread, '20,007-entry selection occupies the event-loop thread'
        else:
            assert scan_threads[0] == loop_thread

    asyncio.run(run())



def test_actual_offloaded_manifest_scan_retains_http_lease_after_deadline(monkeypatch):
    entered, release, exited = threading.Event(), threading.Event(), threading.Event()

    class ControlledRows(list):
        def __iter__(self):
            entered.set()
            try:
                if not release.wait(5):
                    raise AssertionError('controlled scan was not released')
                return super().__iter__()
            finally:
                exited.set()

    monkeypatch.setattr(weather, 'store', SimpleNamespace(
        get_manifest=lambda: SimpleNamespace(products=ControlledRows())))

    def stop_after_selection(*args):
        raise HTTPException(status_code=503, detail='offline selection boundary')

    monkeypatch.setattr(mid_res_tier, 'split_mid_candidates', stop_after_selection)

    async def run():
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app()),
                                     base_url='https://offline.invalid') as client:
            task = asyncio.create_task(client.get('/api/weather/grid', params=PARAMS))
            try:
                until = time.monotonic() + 2
                while not entered.is_set() and time.monotonic() < until:
                    await asyncio.sleep(.005)
                assert entered.is_set()
                response = await asyncio.wait_for(asyncio.shield(task), 2)
                assert response.status_code == 503 and response.headers['retry-after'] == '1'
                assert not exited.is_set()
                assert series_response.ADMISSION.active['mini'] == 1
            finally:
                release.set()
                await asyncio.gather(task, return_exceptions=True)
                await drained()
            assert exited.is_set() and series_response.ADMISSION.active['mini'] == 0

    asyncio.run(run())
