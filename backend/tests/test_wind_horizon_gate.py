"""
wind_horizon_fail_fast — beyond-horizon wind requests must 404 fast (no_wind_coverage), never fall
through to the dynamic upstream build (live-measured 2026-07-10: EURO wind >240h returned naked
HTTP 500 on every scrub past day 10 — the "wind clears at the 14-day mark" report — and doomed
upstream grinds poisoned the rate-limit negative cache). ICON is exempt: extend_icon_wind_to_14d
serves 120→336h from the 5-day base fetch (verified live).
"""
from datetime import datetime, timezone, timedelta

import pytest
from fastapi import HTTPException

from services.weather_pipeline.viewport_service import wind_horizon_fail_fast


def _hours_out(h):
    return datetime.now(timezone.utc) + timedelta(hours=h)


def test_euro_beyond_240h_raises_clean_404(monkeypatch):
    monkeypatch.delenv("WIND_HORIZON_GATE", raising=False)
    with pytest.raises(HTTPException) as ei:
        wind_horizon_fail_fast("EURO", _hours_out(264), forecast_days=10)
    assert ei.value.status_code == 404
    assert "no_wind_coverage" in ei.value.detail


def test_euro_within_horizon_passes(monkeypatch):
    monkeypatch.delenv("WIND_HORIZON_GATE", raising=False)
    wind_horizon_fail_fast("EURO", _hours_out(200), forecast_days=10)  # no raise


def test_icon_exempt_for_its_extension_range(monkeypatch):
    # ICON 120→336h is served by extend_icon_wind_to_14d from the 5-day base — never gate it.
    monkeypatch.delenv("WIND_HORIZON_GATE", raising=False)
    wind_horizon_fail_fast("ICON", _hours_out(330), forecast_days=5)  # no raise


def test_gfs_gated_only_past_its_native_384h(monkeypatch):
    monkeypatch.delenv("WIND_HORIZON_GATE", raising=False)
    wind_horizon_fail_fast("GFS", _hours_out(360), forecast_days=16)  # within native — no raise
    with pytest.raises(HTTPException):
        wind_horizon_fail_fast("GFS", _hours_out(400), forecast_days=16)


def test_kill_switch_disables_the_gate(monkeypatch):
    monkeypatch.setenv("WIND_HORIZON_GATE", "0")
    wind_horizon_fail_fast("EURO", _hours_out(300), forecast_days=10)  # no raise
