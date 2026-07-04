"""
Tests for EURO wind + pressure ECMWF-Open-Data-direct ingestion (EURO atmo off open-meteo — the finish).

Verifies the ECMWF-first path in ingest_euro_wind_global / ingest_euro_pressure_global produces products
manifest-identical to the open-meteo path (provider='open-meteo', source_dataset='ecmwf_ifs',
authoritative), falls back to open-meteo when ECMWF yields nothing, and honours the kill switch. The
actual IFS GRIB fetch/decode (ecmwf_opendata_fetcher.py / ecmwf-opendata + pygrib) is verified on Render
via the standalone fetcher; here the ecmwf service functions are mocked.
"""
import pytest


# ───────────────────────────── EURO WIND ─────────────────────────────
@pytest.mark.asyncio
async def test_euro_wind_ecmwf_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_wind_results
    import services.ecmwf_wind_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_WIND_ECMWF_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_wind_results(scheduler.om_provider, region, resolution=10.0,
                                     forecast_days=1, is_test_fixture=False)
    for p in pts:
        p["__provider"] = "ecmwf"

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_euro_wind_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    assert called["ecmwf"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ecmwf_ifs"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_euro_wind_ecmwf_fallback_to_open_meteo(tmp_path, monkeypatch, hermetic_om_wind):
    """Real ecmwf_wind_service returns None in the test env -> the open-meteo path runs unchanged."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider in ("open-meteo", "test-fixture")
        assert p.layer == "wind"


@pytest.mark.asyncio
async def test_euro_wind_ecmwf_kill_switch(tmp_path, monkeypatch, hermetic_om_wind):
    """EURO_WIND_ECMWF_DIRECT=0 must skip ECMWF entirely before the service is consulted."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wind_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network
    monkeypatch.setenv("EURO_WIND_ECMWF_DIRECT", "0")

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return []

    monkeypatch.setattr(svc, "fetch_euro_wind_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    assert called["ecmwf"] is False


# ─────────────────────────── EURO PRESSURE ───────────────────────────
@pytest.mark.asyncio
async def test_euro_pressure_ecmwf_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
    import services.ecmwf_pressure_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_PRESSURE_ECMWF_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_pressure_results(scheduler.om_provider, region, 10.0)
    for p in pts:
        p.pop("is_test_fixture", None)
        p["__provider"] = "ecmwf"

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_euro_pressure_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_pressure_global()
    assert ok is True
    assert called["ecmwf"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ecmwf_ifs"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_euro_pressure_ecmwf_fallback_to_open_meteo(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    ok = await scheduler.ingest_euro_pressure_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    assert all(p.layer == "pressure" for p in prods)
