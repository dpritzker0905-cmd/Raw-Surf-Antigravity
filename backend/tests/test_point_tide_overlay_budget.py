"""/point-tide?purpose=overlay must never spend the tide quota the rating's tide and eta depend on (advisor red-team of
#923, 2026-11-15): warm cells are served; a cold cell is fetched only within the overlay's own per-minute budget and
never during an upstream cooldown; otherwise a non-cached "overlay_deferred". Requests without purpose are unchanged."""
import asyncio

import pytest
from fastapi import Response

import routes.weather_point_tide as R


@pytest.fixture(autouse=True)
def _budget():
    R._overlay_bucket.update(tokens=R.OVERLAY_COLD_PER_MIN)
    R._overlay_day.update(day=None, count=0)
    yield


def _call(monkeypatch, state, purpose="overlay"):
    calls = []

    async def fake_fetch(lat, lng):
        calls.append((lat, lng))
        return None
    monkeypatch.setattr(R._tide, "acquisition_state", lambda lat, lng: state)
    monkeypatch.setattr(R._tide, "fetch_tide_hourly", fake_fetch)
    resp = Response()
    out = asyncio.run(R.get_point_tide(resp, lat=21.3, lng=-157.9, purpose=purpose))
    return out, calls, resp


def test_warm_cells_are_served_without_spending_budget(monkeypatch):
    out, calls, _ = _call(monkeypatch, "warm")
    assert calls and out.get("reason") != "overlay_deferred"
    assert R._overlay_bucket["tokens"] == pytest.approx(R.OVERLAY_COLD_PER_MIN, abs=0.01)


def test_cold_cells_spend_the_budget_then_defer(monkeypatch):
    n = int(R.OVERLAY_COLD_PER_MIN)
    for _ in range(n):
        out, calls, _ = _call(monkeypatch, "cold")
        assert calls
    out, calls, resp = _call(monkeypatch, "cold")
    assert not calls and out["reason"] == "overlay_deferred" and out["available"] is False
    assert resp.headers["Cache-Control"] == "no-store"


def test_the_daily_ceiling_defers_even_with_minute_tokens(monkeypatch):
    out, calls, _ = _call(monkeypatch, "cold")
    assert calls
    R._overlay_day["count"] = R.OVERLAY_COLD_PER_DAY
    R._overlay_bucket.update(tokens=R.OVERLAY_COLD_PER_MIN)
    out, calls, _ = _call(monkeypatch, "cold")
    assert not calls and out["reason"] == "overlay_deferred"
    assert R.OVERLAY_COLD_PER_DAY * 5 <= 10000          # leaves >= 80% of the free tier's day to the rest


def test_a_cooldown_defers_the_overlay_even_with_budget(monkeypatch):
    out, calls, _ = _call(monkeypatch, "cooling")
    assert not calls and out["reason"] == "overlay_deferred"


def test_requests_without_purpose_are_unchanged(monkeypatch):
    R._overlay_bucket.update(tokens=0.0)
    out, calls, _ = _call(monkeypatch, "cooling", purpose=None)
    assert calls and out.get("reason") != "overlay_deferred"


def test_acquisition_state_reads_the_real_cache():
    from services.weather_pipeline import tide as T
    T._reset_tide_cache_for_test()
    assert T.acquisition_state(10.0, 10.0) == "cold"
