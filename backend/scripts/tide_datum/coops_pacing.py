"""Paced, fail-closed access to NOAA CO-OPS for the tide-a-harcon-v1 run (gates/tide-a-harcon-v1.md amendment 3,
PRE-DATA; the advisor's approval of pacing design v2 with R1 and R2, after v1-1 = NO RUN (infra)).

`install()` does two things, both only for the CO-OPS host:
  1. replaces `urllib.request.urlopen` (finder_check, tide_fes.sources and the instrument all look it up at call time,
     so no vendored byte changes) with `paced_urlopen`, which
       - PACES: at least MIN_GAP_S between the starts of any two CO-OPS requests, retries included, and before the first
         request of the process (so the gap also holds across workflow steps);
       - READS the whole body inside the guard and requires complete JSON;
       - CLASSIFIES (measured on non-gate stations, 2026-11-24): a 200 with well-formed JSON is DATA (an empty constants
         list or an error-JSON is "no data", unchanged); any non-200, connection error, timeout, truncated or non-JSON
         body is INFRASTRUCTURE;
       - BACKS OFF on infrastructure: waits BASE_S doubling to at most CAP_S, plus up to 25 % jitter, honouring
         Retry-After (seconds or HTTP-date) unless it asks for more than RETRY_AFTER_MAX_S; bounded by BUDGET_S from the
         request's first attempt and by the step's remaining budget (set_budget);
       - then raises CoopsUnavailable (a BaseException, so no `except Exception` can turn it into "no constants" or
         "not MEASURED"); 400/404 on this run's known stations raise it at once.
  2. guards `http.client.HTTPConnection.request` (every library path goes through it): a CO-OPS request is counted;
     any non-GET, any body, or any host other than CO-OPS is refused (CoopsUnavailable). `audit()` then requires the
     http-layer CO-OPS count to equal the wrapper's attempt count: a request that bypassed the classification aborts.
Every attempt is appended to LOG_PATH (flushed). Constants are fixed here: no environment or argument overrides.
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
MIN_GAP_S, BASE_S, CAP_S, BUDGET_S, RETRY_AFTER_MAX_S, SOCKET_TIMEOUT_S = 2.0, 15.0, 120.0, 600.0, 900.0, 60
LOG_PATH = "coops_requests.jsonl"


class CoopsUnavailable(BaseException):
    """A CO-OPS request that could not be completed: infrastructure, never data. The runner turns it into
    outcome.json {"status": "no_run_infra"} and a non-zero exit (amendment 3, R2)."""

    def __init__(self, msg, station=None, attempts=0):
        super().__init__(msg)
        self.station, self.attempts = station, attempts


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


_state = {"last_start": None, "orig": urllib.request.urlopen, "orig_request": http.client.HTTPConnection.request,
          "installed": False, "http_count": 0, "wrapper_count": 0, "deadline": None}
_clock = {"now": time.monotonic, "sleep": time.sleep, "rand": random.random}


def set_budget(seconds):
    """The step's remaining budget: a wait that would pass it aborts at once."""
    _state["deadline"] = _clock["now"]() + float(seconds)


def _log(row):
    try:
        with open(LOG_PATH, "a", encoding="utf-8") as fh:
            fh.write(json.dumps(row, sort_keys=True) + "\n")
            fh.flush()
    except OSError:
        pass


def _retry_after(err):
    h = getattr(err, "headers", None)
    v = h.get("Retry-After") if h is not None else None
    if not v:
        return None
    try:
        return max(0.0, float(v))
    except ValueError:
        try:
            return max(0.0, (email.utils.parsedate_to_datetime(v) - datetime.now(timezone.utc)).total_seconds())
        except (TypeError, ValueError):
            return None


def _space():
    now = _clock["now"]()
    last = _state["last_start"]
    wait = MIN_GAP_S if last is None else MIN_GAP_S - (now - last)      # a startup gap too
    if wait > 0:
        _clock["sleep"](wait)
    _state["last_start"] = _clock["now"]()


def paced_urlopen(url, data=None, timeout=SOCKET_TIMEOUT_S, *args, **kwargs):
    """urlopen's signature. CO-OPS: paced, verified, classified, backed off and bounded; other hosts pass through."""
    full = url.full_url if isinstance(url, urllib.request.Request) else str(url)
    u = urlparse(full)
    if (u.hostname or "").lower() != HOST:
        return _state["orig"](url, data, timeout, *args, **kwargs)
    q = parse_qs(u.query)
    station = (q.get("station") or [None])[0] or u.path.split("/stations/")[-1].split("/")[0]
    first, attempt = _clock["now"](), 0
    while True:
        attempt += 1
        _space()
        _state["wrapper_count"] += 1
        row = {"t": time.time(), "path": u.path, "station": station, "interval": (q.get("interval") or [None])[0],
               "attempt": attempt}
        asked = None
        try:
            with _state["orig"](url, data, timeout, *args, **kwargs) as resp:
                status, headers, body = getattr(resp, "status", 200), getattr(resp, "headers", None), resp.read()
            json.loads(body.decode("utf-8"))           # a truncated or non-JSON body is infrastructure, never data
            _log(dict(row, status=status, bytes=len(body), cls="data"))
            return _Resp(body, status, headers, full)
        except urllib.error.HTTPError as e:
            _log(dict(row, status=e.code, cls="infra"))
            if e.code in (400, 404):                   # this run's stations are all known: a system error, at once
                raise CoopsUnavailable(f"CO-OPS HTTP {e.code} for {u.path}", station, attempt) from None
            asked = _retry_after(e)
        except (urllib.error.URLError, socket.timeout, TimeoutError, ConnectionError, http.client.HTTPException,
                ValueError) as e:                       # ValueError: JSON / UTF-8 decoding of a truncated body
            _log(dict(row, status=type(e).__name__, cls="infra"))
        if asked is not None and asked > RETRY_AFTER_MAX_S:
            raise CoopsUnavailable(f"CO-OPS asked to wait {asked:.0f} s for {u.path}", station, attempt)
        wait = min(CAP_S, BASE_S * 2 ** (attempt - 1)) * (1.0 + 0.25 * _clock["rand"]())
        if asked is not None:
            wait = max(wait, asked)
        now = _clock["now"]()
        if now - first + wait > BUDGET_S or (_state["deadline"] is not None and now + wait > _state["deadline"]):
            raise CoopsUnavailable(f"CO-OPS unavailable for {u.path} after {attempt} attempt(s)", station, attempt)
        _clock["sleep"](wait)


def _guarded_request(self, method, url, body=None, *args, **kwargs):
    host = (self.host or "").lower()
    if host != HOST or str(method).upper() != "GET" or body is not None:
        raise CoopsUnavailable(f"refused a {method} to {host}: the paced run reaches CO-OPS only, GET only")
    _state["http_count"] += 1
    return _state["orig_request"](self, method, url, body, *args, **kwargs)


def install():
    """Route every urllib.request.urlopen through paced_urlopen and guard http.client (idempotent)."""
    if not _state["installed"]:
        _state["orig"] = urllib.request.urlopen
        _state["orig_request"] = http.client.HTTPConnection.request
        urllib.request.urlopen = paced_urlopen
        http.client.HTTPConnection.request = _guarded_request
        _state["installed"] = True


def uninstall():
    if _state["installed"]:
        urllib.request.urlopen = _state["orig"]
        http.client.HTTPConnection.request = _state["orig_request"]
        _state.update(installed=False, last_start=None, http_count=0, wrapper_count=0, deadline=None)


def audit():
    """Every CO-OPS request at the http layer must have gone through the classifying wrapper."""
    if _state["http_count"] != _state["wrapper_count"]:
        raise CoopsUnavailable(f"request audit: {_state['http_count']} CO-OPS requests at the http layer, "
                               f"{_state['wrapper_count']} through the paced wrapper")
