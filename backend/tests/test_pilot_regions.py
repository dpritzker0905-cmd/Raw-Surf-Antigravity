"""Unit tests for worldwide coastal pilot-region rotation (the worldwide coastal-resolution follow-up).

The marine + wind pilots ingest the flagship REGIONAL_CONFIGS every cron cycle plus a rotating slice of
WORLDWIDE_COASTAL_REGIONS, so worldwide 0.25° coastal coverage is achieved within the fixed CI budget.
"""
from services.weather_pipeline.scheduler_helpers import (
    _select_rotating_regions,
    get_pilot_regions,
    REGIONAL_CONFIGS,
    WORLDWIDE_COASTAL_REGIONS,
)


def test_rotating_includes_flagship_and_rotates_each_cycle():
    flagship = {"a": {}, "b": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {}), ("w3", {})]
    assert set(_select_rotating_regions(flagship, ww, 1, 0)) == {"a", "b", "w0"}
    assert set(_select_rotating_regions(flagship, ww, 1, 1)) == {"a", "b", "w1"}


def test_rotation_covers_every_worldwide_region_over_cycles():
    flagship = {"a": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {}), ("w3", {})]
    covered = set()
    for cycle in range(len(ww)):
        covered |= set(_select_rotating_regions(flagship, ww, 1, cycle)) - set(flagship)
    assert covered == {"w0", "w1", "w2", "w3"}


def test_rotation_window_wraps_and_per_cycle_zero():
    flagship = {"a": {}}
    ww = [("w0", {}), ("w1", {}), ("w2", {})]
    assert set(_select_rotating_regions(flagship, ww, 2, 0)) == {"a", "w0", "w1"}
    assert set(_select_rotating_regions(flagship, ww, 2, 1)) == {"a", "w2", "w0"}  # start=2 wraps
    assert set(_select_rotating_regions(flagship, ww, 0, 9)) == {"a"}             # per_cycle 0 -> flagship only


def test_worldwide_regions_distinct_and_valid():
    assert not (set(WORLDWIDE_COASTAL_REGIONS) & set(REGIONAL_CONFIGS))  # no overlap with flagship
    for rid, cfg in WORLDWIDE_COASTAL_REGIONS.items():
        assert cfg["resolution"] == 0.25, rid
        assert cfg["west"] < cfg["east"], rid
        assert cfg["south"] < cfg["north"], rid


def test_get_pilot_regions_flagship_only_in_test_env():
    # Under pytest is_test_environment() is True, so the pilots get flagship-only -> existing deterministic
    # ingestion tests (marine pilot, etc.) are unaffected by the worldwide rotation.
    assert set(get_pilot_regions()) == set(REGIONAL_CONFIGS)
