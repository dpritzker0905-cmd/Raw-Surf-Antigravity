"""
A15-19 (audit 15.0, 2026-09-25): a transient Storage rejection must not skip the forecast-skill ledger.

The Precompute Spot Ratings job reads calibration/skill/pending.json (~20k rows) while its own
prefetch is throttled (HTTP 429 too_many_connections). The strict read had no retry, so 2 of the
last 3 precompute runs logged "forecast skill ledger skipped (L2 read failed ...)", uploaded a
calibration report without forecast_skill_ops, and the accuracy monitor paged SKILL LEDGER DEAD.
"""
from types import SimpleNamespace

import pytest
import requests

from services.weather_pipeline import buoy_calibration as bc
from services.weather_pipeline import l2_retry


class Resp(SimpleNamespace):
    def json(self):
        return self.body


@pytest.fixture(autouse=True)
def _storage(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.test")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-key-not-a-secret")
    monkeypatch.setattr(l2_retry.time, "sleep", lambda s: None)


def _script(monkeypatch, *answers):
    calls = []

    def get(url, headers=None, timeout=None):
        calls.append(timeout)
        a = answers[min(len(calls), len(answers)) - 1]
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(requests, "get", get)
    return calls


def test_a_throttled_strict_read_is_retried_and_succeeds(monkeypatch):
    calls = _script(monkeypatch, Resp(status_code=429, headers={}, body=None),
                    Resp(status_code=200, headers={}, body=[{"row": 1}]))
    assert bc.load_calibration_l2("calibration/skill/pending.json", strict=True) == [{"row": 1}]
    assert len(calls) == 2
    assert calls[0] == 30                    # room for a ~20k-row object


def test_a_dropped_connection_is_retried(monkeypatch):
    calls = _script(monkeypatch, requests.Timeout("read timed out"),
                    Resp(status_code=200, headers={}, body={"ok": True}))
    assert bc.load_calibration_l2("calibration/skill/pending.json", strict=True) == {"ok": True}
    assert len(calls) == 2


def test_a_persistent_rejection_still_fails_closed_and_names_its_cause(monkeypatch):
    calls = _script(monkeypatch, Resp(status_code=503, headers={}, body={"error": "busy"}))
    with pytest.raises(bc.CalibrationReadError, match=r"pending\.json: CalibrationReadError: L2 read returned HTTP 503"):
        bc.load_calibration_l2("calibration/skill/pending.json", strict=True)
    assert len(calls) == 5                   # L2_UPLOAD_MAX_ATTEMPTS default


def test_an_absent_object_is_not_retried(monkeypatch):
    calls = _script(monkeypatch, Resp(status_code=404, headers={}, body={"code": "not_found"}))
    assert bc.load_calibration_l2("calibration/skill/pending.json", strict=True) is None
    assert len(calls) == 1


def test_legacy_non_strict_reads_are_unchanged(monkeypatch):
    calls = _script(monkeypatch, Resp(status_code=429, headers={}, body=None))
    assert bc.load_calibration_l2("calibration/buoy_latest.json") is None
    assert calls == [10]                     # one attempt, the old timeout
