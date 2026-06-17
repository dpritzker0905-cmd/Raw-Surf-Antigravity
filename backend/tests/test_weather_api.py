import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
import math

from server import app
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
)
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.normalizer import WeatherNormalizer

client = TestClient(app)

def test_api_endpoints_manifest_and_parity(tmp_path, monkeypatch):
    """
    Test API grid and point endpoints integration and prove they
    sample the exact same product with absolute parity.
    """
    # 1. Create a temp ProductStore
    temp_store = ProductStore(cache_dir=tmp_path)
    
    # 2. Monkeypatch the store instance in routes.weather to use our temp_store
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 3. Create and save a valid product in ProductStore
    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    valid_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    
    # Simple 2x2 grid for Florida bbox
    vectors = [
        GridVector(lat=24.0, lng=-85.0, speed=10.0, direction=90.0, u=-10.0, v=0.0, period=6.0),
        GridVector(lat=24.0, lng=-79.0, speed=20.0, direction=90.0, u=-20.0, v=0.0, period=6.0),
        GridVector(lat=31.0, lng=-85.0, speed=30.0, direction=90.0, u=-30.0, v=0.0, period=8.0),
        GridVector(lat=31.0, lng=-79.0, speed=40.0, direction=90.0, u=-40.0, v=0.0, period=8.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=valid_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height", "wave_direction"],
        freshness_sec=1800
    )

    # Use isolated store to save file
    temp_store.save_product(product, resolution=6.0)

    # 2. Query products list API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert "products" in manifest
    assert len(manifest["products"]) > 0

    # 3. Query grid API
    response_grid = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "GFS"
    assert grid_payload["layer"] == "waves"

    # 4. Query point API at a specific interpolated coordinate
    lat, lng = 27.5, -82.0
    response_point = client.get(
        f"/api/weather/point?model=GFS&domain=marine&layer=waves&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"

    # 5. Verify local bilinear calculation parity manually over same product
    sampler = PointSampler()
    local_point_res = sampler.sample_point(product, lat, lng)
    
    # Confirm exact float parity matches API response
    assert math.isclose(point_payload["point"]["speed"], local_point_res.point.speed, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["u"], local_point_res.point.u, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["v"], local_point_res.point.v, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["period"], local_point_res.point.period, abs_tol=1e-4)

def test_api_endpoints_wind_manifest_and_parity(tmp_path, monkeypatch):
    """
    Test API grid and point endpoints integration for wind and prove they
    sample the exact same product with absolute parity.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    valid_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    
    vectors = [
        GridVector(lat=24.0, lng=-85.0, speed=10.0, direction=90.0, u=-10.0, v=0.0),
        GridVector(lat=24.0, lng=-79.0, speed=20.0, direction=90.0, u=-20.0, v=0.0),
        GridVector(lat=31.0, lng=-85.0, speed=30.0, direction=90.0, u=-30.0, v=0.0),
        GridVector(lat=31.0, lng=-79.0, speed=40.0, direction=90.0, u=-40.0, v=0.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        run_time=datetime.now(timezone.utc),
        valid_time=valid_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wind_speed",
        value_unit="kn",
        display_unit_hint="kn",
        source_variables=["wind_speed_10m", "wind_direction_10m"],
        freshness_sec=1800
    )

    temp_store.save_product(product, resolution=6.0)

    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert "products" in manifest
    assert len(manifest["products"]) > 0

    response_grid = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "GFS"
    assert grid_payload["layer"] == "wind"

    lat, lng = 27.5, -82.0
    response_point = client.get(
        f"/api/weather/point?model=GFS&domain=wind&layer=wind&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"

    sampler = PointSampler()
    local_point_res = sampler.sample_point(product, lat, lng)
    
    assert math.isclose(point_payload["point"]["speed"], local_point_res.point.speed, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["u"], local_point_res.point.u, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["v"], local_point_res.point.v, abs_tol=1e-4)

def test_icon_swell2_unsupported(tmp_path, monkeypatch):
    """Verify that normalizer rejects ICON swell_2, and API endpoints return honest unsupported response."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    
    # Try normalizing swell_2 for ICON
    res = normalizer.normalize(
        model="ICON",
        provider="open-meteo",
        domain="marine",
        layer="swell_2",
        raw_results=[{"latitude": 24.0, "longitude": -80.0, "hourly": {"time": ["2026-06-01T21:00:00Z"]}}],
        bbox={"west": -80.0, "south": 24.0, "east": -80.0, "north": 24.0},
        resolution=0.25,
        target_time=target_dt
    )
    assert res is None # Explicitly rejected

    # Request /grid for ICON swell_2 (should return conformed unsupported response)
    response_grid = client.get(
        "/api/weather/grid?model=ICON&domain=marine&layer=swell_2&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["status"] == "unsupported"
    assert grid_payload["reason"] == "unsupported_model_layer"
    assert grid_payload["is_estimated"] is False
    assert grid_payload["__unsupportedLayer"] is True

    # Request /point for ICON swell_2 (should return conformed unsupported response)
    response_point = client.get(
        "/api/weather/point?model=ICON&domain=marine&layer=swell_2&lat=28.40&lng=-80.60&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["status"] == "unsupported"
    assert point_payload["reason"] == "unsupported_model_layer"
    assert point_payload["is_estimated"] is False
    assert point_payload["point"]["interpolation_method"] == "unsupported"

def test_stage_6h1_requirements(tmp_path, monkeypatch):
    """
    Verify Stage 6H.1 SoCal Wind Tile Pilot specifications:
    - Region-aware filenames: {model}_{domain}_{layer}_{region_id}_{valid_time}.json
    - Manifest region metadata: region_id, coverage_mode, tile_id, product_id
    - Backward compatibility for old Florida products lacking region_id (treating them as florida_east_coast)
    - Grid route tile selection: Bbox intersection matches the best intersecting tile.
    - Point fallback schema: out-of-tile coordination query triggers Open-Meteo fallback.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 1. Create a product with region metadata
    bounds = CoverageBounds(west=-125.0, south=30.0, east=-115.0, north=38.0) # SoCal Bbox
    valid_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    vectors = [
        GridVector(lat=30.0, lng=-125.0, speed=12.0, direction=240.0, u=10.39, v=6.0),
        GridVector(lat=30.0, lng=-115.0, speed=14.0, direction=240.0, u=12.12, v=7.0),
        GridVector(lat=38.0, lng=-125.0, speed=16.0, direction=240.0, u=13.85, v=8.0),
        GridVector(lat=38.0, lng=-115.0, speed=18.0, direction=240.0, u=15.58, v=9.0),
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    
    product_socal = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        run_time=datetime.now(timezone.utc),
        valid_time=valid_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wind_speed",
        value_unit="kn",
        display_unit_hint="kn",
        source_variables=["wind_speed_10m", "wind_direction_10m"],
        freshness_sec=1800,
        region_id="us_west_coast_socal",
        coverage_mode="regional_tile",
        tile_id="us_west_coast_socal"
    )

    # Save SoCal product and assert filename structure
    filename = temp_store.save_product(product_socal, resolution=10.0)
    assert filename == "gfs_wind_wind_us_west_coast_socal_20260601T210000Z.json"
    
    # Check that manifest was updated with region metadata
    manifest = temp_store.get_manifest()
    p_socal = next(p for p in manifest.products if p.region_id == "us_west_coast_socal")
    assert p_socal.region_id == "us_west_coast_socal"
    assert p_socal.coverage_mode == "regional_tile"
    assert p_socal.tile_id == "us_west_coast_socal"
    assert p_socal.product_id == filename
    
    # 2. Check old Florida compatibility
    # Simulate an old Florida product file in cache dir, and an old manifest entry
    old_filename = "gfs_wind_wind_20260601T210000Z.json"
    old_bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    old_grid = NormalizedGrid(bounds=old_bounds, cols=2, rows=2, vectors=vectors)
    old_product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        run_time=datetime.now(timezone.utc),
        valid_time=valid_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=old_bounds,
        grid=old_grid,
        value_kind="wind_speed",
        value_unit="kn",
        display_unit_hint="kn",
        source_variables=["wind_speed_10m", "wind_direction_10m"],
        freshness_sec=1800
        # region_id is missing!
    )
    
    # Save the product directly on disk to simulate pre-existing files
    with open(temp_store.cache_dir / old_filename, "w") as f:
        f.write(old_product.model_dump_json())
        
    # Inject manifest item lacking region_id
    from services.weather_pipeline.schemas import ManifestProduct
    manifest.products.append(ManifestProduct(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        run_time=datetime.now(timezone.utc),
        valid_time_start=valid_dt,
        valid_time_end=valid_dt,
        resolution=6.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        coverage=old_bounds,
        filename=old_filename
        # region_id, coverage_mode, tile_id are missing!
    ))
    temp_store._save_manifest(manifest)
    
    # Load manifest and ensure it translates the old Florida product
    reloaded_manifest = temp_store.get_manifest()
    p_old = next(p for p in reloaded_manifest.products if p.filename == old_filename)
    assert p_old.region_id == "florida_east_coast"
    assert p_old.coverage_mode == "regional_tile"
    assert p_old.tile_id == "florida_east_coast"
    assert p_old.product_id == old_filename

    # Load product from store and check it got translated
    loaded_old_product = temp_store.load_product(old_filename)
    assert loaded_old_product.region_id == "florida_east_coast"
    assert loaded_old_product.coverage_mode == "regional_tile"
    assert loaded_old_product.tile_id == "florida_east_coast"
    assert loaded_old_product.product_id == old_filename

    # 3. Test Grid route tile selection matching by viewport
    # When requesting Florida viewport, it should match the Florida product
    response_fl = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-06-01T21:00:00Z&bbox=-83,25,-81,29"
    )
    assert response_fl.status_code == 200
    res_fl_data = response_fl.json()
    assert res_fl_data["product_id"] == old_filename
    
    # When requesting SoCal viewport, it should match the SoCal product
    response_socal = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-06-01T21:00:00Z&bbox=-123,31,-117,37"
    )
    assert response_socal.status_code == 200
    res_socal_data = response_socal.json()
    assert res_socal_data["product_id"] == filename

    # 4. Point Fallback Schema Validation
    # In Florida (inside old Florida tile), it should sample the grid file
    response_pt_fl = client.get(
        "/api/weather/point?model=GFS&domain=wind&layer=wind&lat=26.0&lng=-81.0&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_pt_fl.status_code == 200
    res_pt_fl_data = response_pt_fl.json()
    assert res_pt_fl_data["source"] == "grid_file"
    assert res_pt_fl_data["coverage_status"] == "inside_regional_tile"
    assert res_pt_fl_data["fallback_attempted"] is False

    # In Hawaii (outside all tiles), it should fall back to point API
    # Mocking fetch_point to return successful Open-Meteo point payload
    async def mock_fetch_point(self, model, domain, layer, lat, lng, *args, **kwargs):
        return {
            "latitude": lat,
            "longitude": lng,
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [15.0],
                "wind_direction_10m": [180.0]
            }
        }
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point)

    response_pt_hawaii = client.get(
        "/api/weather/point?model=GFS&domain=wind&layer=wind&lat=21.0&lng=-157.0&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_pt_hawaii.status_code == 200
    res_pt_hawaii_data = response_pt_hawaii.json()
    assert res_pt_hawaii_data["source"] == "backend_direct_point"
    assert res_pt_hawaii_data["coverage_status"] == "outside_grid_tile"
    assert res_pt_hawaii_data["fallback_attempted"] is True
    assert res_pt_hawaii_data["point"]["speed"] == 15.0
    assert res_pt_hawaii_data["is_forecast_authoritative"] is True
    assert res_pt_hawaii_data["is_estimated"] is False

def test_stage_6h2_requirements(tmp_path, monkeypatch):
    """
    Verify Stage 6H.2 SoCal GFS/ICON Marine Regional Grid Pilot specifications:
    - GFS/ICON marine ingestion generates region-aware filenames and manifest metadata.
    - Grid route tile selection matches the correct marine region by bbox.
    - Rectangular grid integrity is preserved.
    - Inside-tile marine point interpolation samples the grid file correctly.
    - Outside-tile provider point fallback resolves with proper schema (authoritative=True, source=provider_point_api, etc).
    - Unit consistency: raw values are meters (unit: "m") and display hint is "ft".
    - Unsupported ICON swell_2 is rejected or handled cleanly without fake fallback.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 1. Ingestion / Normalization test for GFS & ICON marine waves
    # Bbox for SoCal
    from services.weather_pipeline.scheduler import REGIONAL_CONFIGS
    socal_bbox = REGIONAL_CONFIGS["us_west_coast_socal"]
    times = ["2026-06-02T12:00:00Z"]
    
    mock_raw_gfs = [{
        "latitude": 34.0,
        "longitude": -118.0,
        "hourly_units": {
            "wave_height": "m",
            "wave_direction": "°",
            "wave_period": "s"
        },
        "hourly": {
            "time": times,
            "wave_height": [2.5],
            "wave_direction": [240.0],
            "wave_period": [12.0]
        }
    }]
    
    normalizer = WeatherNormalizer()
    run_dt = datetime.now(timezone.utc)
    target_dt = datetime.fromisoformat("2026-06-02T12:00:00+00:00")
    
    product_gfs = normalizer.normalize(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        raw_results=mock_raw_gfs,
        bbox=socal_bbox,
        resolution=1.0,
        target_time=target_dt,
        run_time=run_dt,
        region_id="us_west_coast_socal",
        coverage_mode="regional_tile"
    )
    
    assert product_gfs is not None
    assert product_gfs.region_id == "us_west_coast_socal"
    assert product_gfs.tile_id == "us_west_coast_socal"
    assert product_gfs.coverage_mode == "regional_tile"
    assert product_gfs.value_unit == "m"
    assert product_gfs.display_unit_hint == "ft"
    
    # Save product
    filename = temp_store.save_product(product_gfs, resolution=1.0)
    assert filename == "gfs_marine_waves_us_west_coast_socal_20260602T120000Z.json"
    
    # 2. Grid route tile selection & Rectangular integrity
    # Request SoCal grid waves
    response_grid = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-123,31,-117,37"
    )
    assert response_grid.status_code == 200
    grid_json = response_grid.json()
    assert grid_json["product_id"] == filename
    assert grid_json["grid"]["bounds"]["west"] == -123.0
    assert grid_json["grid"]["cols"] > 0
    # Rectangular integrity: cols * rows == vectors length
    assert len(grid_json["grid"]["vectors"]) == grid_json["grid"]["cols"] * grid_json["grid"]["rows"]
    
    # 3. Inside-tile point interpolation
    response_pt_inside = client.get(
        "/api/weather/point?model=GFS&domain=marine&layer=waves&lat=34.0&lng=-118.0&valid_time=2026-06-02T12:00:00Z"
    )
    assert response_pt_inside.status_code == 200
    pt_inside_json = response_pt_inside.json()
    assert pt_inside_json["source"] == "grid_file"
    assert pt_inside_json["coverage_status"] == "inside_regional_tile"
    assert pt_inside_json["point"]["speed"] == 2.5 # speed field contains wave height in meters
    assert pt_inside_json["value_unit"] == "m"
    assert pt_inside_json["display_unit_hint"] == "ft"
    
    # 4. Outside-tile point fallback
    # Mocking fetch_point to return successful Open-Meteo marine point payload
    async def mock_fetch_point_marine(self, model, domain, layer, lat, lng, *args, **kwargs):
        return {
            "latitude": lat,
            "longitude": lng,
            "hourly": {
                "time": ["2026-06-02T12:00:00Z"],
                "wave_height": [3.1],
                "wave_direction": [250.0],
                "wave_period": [14.0]
            }
        }
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point_marine)
    
    response_pt_outside = client.get(
        "/api/weather/point?model=GFS&domain=marine&layer=waves&lat=21.0&lng=-157.0&valid_time=2026-06-02T12:00:00Z"
    )
    assert response_pt_outside.status_code == 200
    pt_outside_json = response_pt_outside.json()
    assert pt_outside_json["source"] == "backend_direct_point"
    assert pt_outside_json["coverage_status"] == "outside_grid_tile"
    assert pt_outside_json["fallback_attempted"] is True
    assert pt_outside_json["is_forecast_authoritative"] is True
    assert pt_outside_json["is_estimated"] is False
    assert pt_outside_json["point"]["speed"] == 3.1 # wave height in meters
    assert pt_outside_json["point"]["period"] == 14.0
    assert pt_outside_json["value_unit"] == "m"
    assert pt_outside_json["display_unit_hint"] == "ft"
    
    # 5. Unsupported ICON swell_2 reject guard
    response_icon_swell2_grid = client.get(
        "/api/weather/grid?model=ICON&domain=marine&layer=swell_2&valid_time=2026-06-02T12:00:00Z"
    )
    assert response_icon_swell2_grid.status_code == 200
    icon_swell2_grid_json = response_icon_swell2_grid.json()
    assert icon_swell2_grid_json["status"] == "unsupported"
    assert icon_swell2_grid_json["grid"]["cols"] == 0
    assert len(icon_swell2_grid_json["grid"]["vectors"]) == 0
    
    response_icon_swell2_point = client.get(
        "/api/weather/point?model=ICON&domain=marine&layer=swell_2&lat=34.0&lng=-118.0&valid_time=2026-06-02T12:00:00Z"
    )
    assert response_icon_swell2_point.status_code == 200
    icon_swell2_point_json = response_icon_swell2_point.json()
    assert icon_swell2_point_json["status"] == "unsupported"
    assert icon_swell2_point_json["point"]["interpolation_method"] == "unsupported"


def test_client_diagnostics():
    """
    Test POST /api/weather/client-diagnostics endpoint.
    """
    payload = {
        "timestamp": "2026-06-14T18:00:00Z",
        "event_type": "TRUTH_VIOLATION_RASTER_OVERLAP",
        "model": "EURO",
        "layer": "waves",
        "timeOffset": 24.0,
        "fps": 58.0,
        "memory": 128.0,
        "correlationId": "test-cor-123",
        "details": {"hint": "Multiple raster families visible"}
    }
    
    response = client.post("/api/weather/client-diagnostics", json=payload)
    assert response.status_code == 200
    assert response.json()["status"] == "success"


def test_euro_regional_overlap_viewport(tmp_path, monkeypatch):
    """
    Verify that for EURO marine, a requested viewport that overlaps a regional tile
    but is not fully covered (e.g. going slightly outside) still uses the regional Copernicus tile
    and filters it, returning it as regional_partial instead of falling back to Open-Meteo.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0) # Florida East Coast
    valid_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    vectors = [
        GridVector(lat=24.0, lng=-85.0, speed=1.0, direction=90.0, u=-1.0, v=0.0, period=6.0),
        GridVector(lat=24.0, lng=-79.0, speed=2.0, direction=90.0, u=-2.0, v=0.0, period=6.0),
        GridVector(lat=31.0, lng=-85.0, speed=3.0, direction=90.0, u=-3.0, v=0.0, period=8.0),
        GridVector(lat=31.0, lng=-79.0, speed=4.0, direction=90.0, u=-4.0, v=0.0, period=8.0),
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=valid_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height", "wave_direction"],
        freshness_sec=1800,
        region_id="florida_east_coast",
        coverage_mode="regional_tile"
    )

    temp_store.save_product(product, resolution=6.0)

    # Bbox overlaps Florida but goes slightly outside (-86 to -78 longitude)
    response = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time=2026-06-01T21:00:00Z&bbox=-86,23,-78,32"
    )
    assert response.status_code == 200
    res_data = response.json()
    assert res_data["product_id"] == "euro_marine_waves_florida_east_coast_20260601T210000Z.json"
    assert res_data["is_estimated"] is False
    assert res_data["provider"] == "copernicus"


