"""
Tests for ICON wind DWD-direct ingestion (ICON wind off open-meteo).

Verifies the DWD-first path in ingest_icon_wind_global produces AUTHORITATIVE products manifest-identical
to the open-meteo path (provider='open-meteo', source_dataset='dwd_icon', is_estimated=False) and falls
back to open-meteo when DWD yields nothing. The icosahedral GRIB fetch/decode (dwd_icon_wind_fetcher.py /
pygrib + CLAT/CLON nearest-neighbor) is verified on Render via the standalone fetcher; here
fetch_icon_wind_global_coarse is mocked.
"""
import pytest


@pytest.mark.asyncio
async def test_icon_wind_dwd_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_wind_results
    import services.dwd_wind_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_WIND_DWD_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    # DWD-shaped wind results (authoritative, NOT a fixture). __provider='dwd'.
    pts = generate_mock_wind_results(
        scheduler.om_provider, region, resolution=10.0, forecast_days=1, is_test_fixture=False
    )
    for p in pts:
        p["__provider"] = "dwd"

    called = {"dwd": False}

    async def fake_dwd(bbox, resolution=10.0, forecast_days=8):
        called["dwd"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_icon_wind_global_coarse", fake_dwd)

    ok = await scheduler.ingest_icon_wind_global()
    assert ok is True
    assert called["dwd"] is True  # DWD primary path taken (not the open-meteo fallback)

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "ICON" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    # Audit #22 (2026-07-10): the DWD path now ALSO pre-bakes the 14d loop-extrapolated tail, so the
    # lane holds BOTH authoritative natives and an estimated tail (kill ICON_WIND_EXTEND=0).
    natives = [p for p in prods if not p.is_estimated]
    tail = [p for p in prods if p.is_estimated]
    assert len(natives) > 0
    for p in natives:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "dwd_icon"
        assert p.is_forecast_authoritative is True  # DWD is real data -> authoritative
    for p in tail:
        assert p.is_forecast_authoritative is False  # loop-extrapolation = estimated, never authoritative
        assert p.valid_time_start > max(n.valid_time_start for n in natives)  # tail strictly beyond natives


@pytest.mark.asyncio
async def test_icon_wind_dwd_fallback_to_open_meteo(tmp_path, monkeypatch, hermetic_om_wind):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network

    ok = await scheduler.ingest_icon_wind_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "ICON" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    assert all(p.layer == "wind" for p in prods)
