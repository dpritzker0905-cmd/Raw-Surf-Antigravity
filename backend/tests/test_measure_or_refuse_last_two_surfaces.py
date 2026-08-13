"""WS-CAN-0010 + WS-CAN-0063 — the last two fabricated status surfaces.

R11-08 named THREE surfaces that reported numbers nobody measured. Two were repaired at
512b1cb6..9fe18414 (`/api/weather/status` refuses with a pointer; admin api-metrics reads
request_telemetry — pinned by test_admin_api_metrics_honesty.py). These are the other two, and
they are the same defect on opposite ends of one wire:

  WS-CAN-0010  routes/admin/system.py     `error_rate = 0.5  # Placeholder`
  WS-CAN-0063  TruthOverlay.js:126        `fps: ...?.gpuStats?.fps || 60`
               routes/weather.py:726      `FPS: {report.fps or 60}`      <- the SERVER half

⭐ The server half is why this file exists. Fixing only the client would have left the backend
coercing a null — or a measured 0 — into 60 on arrival, and the "fix" would have shipped green.
`0 || 60` and `0 or 60` are both 60, and 0 fps is the single most important reading there is: it
means the render is FROZEN. That is the program's most-repeated root cause (a check that cannot
tell "not sampled" from "broken" reports success), here on the ONLY client→server transport in the
system.
"""
import logging
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import pytest                                                   # noqa: E402
import services.request_telemetry as T                          # noqa: E402
from services.request_telemetry import record                   # noqa: E402
from routes.admin.system import measured_error_rate_percent     # noqa: E402


@pytest.fixture(autouse=True)
def fresh_telemetry():
    saved = dict(T._routes)
    T._routes.clear()
    yield
    T._routes.clear()
    T._routes.update(saved)


# ---------------------------------------------------------------- WS-CAN-0010

def test_refuses_with_none_instead_of_the_0_point_5_placeholder():
    assert measured_error_rate_percent() is None


def test_the_placeholder_value_can_never_be_returned_from_an_empty_lane():
    # The precise regression: 0.5 was returned unconditionally and read as "healthy" (< 1).
    assert measured_error_rate_percent() != 0.5


def test_serves_the_real_5xx_rate_when_requests_exist():
    for _ in range(9):
        record("GET", "/api/ok", 200, 10.0)
    record("GET", "/api/boom", 500, 10.0)
    assert measured_error_rate_percent() == pytest.approx(10.0, abs=0.001)


def test_a_fully_broken_lane_reads_as_100_percent_not_as_healthy():
    for _ in range(4):
        record("GET", "/api/boom", 503, 10.0)
    assert measured_error_rate_percent() == pytest.approx(100.0, abs=0.001)


# ---------------------------------------------------------------- WS-CAN-0063

def _diag_log(caplog, fps):
    """Post one client-diagnostic report and return the emitted log line."""
    from fastapi.testclient import TestClient
    from server import app
    payload = {
        "timestamp": "2026-08-13T18:00:00Z",
        "event_type": "TRUTH_VIOLATION_TEST",
        "model": "GFS", "layer": "water_temp", "timeOffset": 0.0,
        "memory": 128.0, "correlationId": "ws-can-0063",
    }
    if fps is not None:
        payload["fps"] = fps
    with caplog.at_level(logging.WARNING):
        r = TestClient(app).post("/api/weather/client-diagnostics", json=payload)
    assert r.status_code == 200
    lines = [m for m in caplog.messages if "[CLIENT-DIAGNOSTIC]" in m]
    assert lines, "the endpoint logged nothing — the assertion below would be vacuous"
    return lines[-1]


def test_absent_fps_is_reported_unmeasured_not_60(caplog):
    line = _diag_log(caplog, None)
    assert "FPS: unmeasured" in line
    assert "FPS: 60" not in line


def test_a_MEASURED_ZERO_survives_and_is_not_coerced_to_60(caplog):
    # THE case. A frozen render reports 0. `report.fps or 60` turned that into 60, so the one
    # reading that means "the map is dead" arrived looking perfectly healthy.
    line = _diag_log(caplog, 0.0)
    assert "FPS: 0" in line
    assert "FPS: 60" not in line


def test_a_real_reading_is_passed_through_unchanged(caplog):
    # Positive control: without it, a rule that always prints "unmeasured" would pass the two above.
    line = _diag_log(caplog, 58.0)
    assert "FPS: 58" in line
