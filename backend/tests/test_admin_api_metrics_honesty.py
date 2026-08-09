"""R11-08 (Report 11.0) — /admin/system/api-metrics must MEASURE or REFUSE, never fabricate.

THE DEFECT THIS PINS: the endpoint read `SystemHealthMetric`, a table with no writers anywhere
in the backend, so its "simulated healthy" branch (45 ms / 0.3% / "healthy") was the only branch
that could ever execute — an admin dashboard actively reported healthy API metrics during any
outage. The house rule (standing work rules §27): a check that cannot tell not-sampled from
broken must REFUSE. The endpoint now serves the request-telemetry middleware's real counters and
returns status="not_instrumented" when none exist.
"""
import asyncio
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import services.request_telemetry as T                        # noqa: E402
from services.request_telemetry import record                 # noqa: E402
import pytest                                                 # noqa: E402


@pytest.fixture(autouse=True)
def fresh_state():
    saved = dict(T._routes)
    T._routes.clear()
    yield
    T._routes.clear()
    T._routes.update(saved)


def _call(hours=24):
    from routes.admin.system import get_api_metrics
    # The rewired body reads only the telemetry module — admin/db deps are FastAPI-injected in
    # production and unused by the metric computation, so None is legal for a direct call.
    return asyncio.run(get_api_metrics(admin=None, hours=hours, db=None))


def test_refuses_when_nothing_was_recorded_instead_of_simulating_healthy():
    out = _call()
    assert out["status"] == "not_instrumented"
    assert out["avg_response_time_ms"] is None
    assert out["error_rate_percent"] is None
    assert out["total_requests"] == 0
    # The old fabrication must never come back:
    assert out["avg_response_time_ms"] != 45


def test_serves_the_real_counters_when_they_exist():
    for _ in range(8):
        record("GET", "/api/x", 200, 20.0)
    record("GET", "/api/x", 500, 400.0)
    out = _call()
    assert out["source"] == "request_telemetry"
    assert out["total_requests"] == 9
    # 1 of 9 requests was a 5xx
    assert out["error_rate_percent"] == pytest.approx(100.0 / 9.0, abs=0.01)
    # avg over (8*20 + 1*400) / 9
    assert out["avg_response_time_ms"] == pytest.approx((8 * 20.0 + 400.0) / 9.0, abs=0.5)
    # the window is disclosed as cumulative, not the requested hours
    assert out["window"]["requested_hours_ignored"] is True


def test_status_derives_from_measured_numbers_not_a_constant():
    # A degraded reality must be allowed to read as degraded.
    for _ in range(10):
        record("GET", "/api/slow", 500, 900.0)
    out = _call()
    assert out["status"] == "critical"
