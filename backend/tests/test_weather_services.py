import pytest
from datetime import datetime, timezone, timedelta
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

def test_gfs_all_marine_layers_normalization(tmp_path, monkeypatch):
    """
    Verify GFS Marine Ingestion, normalization, saving, and conformed point/grid endpoints.
    Checks waves, swell_1, swell_2, and wind_waves.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 2x2 grid for Florida East Coast
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [1.0], "wave_direction": [90.0], "wave_period": [10.0],
                "swell_wave_height": [0.8], "swell_wave_direction": [100.0], "swell_wave_period": [8.0],
                "secondary_swell_wave_height": [0.3], "secondary_swell_wave_direction": [110.0], "secondary_swell_wave_period": [6.0],
                "wind_wave_height": [0.5], "wind_wave_direction": [120.0], "wind_wave_period": [4.0]
            }
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [2.0], "wave_direction": [90.0], "wave_period": [10.0],
                "swell_wave_height": [1.6], "swell_wave_direction": [100.0], "swell_wave_period": [8.0],
                "secondary_swell_wave_height": [0.6], "secondary_swell_wave_direction": [110.0], "secondary_swell_wave_period": [6.0],
                "wind_wave_height": [1.0], "wind_wave_direction": [120.0], "wind_wave_period": [4.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [3.0], "wave_direction": [90.0], "wave_period": [12.0],
                "swell_wave_height": [2.4], "swell_wave_direction": [100.0], "swell_wave_period": [9.0],
                "secondary_swell_wave_height": [0.9], "secondary_swell_wave_direction": [110.0], "secondary_swell_wave_period": [7.0],
                "wind_wave_height": [1.5], "wind_wave_direction": [120.0], "wind_wave_period": [5.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "secondary_swell_wave_height": "m", "secondary_swell_wave_direction": "°", "secondary_swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [4.0], "wave_direction": [90.0], "wave_period": [12.0],
                "swell_wave_height": [3.2], "swell_wave_direction": [100.0], "swell_wave_period": [9.0],
                "secondary_swell_wave_height": [1.2], "secondary_swell_wave_direction": [110.0], "secondary_swell_wave_period": [7.0],
                "wind_wave_height": [2.0], "wind_wave_direction": [120.0], "wind_wave_period": [5.0]
            }
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    layers = ["waves", "swell_1", "swell_2", "wind_waves"]
    for layer in layers:
        product = normalizer.normalize(
            model="GFS",
            provider="open-meteo",
            domain="marine",
            layer=layer,
            raw_results=mock_results,
            bbox=bbox,
            resolution=6.0,
            target_time=target_dt
        )
        assert product is not None
        assert product.model == "GFS"
        assert product.layer == layer
        assert product.grid.cols == 2
        assert product.grid.rows == 2
        assert len(product.grid.vectors) == 4
        assert product.is_test_fixture is False

        # Save to temp store
        temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    for layer in layers:
        assert any(p["model"] == "GFS" and p["layer"] == layer and p["provider"] == "open-meteo" for p in manifest["products"])
        # Verify no test fixtures in manifest
        assert not any(p["is_test_fixture"] for p in manifest["products"])

    # 2. Query grid API for swell_1
    response_grid = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=swell_1&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "GFS"
    assert grid_payload["layer"] == "swell_1"
    assert "diagnostics" in grid_payload["grid"]
    diag = grid_payload["grid"]["diagnostics"]
    assert diag["gridMode"] == "rectangular"
    assert diag["cols"] == 2
    assert diag["rows"] == 2
    assert diag["vectors_length"] == 4

    # 3. Query point API inside the grid (bilinear interpolation) for swell_1
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=GFS&domain=marine&layer=swell_1&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0
    # Peak period omitted/zero behavior
    assert point_payload["point"]["period"] > 0.0

    # Verify point metadata propagation
    assert point_payload["source_dataset"] == "ncep_gfswave025"
    assert point_payload["source_variables"] == ["swell_wave_height", "swell_wave_direction", "swell_wave_period"]
    assert point_payload["is_test_fixture"] is False
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["is_estimated"] is False

def test_icon_marine_layers_normalization(tmp_path, monkeypatch):
    """
    Verify ICON Marine Ingestion, normalization, saving, conformed point/grid endpoints,
    and metadata properties mapping. Checks waves, swell_1, and wind_waves.
    """
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 2x2 grid for Florida East Coast
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [1.0], "wave_direction": [90.0], "wave_period": [10.0],
                "swell_wave_height": [0.8], "swell_wave_direction": [100.0], "swell_wave_period": [8.0],
                "wind_wave_height": [0.5], "wind_wave_direction": [120.0], "wind_wave_period": [4.0]
            }
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [2.0], "wave_direction": [90.0], "wave_period": [10.0],
                "swell_wave_height": [1.6], "swell_wave_direction": [100.0], "swell_wave_period": [8.0],
                "wind_wave_height": [1.0], "wind_wave_direction": [120.0], "wind_wave_period": [4.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [3.0], "wave_direction": [90.0], "wave_period": [12.0],
                "swell_wave_height": [2.4], "swell_wave_direction": [100.0], "swell_wave_period": [9.0],
                "wind_wave_height": [1.5], "wind_wave_direction": [120.0], "wind_wave_period": [5.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {
                "wave_height": "m", "wave_direction": "°", "wave_period": "s",
                "swell_wave_height": "m", "swell_wave_direction": "°", "swell_wave_period": "s",
                "wind_wave_height": "m", "wind_wave_direction": "°", "wind_wave_period": "s"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wave_height": [4.0], "wave_direction": [90.0], "wave_period": [12.0],
                "swell_wave_height": [3.2], "swell_wave_direction": [100.0], "swell_wave_period": [9.0],
                "wind_wave_height": [2.0], "wind_wave_direction": [120.0], "wind_wave_period": [5.0]
            }
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    layers = ["waves", "swell_1", "wind_waves"]
    for layer in layers:
        product = normalizer.normalize(
            model="ICON",
            provider="open-meteo",
            domain="marine",
            layer=layer,
            raw_results=mock_results,
            bbox=bbox,
            resolution=6.0,
            target_time=target_dt
        )
        assert product is not None
        assert product.model == "ICON"
        assert product.layer == layer
        assert product.grid.cols == 2
        assert product.grid.rows == 2
        assert len(product.grid.vectors) == 4
        assert product.is_test_fixture is False
        assert product.source_dataset == "dwd_gwam"
        assert product.upstream_provider == "open-meteo"
        assert product.upstream_model == "gwam"

        # Save to temp store
        temp_store.save_product(product, resolution=6.0)

    # 1. Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    for layer in layers:
        assert any(
            p["model"] == "ICON" and p["layer"] == layer and p["provider"] == "open-meteo" 
            and p["source_dataset"] == "dwd_gwam"
            and p["upstream_provider"] == "open-meteo"
            and p["upstream_model"] == "gwam"
            for p in manifest["products"]
        )

    # 2. Query grid API for swell_1
    response_grid = client.get(
        "/api/weather/grid?model=ICON&domain=marine&layer=swell_1&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "ICON"
    assert grid_payload["layer"] == "swell_1"
    assert grid_payload["upstream_provider"] == "open-meteo"
    assert grid_payload["upstream_model"] == "gwam"

    # 3. Query point API inside the grid (bilinear interpolation) for swell_1
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=ICON&domain=marine&layer=swell_1&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0
    assert point_payload["point"]["period"] > 0.0
    assert point_payload["source_dataset"] == "dwd_gwam"
    assert point_payload["upstream_provider"] == "open-meteo"
    assert point_payload["upstream_model"] == "gwam"

def test_icon_wind_normalization_and_endpoints(tmp_path, monkeypatch):
    """Verify that WeatherNormalizer parses and converts ICON wind variables, including gusts, and API endpoints function correctly with parity."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 2x2 grid for Florida East Coast
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [10.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [15.0]
            }
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [20.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [25.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [30.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [35.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [40.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [45.0]
            }
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="ICON",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "ICON"
    assert product.layer == "wind"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4
    assert product.is_test_fixture is False
    assert product.source_dataset == "dwd_icon"
    assert product.upstream_provider == "open-meteo"
    assert product.upstream_model == "dwd_icon"

    # Verify vector details
    v0 = product.grid.vectors[0]
    assert v0.speed == 10.0
    assert v0.direction == 90.0
    assert v0.gust == 15.0
    assert math.isclose(v0.u, -10.0, abs_tol=1e-4)
    assert math.isclose(v0.v, 0.0, abs_tol=1e-4)

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(
        p["model"] == "ICON" and p["layer"] == "wind" and p["domain"] == "wind" and p["provider"] == "open-meteo"
        for p in manifest["products"]
    )

    # Query grid API for ICON wind
    response_grid = client.get(
        "/api/weather/grid?model=ICON&domain=wind&layer=wind&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "ICON"
    assert grid_payload["layer"] == "wind"
    assert grid_payload["grid"]["vectors"][0]["gust"] == 15.0

    # Query point API inside the grid (bilinear interpolation) for ICON wind
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=ICON&domain=wind&layer=wind&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0
    assert point_payload["point"]["gust"] > 0.0

    # Verify point parity matches local bilinear sampling
    sampler = PointSampler()
    local_point_res = sampler.sample_point(product, lat, lng)
    assert math.isclose(point_payload["point"]["speed"], local_point_res.point.speed, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["gust"], local_point_res.point.gust, abs_tol=1e-4)

def test_euro_wind_normalization_and_endpoints(tmp_path, monkeypatch):
    """Verify that WeatherNormalizer parses and converts EURO wind variables, including gusts, and API endpoints function correctly with parity."""
    temp_store = ProductStore(cache_dir=tmp_path)
    from routes import weather
    monkeypatch.setattr(weather, "store", temp_store)

    # 2x2 grid for Florida East Coast
    mock_results = [
        {
            "latitude": 24.0, "longitude": -85.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [10.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [15.0]
            }
        },
        {
            "latitude": 24.0, "longitude": -79.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [20.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [25.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -85.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [30.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [35.0]
            }
        },
        {
            "latitude": 30.0, "longitude": -79.0,
            "hourly_units": {
                "wind_speed_10m": "kn", "wind_direction_10m": "°", "wind_gusts_10m": "kn"
            },
            "hourly": {
                "time": ["2026-06-01T21:00:00Z"],
                "wind_speed_10m": [40.0], "wind_direction_10m": [90.0], "wind_gusts_10m": [45.0]
            }
        }
    ]

    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -85.0, "south": 24.0, "east": -79.0, "north": 30.0}

    product = normalizer.normalize(
        model="EURO",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        raw_results=mock_results,
        bbox=bbox,
        resolution=6.0,
        target_time=target_dt
    )

    assert product is not None
    assert product.model == "EURO"
    assert product.layer == "wind"
    assert product.grid.cols == 2
    assert product.grid.rows == 2
    assert len(product.grid.vectors) == 4
    assert product.is_test_fixture is False
    assert product.source_dataset == "ecmwf_ifs"
    assert product.upstream_provider == "open-meteo"
    assert product.upstream_model == "ecmwf_ifs"

    # Verify vector details
    v0 = product.grid.vectors[0]
    assert v0.speed == 10.0
    assert v0.direction == 90.0
    assert v0.gust == 15.0
    assert math.isclose(v0.u, -10.0, abs_tol=1e-4)
    assert math.isclose(v0.v, 0.0, abs_tol=1e-4)

    # Save to temp store
    temp_store.save_product(product, resolution=6.0)

    # Query products manifest API
    response = client.get("/api/weather/products")
    assert response.status_code == 200
    manifest = response.json()
    assert any(
        p["model"] == "EURO" and p["layer"] == "wind" and p["domain"] == "wind" and p["provider"] == "open-meteo"
        for p in manifest["products"]
    )

    # Query grid API for EURO wind
    response_grid = client.get(
        "/api/weather/grid?model=EURO&domain=wind&layer=wind&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_grid.status_code == 200
    grid_payload = response_grid.json()
    assert grid_payload["model"] == "EURO"
    assert grid_payload["layer"] == "wind"
    assert grid_payload["grid"]["vectors"][0]["gust"] == 15.0

    # Query point API inside the grid (bilinear interpolation) for EURO wind
    lat, lng = 27.0, -82.0
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=wind&layer=wind&lat={lat}&lng={lng}&valid_time=2026-06-01T21:00:00Z"
    )
    assert response_point.status_code == 200
    point_payload = response_point.json()
    assert point_payload["is_forecast_authoritative"] is True
    assert point_payload["point"]["interpolation_method"] == "bilinear"
    assert point_payload["point"]["speed"] > 0.0
    assert point_payload["point"]["gust"] > 0.0

    # Verify point parity matches local bilinear sampling
    sampler = PointSampler()
    local_point_res = sampler.sample_point(product, lat, lng)
    assert math.isclose(point_payload["point"]["speed"], local_point_res.point.speed, abs_tol=1e-4)
    assert math.isclose(point_payload["point"]["gust"], local_point_res.point.gust, abs_tol=1e-4)


def test_save_products_batch(tmp_path):
    """
    Test save_products_batch in ProductStore and verify that multiple
    products are saved, duplicates are updated/overwritten, and manifest is written once.
    """
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
    from datetime import datetime, timezone
    
    store = ProductStore(cache_dir=tmp_path)
    
    bounds = CoverageBounds(west=-80.0, south=24.0, east=-79.0, north=25.0)
    vectors = [GridVector(lat=24.0, lng=-80.0, speed=10.0, direction=90.0, u=-10.0, v=0.0)]
    grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=vectors)
    
    product1 = NormalizedProduct(
        model="GFS",
        provider="test-fixture",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.fromisoformat("2026-06-01T12:00:00+00:00"),
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
    
    product2 = NormalizedProduct(
        model="GFS",
        provider="test-fixture",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.fromisoformat("2026-06-01T15:00:00+00:00"),
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
    
    # Batch save products
    count = store.save_products_batch([(product1, 1.0), (product2, 1.0)])
    assert count == 2
    
    # Verify both files exist
    manifest = store.get_manifest()
    assert len(manifest.products) == 2
    filenames = {p.filename for p in manifest.products}
    assert any("20260601T120000Z" in f for f in filenames)
    assert any("20260601T150000Z" in f for f in filenames)
    
    # Save a duplicate for the first product to verify overwrite / slice filtering
    product1_new = NormalizedProduct(
        model="GFS",
        provider="test-fixture",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=datetime.fromisoformat("2026-06-01T12:00:00+00:00"),
        is_forecast_authoritative=True,
        is_estimated=True,  # Changed to estimated to distinguish
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height"],
        freshness_sec=1800
    )
    
    count2 = store.save_products_batch([(product1_new, 1.0)])
    assert count2 == 1
    
    # Verify manifest still has 2 products and the duplicate was replaced
    manifest2 = store.get_manifest()
    assert len(manifest2.products) == 2
    
    replaced_product = next(p for p in manifest2.products if "20260601T120000Z" in p.filename)
    assert replaced_product.is_estimated is True
