"""GFS marine pilot: one download pass per HORIZON, not one per region.

THE DEFECT THIS CLOSES (measured live 2026-07-31 20:19Z, at the SERVE path). GFS marine for
uk_ireland and east_australia sat on a run 448.2 h old (18.7 days) with no product covering now,
because the clock-keyed rotation could not reach that pair. The consequence was not "old numbers" —
it was silent degradation of the height chain:

  uk_ireland      /point -> source=grid_file, product=gfs_marine_waves_GLOBAL_MID  (2 deg, 8x coarser)
  east_australia  /point -> source=backend_direct_point, product_id=None,
                            run_time stamped at REQUEST time == a live per-request upstream fetch

The second one matters most: a missing tile does not merely coarsen the grid, it moves cost onto the
request path of a box with three melt incidents. The rotation existed to ration download duplication
that was never real -- NOAA byte-range picks a GRIB message (a whole global field), not a region.

Marine adds a constraint wind does not have: the flagship-first horizon (flagship 14d, worldwide
short). One pass has one horizon, so passes are grouped BY HORIZON. The tests below pin that the
grouping preserves the contract instead of quietly flattening it.
"""
import pytest
from datetime import datetime, timezone, timedelta


def _wave_like_points(om_provider, region, resolution=0.25):
    """NOAA GFS-Wave-shaped points: 4 native layers, 3-hourly."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(6)]
    vars12 = ["wave_height", "wave_direction", "wave_period",
              "swell_wave_height", "swell_wave_direction", "swell_wave_period",
              "secondary_swell_wave_height", "secondary_swell_wave_direction",
              "secondary_swell_wave_period",
              "wind_wave_height", "wind_wave_direction", "wind_wave_period"]
    pts = []
    for lat, lon in zip(lats, lons):
        hourly = {"time": times}
        for v in vars12:
            hourly[v] = [(200.0 if "direction" in v else (9.0 if "period" in v else 1.4))
                         for _ in times]
        pts.append({"latitude": lat, "longitude": lon, "__provider": "noaa",
                    "hourly_units": {}, "hourly": hourly})
    return pts


@pytest.fixture(autouse=True)
def _production_mid_horizon(monkeypatch):
    """The 2 deg global_mid tile folds into this pilot's pass (2026-08-02), and WHICH pass it joins
    is decided by horizon — `by_horizon` groups one download per distinct forecast length.

    Under tests GFS_MID_RES_FORECAST_DAYS defaults to 2 days, so global_mid would form its own group
    and these tests would never see the production arrangement (mid 14 d == flagship 14 d, one shared
    pass). Pin production's horizons so the grouping under test is the grouping that ships."""
    monkeypatch.setenv("GFS_MID_RES_FORECAST_DAYS", "14")
    monkeypatch.setenv("GFS_MARINE_FLAGSHIP_FORECAST_DAYS", "14")


@pytest.mark.asyncio
async def test_one_pass_per_horizon_not_one_per_region(tmp_path, monkeypatch):
    """THE FIX. In the test env only the flagship regions are in play and they share one horizon, so
    exactly ONE download pass must cover both -- not one per region."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        calls.append((forecast_days, set(bboxes)))
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)

    assert await scheduler.ingest_gfs_marine_pilot() is True
    assert len(calls) == 1, f"{len(calls)} passes for one horizon -- must be one"
    # global_mid rides ALONG, it does not add a pass. That is the whole 2026-08-02 saving: before the
    # fold it downloaded this same f000-f336 set again in its own job, ~26 min later.
    assert calls[0][1] == set(REGIONAL_CONFIGS) | {"global_mid"}

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "GFS" and p.domain == "marine" and p.region_id == region_id]
        assert regionals, f"no GFS marine products for {region_id}"
        for p in regionals:
            assert p.provider == "open-meteo"
            assert p.coverage_mode == "regional_tile"


@pytest.mark.asyncio
async def test_flagship_and_worldwide_horizons_stay_separate(tmp_path, monkeypatch):
    """THE CONTRACT THAT MUST SURVIVE. Grouping by horizon is what lets one pass serve many regions
    WITHOUT flattening flagship 14d and worldwide 3d into a single compromise. Assert two passes,
    with the right regions and the right horizon on each -- a single pass here would mean either the
    flagship lost 11 days of horizon or every worldwide region silently gained them (and with them
    the forecast-hour cost the short horizon exists to bound)."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import (
        REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS)
    from services.weather_pipeline import copernicus_validator
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WORLDWIDE_COASTAL", "1")
    monkeypatch.setenv("GFS_MARINE_FLAGSHIP_FORECAST_DAYS", "14")
    monkeypatch.setenv("GFS_MARINE_FORECAST_DAYS", "3")
    monkeypatch.setattr(copernicus_validator, "is_test_environment", lambda: False)

    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        calls.append((forecast_days, set(bboxes)))
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)

    assert await scheduler.ingest_gfs_marine_pilot() is True
    by_days = {d: regs for d, regs in calls}
    assert set(by_days) == {3, 14}, f"horizons seen: {sorted(by_days)} -- expected exactly 3d and 14d"
    assert by_days[14] == set(REGIONAL_CONFIGS) | {"global_mid"}, (
        "flagship horizon must carry the flagship regions plus the folded global_mid tile")
    assert by_days[3] == set(WORLDWIDE_COASTAL_REGIONS), "worldwide horizon must carry all 8 worldwide regions"

    saved = {p.region_id for p in temp_store.get_manifest().products
             if p.model == "GFS" and p.domain == "marine"}
    missing = (set(REGIONAL_CONFIGS) | set(WORLDWIDE_COASTAL_REGIONS)) - saved
    assert not missing, f"regions missing from the manifest: {missing}"


@pytest.mark.asyncio
async def test_socal_still_omits_swell_2(tmp_path, monkeypatch):
    """A per-region quirk that the shared save helper must not flatten."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    await scheduler.ingest_gfs_marine_pilot()

    products = temp_store.get_manifest().products
    socal = {p.layer for p in products if p.region_id == "us_west_coast_socal" and p.model == "GFS"}
    fl = {p.layer for p in products if p.region_id == "florida_east_coast" and p.model == "GFS"}
    assert "swell_2" not in socal, "SoCal must not get swell_2"
    assert "swell_2" in fl, "Florida must still get swell_2"


@pytest.mark.asyncio
async def test_every_region_shares_one_run_time(tmp_path, monkeypatch):
    """Per-region passes produced a staircase of run_times -- exactly the signal that made the
    starvation hard to see. One pass must stamp one run_time."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    await scheduler.ingest_gfs_marine_pilot()

    runs = {p.run_time for p in temp_store.get_manifest().products
            if p.model == "GFS" and p.domain == "marine"}
    assert len(runs) == 1, f"regions carry {len(runs)} distinct run_times -- not a single pass"


@pytest.mark.asyncio
async def test_falls_back_to_per_region_when_the_multi_pass_yields_nothing(tmp_path, monkeypatch):
    """A throughput optimisation must not become a single point of failure."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def no_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        return None

    async def per_region(bbox, resolution=10.0, forecast_days=14, bboxes=None):
        return _wave_like_points(scheduler.om_provider, bbox, 5.0)

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", no_multi)
    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_global_coarse", per_region)

    assert await scheduler.ingest_gfs_marine_pilot() is True
    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        assert [p for p in products if p.model == "GFS" and p.domain == "marine"
                and p.region_id == region_id], f"fallback shipped nothing for {region_id}"


@pytest.mark.asyncio
async def test_a_raising_multi_fetch_does_not_kill_the_job(tmp_path, monkeypatch):
    """One bad horizon group must cost that group, not the whole pilot."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def boom(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        raise RuntimeError("AWS Open Data 503")

    async def per_region(bbox, resolution=10.0, forecast_days=14, bboxes=None):
        return _wave_like_points(scheduler.om_provider, bbox, 5.0)

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", boom)
    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_global_coarse", per_region)

    assert await scheduler.ingest_gfs_marine_pilot() is True


@pytest.mark.asyncio
async def test_folded_global_mid_is_requested_at_its_own_resolution(tmp_path, monkeypatch):
    """The fold's whole premise: ONE download, TWO output resolutions. global_mid must be asked for
    at 2 deg while the flagship regions stay at 0.25 deg — and the flagship regions must be ABSENT
    from the map, so they keep the scalar and their tiles do not silently change grid."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    seen = {}

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        seen["scalar"] = resolution
        seen["map"] = dict(resolutions or {})
        return {rid: _wave_like_points(scheduler.om_provider, bb, 5.0)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    assert await scheduler.ingest_gfs_marine_pilot() is True

    assert seen["scalar"] == 0.25, "the pass default must stay the flagship 0.25 deg"
    assert seen["map"] == {"global_mid": 2.0}, (
        f"expected ONLY global_mid to override its resolution, got {seen['map']} — listing a "
        f"flagship region here would re-grid tiles that must stay byte-identical")

    mid = [p for p in temp_store.get_manifest().products
           if p.model == "GFS" and p.domain == "marine" and p.region_id == "global_mid"]
    assert mid, "the folded pass saved no global_mid products"
    assert {p.coverage_mode for p in mid} == {"global_tile"}, (
        "global_mid must be saved as a global_tile — a regional_tile would not be served by "
        "grid_resolver's Step 3.6 clip, so the z6-7 tier would silently vanish")
    assert {p.layer for p in mid} == {"waves", "swell_1", "swell_2", "wind_waves"}
    for p in mid:
        assert p.resolution == 2.0, f"global_mid saved at {p.resolution} deg, expected 2.0"


@pytest.mark.asyncio
async def test_a_failed_shared_pass_still_produces_global_mid(tmp_path, monkeypatch):
    """⛔ THE FOLD MAY ONLY SAVE TIME, NEVER LOSE THE TILE. Before the fold, global_mid had its own
    job with its own fetch; after it, an empty shared pass would leave no one to write the tile at
    all. The standalone impl must run as a fallback — worst case that is exactly the two downloads
    we had before, which is the correct thing to trade for never losing the tier."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def no_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        return None

    async def per_region(bbox, resolution=10.0, forecast_days=14, bboxes=None, resolutions=None):
        return _wave_like_points(scheduler.om_provider, bbox, 5.0)

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", no_multi)
    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_global_coarse", per_region)

    await scheduler.ingest_gfs_marine_pilot()

    mid = [p for p in temp_store.get_manifest().products
           if p.model == "GFS" and p.domain == "marine" and p.region_id == "global_mid"]
    assert mid, "the shared pass failed and nothing fell back — the mid tier would go stale"
    assert {p.coverage_mode for p in mid} == {"global_tile"}


@pytest.mark.asyncio
async def test_kill_switch_restores_the_per_region_path(tmp_path, monkeypatch):
    """MARINE_PILOT_MULTI_BBOX=0 must skip the multi pass entirely."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_marine_service as noaa_marine

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("MARINE_PILOT_MULTI_BBOX", "0")

    called = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=3, resolutions=None):
        called.append(1)
        return {}

    async def per_region(bbox, resolution=10.0, forecast_days=14, bboxes=None):
        return _wave_like_points(scheduler.om_provider, bbox, 5.0)

    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_regions", fake_multi)
    monkeypatch.setattr(noaa_marine, "fetch_gfs_marine_global_coarse", per_region)

    assert await scheduler.ingest_gfs_marine_pilot() is True
    assert not called, "kill switch did not prevent the multi-bbox fetch"
