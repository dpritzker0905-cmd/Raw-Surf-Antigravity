"""Bounded, observable retries for read-only census HTTP acquisition, never grading.

Storage returned 429/SlowDown in run 34413573159. Later reads in the same run
succeeded. Retain every refused attempt; persistent failures still refuse the
census. Never log URLs, credentials, arbitrary response bodies or exceptions.
"""
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime
import random
import sys
import time

ATTEMPTS = 3
MAX_WAIT_SECONDS = 30
RETRYABLE = {429, 502, 503, 504}


class CensusReadError(RuntimeError):
    """Acquisition failed; this is not a scientific verdict."""


def retry_delay(headers, attempt):
    delay = 2 ** attempt + random.uniform(0, 1)
    value = headers.get('Retry-After')
    if value:
        try:
            seconds = int(value)
        except (ValueError, TypeError):
            try:
                stamp = parsedate_to_datetime(value)
                if stamp.tzinfo is None:
                    stamp = stamp.replace(tzinfo=timezone.utc)
                seconds = (stamp - datetime.now(timezone.utc)).total_seconds()
            except (ValueError, TypeError, OverflowError):
                seconds = 0
        delay = max(delay, seconds)
    # Do not violate a server's longer Retry-After by capping and retrying early.
    if delay > MAX_WAIT_SECONDS:
        raise CensusReadError('Retry-After exceeds the bounded census wait; refusing')
    return delay


def get_json(session, url, headers, what, timeout=120):
    import requests

    for attempt in range(1, ATTEMPTS + 1):
        response = None
        retry_headers = {}
        try:
            response = session.get(url, headers=headers, timeout=timeout)
            status = response.status_code
            if status == 200:
                try:
                    payload = response.json()
                except ValueError:
                    raise CensusReadError(f'{what}: invalid JSON; refusing without retry') from None
                if attempt > 1:
                    print(f'::warning::census HTTP {what}: recovered on attempt {attempt}/{ATTEMPTS}; '
                          'earlier transport refusals retained above; calibration is graded separately', file=sys.stderr)
                return payload
            reason = f'HTTP {status}'
            if status not in RETRYABLE:
                raise CensusReadError(f'{what}: {reason}; not retryable')
            retry_headers = response.headers
        except (requests.exceptions.Timeout, requests.exceptions.ConnectionError) as error:
            reason = type(error).__name__
        finally:
            if response is not None:
                response.close()
        if attempt == ATTEMPTS:
            raise CensusReadError(f'{what}: {reason}; exhausted {ATTEMPTS} attempts')
        try:
            delay = retry_delay(retry_headers, attempt)
        except CensusReadError as error:
            raise CensusReadError(f'{what}: {reason}; {error}') from None
        print(f'::warning::census HTTP {what}: attempt {attempt}/{ATTEMPTS} refused ({reason}); '
              f'waiting {delay:.2f}s before another GET', file=sys.stderr)
        time.sleep(delay)


def fetch_json(url, token, what, timeout=120):
    import requests

    with requests.Session() as session:
        return get_json(session, url, {'Authorization': f'Bearer {token}', 'apikey': token,
                                      'User-Agent': 'calibration-census/2'}, what, timeout)
