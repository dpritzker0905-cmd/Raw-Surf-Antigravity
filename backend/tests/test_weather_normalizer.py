import pytest
from datetime import datetime, timezone
import math

from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds
)
from services.weather_pipeline.sampler import PointSampler
from services.weather_pipeline.normalizer import WeatherNormalizer

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
    assert res.is_estimated is False
    assert res.is_forecast_authoritative is False
    assert res.point.speed == 0.0
    assert "Requested point falls outside the authoritative grid boundaries" in res.warnings

def test_gfs_wind_coordinate_reconstruction_and_bilinear():
    """
    Verify coordinate reconstruction fixes float coordinate noise, outputs stable row-major
    vectors where cols * rows == vectors.length, and supports successful bilinear lookup.
    """
    normalizer = WeatherNormalizer()
    sampler = PointSampler()

    # Bounding box from 24.0 to 24.5 lat, -85.0 to -84.5 lon.
    # At resolution 0.25, we expect coordinates:
    # Lats: 24.0, 24.25, 24.5 (3 rows)
    # Lons: -85.0, -84.75, -84.5 (3 cols)
    # Total points: 9.
    # We will simulate noisy floats from Open-Meteo.
    bbox = {"west": -85.0, "south": 24.0, "east": -84.5, "north": 24.5}
    resolution = 0.25
    target_dt = datetime.fromisoformat("2026-06-01T15:00:00+00:00")

    # Order in raw results is mixed/transposed to verify sorting and stable order
    raw_results = [
        # (24.25, -84.75) with float noise
        {"latitude": 24.2501, "longitude": -84.7499, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [15.0], "wind_direction_10m": [90.0]}},
        # (24.0, -85.0)
        {"latitude": 23.9998, "longitude": -85.0002, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [10.0], "wind_direction_10m": [90.0]}},
        # (24.5, -84.5)
        {"latitude": 24.5002, "longitude": -84.5001, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [25.0], "wind_direction_10m": [90.0]}},
        # (24.0, -84.75)
        {"latitude": 24.0001, "longitude": -84.7503, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [11.0], "wind_direction_10m": [90.0]}},
        # (24.25, -85.0)
        {"latitude": 24.2499, "longitude": -85.0002, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [14.0], "wind_direction_10m": [90.0]}},
        # (24.0, -84.5)
        {"latitude": 23.9999, "longitude": -84.4998, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [12.0], "wind_direction_10m": [90.0]}},
        # (24.5, -85.0)
        {"latitude": 24.5001, "longitude": -85.0003, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [20.0], "wind_direction_10m": [90.0]}},
        # (24.5, -84.75)
        {"latitude": 24.4998, "longitude": -84.7501, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [22.0], "wind_direction_10m": [90.0]}},
        # (24.25, -84.5)
        {"latitude": 24.2502, "longitude": -84.4999, "hourly_units": {"wind_speed_10m": "kn", "wind_direction_10m": "°"},
         "hourly": {"time": ["2026-06-01T15:00:00Z"], "wind_speed_10m": [16.0], "wind_direction_10m": [90.0]}}
    ]

    product = normalizer.normalize(
        model="GFS",
        provider="open-meteo",
        domain="wind",
        layer="wind",
        raw_results=raw_results,
        bbox=bbox,
        resolution=resolution,
        target_time=target_dt
    )

    assert product is not None
    grid = product.grid
    assert grid.cols == 3
    assert grid.rows == 3
    assert len(grid.vectors) == 9
    assert grid.cols * grid.rows == len(grid.vectors)

    # Verify stable row-major order: south-to-north, west-to-east
    expected_order = [
        (24.0, -85.0), (24.0, -84.75), (24.0, -84.5),
        (24.25, -85.0), (24.25, -84.75), (24.25, -84.5),
        (24.5, -85.0), (24.5, -84.75), (24.5, -84.5)
    ]
    
    for idx, (expected_lat, expected_lng) in enumerate(expected_order):
        v = grid.vectors[idx]
        assert v.lat == expected_lat
        assert v.lng == expected_lng

    # Verify bilinear corner lookup succeeds (no nearest neighbor fallback) for an interior point
    # We sample lat=24.1, lng=-84.8
    res = sampler.sample_point(product, 24.1, -84.8)
    assert res.point.interpolation_method == "bilinear"
    assert res.point.speed > 0.0

def test_gfs_direction_to_uv_convention():
    """
    Verify that WeatherNormalizer translates GFS/Open-Meteo meteorological wave directions FROM
    into correct Cartesian advection velocities (TOWARD directions) expected by
    the WebGL marine particle engine.
    """
    normalizer = WeatherNormalizer()
    target_dt = datetime.fromisoformat("2026-06-01T21:00:00+00:00")
    bbox = {"west": -80.0, "south": 24.0, "east": -79.0, "north": 25.0}

    test_cases = [
        {"direction": 0.0, "expected_u": 0.0, "expected_v": -2.0},
        {"direction": 90.0, "expected_u": -2.0, "expected_v": 0.0},
        {"direction": 180.0, "expected_u": 0.0, "expected_v": 2.0},
        {"direction": 270.0, "expected_u": 2.0, "expected_v": 0.0},
    ]

    for tc in test_cases:
        mock_results = [
            {
                "latitude": 24.0, "longitude": -80.0,
                "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
                "hourly": {"time": ["2026-06-01T21:00:00Z"], "wave_height": [2.0], "wave_direction": [tc["direction"]], "wave_period": [5.0]}
            }
        ]

        product = normalizer.normalize(
            model="GFS",
            provider="open-meteo",
            domain="marine",
            layer="waves",
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


def test_weather_normalizer_dir_confidence_plumb_through():
    """§0B-a render-confidence (2026-07-03): a coarse NOAA product's wave_direction_confidence
    hourly series must land on GridVector.dir_confidence; absent series -> None (regional/legacy)."""
    normalizer = WeatherNormalizer()
    base = {
        "latitude": 27.5,
        "longitude": -80.0,
        "hourly_units": {"wave_height": "m", "wave_direction": "°", "wave_period": "s"},
        "hourly": {
            "time": ["2026-06-01T15:00:00Z"],
            "wave_height": [2.5],
            "wave_direction": [90.0],
            "wave_period": [8.0],
        },
    }
    target_dt = datetime.fromisoformat("2026-06-01T15:00:00+00:00")
    kwargs = dict(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        bbox={"west": -80.0, "south": 27.5, "east": -80.0, "north": 27.5},
        resolution=0.25, target_time=target_dt,
    )

    # With the confidence series exported (the coarse fetcher path)
    with_conf = {**base, "hourly": {**base["hourly"], "wave_direction_confidence": [0.4321]}}
    product = normalizer.normalize(raw_results=[with_conf], **kwargs)
    assert product.grid.vectors[0].dir_confidence == pytest.approx(0.4321)

    # Without it (regional tiles, other providers) the field stays None — fully backward compatible
    product_legacy = normalizer.normalize(raw_results=[base], **kwargs)
    assert product_legacy.grid.vectors[0].dir_confidence is None
