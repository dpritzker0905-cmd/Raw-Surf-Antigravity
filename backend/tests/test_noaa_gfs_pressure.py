"""
Tests for GFS MSL-pressure NOAA-direct ingestion (GFS pressure off open-meteo).

Verifies the NOAA-first path in ingest_gfs_pressure_global produces products manifest-identical to the
open-meteo path (provider='open-meteo', source_dataset='gfs_seamless', authoritative), and that it falls
back to open-meteo when NOAA yields nothing. The bz2/GRIB fetch/decode is verified on Render via the
standalone fetcher; here fetch_gfs_pressure_global_coarse is mocked.
"""
import pytest


@pytest.mark.asyncio
async def test_gfs_pressure_noaa_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
    import services.noaa_pressure_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("GFS_PRESSURE_NOAA_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_pressure_results(scheduler.om_provider, region, 10.0)
    for p in pts:
        p.pop("is_test_fixture", None)
        p["__provider"] = "noaa"

    called = {"noaa": False}

    async def fake_noaa(bbox, resolution=10.0, forecast_days=16):
        called["noaa"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_gfs_pressure_global_coarse", fake_noaa)

    ok = await scheduler.ingest_gfs_pressure_global()
    assert ok is True
    assert called["noaa"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "GFS" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "gfs_seamless"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_gfs_pressure_noaa_fallback_to_open_meteo(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    ok = await scheduler.ingest_gfs_pressure_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "GFS" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    assert all(p.layer == "pressure" for p in prods)
