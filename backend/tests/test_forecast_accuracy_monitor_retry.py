"""The accuracy monitor retries a busy Storage read (HTTP 429 / 5xx) with capped backoff (run 41906117768)."""
import json


def _http_error(code, body):
    import io
    import urllib.error
    return urllib.error.HTTPError("https://storage.example.invalid/x", code, "err", {},
                                  io.BytesIO(json.dumps(body).encode()))


NO_SUCH_KEY = {"statusCode": "404", "code": "NoSuchKey", "error": "not_found", "message": "Object not found"}


def test_fetch_l2_retries_a_busy_storage_then_reads(monkeypatch):
    import scripts.forecast_accuracy_monitor as fam
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    slept = []
    monkeypatch.setattr(fam, "_sleep", slept.append)
    import io
    answers = [_http_error(429, {}), _http_error(503, {}), io.BytesIO(b'{"rows": []}')]
    calls = []

    def urlopen(req, timeout=30):
        calls.append(req)
        a = answers.pop(0)
        if isinstance(a, Exception):
            raise a
        return a
    monkeypatch.setattr(fam.urllib.request, "urlopen", urlopen)
    assert fam._fetch_l2("calibration/skill/scored-2026-11-03.json") == {"rows": []}
    assert len(calls) == 3 and len(slept) == 2 and all(0 < s <= 30 for s in slept)


def test_fetch_l2_retry_kill_switch_and_no_retry_on_absence(monkeypatch):
    import scripts.forecast_accuracy_monitor as fam
    monkeypatch.setenv("SUPABASE_URL", "https://storage.example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-not-a-key")
    slept = []
    monkeypatch.setattr(fam, "_sleep", slept.append)
    calls = []

    def answer(exc):
        def urlopen(req, timeout=30):
            calls.append(req)
            raise exc
        monkeypatch.setattr(fam.urllib.request, "urlopen", urlopen)
        return fam._fetch_l2("calibration/skill/scored-2026-11-03.json")

    assert answer(_http_error(400, NO_SUCH_KEY)) is fam.ABSENT and len(calls) == 1 and not slept
    calls.clear()
    monkeypatch.setenv("L2_FETCH_RETRIES", "1")
    assert answer(_http_error(429, {})) is None and len(calls) == 1 and not slept
