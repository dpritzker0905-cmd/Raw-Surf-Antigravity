"""
F5 — capabilities are the single source of truth for forecast horizons. Pin the EURO marine
contract so it can't silently drift back to a stale 240h (the F1 regression). The frontend
fallback constants (DISPLAY_EURO_*_MAX_HOURS) mirror these in
frontend/src/__tests__/displayHorizons.test.js — change both together.
"""
from services.weather_pipeline.capabilities import get_weather_capabilities


def test_euro_marine_horizon_contract_240_native_96_estimated_336_max():
    caps = get_weather_capabilities()
    euro_marine = [c for c in caps if c.get("model") == "EURO" and c.get("domain") == "marine"]
    assert {c["layer"] for c in euro_marine} == {"waves", "swell_1", "swell_2", "wind_waves"}
    for c in euro_marine:
        assert c["native_horizon_hours"] == 240, c["layer"]
        assert c["estimated_horizon_hours"] == 96, c["layer"]
        assert c["max_forecast_hours"] == 336, c["layer"]
        # native + estimated == max (the truthful 14-day window)
        assert c["native_horizon_hours"] + c["estimated_horizon_hours"] == c["max_forecast_hours"], c["layer"]
