"""
Flagship-first fine-pilot horizon (2026-07-15, the 14-day state-of-the-art arc).

The ever-present flagship coasts (REGIONAL_CONFIGS = FL / SoCal, ingested every cron cycle) carry the
long native forecast horizon; the rotating WORLDWIDE regions stay at the shorter budget horizon so the
~165-min CI stays green. Phase 1 wires this into the GFS pilot (14d flagship / 8d worldwide).
"""
from services.weather_pipeline.scheduler_helpers import (
    is_flagship_pilot_region, flagship_pilot_days, REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS,
)


def test_flagship_regions_are_the_regional_configs():
    for rid in REGIONAL_CONFIGS:
        assert is_flagship_pilot_region(rid) is True
    for rid in WORLDWIDE_COASTAL_REGIONS:
        assert is_flagship_pilot_region(rid) is False
    assert is_flagship_pilot_region("florida_east_coast") is True
    assert is_flagship_pilot_region("hawaii") is False


def test_flagship_pilot_days_selects_long_vs_short():
    # flagship coast → the long native horizon; worldwide → the short budget horizon.
    assert flagship_pilot_days("florida_east_coast", flagship_days=14, worldwide_days=8) == 14
    assert flagship_pilot_days("us_west_coast_socal", flagship_days=14, worldwide_days=8) == 14
    assert flagship_pilot_days("hawaii", flagship_days=14, worldwide_days=8) == 8
    assert flagship_pilot_days("indonesia", flagship_days=7, worldwide_days=2) == 2


def test_gfs_pilot_uses_flagship_first_horizon():
    """Guard the GFS pilot wiring: a refactor that drops the flagship-first selection would silently
    revert flagship coasts to the 8d worldwide horizon (the coastal 14-day regression)."""
    import inspect
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    src = inspect.getsource(WeatherPipelineScheduler.ingest_gfs_marine_pilot)
    assert "flagship_pilot_days" in src, "GFS pilot must select the flagship-first horizon"
    assert "GFS_MARINE_FLAGSHIP_FORECAST_DAYS" in src
