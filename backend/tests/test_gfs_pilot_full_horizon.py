"""Item 13 (2026-11-01, DARK): GFS_PILOT_FULL_HORIZON gives every GFS pilot box the flagship horizon.

With the pilots lane at GFS_MARINE_FORECAST_DAYS='5', 17 of 19 GFS boxes end at run + 120 h (CDN audit 10-26T14Z: 41/45
frames, gap h116-h336), so close-zoom GFS scrubbing past day 5 falls back to the server. The flag must (a) change
nothing while '0', (b) put every box in the ONE flagship pass when '1' (no new download pass), and (c) be wired dark.
"""
import os
import re

import pytest

from services.weather_pipeline.pilot_regions import (
    REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS, gfs_marine_pilot_days)

WORLDWIDE = next(iter(WORLDWIDE_COASTAL_REGIONS))
FLAGSHIP = next(iter(REGIONAL_CONFIGS))
PILOTS_YML = os.path.join(os.path.dirname(__file__), "..", "..", ".github", "workflows", "forecast-ingest-pilots.yml")


@pytest.fixture
def lane_env(monkeypatch):
    monkeypatch.setenv("GFS_MARINE_FLAGSHIP_FORECAST_DAYS", "14")
    monkeypatch.setenv("GFS_MARINE_FORECAST_DAYS", "5")
    monkeypatch.delenv("GFS_PILOT_FULL_HORIZON", raising=False)
    return monkeypatch


def test_flag_off_keeps_the_two_horizons(lane_env):
    assert gfs_marine_pilot_days(FLAGSHIP) == 14
    assert gfs_marine_pilot_days(WORLDWIDE) == 5


def test_flag_on_gives_every_box_the_flagship_horizon(lane_env):
    lane_env.setenv("GFS_PILOT_FULL_HORIZON", "1")
    assert gfs_marine_pilot_days(FLAGSHIP) == 14
    assert gfs_marine_pilot_days(WORLDWIDE) == 14


def test_flag_on_never_shortens_a_longer_worldwide_setting(lane_env):
    lane_env.setenv("GFS_PILOT_FULL_HORIZON", "1")
    lane_env.setenv("GFS_MARINE_FORECAST_DAYS", "16")
    assert gfs_marine_pilot_days(WORLDWIDE) == 16


def test_unset_envs_keep_the_code_defaults(monkeypatch):
    for name in ("GFS_MARINE_FLAGSHIP_FORECAST_DAYS", "GFS_MARINE_FORECAST_DAYS", "GFS_PILOT_FULL_HORIZON"):
        monkeypatch.delenv(name, raising=False)
    assert (gfs_marine_pilot_days(FLAGSHIP), gfs_marine_pilot_days(WORLDWIDE)) == (14, 8)


@pytest.mark.asyncio
async def test_flag_on_is_one_pass_carrying_every_box(tmp_path, lane_env):
    """The cost claim: the 17 boxes JOIN the flagship pass. Two passes would mean a new download was added."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import GFS_MARINE_EXTRA_REGIONS
    from services.weather_pipeline import copernicus_validator
    import services.noaa_marine_service as noaa_marine
    from tests.test_gfs_marine_pilot_multi_bbox import _wave_like_points

    store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=store)
    lane_env.setenv("NODE_ENV", "test")
    lane_env.setenv("WORLDWIDE_COASTAL", "1")
    lane_env.delenv("GFS_MARINE_EXTRA_REGIONS", raising=False)
    lane_env.setenv("GFS_PILOT_FULL_HORIZON", "1")
    lane_env.setattr(copernicus_validator, "is_test_environment", lambda: False)
    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        calls.append((forecast_days, set(bboxes)))
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0) for rid, bb in bboxes.items()}

    lane_env.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    assert await scheduler.ingest_gfs_marine_pilot() is True
    # global_mid keeps its own horizon (gfs_mid_forecast_days; 2 d in the test env), so look at the boxes only.
    box_passes = [(d, regs - {"global_mid"}) for d, regs in calls if regs - {"global_mid"}]
    expected = set(REGIONAL_CONFIGS) | set(WORLDWIDE_COASTAL_REGIONS) | set(GFS_MARINE_EXTRA_REGIONS)
    assert box_passes == [(14, expected)], f"box passes: {[(d, len(r)) for d, r in box_passes]}"


def test_the_pilots_lane_wires_the_flag_dark():
    with open(PILOTS_YML, encoding="utf-8") as fh:
        text = fh.read()
    assert re.search(r"^\s+GFS_PILOT_FULL_HORIZON: \$\{\{ vars\.GFS_PILOT_FULL_HORIZON \|\| '0' \}\}", text, re.M)
    # The worldwide horizon itself is untouched: the flag, not a quiet edit, is what lengthens it.
    assert re.search(r"^\s+GFS_MARINE_FORECAST_DAYS: '5'$", text, re.M)
