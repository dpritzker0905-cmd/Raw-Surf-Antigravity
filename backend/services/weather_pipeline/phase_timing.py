"""Request-local series phase attribution. Sums can overlap; they are not wall time."""
from contextvars import ContextVar
from functools import wraps
from time import perf_counter

_active = ContextVar('weather_series_phases', default=None)
_PHASES = frozenset(('provider_wait', 'viewport_upstream', 'normalize_persist', 'manifest_load', 'product_load'))


async def timed_await(phase, awaitable):
    trace = _active.get()
    if trace is None or trace['closed'] or phase not in _PHASES:
        return await awaitable
    started = perf_counter()
    failed = False
    try:
        return await awaitable
    except BaseException:
        failed = True
        raise
    finally:
        # Shielded warming tasks can outlive the response. Freeze its evidence on exit.
        if not trace['closed']:
            duration = max(0.0, (perf_counter() - started) * 1000)
            item = trace['phases'].setdefault(phase, {'calls': 0, 'failed_or_cancelled': 0, 'sum_ms': 0.0, 'max_ms': 0.0})
            item['calls'] += 1
            item['failed_or_cancelled'] += int(failed)
            item['sum_ms'] += duration
            item['max_ms'] = max(item['max_ms'], duration)


def timed_phase(phase):
    def decorate(function):
        @wraps(function)
        async def wrapped(*args, **kwargs):
            return await timed_await(phase, function(*args, **kwargs))
        return wrapped
    return decorate


def trace_series_phases(function):
    @wraps(function)
    async def wrapped(*args, **kwargs):
        trace = {'closed': False, 'phases': {}}
        token = _active.set(trace)
        try:
            result = await function(*args, **kwargs)
            timing = result.setdefault('timing', {})
            timing['phases'] = {name: {key: round(value, 3) if key.endswith('_ms') else value
                                      for key, value in item.items()}
                                for name, item in trace['phases'].items()}
            timing['phase_semantics'] = 'Cumulative awaited durations; nested/concurrent phases overlap. Excludes HTTP serialization, transport and browser presentation.'
            return result
        finally:
            trace['closed'] = True
            _active.reset(token)
    return wrapped
