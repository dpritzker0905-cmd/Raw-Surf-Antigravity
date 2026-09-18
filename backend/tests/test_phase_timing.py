import asyncio
import pytest
from services.weather_pipeline.phase_timing import timed_await, trace_series_phases


def test_concurrent_requests_do_not_share_phase_counters():
    @trace_series_phases
    async def request(count):
        for _ in range(count): await timed_await('product_load', asyncio.sleep(0))
        return {}
    async def run(): return await asyncio.gather(request(1), request(3))
    a,b=asyncio.run(run())
    assert a['timing']['phases']['product_load']['calls']==1
    assert b['timing']['phases']['product_load']['calls']==3


def test_failure_is_measured_without_changing_exception():
    async def fail(): raise ValueError('test')
    @trace_series_phases
    async def request():
        with pytest.raises(ValueError,match='test'): await timed_await('provider_wait',fail())
        return {}
    result=asyncio.run(request())
    assert result['timing']['phases']['provider_wait']['failed_or_cancelled']==1


def test_cancelled_request_resets_context_and_does_not_consume_cancellation():
    @trace_series_phases
    async def request():
        await timed_await('provider_wait',asyncio.sleep(60))
        return {}
    @trace_series_phases
    async def next_request(): return {}
    async def run():
        task=asyncio.create_task(request()); await asyncio.sleep(0); task.cancel()
        with pytest.raises(asyncio.CancelledError): await task
        return await next_request()
    assert asyncio.run(run())['timing']['phases']=={}


def test_late_child_completion_cannot_mutate_completed_response():
    children=[]
    release=None
    @trace_series_phases
    async def request():
        children.append(asyncio.create_task(timed_await('provider_wait',release.wait())))
        await asyncio.sleep(0)
        return {}
    async def run():
        nonlocal release
        release=asyncio.Event()
        result=await request()
        release.set(); await children[0]
        return result
    assert asyncio.run(run())['timing']['phases']=={}
