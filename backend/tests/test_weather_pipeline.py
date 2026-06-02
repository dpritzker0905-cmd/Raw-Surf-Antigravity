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

@pytest.fixture
def clean_store(tmp_path):
    """Fixture providing a ProductStore with a temporary directory."""
    return ProductStore(cache_dir=tmp_path)

def test_weather_normalizer_find_closest_time_index():
    """Verify that closest time index calculations are bounded correctly within 3 hours."""
    times = [
        "2026-06-01T12:00:00Z",
        "2026-06-01T15:00:00Z",
        "2026-06-01T18:00:00Z"
    ]
    normalizer = WeatherNormalizer()

    # Exact match
    target_dt = datetime.fromisoformat("2026-06-01T15:00:00+00:00")
    idx = normalizer.find_closest_time_index(times, target_dt)
    assert idx == 1

    # Within 3 hours boundary (1h delta)
    target_dt_near = datetime.fromisoformat("2026-06-01T16:00:00+00:00")
    idx_near = normalizer.find_closest_time_index(times, target_dt_near)
    assert idx_near == 1

    # Outside 3 hours boundary (4h delta)
    target_dt_far = datetime.fromisoformat("2026-06-01T22:00:00+00:00")
    idx_far = normalizer.find_closest_time_index(times, target_dt_far)
    assert idx_far is None

def test_weather_normalizer_uv_conversion():
    """Prove that normalizer maps raw speed/direction to Cartesian wind U/V components correctly."""
    normalizer = WeatherNormalizer()
    raw_results = [
        {
            "latitude": 27.5,
            "longitude": -80.0,
            "hourly_units": {
                "wave_height": "m",
                "wave_direction": "°",
                "wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T15:00:00Z"],
                "wave_height": [2.5],
                "wave_direction": [90.0],
                "wave_period": [8.0]
            }
        }
    ]

    target_dt = datetime.fromisoformat("2026-06-01T15:00:00+00:00")
    product = normalizer.normalize(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        raw_results=raw_results,
        bbox={"west": -80.0, "south": 27.5, "east": -80.0, "north": 27.5},
        resolution=0.25,
        target_time=target_dt
    )

    assert product is not None
    assert product.grid is not None
    assert len(product.grid.vectors) == 1
    
    vec = product.grid.vectors[0]
    assert vec.speed == 2.5
    assert vec.direction == 90.0
    
    # 90 degrees means blowing FROM east (direction of movement is blowing West)
    # So U (zonal movement) should be negative (-2.5) and V (meridional) should be 0.
    assert math.isclose(vec.u, -2.5, abs_tol=1e-4)
    assert math.isclose(vec.v, 0.0, abs_tol=1e-4)
    assert vec.period == 8.0

def test_point_sampler_bilinear_interpolation():
    """Verify point sampling bilinear interpolation math over a 2x2 grid cell."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    
    # Set known vectors at 4 grid corners
    # (24.0, -80.0) -> speed=10.0, dir=90.0 (u=-10.0, v=0.0)
    # (24.0, -79.0) -> speed=20.0, dir=90.0 (u=-20.0, v=0.0)
    # (25.0, -80.0) -> speed=30.0, dir=90.0 (u=-30.0, v=0.0)
    # (25.0, -79.0) -> speed=40.0, dir=90.0 (u=-40.0, v=0.0)
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=10.0, direction=90.0, u=-10.0, v=0.0, period=5.0),
        GridVector(lat=24.0, lng=-79.0, speed=20.0, direction=90.0, u=-20.0, v=0.0, period=6.0),
        GridVector(lat=25.0, lng=-80.0, speed=30.0, direction=90.0, u=-30.0, v=0.0, period=7.0),
        GridVector(lat=25.0, lng=-79.0, speed=40.0, direction=90.0, u=-40.0, v=0.0, period=8.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
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

    sampler = PointSampler()

    # Exact match on corner (24.0, -80.0)
    res_exact = sampler.sample_point(product, 24.0, -80.0)
    assert res_exact.point.interpolation_method == "exact_match"
    assert res_exact.point.speed == 10.0
    assert res_exact.point.period == 5.0

    # Bilinear sample exactly in the center (24.5, -79.5)
    res_center = sampler.sample_point(product, 24.5, -79.5)
    assert res_center.point.interpolation_method == "bilinear"
    # Average of -10, -20, -30, -40 is -25.0
    assert math.isclose(res_center.point.u, -25.0, abs_tol=1e-4)
    assert math.isclose(res_center.point.v, 0.0, abs_tol=1e-4)
    assert res_center.point.speed == 25.0
    assert res_center.point.direction == 90.0
    assert res_center.point.period == 6.5

def test_point_sampler_out_of_bounds():
    """Verify out-of-bounds requests are protected and marked is_estimated=True."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=10.0, direction=90.0, u=-10.0, v=0.0)
    ]
    grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=vectors)
    product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height"],
        freshness_sec=1800
    )

    sampler = PointSampler()
    
    # Request coordinate outside grid boundaries
    res = sampler.sample_point(product, 32.0, -90.0)
    assert res.is_estimated is True
    assert res.is_forecast_authoritative is False
    assert res.point.speed == 0.0
    assert "Requested point falls outside the authoritative grid boundaries" in res.warnings

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

def test_weather_normalizer_wind_knots_conversion():
    """Prove that normalizer converts wind speed to knots if raw speed is in other units."""
    normalizer = WeatherNormalizer()
    raw_results = [
        {
            "latitude": 27.5,
            "longitude": -80.0,
            "hourly_units": {
                "wind_speed_10m": "km/h",
                "wind_direction_10m": "°"
            },
            "hourly": {
                "time": ["2026-06-01T15:00:00Z"],
                "wind_speed_10m": [36.0], # 36 km/h
                "wind_direction_10m": [180.0] # Blowing FROM South TO North
            }
        }
    ]

    target_dt = datetime.fromisoformat("2026-06-01T15:00:00+00:00")
    product = normalizer.normalize(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        raw_results=raw_results,
        bbox={"west": -80.0, "south": 27.5, "east": -80.0, "north": 27.5},
        resolution=0.25,
        target_time=target_dt
    )

    assert product is not None
    assert product.grid is not None
    assert len(product.grid.vectors) == 1
    
    vec = product.grid.vectors[0]
    expected_kn = 36.0 * 0.539957
    assert math.isclose(vec.speed, expected_kn, abs_tol=1e-4)
    assert vec.direction == 180.0
    
    assert math.isclose(vec.u, 0.0, abs_tol=1e-4)
    assert math.isclose(vec.v, expected_kn, abs_tol=1e-4)

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
