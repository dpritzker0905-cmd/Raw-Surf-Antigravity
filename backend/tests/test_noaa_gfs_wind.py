"""
Tests for GFS wind NOAA-direct ingestion (GFS wind off open-meteo).

Verifies the NOAA-first path in ingest_gfs_wind_global produces products manifest-identical to the
open-meteo path (zero regression), and that it falls back to open-meteo when NOAA yields nothing.
The actual GRIB2 fetch/decode (noaa_gfs_wind_fetcher.py / pygrib) is verified on Render via the
standalone fetcher; here fetch_gfs_wind_global_coarse is mocked.
"""
import pytest


@pytest.mark.asyncio
async def test_gfs_wind_noaa_direct_ingestion(tmp_path, monkeypatch):
    """
    When fetch_gfs_wind_global_coarse returns NOAA GFS results, ingest_gfs_wind_global must save
    AUTHORITATIVE products identical to the open-meteo path: provider='open-meteo',
    source_dataset='gfs_seamless', is_estimated=False — i.e. moving GFS wind onto NOAA causes ZERO
    manifest regression.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_wind_results
    import services.noaa_wind_service as noaa_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_WIND_NOAA_DIRECT", "1")

    global_region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}

    # NOAA-shaped wind results (full coarse grid, real-looking — NOT a fixture; authoritative).
    noaa_points = generate_mock_wind_results(
        scheduler.om_provider, global_region, resolution=10.0, forecast_days=1, is_test_fixture=False
    )
    for p in noaa_points:
        p["__provider"] = "noaa"

    called = {"noaa": False}

    async def fake_noaa(bbox, resolution=10.0, forecast_days=14):
        called["noaa"] = True
        return noaa_points

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", fake_noaa)

    success = await scheduler.ingest_gfs_wind_global()
    assert success is True
    assert called["noaa"] is True  # NOAA primary path was taken (not the open-meteo fallback)

    products = temp_store.get_manifest().products
    gfs_wind = [p for p in products if p.model == "GFS" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(gfs_wind) > 0
    for p in gfs_wind:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "gfs_seamless"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_gfs_wind_noaa_fallback_to_open_meteo(tmp_path, monkeypatch, hermetic_om_wind):
    """
    When NOAA-direct yields nothing (returns None), ingest_gfs_wind_global must fall through to the
    existing open-meteo path with no regression. In a test env the real fetch_gfs_wind_global_coarse
    already returns None, so this exercises the fallback end-to-end.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network

    success = await scheduler.ingest_gfs_wind_global()
    assert success is True

    products = temp_store.get_manifest().products
    gfs_wind = [p for p in products if p.model == "GFS" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(gfs_wind) > 0
    # In a test env the open-meteo fallback uses a fixture mock (provider='test-fixture'); the point here
    # is the fallback RAN and produced GFS wind global products.
    for p in gfs_wind:
        assert p.provider in ("open-meteo", "test-fixture")
        assert p.layer == "wind"


# ── HOURLY GFS WIND f000-f120 (2026-10-25; dark behind FRAME_WIND_GFS_HOURLY) ──────────────────────────────────────────
def test_forecast_hours_default_is_three_hourly_unchanged():
    from services.noaa_gfs_wind_fetcher import forecast_hours
    assert forecast_hours(336) == list(range(0, 337, 3))
    assert forecast_hours(336, 0) == list(range(0, 337, 3))
    assert forecast_hours(48, None) == list(range(0, 49, 3))


def test_forecast_hours_hourly_to_f120_then_three_hourly():
    from services.noaa_gfs_wind_fetcher import forecast_hours
    steps = forecast_hours(336, 120)
    assert steps[:121] == list(range(0, 121))                 # every hour f000-f120
    assert steps[121:] == list(range(123, 337, 3))             # 3-hourly beyond, as NOAA publishes
    assert len(steps) == 193                                   # 41 three-hourly in f000-f120 become 121 (+80)
    assert forecast_hours(336, 200) == steps                   # NOAA publishes no hourly step past f120: capped
    assert forecast_hours(48, 120) == list(range(0, 49))       # a shorter horizon stops at its own end


@pytest.mark.asyncio
async def test_service_passes_hourly_until_with_the_valid_window(monkeypatch):
    import services.noaa_wind_service as noaa_svc
    seen = {}

    async def fake_run(script, bbox, resolution, forecast_days, **kwargs):
        seen.update(kwargs)
        return []

    monkeypatch.setattr(noaa_svc, "run_fetcher_subprocess", fake_run)
    box = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    await noaa_svc.fetch_gfs_wind_global_coarse(box, 2.0, 14)
    assert "extra_payload" not in seen                         # default: the payload is unchanged
    seen.clear()
    win = {"start": "2026-10-25T00:00:00Z", "end": "2026-10-25T06:00:00Z"}
    await noaa_svc.fetch_gfs_wind_global_coarse(box, 2.0, 14, valid_window=win, hourly_until=120)
    assert seen["extra_payload"] == {"valid_window": win, "hourly_until": 120}


@pytest.mark.asyncio
async def test_global_mid_ingest_asks_hourly_only_with_the_flag(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline import wind_mid_res_ingestion as mid
    import services.noaa_wind_service as noaa_svc

    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_WIND_NOAA_DIRECT", "1")
    asked = []

    async def fake_fetch(bbox, resolution, forecast_days, **kwargs):
        asked.append(kwargs.get("hourly_until"))
        return None                                            # NOAA unavailable: the open-meteo fallback path runs

    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", fake_fetch)
    scheduler = WeatherPipelineScheduler(store=ProductStore(cache_dir=tmp_path))

    monkeypatch.delenv("FRAME_WIND_GFS_HOURLY", raising=False)
    assert mid.gfs_wind_hourly_until() is None
    await mid.ingest_gfs_wind_global_mid_impl(scheduler)
    monkeypatch.setenv("FRAME_WIND_GFS_HOURLY", "1")
    assert mid.gfs_wind_hourly_until() == 120
    await mid.ingest_gfs_wind_global_mid_impl(scheduler)
    monkeypatch.setenv("FRAME_WIND_GFS_HOURLY", "0")
    assert mid.gfs_wind_hourly_until() is None
    assert asked == [None, 120]
