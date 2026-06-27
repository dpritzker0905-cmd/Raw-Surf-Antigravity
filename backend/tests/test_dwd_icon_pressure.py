"""
Tests for ICON MSL-pressure DWD-direct ingestion (ICON pressure off open-meteo — the last ICON layer).

Verifies the DWD-first path in ingest_icon_pressure_global produces products manifest-identical to the
open-meteo path (provider='open-meteo', source_dataset='dwd_icon', authoritative), and that it falls
back to open-meteo when DWD yields nothing. The icosahedral bz2/GRIB fetch/decode is verified on Render
via the standalone fetcher; here fetch_icon_pressure_global_coarse is mocked.
"""
import pytest


@pytest.mark.asyncio
async def test_icon_pressure_dwd_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
    import services.dwd_pressure_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_PRESSURE_DWD_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_pressure_results(scheduler.om_provider, region, 10.0)
    for p in pts:
        p.pop("is_test_fixture", None)
        p["__provider"] = "dwd"

    called = {"dwd": False}

    async def fake_dwd(bbox, resolution=10.0, forecast_days=8):
        called["dwd"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_icon_pressure_global_coarse", fake_dwd)

    ok = await scheduler.ingest_icon_pressure_global()
    assert ok is True
    assert called["dwd"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "ICON" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        # DWD-direct is served native + authoritative (no loop-extrapolation), byte-identical manifest.
        assert p.provider == "open-meteo"
        assert p.source_dataset == "dwd_icon"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_icon_pressure_dwd_fallback_to_open_meteo(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    # real dwd_pressure_service returns None in the test env -> open-meteo loop-extrapolation path runs

    ok = await scheduler.ingest_icon_pressure_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "ICON" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    assert all(p.layer == "pressure" for p in prods)


@pytest.mark.asyncio
async def test_icon_pressure_dwd_kill_switch_forces_open_meteo(tmp_path, monkeypatch):
    """ICON_PRESSURE_DWD_DIRECT=0 must skip DWD entirely even if the service would return data."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.dwd_pressure_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_PRESSURE_DWD_DIRECT", "0")

    called = {"dwd": False}

    async def fake_dwd(bbox, resolution=10.0, forecast_days=8):
        called["dwd"] = True
        return []

    monkeypatch.setattr(svc, "fetch_icon_pressure_global_coarse", fake_dwd)

    ok = await scheduler.ingest_icon_pressure_global()
    assert ok is True
    assert called["dwd"] is False     # kill switch short-circuits before the service is consulted
