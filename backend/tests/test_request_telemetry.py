"""Request telemetry — the denominator must count correctly, stay bounded, and never lie.

MASTER-AUDIT-11.0 §3.14 rated observability CRITICAL: zero runtime telemetry existed, which is
why thirteen audit passes hand-built harnesses and every production claim carried a "not
quantified" caveat. These tests drive the REAL ASGI middleware with hand-built scopes (no
TestClient dependency) and pin the design bounds: template-not-path, the cardinality cap, 5xx
accounting including handler exceptions, conservative percentiles, and the kill switch."""
import asyncio
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.request_telemetry as T                        # noqa: E402
from services.request_telemetry import (                      # noqa: E402
    BUCKET_BOUNDS_MS, MAX_ROUTES, RequestTelemetryMiddleware, record, snapshot)


@pytest.fixture(autouse=True)
def fresh_state():
    saved = dict(T._routes)
    T._routes.clear()
    yield
    T._routes.clear()
    T._routes.update(saved)


class _Route:
    def __init__(self, path):
        self.path_format = path


def _scope(path="/api/x", method="GET"):
    return {"type": "http", "method": method, "path": path}


async def _drive(app, scope):
    mw = RequestTelemetryMiddleware(app)
    sent = []

    async def send(msg):
        sent.append(msg)

    async def receive():
        return {"type": "http.request"}

    await mw(scope, receive, send)
    return sent


async def test_records_the_route_template_never_the_raw_path():
    async def app(scope, receive, send):
        scope["route"] = _Route("/api/spots/{spot_id}")       # the router sets this mid-call
        await send({"type": "http.response.start", "status": 200})
        await send({"type": "http.response.body", "body": b""})

    await _drive(app, _scope(path="/api/spots/abc-123"))
    await _drive(app, _scope(path="/api/spots/def-456"))
    keys = list(T._routes.keys())
    assert keys == [("GET", "/api/spots/{spot_id}")], (
        f"raw paths leaked into the key set: {keys} — that is the cardinality explosion the "
        f"template rule exists to prevent")
    assert T._routes[keys[0]]["n"] == 2


async def test_an_unmatched_request_folds_into_one_bucket():
    async def app(scope, receive, send):                      # 404 path: router sets no route
        await send({"type": "http.response.start", "status": 404})

    await _drive(app, _scope(path="/nope/1"))
    await _drive(app, _scope(path="/nope/2"))
    assert list(T._routes.keys()) == [("GET", "(unmatched)")]


async def test_a_handler_exception_is_recorded_as_500_and_reraised():
    async def app(scope, receive, send):
        scope["route"] = _Route("/api/boom")
        raise RuntimeError("handler died")

    with pytest.raises(RuntimeError):
        await _drive(app, _scope())
    e = T._routes[("GET", "/api/boom")]
    assert e["n"] == 1 and e["err"] == 1, (
        "a request that dies before http.response.start must count as a 5xx, not vanish — "
        "vanishing errors are how an outage reads as low traffic")


def test_the_cardinality_cap_folds_overflow_instead_of_growing():
    for i in range(MAX_ROUTES):
        record("GET", f"/r{i}", 200, 10.0)
    record("GET", "/one-too-many", 200, 10.0)
    record("GET", "/another", 500, 10.0)
    assert len(T._routes) == MAX_ROUTES + 1                   # the cap plus the fold bucket
    other = T._routes[T.OTHER_KEY]
    assert other["n"] == 2 and other["err"] == 1


def test_percentiles_are_bucket_upper_bounds_and_read_high_never_low():
    """⚠️ CONTRACT CHANGED 2026-08-10, deliberately, and this test detected it.

    `_percentile_ms` now returns (value, is_overflow) and CAPS the bucket bound at the observed
    max. The old expectation here was `p(1.0) == 1000.0` -- the bucket bound -- when the largest
    request actually seen was 900 ms. Reporting 1000.0 asserts a latency that never occurred; the
    cap reports 900.0, which is still an UPPER BOUND on the true percentile and strictly tighter.
    The reason it mattered: five 8 ms requests were reporting p50=p90=p99=10.0 beside max=8.0, a
    percentile above the maximum, which reads as a bug and taints the whole payload.
    The "read high, never low" property is unchanged and still asserted below."""
    for _ in range(99):
        record("GET", "/p", 200, 4.0)                          # bucket <=5
    record("GET", "/p", 200, 900.0)                            # bucket <=1000
    e = T._routes[("GET", "/p")]
    assert T._percentile_ms(e, 0.50) == (5.0, False)           # reads HIGH: 4 ms mass -> its bound
    assert T._percentile_ms(e, 0.99) == (5.0, False)           # 99th of 100 is still the 4 ms mass
    assert T._percentile_ms(e, 1.0) == (900.0, False), (
        "the tail is the bucket bound CAPPED at the observed max -- 1000.0 was never measured")
    record("GET", "/of", 200, 99999.0)                         # overflow bucket
    value, is_overflow = T._percentile_ms(T._routes[("GET", "/of")], 0.5)
    assert value == 99999.0, "the overflow bucket must report max_ms, not a fabricated bound"
    assert is_overflow is True, (
        "overflow must be FLAGGED -- an unflagged max_ms is indistinguishable from a measured "
        "percentile, which is exactly how this payload misled a reader in production")


def test_snapshot_totals_and_ranks_by_traffic():
    for _ in range(5):
        record("GET", "/busy", 200, 20.0)
    record("GET", "/quiet", 503, 3000.0)
    snap = snapshot(top=1)
    assert snap["total"]["n"] == 6 and snap["total"]["err_5xx"] == 1
    assert len(snap["top_routes"]) == 1
    assert snap["top_routes"][0]["route"] == "GET /busy", "top must be ranked by traffic"
    assert snap["routes_tracked"] == 2
    assert snap["total"]["max_ms"] == 3000.0


async def test_the_kill_switch_disables_recording_entirely(monkeypatch):
    monkeypatch.setenv("REQUEST_TELEMETRY", "0")

    async def app(scope, receive, send):
        scope["route"] = _Route("/api/x")
        await send({"type": "http.response.start", "status": 200})

    await _drive(app, _scope())
    assert T._routes == {}, "REQUEST_TELEMETRY=0 must record nothing"


def test_the_health_payload_carries_the_block():
    """Wiring pin: /api/health must expose the snapshot (the health lane and the external probe
    are the read path — telemetry nobody can read is the audit's 'write-only archive' class)."""
    import inspect
    import routes.health as H
    src = inspect.getsource(H.health_check)
    assert "request_telemetry" in src and "_telemetry_snapshot" in src, (
        "routes/health.py no longer exposes request_telemetry — the denominators are dark again")
