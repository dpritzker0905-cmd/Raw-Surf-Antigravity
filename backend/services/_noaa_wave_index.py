"""Bounded NOAA wave index retries; shared by local and subprocess fetches."""
import os
import time


def fetch_selected_index(client, url, timeout, expected, select_ranges, parse_idx):
    """Retry at most once when explicitly armed; never decode a refused index."""
    import requests as requests_api
    armed = os.environ.get('NOAA_WAVE_INDEX_RETRY', '0') == '1'
    for attempt in range(2 if armed else 1):
        response = None
        try:
            response = client.get(url + '.idx', timeout=timeout)
            status = getattr(response, 'status_code', 200)
            if armed and status != 200:
                if status not in (429, 500, 502, 503, 504) or attempt:
                    raise RuntimeError(f'wave index HTTP {status}')
                # Respect server backoff; do not immediately repeat a rate-limited request.
                hint = (getattr(response, 'headers', None) or {}).get('Retry-After')
                if status == 429 or hint is not None:
                    raise RuntimeError(f'wave index HTTP {status}; server backoff, no immediate retry')
            else:
                selected = select_ranges(parse_idx(response.text))
                if len(selected) == expected:
                    return selected
                if not armed or attempt:
                    raise RuntimeError(f'idx missing wave messages (got {len(selected)}/{expected})')
        except (requests_api.Timeout, requests_api.ConnectionError):
            if not armed or attempt:
                raise
        finally:
            close = getattr(response, 'close', None)
            if callable(close):
                close()
        time.sleep(0.25)
    raise RuntimeError('wave index unavailable')
