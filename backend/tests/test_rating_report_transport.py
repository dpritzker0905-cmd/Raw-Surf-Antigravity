"""Exercise real Requests query encoding at the HTTP transport boundary."""
import json
from datetime import datetime, timezone
from urllib.parse import parse_qs, urlsplit

import pytest
import requests

from services.weather_pipeline import rating_confirmation as confirmation


class FixedClock(datetime):
    @classmethod
    def now(cls, tz=None):
        return cls(2026, 9, 15, 2, 8, 55, 267525, tzinfo=timezone.utc)


@pytest.fixture
def configured(monkeypatch):
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid/")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test-only-key")
    monkeypatch.setattr(confirmation, "datetime", FixedClock)


def test_utc_cutoff_survives_real_request_preparation(configured, monkeypatch):
    captured = []
    created = "2026-09-15T01:00:00+00:00"

    def send(session, request, **kwargs):
        query = parse_qs(urlsplit(request.url).query)
        captured.append((request, query, kwargs))
        response = requests.Response()
        response.request = request
        # Reproduce PostgREST's rejection after '+' is form-decoded as a space.
        valid = query["created_at"] == ["gte.2026-09-14T14:08:55.267525+00:00"]
        response.status_code = 200 if valid else 400
        response._content = json.dumps([
            {"spot_id": 42, "rating": 5, "created_at": created},
            {"spot_id": None, "rating": 4, "created_at": created},
            {"spot_id": 42, "rating": 4, "created_at": created},
        ] if valid else {"code": "22007"}).encode()
        return response

    monkeypatch.setattr(requests.sessions.Session, "send", send)
    reports = confirmation.fetch_recent_reports_via_rest(limit=17)
    assert reports == {"42": [
        {"rating": 5, "created_at": created},
        {"rating": 4, "created_at": created},
    ]}
    request, query, kwargs = captured[0]
    assert len(captured) == 1
    assert urlsplit(request.url).path == "/rest/v1/surf_reports"
    assert query == {
        "select": ["spot_id,rating,created_at"],
        "created_at": ["gte.2026-09-14T14:08:55.267525+00:00"],
        "rating": ["not.is.null"], "limit": ["17"],
    }
    assert kwargs["timeout"] == 20
    assert request.headers["apikey"] == "test-only-key"
    assert request.headers["Authorization"] == "Bearer test-only-key"
    assert confirmation.report_confirmation(reports["42"], FixedClock.now()) == "epic"


def test_transport_failure_keeps_reportless_fallback(configured, monkeypatch, caplog):
    def send(*args, **kwargs):
        raise requests.Timeout("test timeout")

    monkeypatch.setattr(requests.sessions.Session, "send", send)
    assert confirmation.fetch_recent_reports_via_rest() == {}
    assert "gate runs report-less" in caplog.text


def test_missing_credentials_does_not_send(monkeypatch):
    monkeypatch.delenv("SUPABASE_SERVICE_ROLE_KEY", raising=False)
    monkeypatch.delenv("SUPABASE_KEY", raising=False)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")

    def send(*args, **kwargs):
        pytest.fail("Missing credentials must not send a request")

    monkeypatch.setattr(requests.sessions.Session, "send", send)
    assert confirmation.fetch_recent_reports_via_rest() == {}
