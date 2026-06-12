import pytest
from datetime import datetime, timezone, timedelta
import os
from fastapi.testclient import TestClient
from server import app
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.viewport_service import ViewportService
from services.weather_pipeline.schemas import NormalizedProduct, CoverageBounds, NormalizedGrid

client = TestClient(app)


@pytest.mark.asyncio
async def test_marine_provider_default_delay(monkeypatch):
    """Verify that OpenMeteoProvider reads defaults from environment variables correctly."""
    monkeypatch.setenv("OPEN_METEO_MARINE_BATCH_DELAY_SEC", "1.2")
    monkeypatch.setenv("OPEN_METEO_WIND_BATCH_DELAY_SEC", "0.9")
    monkeypatch.setenv("NODE_ENV", "production") # avoid test fixture mocking in provider

    provider = OpenMeteoProvider()
    
    # We mock the http client call in fetch_grid to see what delay is resolved
    delay_called = []
    async def mock_sleep(delay):
        delay_called.append(delay)
    import asyncio
    monkeypatch.setattr(asyncio, "sleep", mock_sleep)

    # Mock post call to return empty list or dummy response immediately
    class MockResponse:
        status_code = 200
        def json(self):
            return []
        def raise_for_status(self):
            pass

    async def mock_post(*args, **kwargs):
        return MockResponse()

    import httpx
    monkeypatch.setattr(httpx.AsyncClient, "post", mock_post)

    # Force a grid fetch that requires at least two batches (lats count = 150, batch_size = 100)
    # Florida bbox with 0.1 resolution will generate ~150 coords
    bbox = {"west": -82.0, "south": 24.0, "east": -80.0, "north": 29.0}
    
    # 1. Test GFS Marine (delay should default to OPEN_METEO_MARINE_BATCH_DELAY_SEC = 1.2s)
    await provider.fetch_grid(
        model="GFS", domain="marine", layer="waves", bbox=bbox, resolution=0.1, forecast_days=2
    )
    assert len(delay_called) > 0
    assert delay_called[0] == 1.2

    # 2. Test GFS Wind (delay should default to OPEN_METEO_WIND_BATCH_DELAY_SEC = 0.9s)
    delay_called.clear()
    await provider.fetch_grid(
        model="GFS", domain="wind", layer="wind", bbox=bbox, resolution=0.1, forecast_days=2
    )
    assert len(delay_called) > 0
    assert delay_called[0] == 0.9


@pytest.mark.asyncio
async def test_viewport_gfs_marine_forecast_days_cap(monkeypatch, tmp_path):
    """Verify that dynamic viewport GFS marine fetches cap forecast_days to 8 days."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    provider = OpenMeteoProvider()
    viewport_service = ViewportService(store=temp_store, provider=provider)

    future_dt = datetime.now(timezone.utc) + timedelta(days=15)
    captured_forecast_days = []
    async def mock_fetch_grid(self, model, domain, layer, bbox, resolution, forecast_days, *args, **kwargs):
        captured_forecast_days.append(forecast_days)
        # return mock point to satisfy normalization
        return [{
            "latitude": 26.0, "longitude": -80.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": [future_dt.strftime("%Y-%m-%dT%H:%M:%SZ")], "wave_height": [1.5], "wave_direction": [180.0], "wave_period": [8.0]}
        }]

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid)

    await viewport_service.fetch_viewport_grid_upstream(
        model="GFS", domain="marine", layer="waves",
        valid_time_str=future_dt.strftime("%Y-%m-%dT%H:%M:%SZ"),
        target_dt=future_dt, bbox_str="-85,24,-80,30"
    )
    
    assert len(captured_forecast_days) > 0
    # Capped to 8 days
    assert captured_forecast_days[0] == 8


@pytest.mark.asyncio
async def test_viewport_marine_inter_batch_delay_override(monkeypatch, tmp_path):
    """Verify that dynamic viewport marine fetches override delay to OPEN_METEO_VIEWPORT_MARINE_BATCH_DELAY_SEC."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)
    
    monkeypatch.setenv("OPEN_METEO_VIEWPORT_MARINE_BATCH_DELAY_SEC", "0.7")

    provider = OpenMeteoProvider()
    viewport_service = ViewportService(store=temp_store, provider=provider)

    captured_delay = []
    async def mock_fetch_grid(self, model, domain, layer, bbox, resolution, forecast_days, precomputed_coords, inter_batch_delay):
        captured_delay.append(inter_batch_delay)
        return [{
            "latitude": 26.0, "longitude": -80.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": ["2026-06-02T12:00:00Z"], "wave_height": [1.5], "wave_direction": [180.0], "wave_period": [8.0]}
        }]

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid)

    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    
    await viewport_service.fetch_viewport_grid_upstream(
        model="GFS", domain="marine", layer="waves",
        valid_time_str="2026-06-02T12:00:00Z",
        target_dt=target_dt, bbox_str="-85,24,-80,30"
    )
    
    assert len(captured_delay) > 0
    assert captured_delay[0] == 0.7


def test_no_saving_test_fixture_products_in_non_test_environments(monkeypatch, tmp_path):
    """Verify that save_product strictly rejects test-fixture products in non-test environments."""
    temp_store = ProductStore(cache_dir=tmp_path)

    # Enforce non-test environment (NODE_ENV=production)
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("ENV", "production")
    monkeypatch.setenv("IS_PROD", "true")
    monkeypatch.setenv("LOCAL_TEST_FIXTURE", "false")

    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=[])

    product = NormalizedProduct(
        model="GFS",
        provider="test-fixture", # test fixture provider!
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=False,
        is_estimated=True,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height"],
        freshness_sec=1800,
        is_test_fixture=True # test fixture tag!
    )

    filename = temp_store.save_product(product, resolution=0.25)
    # Must reject and return None
    assert filename is None

    # Check manifest doesn't have it
    manifest = temp_store.get_manifest()
    assert len(manifest.products) == 0
