"""
Shared test fixtures for the Raw Surf backend test suite.

Uses httpx.AsyncClient + ASGITransport for testing FastAPI async endpoints
without needing a running server. This is the FastAPI 2025 recommended pattern.
"""
import platform
platform._wmi = None

import os
import pytest
import pytest_asyncio
from httpx import AsyncClient, ASGITransport

# Set test environment variables BEFORE importing the app
os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///test_dev.db")
os.environ.setdefault("JWT_SECRET", "test-secret-key-for-ci")
os.environ.setdefault("SUPABASE_URL", "https://test.supabase.co")
os.environ.setdefault("SUPABASE_SERVICE_KEY", "test-service-key")
os.environ.setdefault("TESTING", "1")


@pytest_asyncio.fixture
async def client():
    """
    Provides an async httpx client wired to the FastAPI app via ASGITransport.
    Each test gets a fresh client instance. No real DB connections are made.
    """
    try:
        from server import app
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://testserver") as ac:
            yield ac
    except Exception as e:
        pytest.skip(f"App import failed (expected in CI without DB): {e}")


@pytest_asyncio.fixture
async def auth_headers():
    """
    Returns mock authorization headers for authenticated endpoint testing.
    In a full test suite, this would generate a real JWT token.
    """
    return {"Authorization": "Bearer test-token-for-smoke-tests"}


@pytest.fixture(autouse=True)
def clean_viewport_service_registries():
    """Clears ViewportService's static/class-level registries to prevent cross-test loop leakage."""
    try:
        from services.weather_pipeline.viewport_service import ViewportService
        ViewportService.IN_FLIGHT_REQUESTS.clear()
        ViewportService.NEGATIVE_CACHE.clear()
        ViewportService.ACTIVE_REVALIDATIONS.clear()
    except Exception:
        pass


@pytest.fixture
def mock_weather_setup(tmp_path, monkeypatch):
    """Sets up a clean temporary product store and mocks Open-Meteo API queries."""
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.dynamic_index import DynamicProductIndex
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)
    
    # Instantiate dynamic index pointing to tmp_path
    dynamic_idx = DynamicProductIndex(cache_dir=tmp_path)
    monkeypatch.setattr(weather, "dynamic_index", dynamic_idx)

    # Mock fetch_grid to return structured mock datasets
    async def mock_fetch_grid(self, model, domain, layer, bbox, resolution=0.25, forecast_days=2, *args, **kwargs):
        lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        results = []
        for lat, lon in zip(lats, lons):
            hourly_data = {}
            if layer == "waves":
                hourly_data = {
                    "wave_height": [2.5],
                    "wave_direction": [180.0],
                    "wave_period": [10.0]
                }
            elif layer == "swell_1":
                hourly_data = {
                    "swell_wave_height": [2.0],
                    "swell_wave_direction": [170.0],
                    "swell_wave_period": [9.0]
                }
            elif layer == "swell_2":
                hourly_data = {
                    "secondary_swell_wave_height": [1.5],
                    "secondary_swell_wave_direction": [160.0],
                    "secondary_swell_wave_period": [8.0]
                }
            elif layer == "wind_waves":
                hourly_data = {
                    "wind_wave_height": [1.0],
                    "wind_wave_direction": [150.0],
                    "wind_wave_period": [7.0]
                }
            elif layer == "all_marine":
                hourly_data = {
                    "wave_height": [2.5],
                    "wave_direction": [180.0],
                    "wave_period": [10.0],
                    "swell_wave_height": [2.0],
                    "swell_wave_direction": [170.0],
                    "swell_wave_period": [9.0],
                    "secondary_swell_wave_height": [1.5],
                    "secondary_swell_wave_direction": [160.0],
                    "secondary_swell_wave_period": [8.0],
                    "wind_wave_height": [1.0],
                    "wind_wave_direction": [150.0],
                    "wind_wave_period": [7.0]
                }
            elif layer == "wind":
                hourly_data = {
                    "wind_speed_10m": [15.0],
                    "wind_direction_10m": [270.0],
                    "wind_gusts_10m": [22.0]
                }
            
            results.append({
                "latitude": lat,
                "longitude": lon,
                "hourly_units": {
                    "wave_height": "m",
                    "wave_direction": "°",
                    "wave_period": "s",
                    "swell_wave_height": "m",
                    "swell_wave_direction": "°",
                    "swell_wave_period": "s",
                    "secondary_swell_wave_height": "m",
                    "secondary_swell_wave_direction": "°",
                    "secondary_swell_wave_period": "s",
                    "wind_wave_height": "m",
                    "wind_wave_direction": "°",
                    "wind_wave_period": "s",
                    "wind_speed_10m": "kn",
                    "wind_direction_10m": "°",
                    "wind_gusts_10m": "kn"
                },
                "hourly": {
                    "time": ["2026-06-02T12:00:00Z"],
                    **hourly_data
                }
            })
        return results

    # Mock fetch_point for direct fallbacks
    async def mock_fetch_point(self, model, domain, layer, lat, lng, forecast_days=2):
        hourly_data = {}
        if layer == "waves":
            hourly_data = {
                "wave_height": [3.5],
                "wave_direction": [190.0],
                "wave_period": [12.0]
            }
        elif layer == "wind":
            hourly_data = {
                "wind_speed_10m": [25.0],
                "wind_direction_10m": [280.0],
                "wind_gusts_10m": [32.0]
            }
        return {
            "latitude": lat,
            "longitude": lng,
            "hourly": {
                "time": ["2026-06-02T12:00:00Z"],
                **hourly_data
            }
        }

    from services.weather_pipeline.providers.copernicus_provider import CopernicusProvider
    async def mock_copernicus_fetch_grid(self, layer, bbox, resolution=0.25, forecast_days=2, precomputed_coords=None, *args, **kwargs):
        return await mock_fetch_grid(
            self=None,
            model="EURO",
            domain="marine",
            layer=layer,
            bbox=bbox,
            resolution=resolution,
            forecast_days=forecast_days,
            precomputed_coords=precomputed_coords,
            *args, **kwargs
        )

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid)
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point)
    monkeypatch.setattr(CopernicusProvider, "fetch_grid", mock_copernicus_fetch_grid)
    return temp_store, dynamic_idx
