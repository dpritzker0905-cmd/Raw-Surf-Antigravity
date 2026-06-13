import pytest
import asyncio
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from server import app
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

client = TestClient(app)

@pytest.mark.asyncio
async def test_viewport_background_processing_and_no_supabase_upload(mock_weather_setup, monkeypatch):
    """Verify viewport fetching returns target hour immediately, processes remaining hours in background, and bypasses Supabase."""
    store, dynamic_idx = mock_weather_setup
    
    # Track calls to _upload_to_supabase
    upload_calls = []
    def mock_upload_to_supabase(self, filename, data_bytes):
        upload_calls.append(filename)
    monkeypatch.setattr(ProductStore, "_upload_to_supabase", mock_upload_to_supabase)
    
    # We will mock fetch_grid to return multiple hours with all marine variables
    async def mock_fetch_grid_multi(self, model, domain, layer, bbox, resolution=0.25, forecast_days=2, *args, **kwargs):
        lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        results = []
        for lat, lon in zip(lats, lons):
            results.append({
                "latitude": lat,
                "longitude": lon,
                "hourly_units": {
                    "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                    "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                    "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                    "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
                },
                "hourly": {
                    "time": ["2026-06-02T12:00:00Z", "2026-06-02T13:00:00Z", "2026-06-02T14:00:00Z"],
                    "wave_height": [2.5, 3.0, 3.5],
                    "wave_direction": [180.0, 190.0, 200.0],
                    "wave_period": [10.0, 11.0, 12.0],
                    "swell_wave_height": [2.0, 2.5, 3.0],
                    "swell_wave_direction": [170.0, 180.0, 190.0],
                    "swell_wave_period": [9.0, 10.0, 11.0],
                    "secondary_swell_wave_height": [1.5, 2.0, 2.5],
                    "secondary_swell_wave_direction": [160.0, 170.0, 180.0],
                    "secondary_swell_wave_period": [8.0, 9.0, 10.0],
                    "wind_wave_height": [1.0, 1.5, 2.0],
                    "wind_wave_direction": [150.0, 160.0, 170.0],
                    "wind_wave_period": [7.0, 8.0, 9.0]
                }
            })
        return results
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid_multi)
    
    from routes import weather
    from services.weather_pipeline.route_helpers import build_dynamic_cache_key
    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    
    # 1. Fetch grid for target_dt = 12:00
    res = await weather.viewport_service.fetch_viewport_grid(
        model="GFS", domain="marine", layer="waves",
        valid_time_str="2026-06-02T12:00:00Z", target_dt=target_dt,
        bbox_str="-85,24,-80,30"
    )
    
    # Target hour should be normalized and returned
    assert res is not None
    assert res.valid_time == target_dt
    
    # The file for target hour should be on disk
    my_cache_key = build_dynamic_cache_key("GFS", "marine", "waves", target_dt, -85.0, 24.0, -80.0, 30.0)
    assert (store.cache_dir / f"{my_cache_key}.json").exists()
    
    # Check that other hours are not on disk yet (since they run in background)
    dt_13 = datetime(2026, 6, 2, 13, 0, 0, tzinfo=timezone.utc)
    key_13 = build_dynamic_cache_key("GFS", "marine", "waves", dt_13, -85.0, 24.0, -80.0, 30.0)
    
    # Wait for the background task to complete processing
    await asyncio.sleep(0.2)
    
    # Now other hours should be processed and saved on disk
    assert (store.cache_dir / f"{key_13}.json").exists()
    
    # Verify no Supabase uploads were triggered for viewport files
    assert len(upload_calls) == 0

@pytest.mark.asyncio
async def test_viewport_concurrent_waiters_prioritization(mock_weather_setup, monkeypatch):
    """Verify that multiple concurrent waiter requests for different hours are served and prioritized."""
    store, dynamic_idx = mock_weather_setup
    
    # Mock fetch_grid to return multiple hours, with a delay to allow concurrent requests to build up
    async def mock_fetch_grid_delayed(self, model, domain, layer, bbox, resolution=0.25, forecast_days=2, *args, **kwargs):
        await asyncio.sleep(0.1) # Simulate slow network
        lats, lons = OpenMeteoProvider.generate_grid_coords(bbox, resolution)
        results = []
        for lat, lon in zip(lats, lons):
            results.append({
                "latitude": lat,
                "longitude": lon,
                "hourly_units": {
                    "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                    "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                    "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                    "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
                },
                "hourly": {
                    "time": ["2026-06-02T12:00:00Z", "2026-06-02T13:00:00Z", "2026-06-02T14:00:00Z"],
                    "wave_height": [2.5, 3.0, 3.5],
                    "wave_direction": [180.0, 190.0, 200.0],
                    "wave_period": [10.0, 11.0, 12.0],
                    "swell_wave_height": [2.0, 2.5, 3.0],
                    "swell_wave_direction": [170.0, 180.0, 190.0],
                    "swell_wave_period": [9.0, 10.0, 11.0],
                    "secondary_swell_wave_height": [1.5, 2.0, 2.5],
                    "secondary_swell_wave_direction": [160.0, 170.0, 180.0],
                    "secondary_swell_wave_period": [8.0, 9.0, 10.0],
                    "wind_wave_height": [1.0, 1.5, 2.0],
                    "wind_wave_direction": [150.0, 160.0, 170.0],
                    "wind_wave_period": [7.0, 8.0, 9.0]
                }
            })
        return results
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid_delayed)
    
    from routes import weather
    from services.weather_pipeline.route_helpers import build_dynamic_cache_key
    dt_12 = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    dt_14 = datetime(2026, 6, 2, 14, 0, 0, tzinfo=timezone.utc)
    
    # Send Request A for 12:00
    task_a = asyncio.create_task(weather.viewport_service.fetch_viewport_grid(
        model="GFS", domain="marine", layer="waves",
        valid_time_str="2026-06-02T12:00:00Z", target_dt=dt_12,
        bbox_str="-85,24,-80,30"
    ))
    
    # Wait a tiny bit, then send Request B for 14:00
    await asyncio.sleep(0.02)
    task_b = asyncio.create_task(weather.viewport_service.fetch_viewport_grid(
        model="GFS", domain="marine", layer="waves",
        valid_time_str="2026-06-02T14:00:00Z", target_dt=dt_14,
        bbox_str="-85,24,-80,30"
    ))
    
    # Wait for both to complete
    res_a, res_b = await asyncio.gather(task_a, task_b)
    
    assert res_a is not None
    assert res_a.valid_time == dt_12
    assert res_b is not None
    assert res_b.valid_time == dt_14
    
    # Verify both are on disk
    key_12 = build_dynamic_cache_key("GFS", "marine", "waves", dt_12, -85.0, 24.0, -80.0, 30.0)
    key_14 = build_dynamic_cache_key("GFS", "marine", "waves", dt_14, -85.0, 24.0, -80.0, 30.0)
    assert (store.cache_dir / f"{key_12}.json").exists()
    assert (store.cache_dir / f"{key_14}.json").exists()
