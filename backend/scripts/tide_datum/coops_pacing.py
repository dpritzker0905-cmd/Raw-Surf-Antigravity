"""Paced, backing-off access to NOAA CO-OPS for the tide-a-harcon-v1 run (gates/tide-a-harcon-v1.md amendment 2,
PRE-DATA; the advisor's ruling that v1-1 was NO RUN (infra)).

v1-1 got HTTP 403 from api.tidesandcurrents.noaa.gov after about 140 requests in about 2 minutes. `install()` replaces
`urllib.request.urlopen` (which finder_check, tide_fes.sources and the instrument all look up at call time, so no
vendored byte changes) with an opener that, for the CO-OPS host only:
  - PACES: at least MIN_GAP_S between the starts of any two CO-OPS requests, retries included (<= 0.5 per second);
  - BACKS OFF on 403, 429, 5xx, a connection error or a timeout: exponential waits with jitter (BASE_S doubling, at most
    CAP_S each), honouring Retry-After, until BUDGET_S has passed since the request's first attempt (about 10 min);
  - then raises HarnessFailure. Any other HTTP error (400, 404: for the known stations of this run, "invalid station or
    system error") is a HarnessFailure at once, never data.
HarnessFailure is a BaseException on purpose: tide_fes.sources.get_json and the instrument's helpers catch `Exception`,
which would turn a throttled constants fetch into "no constants" (a replacement cause) or a CO-OPS error into "not
MEASURED". The callers that must survive one (the per-station finder runner, the instrument) catch it explicitly and
RECORD it, so the run still writes its output and the scorer turns it into VOID (never FAIL, never a replacement).
Every attempt is appended to LOG_PATH (time, path, station, status, attempt; flushed), which the workflow uploads.
Requests to any other host pass straight through. Constants are fixed here: no environment or argument overrides.
"""
import email.utils
import http.client
import io
import json
import random
import socket
import time
import urllib.error
import urllib.request
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlparse

HOST = "api.tidesandcurrents.noaa.gov"
MIN_GAP_S, BASE_S, CAP_S, BUDGET_S = 2.0, 15.0, 120.0, 600.0
RETRY_STATUS = {403, 429, 500, 502, 503, 504}
LOG_PATH = "coops_requests.jsonl"


class HarnessFailure(BaseException):
    """A CO-OPS request that could not be completed: infrastructure, never data. BaseException so no `except Exception`
    can swallow it; callers that must continue catch it by name and record it."""


class _Resp:
    """The verified body as an urlopen-like response: read(), a context manager, status, headers, getcode()."""

    def __init__(self, body, status, headers, url):
        self._b, self.status, self.headers, self.url = io.BytesIO(body), status, headers, url

    def read(self, *a):
        return self._b.read(*a)

    def getcode(self):
        return self.status

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


_state = {"last_start": None, "orig": urllib.request.urlopen, "installed": False}
_clock = {"now": time.monotonic, "sleep": time.sleep, "rand": random.random}


def _log(row):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
            fh.flush()
    except OSError:
        pass


def _retry_after(err):
    """Seconds asked by a Retry-After header (seconds or HTTP-date), or None."""
    h = getattr(err, "headers", None)
    v = h.get("Retry-After") if h is not None else None
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        try:
            t = email.utils.parsedate_to_datetime(v)
            return max(0.0, (t - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError):
            return None


def _space():
    now = _clock["now"]()
    if _state["last_start"] is not None:
        wait = MIN_GAP_S - (now - _state["last_start"])
        if wait > 0:
            _clock["sleep"](wait)
    _state["last_start"] = _clock["now"]()


def paced_urlopen(url, data=None, timeout=60, *args, **kwargs):
    """urlopen's signature. CO-OPS requests are paced, retried with backoff and bounded; others pass through."""
    full = url.full_url if isinstance(url, urllib.request.Request) else str(url)
    u = urlparse(full)
    if (u.hostname or "").lower() != HOST:
        return _state["orig"](url, data, timeout, *args, **kwargs)
    station = (parse_qs(u.query).get("station") or [None])[0] or u.path.split("/stations/")[-1].split("/")[0]
    first, attempt = _clock["now"](), 0
    while True:
        attempt += 1
        _space()
        try:
            with _state["orig"](url, data, timeout, *args, **kwargs) as resp:
                status, headers, body = getattr(resp, "status", 200), getattr(resp, "headers", None), resp.read()
            json.loads(body.decode("utf-8"))           # a truncated or non-JSON body is infrastructure, never data
            _log({"t": time.time(), "path": u.path, "station": station, "status": status, "attempt": attempt,
                  "bytes": len(body)})
            return _Resp(body, status, headers, full)
        except urllib.error.HTTPError as e:
            _log({"t": time.time(), "path": u.path, "station": station, "status": e.code, "attempt": attempt})
            if e.code not in RETRY_STATUS:
                raise HarnessFailure(f"CO-OPS HTTP {e.code} for {u.path} station {station}") from None
            asked = _retry_after(e)
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException,
                ValueError) as e:                        # ValueError: JSON / UTF-8 decoding of a truncated body
            _log({"t": time.time(), "path": u.path, "station": station, "status": type(e).__name__, "attempt": attempt})
            asked = None
        wait = min(CAP_S, BASE_S * 2 ** (attempt - 1)) * (1.0 + 0.25 * _clock["rand"]())
        if asked is not None:
            wait = max(wait, asked)
        if _clock["now"]() - first + wait > BUDGET_S:
            raise HarnessFailure(f"CO-OPS unavailable for {u.path} station {station} after {attempt} attempt(s) "
                                 f"within {BUDGET_S:.0f} s")
        _clock["sleep"](wait)


def install():
    """Route every urllib.request.urlopen through paced_urlopen (idempotent)."""
    if not _state["installed"]:
        _state["orig"] = urllib.request.urlopen
        urllib.request.urlopen = paced_urlopen
        _state["installed"] = True


def uninstall():
    if _state["installed"]:
        urllib.request.urlopen = _state["orig"]
        _state["installed"] = False
        _state["last_start"] = None
