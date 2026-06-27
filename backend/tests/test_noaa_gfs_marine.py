"""
Tests for GFS marine NOAA-direct ingestion (GFS off open-meteo).

Verifies the NOAA-first path in ingest_gfs_marine_global produces products that are manifest-identical
to the open-meteo path (zero regression), and that it falls back to open-meteo when NOAA yields nothing.
The actual GRIB2 fetch/decode (noaa_gfs_wave_fetcher.py / pygrib) is verified on Render via the
standalone fetcher; here fetch_gfs_marine_global_coarse is mocked.
"""
import pytest


@pytest.mark.asyncio
async def test_gfs_marine_noaa_direct_ingestion(tmp_path, monkeypatch):
    """
    When fetch_gfs_marine_global_coarse returns NOAA GFS-Wave results, ingest_gfs_marine_global must save
    AUTHORITATIVE products identical to the open-meteo path: provider='open-meteo',
    source_dataset='ncep_gfswave025', is_estimated=False — i.e. moving GFS marine onto NOAA causes ZERO
    manifest regression.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_marine_results
    import services.noaa_marine_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_MARINE_FORECAST_DAYS", "1")  # keep the mock time-axis small/fast
    monkeypatch.setenv("GFS_MARINE_NOAA_DIRECT", "1")

    global_region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}

    # NOAA-shaped results (full coarse grid, real-looking — NOT a test fixture, since NOAA data is
    # authoritative). __provider='noaa' marks the channel; the save loop still uses provider='open-meteo'.
    noaa_points = generate_mock_marine_results(scheduler.om_provider, global_region, resolution=10.0)
    for p in noaa_points:
        p.pop("is_test_fixture", None)
        p["__provider"] = "noaa"

    called = {"noaa": False}

    async def fake_noaa(bbox, resolution=10.0, forecast_days=14):
        called["noaa"] = True
        return noaa_points

    monkeypatch.setattr(noaa_svc, "fetch_gfs_marine_global_coarse", fake_noaa)

    success = await scheduler.ingest_gfs_marine_global()
    assert success is True
    assert called["noaa"] is True  # NOAA primary path was taken (not the open-meteo fallback)

    products = temp_store.get_manifest().products
    gfs_marine = [p for p in products if p.model == "GFS" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(gfs_marine) > 0
    for p in gfs_marine:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ncep_gfswave025"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True
    assert {"waves", "swell_1", "swell_2", "wind_waves"}.issubset({p.layer for p in gfs_marine})


@pytest.mark.asyncio
async def test_gfs_marine_noaa_fallback_to_open_meteo(tmp_path, monkeypatch):
    """
    When NOAA-direct yields nothing (returns None), ingest_gfs_marine_global must fall through to the
    existing open-meteo path with no regression. In a test env the real fetch_gfs_marine_global_coarse
    already returns None, so this exercises the fallback end-to-end.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    success = await scheduler.ingest_gfs_marine_global()
    assert success is True

    products = temp_store.get_manifest().products
    gfs_marine = [p for p in products if p.model == "GFS" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(gfs_marine) > 0
    # In a test env the open-meteo fallback uses a fixture mock (provider='test-fixture'); in production it
    # is provider='open-meteo' with source_dataset='ncep_gfswave025'. The point here is the fallback RAN.
    for p in gfs_marine:
        assert p.provider in ("open-meteo", "test-fixture")
    assert {"waves", "swell_1", "swell_2", "wind_waves"}.issubset({p.layer for p in gfs_marine})


@pytest.mark.asyncio
async def test_gfs_marine_pilot_noaa_direct_regional(tmp_path, monkeypatch):
    """
    Regression guard for the decoupling coastal-resolution bug: ingest_gfs_marine_pilot must take the
    NOAA-direct PRIMARY for every region (FL east coast + SoCal at 0.25°) so the decoupled GitHub-runner
    manifest carries regional products even with open-meteo unreachable. Products stay authoritative and
    byte-identical: provider='open-meteo', source_dataset='ncep_gfswave025', coverage_mode='regional_tile'.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_marine_results, REGIONAL_CONFIGS
    import services.noaa_marine_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_MARINE_FORECAST_DAYS", "1")  # small/fast mock time-axis
    monkeypatch.setenv("GFS_MARINE_NOAA_DIRECT", "1")

    called_regions = []

    async def fake_noaa(bbox, resolution=10.0, forecast_days=14):
        # NOAA-shaped results for whatever regional bbox the pilot passes (authoritative, not a fixture).
        called_regions.append((round(bbox["west"], 2), round(bbox["east"], 2)))
        pts = generate_mock_marine_results(scheduler.om_provider, bbox, resolution)
        for p in pts:
            p.pop("is_test_fixture", None)
            p["__provider"] = "noaa"
        return pts

    monkeypatch.setattr(noaa_svc, "fetch_gfs_marine_global_coarse", fake_noaa)

    success = await scheduler.ingest_gfs_marine_pilot()
    assert success is True
    # NOAA primary taken for BOTH pilot regions (not the open-meteo fallback).
    assert len(called_regions) == len(REGIONAL_CONFIGS)

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "GFS" and p.domain == "marine" and p.region_id == region_id]
        assert len(regionals) > 0, f"no regional products saved for {region_id}"
        for p in regionals:
            assert p.provider == "open-meteo"
            assert p.source_dataset == "ncep_gfswave025"
            assert p.is_estimated is False
            assert p.is_forecast_authoritative is True
            assert p.coverage_mode == "regional_tile"
            assert p.resolution == REGIONAL_CONFIGS[region_id]["resolution"]
