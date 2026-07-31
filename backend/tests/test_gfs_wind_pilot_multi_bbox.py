"""GFS wind pilot: ONE download pass covers every region, so the rotation is retired.

THE DEFECT THIS CLOSES (measured live 2026-07-31). Hawaii's GFS wind product for the current
top-of-hour carried a run_time 75.0 h old; only run_time revealed it, because valid_time was
CURRENT. Every North Shore rating computed wind_gate / wind_quality (0.60 of the quality blend, and
a multiplicative veto) from a 3-day-old forecast. The cause was WORLDWIDE_REGIONS_PER_CYCLE
rationing regions -- and the cost it rationed was pure redundancy, since NOAA's byte-range selects a
GRIB message (a whole global field), not a region. Sampling all regions from one pass removes the
reason to ration.

Mirrors test_dwd_icon_marine.test_icon_marine_pilot_multi_bbox_single_pass -- the same assertion
shape for the same optimisation, on the lane it was never ported to.
"""
import pytest
from datetime import datetime, timezone, timedelta


def _wind_like_points(om_provider, region, resolution=0.25):
    """NOAA-shaped wind points: 3-hourly, m/s + degrees, matching noaa_gfs_wind_fetcher output."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(6)]
    return [{
        "latitude": lat, "longitude": lon, "__provider": "noaa",
        "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
        "hourly": {"time": times,
                   "wind_speed_10m": [7.5 for _ in times],
                   "wind_direction_10m": [45.0 for _ in times]},
    } for lat, lon in zip(lats, lons)]


@pytest.mark.asyncio
async def test_one_pass_covers_every_region_and_never_rotates(tmp_path, monkeypatch):
    """THE FIX. Exactly ONE fetch for ALL regions, and the region set is get_all_pilot_regions() --
    NOT the rotating get_pilot_regions() slice. If this ever calls the rotating selector again, some
    region goes unrefreshed on every fire and the starvation returns."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")

    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        calls.append(dict(bboxes))
        return {rid: _wind_like_points(scheduler.om_provider, bb, resolution)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", fake_multi)

    success = await scheduler.ingest_gfs_wind_pilot()
    assert success is True
    assert len(calls) == 1, f"{len(calls)} download passes -- must be exactly one for all regions"
    assert set(calls[0]) == set(REGIONAL_CONFIGS)      # test env = flagship set

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "GFS" and p.domain == "wind" and p.region_id == region_id]
        assert regionals, f"no GFS wind products saved for {region_id} (multi path)"
        for p in regionals:
            assert p.provider == "open-meteo"          # manifest byte-identical to the legacy path
            assert p.coverage_mode == "regional_tile"
            assert p.layer == "wind"


@pytest.mark.asyncio
async def test_the_pass_covers_all_worldwide_regions_not_a_rotating_slice(tmp_path, monkeypatch):
    """THE ASSERTION THAT ACTUALLY DISCRIMINATES.

    Under pytest, get_all_pilot_regions() and get_pilot_regions() BOTH return flagship-only, so a
    test that only checks the flagship set passes with either selector and proves nothing -- the
    'instrument measured something adjacent' trap that let this class survive three sessions. Lift
    the test-env short-circuit and the two selectors become distinguishable: all 10 regions vs a
    rotating 2-of-8 slice. Only the non-rotating selector can satisfy this.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import (
        REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS)
    from services.weather_pipeline import copernicus_validator
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")
    monkeypatch.setenv("WORLDWIDE_COASTAL", "1")
    monkeypatch.setenv("WORLDWIDE_REGIONS_PER_CYCLE", "2")
    monkeypatch.setattr(copernicus_validator, "is_test_environment", lambda: False)

    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        calls.append(dict(bboxes))
        return {rid: _wind_like_points(scheduler.om_provider, bb, 5.0)   # coarse: keep the test fast
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", fake_multi)

    assert await scheduler.ingest_gfs_wind_pilot() is True
    assert len(calls) == 1
    expected = set(REGIONAL_CONFIGS) | set(WORLDWIDE_COASTAL_REGIONS)
    assert set(calls[0]) == expected, (
        f"pass covered {len(calls[0])} regions, expected all {len(expected)} — "
        "a rotating slice would cover only 2 worldwide regions")

    saved = {p.region_id for p in temp_store.get_manifest().products
             if p.model == "GFS" and p.domain == "wind"}
    assert set(WORLDWIDE_COASTAL_REGIONS).issubset(saved), (
        f"worldwide regions missing from the manifest: {set(WORLDWIDE_COASTAL_REGIONS) - saved}")


@pytest.mark.asyncio
async def test_every_region_shares_one_run_time(tmp_path, monkeypatch):
    """A single pass must stamp ONE run_time across all regions. Per-region passes produced a
    staircase of run_times, which is exactly the signal that made the starvation hard to see: some
    regions current, others days old, all with plausible valid_times."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        return {rid: _wind_like_points(scheduler.om_provider, bb, resolution)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", fake_multi)
    await scheduler.ingest_gfs_wind_pilot()

    runs = {p.run_time for p in temp_store.get_manifest().products
            if p.model == "GFS" and p.domain == "wind"}
    assert len(runs) == 1, f"regions carry {len(runs)} distinct run_times -- not a single pass"


@pytest.mark.asyncio
async def test_falls_back_to_per_region_when_the_multi_pass_yields_nothing(tmp_path, monkeypatch):
    """A throughput optimisation must not become a single point of failure: if the multi pass
    returns nothing, the per-region path still ships tiles."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")

    async def no_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        return None

    async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None):
        return _wind_like_points(scheduler.om_provider, bbox, resolution)

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", no_multi)
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", per_region)

    assert await scheduler.ingest_gfs_wind_pilot() is True
    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        assert [p for p in products if p.model == "GFS" and p.domain == "wind"
                and p.region_id == region_id], f"fallback shipped nothing for {region_id}"


@pytest.mark.asyncio
async def test_a_raising_multi_fetch_does_not_kill_the_job(tmp_path, monkeypatch):
    """One bad fetch must cost the multi pass, not the whole pilot -- the blast-radius rule this
    repo learned when an UnboundLocalError killed a whole estimates job."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")

    async def boom(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        raise RuntimeError("AWS Open Data 503")

    async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None):
        return _wind_like_points(scheduler.om_provider, bbox, resolution)

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", boom)
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", per_region)

    assert await scheduler.ingest_gfs_wind_pilot() is True


@pytest.mark.asyncio
async def test_kill_switch_restores_the_per_region_path(tmp_path, monkeypatch):
    """WIND_PILOT_MULTI_BBOX=0 must skip the multi pass entirely (no fetch attempted)."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")
    monkeypatch.setenv("WIND_PILOT_MULTI_BBOX", "0")

    called = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        called.append(1)
        return {}

    async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None):
        return _wind_like_points(scheduler.om_provider, bbox, resolution)

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_regions", fake_multi)
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", per_region)

    assert await scheduler.ingest_gfs_wind_pilot() is True
    assert not called, "kill switch did not prevent the multi-bbox fetch"
