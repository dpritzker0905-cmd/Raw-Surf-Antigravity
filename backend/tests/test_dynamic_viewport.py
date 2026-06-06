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
    assert pt_outside["coverage_status"] == "out_of_bounds/no_coverage"
    assert pt_outside["grid_parity"] is False
    assert pt_outside["point"]["speed"] is None

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

def test_dynamic_viewport_grid_icon_euro_success(mock_weather_setup):
    """Verify ICON and EURO waves/wind dynamic viewport products are generated successfully on grid query."""
    store, dynamic_idx = mock_weather_setup

    # Test ICON
    response_icon = client.get(
        "/api/weather/grid?model=ICON&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response_icon.status_code == 200
    json_icon = response_icon.json()
    assert json_icon["is_dynamic_viewport_product"] is True
    assert json_icon["cache_hit"] == "cache_miss"

    # Test EURO
    response_euro = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response_euro.status_code == 200
    json_euro = response_euro.json()
    assert json_euro["is_dynamic_viewport_product"] is True
    assert json_euro["cache_hit"] == "cache_miss"


def test_all_non_gfs_layers(mock_weather_setup):
    """Verify dynamic viewport grid responses for every supported non-GFS layer of EURO and ICON."""
    # We use a bbox wider than the Florida box: west=-95.0, south=20.0, east=-70.0, north=35.0
    bbox_wider = "-95,20,-70,35"
    
    cases = [
        # EURO
        {"model": "EURO", "domain": "marine", "layer": "waves"},
        {"model": "EURO", "domain": "marine", "layer": "swell_1"},
        {"model": "EURO", "domain": "marine", "layer": "swell_2"},
        {"model": "EURO", "domain": "marine", "layer": "wind_waves"},
        {"model": "EURO", "domain": "wind", "layer": "wind"},
        # ICON
        {"model": "ICON", "domain": "marine", "layer": "waves"},
        {"model": "ICON", "domain": "marine", "layer": "swell_1"},
        {"model": "ICON", "domain": "marine", "layer": "wind_waves"},
        {"model": "ICON", "domain": "wind", "layer": "wind"},
    ]
    
    for c in cases:
        model = c["model"]
        domain = c["domain"]
        layer = c["layer"]
        url = f"/api/weather/grid?model={model}&domain={domain}&layer={layer}&valid_time=2026-06-02T12:00:00Z&bbox={bbox_wider}"
        response = client.get(url)
        assert response.status_code == 200, f"Failed for {model} {domain} {layer}"
        json_data = response.json()
        
        assert json_data["is_dynamic_viewport_product"] is True, f"{model} {domain} {layer} is_dynamic_viewport_product should be True"
        assert json_data["coverage_scope"] in ("viewport", "global_coarse"), f"{model} {domain} {layer} coverage_scope should be viewport or global_coarse"
        
        # served_bbox must not be Florida-only (Florida-only is roughly -85, 24, -79, 31)
        served_bbox = json_data.get("served_bbox")
        assert served_bbox is not None, f"{model} {domain} {layer} served_bbox should not be None"
        s_w, s_s, s_e, s_n = map(float, served_bbox.split(","))
        assert s_w < -85.0 or s_e > -79.0, f"{model} {domain} {layer} served_bbox {served_bbox} should be wider than Florida"
        
        # provider/upstream_provider honesty (always open-meteo for viewport grid)
        assert json_data["provider"] == "open-meteo", f"{model} {domain} {layer} provider should be open-meteo"
        assert json_data["upstream_provider"] == "open-meteo", f"{model} {domain} {layer} upstream_provider should be open-meteo"
        
        # grid and vectors check
        grid = json_data["grid"]
        assert grid is not None
        assert len(grid["vectors"]) > 0, f"{model} {domain} {layer} should have vectors"
        
        # vectorCount > 0
        assert grid["diagnostics"].get("vectorCount", 0) > 0, f"{model} {domain} {layer} vectorCount should be > 0"
        
        # nonzeroCount > 0 where source supports the layer
        assert grid["diagnostics"].get("nonzeroCount", 0) > 0, f"{model} {domain} {layer} nonzeroCount should be > 0"

    # ICON swell_2 must assert explicit unsupported/no source data, not a regional square
    url_icon_swell2 = f"/api/weather/grid?model=ICON&domain=marine&layer=swell_2&valid_time=2026-06-02T12:00:00Z&bbox={bbox_wider}"
    response_icon_swell2 = client.get(url_icon_swell2)
    assert response_icon_swell2.status_code == 200
    json_swell2 = response_icon_swell2.json()
    assert json_swell2["status"] == "unsupported"
    assert json_swell2["reason"] == "unsupported_model_layer"
    assert json_swell2["renderable"] is False
    assert len(json_swell2["grid"]["vectors"]) == 0
