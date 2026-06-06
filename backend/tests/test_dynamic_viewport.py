import pytest
from datetime import datetime, timezone
import json
import math
from pathlib import Path
from fastapi.testclient import TestClient
from server import app
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.dynamic_index import DynamicProductIndex
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

client = TestClient(app)

@pytest.fixture
def mock_weather_setup(tmp_path, monkeypatch):
    """Sets up a clean temporary product store and mocks Open-Meteo API queries."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)
    
    # Instantiate dynamic index pointing to tmp_path
    dynamic_idx = DynamicProductIndex(cache_dir=tmp_path)
    monkeypatch.setattr(weather, "dynamic_index", dynamic_idx)

    # Mock fetch_grid to return structured mock datasets
    async def mock_fetch_grid(self, model, domain, layer, bbox, resolution, forecast_days):
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
                    "wave_height": "m" if layer == "waves" else None,
                    "wave_direction": "°" if layer == "waves" else None,
                    "wave_period": "s" if layer == "waves" else None,
                    "wind_speed_10m": "kn" if layer == "wind" else None,
                    "wind_direction_10m": "°" if layer == "wind" else None,
                    "wind_gusts_10m": "kn" if layer == "wind" else None
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

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid)
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point)
    return temp_store, dynamic_idx

def test_dynamic_viewport_grid_success(mock_weather_setup):
    """Verify GFS waves/wind dynamic viewport products are generated successfully on grid query."""
    store, dynamic_idx = mock_weather_setup

    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["is_dynamic_viewport_product"] is True
    assert json_data["coverage_scope"] in ("viewport", "global_coarse")
    assert json_data["cache_hit"] == "cache_miss"
    assert json_data["grid"]["cols"] > 0
    assert len(json_data["grid"]["vectors"]) == json_data["grid"]["cols"] * json_data["grid"]["rows"]

    # Verify L1 file exists
    product_id = json_data["product_id"]
    assert (store.cache_dir / product_id).exists()

    # Verify registered in dynamic index
    products = dynamic_idx._load_index()
    assert len(products) == 1
    assert products[0]["product_id"] == product_id
    assert products[0]["model"] == "GFS"
    assert products[0]["layer"] == "waves"

    # Query again, should be a cache hit
    response_cached = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response_cached.status_code == 200
    json_cached = response_cached.json()
    assert json_cached["cache_hit"] == "cache_hit"
    assert json_cached["product_id"] == product_id

def test_dynamic_viewport_resolution_stepup(mock_weather_setup):
    """Verify coordinate count safety caps (>800 points) force resolution step-ups dynamically."""
    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-180,-80,180,80"
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["is_dynamic_viewport_product"] is True
    assert json_data["coordinate_count"] <= 800
    # Large area must have triggered resolution step-up (coarser than 0.25)
    assert json_data["resolution"] >= 1.0

def test_dynamic_viewport_point_parity(mock_weather_setup):
    """Verify strict point containment checks when grid_product_id is specified."""
    store, dynamic_idx = mock_weather_setup

    # 1. Fetch grid to populate L1 cache and dynamic index
    res_grid = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    grid_json = res_grid.json()
    grid_product_id = grid_json["product_id"]

    # 2. Query point INSIDE viewport bounds with grid_product_id
    res_pt_inside = client.get(
        f"/api/weather/point?model=GFS&domain=marine&layer=waves&lat=26.0&lng=-82.0&valid_time=2026-06-02T12:00:00Z&grid_product_id={grid_product_id}"
    )
    assert res_pt_inside.status_code == 200
    pt_inside = res_pt_inside.json()
    assert pt_inside["source"] == "grid_file"
    assert pt_inside["coverage_status"] == "inside_served_bbox"
    assert pt_inside["grid_parity"] is True
    assert pt_inside["point"]["speed"] == 2.5

    # 3. Query point OUTSIDE viewport bounds with grid_product_id
    res_pt_outside = client.get(
        f"/api/weather/point?model=GFS&domain=marine&layer=waves&lat=34.0&lng=-118.0&valid_time=2026-06-02T12:00:00Z&grid_product_id={grid_product_id}"
    )
    assert res_pt_outside.status_code == 200
    pt_outside = res_pt_outside.json()
    assert pt_outside["coverage_status"] == "out_of_bounds"
    assert pt_outside["grid_parity"] is True
    assert pt_outside["point"]["speed"] == 0.0  # strict out_of_bounds returns 0.0 speed

def test_dynamic_viewport_point_no_grid_product_fallback(mock_weather_setup):
    """Verify fallback behavior when grid_product_id is missing: checks dynamic index first, then direct point fallback."""
    store, dynamic_idx = mock_weather_setup

    # Seed dynamic product
    res_grid = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    grid_product_id = res_grid.json()["product_id"]

    # 1. Query point inside viewport bbox but without grid_product_id -> should lookup dynamic index and succeed
    res_pt_index = client.get(
        "/api/weather/point?model=GFS&domain=marine&layer=waves&lat=26.0&lng=-82.0&valid_time=2026-06-02T12:00:00Z"
    )
    assert res_pt_index.status_code == 200
    pt_idx = res_pt_index.json()
    assert pt_idx["source"] == "grid_file"
    assert pt_idx["product_id"] == grid_product_id
    assert pt_idx["grid_parity"] is True

    # 2. Query point completely outside any grid bounds -> should trigger direct point fallback, labeled with source="backend_direct_point" and grid_parity=False
    res_pt_direct = client.get(
        "/api/weather/point?model=GFS&domain=marine&layer=waves&lat=21.0&lng=-157.0&valid_time=2026-06-02T12:00:00Z"
    )
    assert res_pt_direct.status_code == 200
    pt_direct = res_pt_direct.json()
    assert pt_direct["source"] == "backend_direct_point"
    assert pt_direct["grid_parity"] is False
    assert pt_direct["fallback_attempted"] is True
    assert pt_direct["fallback_reason"] == "no_matching_grid_product"
    assert pt_direct["point"]["speed"] == 3.5
