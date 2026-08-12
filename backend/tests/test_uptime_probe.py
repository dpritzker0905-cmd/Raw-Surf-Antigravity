"""The uptime probe must be able to GO RED -- and must never be green while blind.

WS-CAN-0025. This probe exists because every other scheduled check rides GitHub cron, whose
delivery is measured at 5-32% of nominal, so a silent monitor is indistinguishable from a healthy
one. A probe whose red path is untested would reproduce exactly that defect one layer out, which
is why every gate below is tested in BOTH directions.
"""
import json
from datetime import datetime, timedelta, timezone

from scripts.uptime_probe import (
    OK, RED, REFUSED, combine, grade_calibration, grade_health,
)

NOW = datetime(2026, 8, 12, 22, 0, tzinfo=timezone.utc)
CFG = {"base": "https://example.invalid", "timeout_s": 60.0,
       "warn_latency_ms": 10000, "max_cal_age_h": 8.0}


def _health(status="healthy", products=21678, mem_pct=67.1, db="healthy"):
    return json.dumps({
        "status": status, "version": "2.0.0-stage-6f-v1-55f2c068abcdef",
        "uptime_seconds": 8730, "database": {"status": db},
        "weather_readiness": {"product_count": products, "restore_status": "complete"},
        "memory": {"peak_pct_of_limit": mem_pct},
    })


# ---------------------------------------------------------------- liveness

def test_a_healthy_service_is_green_and_reports_its_build():
    code, lines, facts = grade_health(200, _health(), 660.0, CFG)
    assert code == OK
    assert facts["sha"] == "55f2c068"
    assert not any("::error::" in l for l in lines)


def test_a_non_200_pages_the_positive_control():
    """THE point of the probe. If this fails, the probe is decoration."""
    code, lines, _ = grade_health(503, "", 100.0, CFG)
    assert code == RED
    assert any("SERVICE DOWN" in l for l in lines)


def test_unreachable_is_BLINDNESS_not_health_and_not_a_breach():
    code, lines, _ = grade_health(None, "timed out", 0.0, CFG)
    assert code == REFUSED
    assert any("BLIND" in l for l in lines)


def test_200_with_an_unparseable_body_refuses():
    """200-with-garbage is the exact shape of `a check that cannot tell not-sampled from fine`."""
    code, lines, _ = grade_health(200, "<html>502 Bad Gateway</html>", 50.0, CFG)
    assert code == REFUSED
    assert any("unparseable" in l for l in lines)


def test_status_not_healthy_pages_even_on_a_200():
    code, lines, _ = grade_health(200, _health(status="degraded"), 500.0, CFG)
    assert code == RED
    assert any("SERVICE UNHEALTHY" in l for l in lines)


def test_zero_products_pages__http_200_would_hide_it_completely():
    """Up, answering, and serving nothing. The failure a naive uptime check cannot see."""
    code, lines, _ = grade_health(200, _health(products=0), 500.0, CFG)
    assert code == RED
    assert any("ZERO PRODUCTS" in l for l in lines)


def test_a_slow_but_healthy_response_WARNS_and_never_pages():
    """Measured p99 is 30.4 s. Paging on the platform's own tail is the cry-wolf failure this
    repo has already paid for once."""
    code, lines, _ = grade_health(200, _health(), 25000.0, CFG)
    assert code == OK
    assert any("::warning::" in l and "SLOW" in l for l in lines)
    assert not any("::error::" in l for l in lines)


def test_memory_headroom_warns_without_paging():
    code, lines, _ = grade_health(200, _health(mem_pct=96.4), 500.0, CFG)
    assert code == OK
    assert any("::warning::" in l and "memory peak" in l for l in lines)


# ---------------------------------------------------------------- pipeline freshness

def test_a_fresh_calibration_report_is_green():
    body = json.dumps({"generated_at": (NOW - timedelta(hours=2)).isoformat()})
    code, lines, facts = grade_calibration(200, body, NOW, CFG)
    assert code == OK and facts["cal_age_h"] == 2.0


def test_a_stalled_pipeline_pages__the_failure_a_cron_cannot_self_report():
    body = json.dumps({"generated_at": (NOW - timedelta(hours=30)).isoformat()})
    code, lines, _ = grade_calibration(200, body, NOW, CFG)
    assert code == RED
    assert any("PIPELINE STALLED" in l for l in lines)


def test_an_unreachable_calibration_report_refuses_rather_than_passing():
    assert grade_calibration(None, "", NOW, CFG)[0] == REFUSED
    assert grade_calibration(200, "not json", NOW, CFG)[0] == REFUSED
    assert grade_calibration(200, json.dumps({}), NOW, CFG)[0] == REFUSED


def test_a_5xx_REACHES_the_red_path__the_assertion_was_green_and_unreachable():
    """⛔ THE REGRESSION THIS PINS, found 2026-08-12 by pointing the probe at a live host that is
    not this API. `urlopen` RAISES on 4xx/5xx. The first `_get` caught Exception broadly, so every
    "503 Service Unavailable" became "unreachable" and the probe answered REFUSED (blind) for the
    one thing it exists to detect: a service up enough to say it is down.

    ★ `test_a_non_200_pages_the_positive_control` above was GREEN the entire time. It proved the
    ASSERTION; nothing could ever call it with a 503. Coverage of an assertion is not coverage of
    its reachability -- the same shape as the tautological cache proof Audit 11.4 caught."""
    import urllib.error
    import scripts.uptime_probe as up

    def boom(req, timeout=None):
        raise urllib.error.HTTPError(req.full_url, 503, "Service Unavailable", {}, None)

    real = up.urllib.request.urlopen
    up.urllib.request.urlopen = boom
    try:
        code, body, ms = up._get("https://example.invalid/api/health", 5)
    finally:
        up.urllib.request.urlopen = real
    assert code == 503, "a 5xx must arrive as a STATUS CODE, not as an exception"
    assert grade_health(code, body, ms, CFG)[0] == RED


def test_red_outranks_refused_outranks_ok():
    """Plain max() would invert the first pair (REFUSED=3 > RED=1) and bury a real outage under a
    side-channel read failure."""
    assert combine(RED, REFUSED) == RED
    assert combine(REFUSED, RED) == RED
    assert combine(OK, REFUSED) == REFUSED
    assert combine(OK, OK) == OK
