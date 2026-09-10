"""Request-boundary controls: real loopback HTTP plus cancellation and cache identity."""
import asyncio
from contextlib import asynccontextmanager
from datetime import datetime, timezone
import json
from urllib.parse import parse_qs, urlsplit

import httpx
import pytest

from services.weather_pipeline import tide as T


def payload(days=3):
    return {"hourly": {"time": [f"2026-09-10T{h:02}:00" for h in range(12)],
                       "sea_level_height_msl": [days / 10 + h / 100 for h in range(12)]}}


@pytest.fixture(autouse=True)
def clean_cache():
    T._reset_tide_cache_for_test()
    yield
    T._reset_tide_cache_for_test()


@asynccontextmanager
async def upstream(monkeypatch, status=200):
    """Actual TCP/HTTP; only endpoint redirected, ordinary owned httpx clients used."""
    seen = []
    handlers = set()

    async def respond(reader, writer):
        task = asyncio.current_task()
        handlers.add(task)
        try:
            raw = await reader.readuntil(b"\r\n\r\n")
            target = raw.split(b" ")[1].decode()
            query = parse_qs(urlsplit(target).query)
            seen.append(query)
            await asyncio.sleep(0.05)  # expose overlapping real requests
            body = json.dumps(payload(int(query["forecast_days"][0]))).encode()
            writer.write(f"HTTP/1.1 {status} Test\r\nContent-Type: application/json\r\nContent-Length: {len(body)}\r\nConnection: close\r\n\r\n".encode() + body)
            await writer.drain()
        finally:
            writer.close()
            await writer.wait_closed()
            handlers.discard(task)

    server = await asyncio.start_server(respond, '127.0.0.1', 0)
    monkeypatch.setattr(T, 'OPEN_METEO_MARINE_API', f'http://127.0.0.1:{server.sockets[0].getsockname()[1]}/v1/marine')
    try:
        yield seen
    finally:
        server.close()
        await server.wait_closed()
        if handlers:
            await asyncio.gather(*handlers)


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [200, 429])
async def test_real_http_eight_cold_callers_make_one_request(monkeypatch, status):
    async with upstream(monkeypatch, status) as seen:
        results = await asyncio.gather(*(T.fetch_tide_hourly(37.5, -122.5) for _ in range(8)))
        assert len(seen) == 1, f'{len(seen)} actual HTTP requests for eight identical callers'
        expected = {'time': payload()['hourly']['time'], 'level': payload()['hourly']['sea_level_height_msl']}
        assert results == ([expected] * 8 if status == 200 else [None] * 8)


@pytest.mark.asyncio
async def test_real_http_long_horizon_is_not_answered_by_short_cache(monkeypatch):
    async with upstream(monkeypatch) as seen:
        short = await T.fetch_tide_hourly(37.5, -122.5, forecast_days=1)
        long = await T.fetch_tide_hourly(37.5, -122.5, forecast_days=3)
        assert [q['forecast_days'][0] for q in seen] == ['1', '3']
        assert short['level'][0] == 0.1 and long['level'][0] == 0.3
        await T.fetch_tide_hourly(37.5, -122.5, forecast_days=1)
        assert len(seen) == 2, 'a longer cached request may satisfy a shorter one'


class Client:
    def __init__(self, status=200, headers=None, blocked=False, error=None):
        self.status, self.headers, self.error = status, headers or {}, error
        self.calls = []
        self.entered, self.release = asyncio.Event(), asyncio.Event()
        self.cancelled = 0
        if not blocked:
            self.release.set()

    async def get(self, url):
        self.calls.append(url)
        self.entered.set()
        try:
            await self.release.wait()
        except asyncio.CancelledError:
            self.cancelled += 1
            raise
        if self.error:
            raise self.error
        query = parse_qs(urlsplit(url).query)
        rows = [payload(int(query['forecast_days'][0])) for _ in query['latitude'][0].split(',')]
        return httpx.Response(self.status, headers=self.headers, json=rows if len(rows) > 1 else rows[0])


@pytest.fixture
def clock(monkeypatch):
    now = [1000.0]
    monkeypatch.setattr(T.time, 'monotonic', lambda: now[0])
    return now


@pytest.mark.asyncio
@pytest.mark.parametrize('status', [429, 500, 502, 503, 504])
async def test_refusal_cools_down_then_recovers_without_cached_fake_values(clock, status):
    c = Client(status)
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert len(c.calls) == 1
    c.status = 200
    clock[0] += 31
    result = await T.fetch_tide_hourly(1, 2, client=c)
    assert result['level'] == payload()['hourly']['sea_level_height_msl']
    assert len(c.calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('error', [httpx.ReadTimeout('timeout'), httpx.ConnectError('connect'), ValueError('bad JSON')])
async def test_exception_cooldown_preserves_unavailable_and_other_cells(clock, error):
    c = Client(error=error)
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert len(c.calls) == 1
    assert await T.fetch_tide_hourly(2, 3, client=Client()) is not None


@pytest.mark.asyncio
@pytest.mark.parametrize('retry_after', ['90', 'Thu, 10 Sep 2026 00:01:30 GMT'])
async def test_429_retry_after_protects_other_cells_and_batch_prewarm(monkeypatch, clock, retry_after):
    monkeypatch.setattr(T.time, 'time', lambda: datetime(2026, 9, 10, tzinfo=timezone.utc).timestamp())
    c = Client(429, {'Retry-After': retry_after})
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    c.status = 200
    clock[0] += 31
    assert await T.fetch_tide_hourly(3, 4, client=c) is None
    assert await T.prewarm_tide_cache([(5, 6)], client=c) == 0
    assert len(c.calls) == 1
    clock[0] += 60
    assert await T.fetch_tide_hourly(3, 4, client=c) is not None
    assert len(c.calls) == 2
    # The obsolete asctime HTTP-date form has no explicit zone, but still means GMT.
    T._reset_tide_cache_for_test()
    c = Client(429, {'Retry-After': 'Thu Sep 10 00:01:30 2026'})
    await T.fetch_tide_hourly(1, 2, client=c)
    c.status = 200
    clock[0] += 31
    assert await T.fetch_tide_hourly(3, 4, client=c) is None
    clock[0] += 60
    assert await T.fetch_tide_hourly(3, 4, client=c) is not None
    assert len(c.calls) == 2


@pytest.mark.asyncio
@pytest.mark.parametrize('retry_after', ['NaN', 'Infinity', '-1', 'not a date'])
async def test_invalid_retry_after_uses_finite_default(clock, retry_after):
    c = Client(429, {'Retry-After': retry_after})
    await T.fetch_tide_hourly(1, 2, client=c)
    c.status = 200
    clock[0] += 31
    assert await T.fetch_tide_hourly(1, 2, client=c) is not None


@pytest.mark.asyncio
async def test_cancelled_waiter_does_not_cancel_the_active_request():
    c = Client(blocked=True)
    owner = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=c))
    await c.entered.wait()
    waiter = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=c))
    await asyncio.sleep(0)
    waiter.cancel()
    with pytest.raises(asyncio.CancelledError):
        await waiter
    c.release.set()
    assert await owner is not None
    assert c.cancelled == 0 and len(c.calls) == 1


@pytest.mark.asyncio
async def test_cancelled_owner_releases_its_client_and_waiter_can_take_over():
    first, second = Client(blocked=True), Client()
    owner = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=first))
    await first.entered.wait()
    waiter = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=second))
    await asyncio.sleep(0)
    owner.cancel()
    with pytest.raises(asyncio.CancelledError):
        await owner
    assert await waiter is not None
    assert first.cancelled == 1 and len(first.calls) == len(second.calls) == 1


@pytest.mark.asyncio
async def test_cancel_all_callers_leaves_no_locked_or_detached_acquisition():
    c = Client(blocked=True)
    tasks = [asyncio.create_task(T.fetch_tide_hourly(1, 2, client=c)) for _ in range(5)]
    await c.entered.wait()
    await asyncio.sleep(0)
    for task in tasks:
        task.cancel()
    results = await asyncio.gather(*tasks, return_exceptions=True)
    assert all(isinstance(r, asyncio.CancelledError) for r in results)
    assert len(c.calls) == c.cancelled == 1
    assert await T.fetch_tide_hourly(1, 2, client=Client()) is not None


@pytest.mark.asyncio
async def test_point_waits_for_batch_and_uses_its_identical_rounded_result():
    batch, point = Client(blocked=True), Client()
    warm = asyncio.create_task(T.prewarm_tide_cache([(28.41, -80.59), (21.66, -158.05)], client=batch))
    await batch.entered.wait()
    call = asyncio.create_task(T.fetch_tide_hourly(28.4, -80.6, client=point))
    await asyncio.sleep(0)
    batch.release.set()
    assert await warm == 2
    assert (await call)['level'] == payload()['hourly']['sea_level_height_msl']
    assert len(batch.calls) == 1 and point.calls == []


@pytest.mark.asyncio
async def test_batch429_stops_later_chunks_and_per_point_fanout():
    c = Client(429)
    coords = [(i, i + 1) for i in range(6)]
    assert await T.prewarm_tide_cache(coords, client=c, chunk_size=2) == 0
    assert await asyncio.gather(*(T.fetch_tide_hourly(*k, client=c) for k in coords)) == [None] * 6
    assert len(c.calls) == 1


@pytest.mark.asyncio
async def test_overlapping_batches_preserve_order_and_do_not_deadlock():
    c = Client()
    a, b = await asyncio.wait_for(asyncio.gather(
        T.prewarm_tide_cache([(1, 2), (3, 4)], client=c),
        T.prewarm_tide_cache([(3, 4), (1, 2)], client=c)), timeout=2)
    assert a + b == 2 and len(c.calls) == 1


@pytest.mark.asyncio
async def test_expired_success_is_not_reused_after_failed_refresh(monkeypatch, clock):
    wall = [datetime(2026, 9, 10, tzinfo=timezone.utc).timestamp()]
    monkeypatch.setattr(T.time, 'time', lambda: wall[0])
    c = Client()
    assert await T.fetch_tide_hourly(1, 2, client=c) is not None
    wall[0] += T._TIDE_TTL_S + 1
    c.status = 500
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert len(c.calls) == 2


@pytest.mark.asyncio
async def test_batch_long_horizon_refresh_and_utc_day_rollover(monkeypatch):
    wall = [datetime(2026, 9, 10, 23, 59, tzinfo=timezone.utc).timestamp()]
    monkeypatch.setattr(T.time, 'time', lambda: wall[0])
    c = Client()
    await T.prewarm_tide_cache([(1, 2)], client=c, forecast_days=1)
    assert await T.prewarm_tide_cache([(1, 2)], client=c, forecast_days=3) == 1
    wall[0] += 120
    await T.fetch_tide_hourly(1, 2, client=c, forecast_days=3)
    assert len(c.calls) == 3, 'prior-day forecast does not cover the new last forecast day'


@pytest.mark.asyncio
@pytest.mark.parametrize('body', [None, {}, [], {'hourly': {}},
                                {'hourly': {'time': ['2026-09-10T00:00'], 'sea_level_height_msl': [1, 2]}}])
async def test_malformed_200_is_not_cached_or_fetched_for_every_caller(body):
    calls = []

    class InvalidClient:
        async def get(self, url):
            calls.append(url)
            return httpx.Response(200, content=json.dumps(body), headers={'Content-Type': 'application/json'})

    c = InvalidClient()
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert len(calls) == 1
    assert (1.0, 2.0) not in T._TIDE_CACHE


@pytest.mark.asyncio
async def test_warm_valid_series_survives_other_cells_quota_refusal():
    c = Client()
    expected = await T.fetch_tide_hourly(1, 2, client=c)
    c.status = 429
    assert await T.fetch_tide_hourly(3, 4, client=c) is None
    assert await T.fetch_tide_hourly(1, 2, client=c) == expected
    assert len(c.calls) == 2


@pytest.mark.asyncio
async def test_overlapping_batches_with_an_active_point_cannot_reverse_lock_order():
    point_client, batches = Client(blocked=True), Client()
    point = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=point_client))
    await point_client.entered.wait()
    first = asyncio.create_task(T.prewarm_tide_cache([(1, 2), (3, 4)], client=batches))
    await asyncio.sleep(0)
    reverse = asyncio.create_task(T.prewarm_tide_cache([(3, 4), (1, 2)], client=batches))
    await asyncio.sleep(0)
    point_client.release.set()
    _, a, b = await asyncio.wait_for(asyncio.gather(point, first, reverse), timeout=2)
    assert a + b == 1 and len(batches.calls) == 1


@pytest.mark.asyncio
async def test_cache_capacity_evicts_one_entry_without_cold_flushing_other_cells(monkeypatch):
    monkeypatch.setattr(T, '_TIDE_CACHE_MAX', 2)
    c = Client()
    await T.fetch_tide_hourly(1, 2, client=c)
    await T.fetch_tide_hourly(3, 4, client=c)
    await T.fetch_tide_hourly(5, 6, client=c)
    assert len(T._TIDE_CACHE) == 2
    await T.fetch_tide_hourly(3, 4, client=c)
    assert len(c.calls) == 3


@pytest.mark.asyncio
async def test_failed_batch_with_missing_rows_does_not_guess_location_mapping():
    class MissingRow:
        async def get(self, url):
            return httpx.Response(200, json=[payload()])

    assert await T.prewarm_tide_cache([(1, 2), (3, 4)], client=MissingRow()) == 0
    assert not T._TIDE_CACHE


@pytest.mark.asyncio
async def test_longer_server_retry_after_is_honored_without_sleeping(clock):
    c = Client(429, {'Retry-After': '7200'})
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    c.status = 200
    clock[0] += 3601
    assert await T.fetch_tide_hourly(1, 2, client=c) is None
    assert len(c.calls) == 1
    clock[0] += 3600
    assert await T.fetch_tide_hourly(1, 2, client=c) is not None


@pytest.mark.asyncio
async def test_point_budget_includes_wait_for_batch_without_cancelling_batch(monkeypatch):
    monkeypatch.setattr(T, '_TIDE_POINT_TIMEOUT_S', 0.03, raising=False)
    batch, point = Client(blocked=True), Client()
    warm = asyncio.create_task(T.prewarm_tide_cache([(1, 2)], client=batch))
    await batch.entered.wait()
    try:
        result = await asyncio.wait_for(T.fetch_tide_hourly(1, 2, client=point), timeout=0.5)
        assert result is None
        assert not warm.done() and point.calls == []
    finally:
        batch.release.set()
        assert await warm == 1
    assert await T.fetch_tide_hourly(1, 2, client=point) is not None
    assert point.calls == []


@pytest.mark.asyncio
async def test_batch_budget_includes_wait_for_point_and_releases_queued_locks(monkeypatch):
    monkeypatch.setattr(T, '_TIDE_BATCH_TIMEOUT_S', 0.03, raising=False)
    point, batch = Client(blocked=True), Client()
    active = asyncio.create_task(T.fetch_tide_hourly(1, 2, client=point))
    await point.entered.wait()
    try:
        assert await asyncio.wait_for(T.prewarm_tide_cache([(1, 2), (3, 4)], client=batch), timeout=0.5) == 0
        assert not active.done() and batch.calls == []
    finally:
        point.release.set()
        assert await active is not None


@pytest.mark.asyncio
async def test_point_budget_cancels_and_cleans_active_acquisition(monkeypatch):
    monkeypatch.setattr(T, '_TIDE_POINT_TIMEOUT_S', 0.03, raising=False)
    c = Client(blocked=True)
    assert await asyncio.wait_for(T.fetch_tide_hourly(1, 2, client=c), timeout=0.5) is None
    assert c.cancelled == 1
    assert await T.fetch_tide_hourly(1, 2, client=Client()) is None  # failed cell cools down
