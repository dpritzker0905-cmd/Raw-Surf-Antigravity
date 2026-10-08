"""PF03 request envelope: per-process admission covers build, encode and gzip.

Default off. Encoding happens in an owned worker; a timed-out waiter never releases
its permit while that worker is still running. A deadline refuses late output; it
cannot preempt Python/C CPU work, so it is not a hard wall-clock execution bound.
"""
import asyncio
import gzip
import json
import math
import os
import time
from collections import deque

from fastapi import HTTPException
from fastapi.encoders import jsonable_encoder
from pydantic import TypeAdapter
from starlette.responses import Response

from services.weather_pipeline.schemas import GridVector
from services.weather_pipeline.config_env import env_float

ADAPTER = TypeAdapter(dict)


def finite_compatible(value):
    """Optimize only exact known JSON types and GridVector's qualified serializer."""
    if value is None or type(value) in (str, bool):
        return True
    if type(value) is int:
        return -(2 ** 63) <= value < 2 ** 63
    if type(value) is float:
        if not math.isfinite(value):
            raise ValueError("Out of range float values are not JSON compliant")
        return True
    if type(value) is GridVector:
        return finite_compatible(value.__dict__)
    if type(value) is dict:
        compatible = True
        for key, child in value.items():
            compatible = finite_compatible(child) and type(key) is str and compatible
        return compatible
    if type(value) in (list, tuple):
        return all([finite_compatible(child) for child in value])
    return False


def accepts_gzip(request):
    if request is None:
        return False
    for item in request.headers.get('accept-encoding', '').lower().split(','):
        parts = item.strip().split(';')
        if parts[0] != 'gzip':
            continue
        try:
            return all(float(p.strip()[2:]) > 0 for p in parts[1:] if p.strip().startswith('q='))
        except ValueError:
            return False
    return False


def encode_response(payload, compress):
    if finite_compatible(payload):
        body = ADAPTER.dump_json(payload)
    else:
        # Match FastAPI's existing unsupported-type behavior, including custom models.
        body = json.dumps(jsonable_encoder(payload), ensure_ascii=False, allow_nan=False,
                          indent=None, separators=(',', ':')).encode('utf-8')
    # Existing outer middleware checks only for the substring 'gzip', ignoring q=0.
    # Explicit identity marks this already-negotiated response and prevents that pass.
    headers = {'Vary': 'Accept-Encoding', 'Content-Encoding': 'identity'}
    if compress and len(body) >= 500:
        body = gzip.compress(body, compresslevel=9)
        headers['Content-Encoding'] = 'gzip'  # outer GZipMiddleware must not compress twice
    return Response(body, media_type='application/json', headers=headers)


class SeriesAdmission:
    """One page; four I/O minis under grid bounds, otherwise one; joint queue <=4."""
    def __init__(self, mini_slots=None):
        self.active = {'mini': 0, 'page': 0}
        self.queue = {'mini': deque(), 'page': deque()}
        self.mini_slots = mini_slots
        self.cpu_slot = asyncio.Semaphore(1)

    def limit(self, lane):
        if lane == 'page':
            return 1
        if self.mini_slots is not None:
            return self.mini_slots
        return 4 if os.environ.get('GRID_RESPONSE_BOUNDS', '0') == '1' else 1

    async def acquire(self, lane, request, deadline):
        queue = self.queue[lane]
        if time.monotonic() >= deadline:
            raise HTTPException(503, 'Series response deadline exceeded', headers={'Retry-After': '1'})
        if request is not None and await request.is_disconnected():
            raise HTTPException(499, 'Client disconnected')
        # Queue capacity is for waiting work. An idle reserved slot remains usable
        # even when the other lane's queue is full; do not starve a visible frame.
        if self.active[lane] < self.limit(lane) and not queue:
            self.active[lane] += 1
            return
        if sum(map(len, self.queue.values())) >= 4:
            raise HTTPException(429, 'Series admission queue full', headers={'Retry-After': '1'})
        ticket = object()
        queue.append(ticket)
        try:
            while True:
                if time.monotonic() >= deadline:
                    raise HTTPException(503, 'Series response deadline exceeded', headers={'Retry-After': '1'})
                if request is not None and await request.is_disconnected():
                    raise HTTPException(499, 'Client disconnected')
                if queue[0] is ticket and self.active[lane] < self.limit(lane):
                    queue.popleft()
                    self.active[lane] += 1
                    return
                await asyncio.sleep(0.025)
        finally:
            if ticket in queue:
                queue.remove(ticket)

    def release(self, lane):
        self.active[lane] -= 1


ADMISSION = SeriesAdmission()


async def serve_series(builder, hours, request):
    budget = env_float('GRID_SERIES_DEADLINE_S', 20.0, lo=1.0, hi=20.0)
    deadline = time.monotonic() + budget
    lane = 'mini' if len([h for h in hours.split(',') if h.strip()]) == 1 else 'page'
    await ADMISSION.acquire(lane, request, deadline)

    async def operation():
        try:
            payload = await builder()
            if time.monotonic() >= deadline:
                raise HTTPException(503, 'Series response deadline exceeded', headers={'Retry-After': '1'})
            if request is not None and await request.is_disconnected():
                raise HTTPException(499, 'Client disconnected')
            response = await asyncio.to_thread(encode_response, payload, accepts_gzip(request))
            if time.monotonic() >= deadline:
                raise HTTPException(503, 'Series response deadline exceeded', headers={'Retry-After': '1'})
            return response
        finally:
            ADMISSION.release(lane)

    task = asyncio.create_task(operation())
    # Consume late errors when the HTTP waiter has timed out/disconnected/canceled.
    task.add_done_callback(lambda finished: None if finished.cancelled() else finished.exception())
    try:
        return await asyncio.wait_for(asyncio.shield(task), max(0, deadline - time.monotonic()))
    except asyncio.TimeoutError:
        raise HTTPException(503, 'Series response deadline exceeded', headers={'Retry-After': '1'})
