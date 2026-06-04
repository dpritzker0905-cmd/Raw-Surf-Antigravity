import pytest
from datetime import datetime, timezone
from fastapi.testclient import TestClient
from services.weather_pipeline.schemas import GridVector, NormalizedPointDetail, CoverageBounds, NormalizedGrid
from services.weather_pipeline.normalizer import WeatherNormalizer
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.store import ProductStore
from server import app

client = TestClient(app)

def test_pressure_schemas_allow_optional_vectors():
    # Test GridVector allows scalar values and defaults vector fields to 0.0
    gv = GridVector(lat=25.0, lng=-80.0, value=1013.2)
    assert gv.value == 1013.2
    assert gv.speed == 0.0
    assert gv.direction == 0.0
    assert gv.u == 0.0
    assert gv.v == 0.0

    # Test NormalizedPointDetail allows scalar values
    npd = NormalizedPointDetail(
        requested_lat=25.0, requested_lng=-80.0,
        sampled_lat=25.0, sampled_lng=-80.0,
        value=1012.8, interpolation_method="exact_match"
    )
    assert npd.value == 1012.8
    assert npd.speed == 0.0
    assert npd.direction == 0.0
    assert npd.u == 0.0
    assert npd.v == 0.0

def test_pressure_normalization():
    normalizer = WeatherNormalizer()
    raw_results = [{
        "latitude": 28.0,
        "longitude": -80.0,
        "hourly_units": {
            "pressure_msl": "hPa"
        },
        "hourly": {
            "time": ["2026-06-04T12:00:00Z"],
            "pressure_msl": [1015.4]
        }
    }]
    bbox = {"west": -80.0, "south": 28.0, "east": -80.0, "north": 28.0}
    target_time = datetime.fromisoformat("2026-06-04T12:00:00+00:00")
    
    for model in ["GFS", "ICON", "EURO"]:
        product = normalizer.normalize(
            model=model,
            provider="open-meteo",
            domain="weather",
            layer="pressure",
            raw_results=raw_results,
            bbox=bbox,
            resolution=0.25,
            target_time=target_time
        )
        
        assert product is not None
        assert product.model == model.upper()
        assert product.domain == "weather"
        assert product.layer == "pressure"
        assert product.value_kind == "pressure"
        assert product.value_unit == "hPa"
        assert product.grid.cols == 1
        assert product.grid.rows == 1
        assert len(product.grid.vectors) == 1
        
        vec = product.grid.vectors[0]
        assert vec.value == 1015.4
        assert vec.speed == 0.0
        assert vec.direction == 0.0
        assert vec.u == 0.0
        assert vec.v == 0.0

def test_point_sampler_pressure_interpolation():
    sampler = PointSampler()
    
    # Setup a mock rectangular 2x2 pressure grid
    # lat0=-80, lat1=-79, lon0=25, lon1=26
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-79.0, north=26.0)
    
    vectors = [
        GridVector(lat=25.0, lng=-80.0, value=1010.0), # bottom-left
        GridVector(lat=25.0, lng=-79.0, value=1012.0), # bottom-right
        GridVector(lat=26.0, lng=-80.0, value=1014.0), # top-left
        GridVector(lat=26.0, lng=-79.0, value=1016.0), # top-right
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    
    from services.weather_pipeline.schemas import NormalizedProduct
    product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="weather",
        layer="pressure",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="pressure",
        value_unit="hPa",
        display_unit_hint="hPa",
        source_variables=["pressure_msl"],
        freshness_sec=1800
    )
    
    # 1. Exact match test
    res_exact = sampler.sample_point(product, 25.0, -80.0)
    assert res_exact.point.value == 1010.0
    assert res_exact.point.interpolation_method == "exact_match"
    
    # 2. Bilinear interpolation test (midpoint 25.5, -79.5)
    # Expected value is average of all 4 corners: (1010 + 1012 + 1014 + 1016) / 4 = 1013.0
    res_bilinear = sampler.sample_point(product, 25.5, -79.5)
    assert res_bilinear.point.value == 1013.0
    assert res_bilinear.point.interpolation_method == "bilinear_scalar"

    # 3. Out of bounds test
    res_oob = sampler.sample_point(product, 30.0, -80.0)
    assert res_oob.point.value is None
    assert "Requested point falls outside the authoritative grid boundaries" in res_oob.warnings
    assert res_oob.point.interpolation_method == "out_of_bounds_fallback"

def test_weather_endpoints_validation():
    # Admin header setup
    headers = {"X-Admin-Key": "test_admin_key"}
    
    for model in ["GFS", "ICON", "EURO"]:
        # Test valid query routes for weather pressure in fastapi router
        # Note: we expect a 404 since products aren't ingested yet for 2050,
        # but it should pass the regex validation (regex error returns 422)
        response_grid = client.get(f"/api/weather/grid?model={model}&domain=weather&layer=pressure&valid_time=2050-06-04T12:00:00Z")
        assert response_grid.status_code == 404
        assert response_grid.json()["reason"] == "no_backend_coverage" if model != "EURO" else "no_copernicus_coverage"
        
        response_point = client.get(f"/api/weather/point?model={model}&domain=weather&layer=pressure&lat=28.36&lng=-80.60&valid_time=2050-06-04T12:00:00Z")
        assert response_point.status_code == 404
        assert response_point.json()["reason"] == "no_backend_coverage" if model != "EURO" else "no_copernicus_coverage"

def test_pressure_test_fixture_guard(monkeypatch):
    monkeypatch.setenv("NODE_ENV", "production")
    monkeypatch.setenv("LOCAL_TEST_FIXTURE", "")
    
    store = ProductStore()
    
    from services.weather_pipeline.schemas import CoverageBounds, NormalizedGrid, NormalizedProduct
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-79.0, north=26.0)
    grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=[])
    
    product = NormalizedProduct(
        model="GFS",
        provider="test-fixture",
        domain="weather",
        layer="pressure",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=False,
        is_estimated=True,
        coverage=bounds,
        grid=grid,
        value_kind="pressure",
        value_unit="hPa",
        display_unit_hint="hPa",
        source_variables=["pressure_msl"],
        freshness_sec=1800,
        is_test_fixture=True
    )
    
    result = store.save_product(product)
    assert result is None

