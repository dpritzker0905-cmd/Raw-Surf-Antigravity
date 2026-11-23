"""Bug hunt 2026-11-22 item F: the sim's DEFAULT (non-strict) path turned a missing swell period into 0.0, which the
surf estimate reads as no surf: 0.0 m, `calm`, very_poor, where the glyph says unknown. A nonzero swell with no usable
period is now NO forecast (unknown, with a reason), never flat surf. Kill switch SIM_MISSING_PERIOD_UNKNOWN='0'.
A true calm (height 0, period 0 or absent) stays a measured calm."""
import copy

import pytest

from services.weather_pipeline import sim_forecast as forecast


@pytest.fixture
def payloads(monkeypatch):
    monkeypatch.setenv("SIM_LIVE_FORECAST", "1")
    monkeypatch.delenv("SIM_STRICT_INPUTS", raising=False)          # the default path
    monkeypatch.delenv("SIM_MISSING_PERIOD_UNKNOWN", raising=False)
    monkeypatch.setattr(forecast, "_is_down", lambda: False)
    forecast._FORECAST_CACHE.clear()
    data = {"marine": {"point": {"speed": 2.0, "period": 14.0, "direction": 290.0}},
            "wind": {"point": {"speed": 5.0, "direction": 90.0}}}
    monkeypatch.setattr(forecast, "fetch_point", lambda domain, *a: copy.deepcopy(data[domain]))
    yield data
    forecast._FORECAST_CACHE.clear()


def fetch():
    return forecast.fetch_live_forecast(21.665, -158.05, "2026-11-22T12:00:00Z")


@pytest.mark.parametrize("period", [None, 0, 0.0, float("nan"), float("inf"), -3.0, "bad", "absent"])
def test_missing_period_with_swell_is_unknown_not_flat(payloads, period):
    if period == "absent":
        del payloads["marine"]["point"]["period"]
    else:
        payloads["marine"]["point"]["period"] = period
    baseline, provenance = fetch()
    assert baseline is None, f"period {period!r} became a baseline {baseline}"
    assert "period" in provenance["reason"]
    assert provenance["valid_time"] == "2026-11-22T12:00:00Z"


def test_a_real_period_is_untouched(payloads):
    baseline, _ = fetch()
    assert baseline["swell_period_sec"] == 14.0 and baseline["swell_height_m"] == 2.0


@pytest.mark.parametrize("period", [None, 0])
def test_a_true_calm_stays_a_calm(payloads, period):
    payloads["marine"]["point"].update(speed=0.0, period=period)
    baseline, _ = fetch()
    assert baseline is not None and baseline["swell_height_m"] == 0.0 and baseline["swell_period_sec"] == 0.0


def test_kill_switch_restores_the_old_zero(payloads, monkeypatch):
    monkeypatch.setenv("SIM_MISSING_PERIOD_UNKNOWN", "0")
    payloads["marine"]["point"]["period"] = None
    baseline, _ = fetch()
    assert baseline["swell_period_sec"] == 0.0
