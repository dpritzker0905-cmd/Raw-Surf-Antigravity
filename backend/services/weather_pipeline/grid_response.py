"""Default-off HTTP grid/series response budget and shared worker ownership.

Wrap FastAPI's own handler, preserving response-model validation and serialization.
The cooperative deadline refuses late output; it cannot preempt event-loop CPU,
threads or shared provider producers. Leases outlive canceled HTTP/per-hour waiters.
"""
import asyncio
from contextvars import ContextVar
from functools import wraps
import gzip
import logging
import os
import time

from fastapi import HTTPException
from fastapi.routing import APIRoute

from services.weather_pipeline.config_env import env_float
from services.weather_pipeline import series_response

OWNED_TASKS = set()
_CHILDREN = ContextVar('weather_response_children', default=None)
INGRESS_KEY = 'weather_response_ingress'
logger = logging.getLogger(__name__)


def enabled():
    return os.environ.get('GRID_RESPONSE_BOUNDS', '0') == '1'


def _expired():
    return HTTPException(503, 'Grid response deadline exceeded', headers={'Retry-After': '1'})


def _retain(task, registry):
    registry.add(task)

    def finished(done):
        registry.discard(done)
        if not done.cancelled():
            error = done.exception()  # Consume late failures after the HTTP waiter leaves.
            if error is not None and not isinstance(error, HTTPException):
                logger.warning('[Grid Response] Owned work finished with %s', type(error).__name__)

    task.add_done_callback(finished)
    return task


def own_grid_operation(builder):
    """Series per-hour wait_for may cancel its waiter, never the owned grid work.

    Direct Python calls outside the response envelope retain their original behavior.
    functools.wraps keeps the signature FastAPI and the series stride probe inspect.
    """
    @wraps(builder)
    async def owned(*args, **kwargs):
        children = _CHILDREN.get()
        if children is None:
            return await builder(*args, **kwargs)
        task = _retain(asyncio.create_task(builder(*args, **kwargs)), children)
        return await asyncio.shield(task)

    return owned


def _finish_response(response, compress):
    # Keep FastAPI's validated body and all raw headers, including repeated cookies.
    # Negotiate here so outer GZipMiddleware cannot add work outside the budget.
    if 'content-encoding' not in response.headers:
        vary = response.headers.get('vary', '')
        if 'accept-encoding' not in [v.strip().lower() for v in vary.split(',')]:
            response.headers['Vary'] = f'{vary}, Accept-Encoding' if vary else 'Accept-Encoding'
        response.headers['Content-Encoding'] = 'identity'
        if compress and len(response.body) >= 500:
            response.body = gzip.compress(response.body, compresslevel=9)
            response.headers['Content-Encoding'] = 'gzip'
            response.headers['Content-Length'] = str(len(response.body))
    return response


async def serve_response(builder, request, lane, deadline):
    admission = series_response.ADMISSION  # one process budget, not a second pair of slots
    await admission.acquire(lane, request, deadline)
    children = set()
    result = asyncio.get_running_loop().create_future()
    # Also consume an output error if its HTTP waiter has already left.
    result.add_done_callback(lambda done: None if done.cancelled() else done.exception())

    async def operation():
        token = _CHILDREN.set(children)
        background = None
        try:
            if time.monotonic() >= deadline:
                raise _expired()
            response = await builder()
            background = response.background
            response.background = None
            if time.monotonic() >= deadline:
                raise _expired()
            response = await asyncio.to_thread(_finish_response, response, series_response.accepts_gzip(request))
            if time.monotonic() >= deadline:
                raise _expired()
            result.set_result(response)
        except BaseException as error:
            if not result.done():
                result.set_exception(error)
            raise
        finally:
            # A series per-hour timeout can leave a grid's store/coarse-fill thread
            # running. Keep the root lease until every such child really completes.
            try:
                try:
                    # Response delivery need not wait for revalidation, but its
                    # work still owns the lease. Run once even if output expired;
                    # otherwise resolver revalidation markers can stay wedged.
                    if background is not None:
                        await background()
                finally:
                    while children:
                        await asyncio.gather(*tuple(children), return_exceptions=True)
            finally:
                _CHILDREN.reset(token)
                admission.release(lane)

    _retain(asyncio.create_task(operation()), OWNED_TASKS)
    # Do not cancel this task on HTTP timeout, client disconnect or cancellation.
    while True:
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            raise _expired()
        if request is not None and await request.is_disconnected():
            raise HTTPException(499, 'Client disconnected')
        done, _ = await asyncio.wait({result}, timeout=min(.025, remaining))
        if done:
            if time.monotonic() >= deadline:
                raise _expired()
            return result.result()


class GridResponseIngress:
    """Timestamp ASGI application ingress, before routing/dependencies/gzip.

    This excludes proxy/socket queueing before ASGI and network transfer after send.
    """
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope.get('type') == 'http' and enabled() and scope.get('path', '').endswith(('/weather/grid', '/weather/grid_series')):
            scope.setdefault('state', {}).setdefault(INGRESS_KEY, time.monotonic())
        await self.app(scope, receive, send)


class GridResponseRoute(APIRoute):
    def get_route_handler(self):
        original = super().get_route_handler()
        if not self.path.endswith(('/weather/grid', '/weather/grid_series')):
            return original

        async def bounded(request):
            if not enabled():
                return await original(request)
            ingress = request.scope.get('state', {}).get(INGRESS_KEY, time.monotonic())
            budget = env_float('GRID_RESPONSE_DEADLINE_S', 20.0, lo=1.0, hi=20.0)
            is_series = self.path.endswith('/grid_series')
            if is_series:
                budget = min(budget, env_float('GRID_SERIES_DEADLINE_S', 20.0, lo=1.0, hi=20.0))
            hours = request.query_params.get('hours', '')
            lane = 'page' if is_series and len([h for h in hours.split(',') if h.strip()]) != 1 else 'mini'
            return await serve_response(lambda: original(request), request, lane, ingress + budget)

        return bounded
