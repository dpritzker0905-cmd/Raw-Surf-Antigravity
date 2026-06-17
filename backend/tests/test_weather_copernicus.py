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


def test_copernicus_provider_normalization_and_endpoints(tmp_path, monkeypatch):
    """
    Test Copernicus provider normalization, product saving, and grid/point endpoints.
    Verifies that the normalized Copernicus product is saved, listed in manifest,
    and queried correctly via grid and point endpoints.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # Mock fetch_euro_marine to return target valid time to prevent temporal drift 404s in fallback paths
    from services import copernicus_marine_service
    async def mock_fetch_euro_marine(latitudes, longitudes, forecast_days=3, variables=None):
        lat, lng = latitudes[0], longitudes[0]
        if 24.0 <= lat <= 30.0 and -85.0 <= lng <= -79.0:
            return [
                {
                    "latitude": lat,
                    "longitude": lng,
                    "hourly_units": {v: "m" if "height" in v else ("°" if "direction" in v else "s") for v in (variables or [])},
                    "hourly": {
                        "time": ["2026-06-01T21:00:00Z"],
                        **{v: [2.0 if "height" in v else (45.0 if "direction" in v else 6.0)] for v in (variables or [])}
                    }
                }
            ]
        raise ValueError("Out of bounds")
    monkeypatch.setattr(copernicus_marine_service, "fetch_euro_marine", mock_fetch_euro_marine)

    # Mock OpenMeteoProvider.fetch_point for the GFS fallback path
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    async def mock_fetch_point(self, model, domain, layer, lat, lng, forecast_days=2):
        if model.upper() == "GFS" and layer == "swell_1":
            return {
                "latitude": lat,
                "longitude": lng,
                "hourly": {
                    "time": ["2026-06-01T21:00:00Z"],
                    "swell_wave_height": [2.0],
                    "swell_wave_direction": [45.0],
                    "swell_wave_period": [6.0]
                }
            }
        raise ValueError("Unsupported mock point model/layer")
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point)

    # Mock Copernicus fetcher results for 2x2 grid
    # Bbox: west=-85, south=24, east=-79, north=30
    # Resolution 6.0 yields lats: [24.0, 30.0], lons: [-85.0, -79.0]
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {"swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "swell_wave_height": [1.0], "swell_wave_direction": [45.0], "swell_wave_period": [6.0]}
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {"swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "swell_wave_height": [2.0], "swell_wave_direction": [45.0], "swell_wave_period": [6.0]}
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {"swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "swell_wave_height": [3.0], "swell_wave_direction": [45.0], "swell_wave_period": [8.0]}
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {"swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "swell_wave_height": [4.0], "swell_wave_direction": [45.0], "swell_wave_period": [8.0]}
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_1",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "EURO"
    assert product.layer == "swell_1"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(p["model"] == "EURO" and p["layer"] == "swell_1" for p in manifest["products"])

    # 2. Query grid API
    response_grid = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=swell_1&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "EURO"
    assert grid_payload["layer"] == "swell_1"

    # 3. Query point API inside the grid (bilinear interpolation)
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=swell_1&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0

    # 4. Query point API outside grid boundaries
    response_point_outside = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=swell_1&lat=35.0&lng=-90.0&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point_outside.status_code == 200
    point_outside_payload = response_point_outside.json()
    assert point_outside_payload["is_estimated"] is True
    assert point_outside_payload["is_forecast_authoritative"] is False
    assert point_outside_payload["point"]["interpolation_method"] == "direct_point_api"

    # Verify grid diagnostics and metadata presence
    assert "diagnostics" in grid_payload["grid"]
    diag = grid_payload["grid"]["diagnostics"]
    assert diag["gridMode"] == "rectangular"
    assert diag["cols"] == 2
    assert diag["rows"] == 2
    assert diag["vectors_length"] == 4
    assert diag["expectedCellCount"] == 4
    assert diag["missingCellCount"] == 0

    # Verify point metadata propagation
    assert point_payload["source_dataset"] == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    assert point_payload["source_variables"] == ["VHM0_SW1", "VMDR_SW1", "VTM01_SW1"]
    assert point_payload["is_test_fixture"] is False
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["is_estimated"] is False


def test_copernicus_provider_normalization_and_endpoints_swell_2(tmp_path, monkeypatch):
    """
    Verify Copernicus Swell 2 normalization, product saving, and grid/point endpoints.
    Verifies that the secondary swell wave variables (VHM0_SW2, VMDR_SW2, VTM01_SW2) are
    mapped, normalized, saved, and queried correctly with conformed metadata.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # Mock Copernicus fetcher results for 2x2 grid for Swell 2
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {"secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "secondary_swell_wave_height": [1.5], "secondary_swell_wave_direction": [90.0], "secondary_swell_wave_period": [7.0]}
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {"secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "secondary_swell_wave_height": [2.5], "secondary_swell_wave_direction": [90.0], "secondary_swell_wave_period": [7.0]}
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {"secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "secondary_swell_wave_height": [3.5], "secondary_swell_wave_direction": [90.0], "secondary_swell_wave_period": [9.0]}
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {"secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "secondary_swell_wave_height": [4.5], "secondary_swell_wave_direction": [90.0], "secondary_swell_wave_period": [9.0]}
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_2",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "EURO"
    assert product.layer == "swell_2"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(p["model"] == "EURO" and p["layer"] == "swell_2" for p in manifest["products"])

    # 2. Query grid API
    response_grid = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=swell_2&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "EURO"
    assert grid_payload["layer"] == "swell_2"

    # 3. Query point API inside the grid (bilinear interpolation)
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=swell_2&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0

    # Verify grid diagnostics and metadata presence
    assert "diagnostics" in grid_payload["grid"]
    diag = grid_payload["grid"]["diagnostics"]
    assert diag["gridMode"] == "rectangular"
    assert diag["cols"] == 2
    assert diag["rows"] == 2
    assert diag["vectors_length"] == 4
    assert diag["expectedCellCount"] == 4
    assert diag["missingCellCount"] == 0

    # Verify point metadata propagation
    assert point_payload["source_dataset"] == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    assert point_payload["source_variables"] == ["VHM0_SW2", "VMDR_SW2", "VTM01_SW2"]
    assert point_payload["is_test_fixture"] is False
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["is_estimated"] is False


def test_copernicus_direction_to_uv_convention():
    """
    Verify that WeatherNormalizer translates meteorological wave directions FROM
    into correct Cartesian advection velocities (TOWARD directions) expected by
    the WebGL marine particle engine.
    """
    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -80.0, "south": 24.0, "east": -79.0, "north": 25.0}

    # Test cases: speed=2.0, direction in degrees (meteorological FROM direction)
    # expected u and v (Cartesian travel direction, +u=Eastward, +v=Northward)
    test_cases = [
        # 0 degrees: coming FROM North -> traveling South (u=0, v=-2.0)
        {"direction": 0.0, "expected_u": 0.0, "expected_v": -2.0},
        # 90 degrees: coming FROM East -> traveling West (u=-2.0, v=0)
        {"direction": 90.0, "expected_u": -2.0, "expected_v": 0.0},
        # 180 degrees: coming FROM South -> traveling North (u=0, v=2.0)
        {"direction": 180.0, "expected_u": 0.0, "expected_v": 2.0},
        # 270 degrees: coming FROM West -> traveling East (u=2.0, v=0)
        {"direction": 270.0, "expected_u": 2.0, "expected_v": 0.0},
    ]

    for tc in test_cases:
        mock_results = [
            {
                "latitude": 24.0, "longitude": -80.0,
                "hourly_units": {"wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"},
                "hourly": {"time": ["2026-06-01T21:00:00Z"], "wind_wave_height": [2.0], "wind_wave_direction": [tc["direction"]], "wind_wave_period": [5.0]}
            }
        ]

        product = normalizer.normalize(
            model="EURO",
            provider="copernicus",
            domain="marine",
            layer="wind_waves",
            raw_results=mock_results,
            bbox=bbox,
            resolution=1.0,
            target_time=target_dt
        )

        assert product is not None
        v = product.grid.vectors[0]
        # Match with small tolerance for floating point precision of sin/cos
        assert math.isclose(v.u, tc["expected_u"], abs_tol=1e-4)
        assert math.isclose(v.v, tc["expected_v"], abs_tol=1e-4)


def test_copernicus_provider_normalization_and_endpoints_wind_waves(tmp_path, monkeypatch):
    """
    Verify Copernicus Wind Waves normalization, product saving, and grid/point endpoints.
    Verifies that the wind wave variables (VHM0_WW, VMDR_WW, VTM01_WW) are
    mapped, normalized, saved, and queried correctly with conformed metadata.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # Mock Copernicus fetcher results for 2x2 grid for Wind Waves
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {"wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wind_wave_height": [1.5], "wind_wave_direction": [180.0], "wind_wave_period": [5.0]}
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {"wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wind_wave_height": [2.5], "wind_wave_direction": [180.0], "wind_wave_period": [5.0]}
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {"wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wind_wave_height": [3.5], "wind_wave_direction": [180.0], "wind_wave_period": [7.0]}
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {"wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wind_wave_height": [4.5], "wind_wave_direction": [180.0], "wind_wave_period": [7.0]}
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="wind_waves",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "EURO"
    assert product.layer == "wind_waves"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(p["model"] == "EURO" and p["layer"] == "wind_waves" for p in manifest["products"])

    # 2. Query grid API
    response_grid = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=wind_waves&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "EURO"
    assert grid_payload["layer"] == "wind_waves"

    # 3. Query point API inside the grid (bilinear interpolation)
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=wind_waves&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0

    # Verify grid diagnostics and metadata presence
    assert "diagnostics" in grid_payload["grid"]
    diag = grid_payload["grid"]["diagnostics"]
    assert diag["gridMode"] == "rectangular"
    assert diag["cols"] == 2
    assert diag["rows"] == 2
    assert diag["vectors_length"] == 4
    assert diag["expectedCellCount"] == 4
    assert diag["missingCellCount"] == 0

    # Verify point metadata propagation
    assert point_payload["source_dataset"] == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    assert point_payload["source_variables"] == ["VHM0_WW", "VMDR_WW", "VTM01_WW"]
    assert point_payload["is_test_fixture"] is False
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["is_estimated"] is False


def test_point_sampler_bilinear_ocean_masked():
    """Verify Option A bilinear_ocean_masked interpolation when 2-3 corners are valid ocean points."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    
    # 2 valid ocean corners: (24.0, -80.0) -> speed=10.0 and (25.0, -79.0) -> speed=40.0
    # 2 land/zero corners: (24.0, -79.0) -> speed=0.0 and (25.0, -80.0) -> speed=0.0
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=10.0, direction=90.0, u=-10.0, v=0.0, period=5.0),
        GridVector(lat=24.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-79.0, speed=40.0, direction=90.0, u=-40.0, v=0.0, period=8.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_1",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["VHM0_SW1"],
        freshness_sec=1800,
        source_dataset="cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    )

    sampler = PointSampler()

    # Sample in center (24.5, -79.5)
    res = sampler.sample_point(product, 24.5, -79.5)
    assert res.point.interpolation_method == "bilinear_ocean_masked"
    assert math.isclose(res.point.speed, 25.0, abs_tol=1e-4)
    assert math.isclose(res.point.u, -25.0, abs_tol=1e-4)
    assert res.point.period == 6.5
    assert res.source_dataset == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"


def test_point_sampler_nearest_ocean_fallback():
    """Verify Option A falls back to nearest ocean point when < 2 corners are valid ocean points."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    
    # Only 1 valid ocean corner: (24.0, -80.0) -> speed=10.0
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=10.0, direction=90.0, u=-10.0, v=0.0, period=5.0),
        GridVector(lat=24.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_1",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["VHM0_SW1"],
        freshness_sec=1800
    )

    sampler = PointSampler()

    res = sampler.sample_point(product, 24.5, -79.5)
    assert res.point.interpolation_method == "nearest_ocean_fallback"
    assert res.point.speed == 10.0
    assert res.point.sampled_lat == 24.0
    assert res.point.sampled_lng == -80.0


def test_point_sampler_unavailable_no_ocean_data():
    """Verify Option A returns unavailable when no valid ocean vectors exist at all in the grid."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    
    # All 4 corners are land/zero.
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=24.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_1",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["VHM0_SW1"],
        freshness_sec=1800
    )

    sampler = PointSampler()

    res = sampler.sample_point(product, 24.5, -79.5)
    assert res.point.interpolation_method == "unavailable"
    assert res.point.speed == 0.0


def test_point_sampler_unavailable_inland_with_coastal_ocean():
    """Verify Option A returns unavailable when 0 valid corners exist, even if other grid points have ocean data."""
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-78.0, north=25.0)
    
    vectors = [
        GridVector(lat=24.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=24.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=24.0, lng=-78.0, speed=12.0, direction=90.0, u=-12.0, v=0.0, period=6.0),
        GridVector(lat=25.0, lng=-80.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-79.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
        GridVector(lat=25.0, lng=-78.0, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0),
    ]

    grid = NormalizedGrid(bounds=bounds, cols=3, rows=2, vectors=vectors)
    product = NormalizedProduct(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="swell_1",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["VHM0_SW1"],
        freshness_sec=1800
    )

    sampler = PointSampler()

    res = sampler.sample_point(product, 24.5, -79.5)
    assert res.point.interpolation_method == "unavailable"
    assert res.point.speed == 0.0


def test_copernicus_provider_normalization_and_endpoints_waves(tmp_path, monkeypatch):
    """
    Verify Copernicus base Waves normalization, product saving, and grid/point endpoints.
    
    Guardrail 1: Period semantics proof
    - VTM10 represents the Mean Spectral Wave Period Tm-1,0 (calculated from the inverse-frequency
      moment of the variance spectral density). It is NOT peak wave period (which is VTPK).
      The API normalizes this to 'wave_period' under conformed schema. The frontend must label
      this generically as 'Period' or 'Mean Wave Period' and NOT 'Peak Period' in the UI.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # Mock Copernicus fetcher results for 2x2 grid for base Waves (VHM0, VMDR, VTM10)
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [1.5], "wave_direction": [180.0], "wave_period": [8.0]}
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [2.5], "wave_direction": [180.0], "wave_period": [8.0]}
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [3.5], "wave_direction": [180.0], "wave_period": [10.0]}
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
            "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [4.5], "wave_direction": [180.0], "wave_period": [10.0]}
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="EURO",
        provider="copernicus",
        domain="marine",
        layer="waves",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "EURO"
    assert product.layer == "waves"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(p["model"] == "EURO" and p["layer"] == "waves" for p in manifest["products"])

    # 2. Query grid API
    response_grid = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "EURO"
    assert grid_payload["layer"] == "waves"

    # 3. Query point API inside the grid (bilinear interpolation)
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=waves&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0

    # Verify grid diagnostics and metadata presence
    assert "diagnostics" in grid_payload["grid"]
    diag = grid_payload["grid"]["diagnostics"]
    assert diag["gridMode"] == "rectangular"
    assert diag["cols"] == 2
    assert diag["rows"] == 2
    assert diag["vectors_length"] == 4
    assert diag["expectedCellCount"] == 4
    assert diag["missingCellCount"] == 0

    # Verify point metadata propagation
    assert point_payload["source_dataset"] == "cmems_mod_glo_wav_anfc_0.083deg_PT3H-i"
    assert point_payload["source_variables"] == ["VHM0", "VMDR", "VTM10"]
    assert point_payload["is_test_fixture"] is False
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["is_estimated"] is False


def test_euro_point_fallback_to_gfs(mock_weather_setup, monkeypatch):
    """
    Verify that when querying a EURO marine point forecast (e.g. swell_1) and 
    Copernicus native fetch fails/is unavailable, it successfully falls back 
    to GFS point data and returns is_estimated=True and provider="gfs_estimated_fallback".
    """
    store, dynamic_idx = mock_weather_setup

    # Mock fetch_euro_marine to raise an exception, simulating no coverage or auth failure
    from services import copernicus_marine_service
    async def mock_fail_fetch_euro_marine(*args, **kwargs):
        raise Exception("Simulated Copernicus fetch failure")
    monkeypatch.setattr(copernicus_marine_service, "fetch_euro_marine", mock_fail_fetch_euro_marine)

    # Enhance mock_fetch_point in OpenMeteoProvider to support swell_1
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    original_fetch_point = OpenMeteoProvider.fetch_point
    async def mock_fetch_point_extended(self, model, domain, layer, lat, lng, forecast_days=2):
        if model.upper() == "GFS" and layer == "swell_1":
            return {
                "latitude": lat,
                "longitude": lng,
                "hourly": {
                    "time": ["2026-06-02T12:00:00Z"],
                    "swell_wave_height": [2.2],
                    "swell_wave_direction": [165.0],
                    "swell_wave_period": [9.5]
                }
            }
        # Fall back to conftest's mock_fetch_point if any
        return await original_fetch_point(self, model, domain, layer, lat, lng, forecast_days)

    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point_extended)

    # Query point API for EURO swell_1
    response = client.get(
        "/api/weather/point?model=EURO&domain=marine&layer=swell_1&lat=28.29&lng=-80.61&valid_time=2026-06-02T12:00:00Z"
    )
    assert response.status_code == 200
    payload = response.json()

    # Assert GFS fallback metadata
    assert payload["model"] == "EURO"
    assert payload["provider"] == "gfs_estimated_fallback"
    assert payload["upstream_provider"] == "gfs_estimated_fallback"
    assert payload["is_forecast_authoritative"] is False
    assert payload["is_estimated"] is True
    assert payload["fallback_attempted"] is True
    assert payload["fallback_reason"] == "copernicus_missing_fallback"
    assert payload["upstream_model"] == "ncep_gfswave025"

    # Assert conformed values
    assert payload["point"]["speed"] == 2.2
    assert payload["point"]["direction"] == 165.0
    assert payload["point"]["period"] == 9.5


