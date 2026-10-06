"""Bounded GFS-wave cycle probing, invoked only by the explicit dark retry flag."""
from datetime import timedelta
import random
import time

RETRYABLE = frozenset({429, 500, 502, 503, 504})
SELECTION_BUDGET_S = 12.0
SOCKET_TIMEOUT_S = 3.0


class _StopProbing(Exception):
    """Respect a server backoff that cannot be completed inside this selection budget."""


def _available(client, url, deadline):
    import requests
    for attempt in range(2):
        remaining = deadline - time.monotonic()
        if remaining <= 0:
            return False
        response = None
        try:
            response = client.head(url, timeout=min(SOCKET_TIMEOUT_S, remaining))
            status = response.status_code
            if time.monotonic() >= deadline:
                return False  # A late response cannot certify completeness.
            if status == 200:
                return True
            if status not in RETRYABLE:
                return False
        except (requests.Timeout, requests.ConnectionError, TimeoutError, ConnectionError):
            pass
        except Exception:
            return False  # Unexpected/malformed responses are not transport retries.
        finally:
            close = getattr(response, 'close', None)
            if callable(close):
                close()
        if attempt == 1:
            if getattr(response, 'status_code', None) == 429:
                raise _StopProbing
            return False
        delay = random.uniform(0.1, 0.3)
        hint = (getattr(response, 'headers', None) or {}).get('Retry-After')
        if hint is not None:
            try:
                hinted = float(hint)
                if not (0 <= hinted < SELECTION_BUDGET_S):
                    raise _StopProbing
                delay = max(delay, hinted)
            except (TypeError, ValueError):
                raise _StopProbing  # Do not probe other URLs ahead of the server's instruction.
        if delay >= deadline - time.monotonic():
            raise _StopProbing
        time.sleep(delay)
    return False


def pick_complete_cycle(client, now, max_f, base_url, grid):
    deadline = time.monotonic() + SELECTION_BUDGET_S
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(7):
        if time.monotonic() >= deadline:
            break
        cycle = floor6 - timedelta(hours=6 * back)
        prefix = f'{base_url}/gfs.{cycle:%Y%m%d}/{cycle:%H}/wave/gridded/gfswave.t{cycle:%H}z.{grid}.'
        try:
            if _available(client, prefix + 'f000.grib2.idx', deadline) and _available(client, prefix + f'f{max_f:03d}.grib2.idx', deadline):
                return cycle, prefix
        except _StopProbing:
            break
    return None, None
