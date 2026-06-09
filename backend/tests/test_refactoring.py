import pytest
import math
from datetime import datetime, timezone, timedelta
from fastapi import HTTPException
from fastapi.responses import JSONResponse

from services.weather_pipeline.schemas import (
    CoverageBounds, NormalizedProduct, NormalizedGrid, GridVector
)
from services.weather_pipeline.route_helpers import (
    parse_bbox, clamp_and_normalize_bbox, generate_bbox_coords,
    choose_adaptive_resolution, build_dynamic_cache_key,
    is_inside_bounds, is_bbox_covered_by, filter_grid_to_bbox,
    make_unsupported_icon_swell2_grid_response,
    make_unsupported_icon_swell2_point_response,
    make_no_coverage_grid_response,
    make_no_coverage_point_response,
    wrap_longitude
)
from services.weather_pipeline.product_selection import (
    bbox_intersection_area, select_best_candidate
)

def test_parse_bbox_valid():
    w, s, e, n = parse_bbox("-83.0,24.0,-79.0,28.0")
    assert w == -83.0
    assert s == 24.0
    assert e == -79.0
    assert n == 28.0

def test_parse_bbox_invalid_format():
    with pytest.raises(HTTPException) as exc:
        parse_bbox("-83.0,24.0")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        parse_bbox("-83.0,24.0,abc,28.0")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        parse_bbox("-83.0,24.0,NaN,28.0")
    assert exc.value.status_code == 400

    with pytest.raises(HTTPException) as exc:
        parse_bbox("-83.0,24.0,inf,28.0")
    assert exc.value.status_code == 400

def test_clamp_and_normalize_bbox():
    # Regular box
    w, s, e, n = clamp_and_normalize_bbox(-83.0, 24.0, -79.0, 28.0)
    assert w == -83.0
    assert s == 24.0
    assert e == -79.0
    assert n == 28.0

    # Inverted latitudes
    w, s, e, n = clamp_and_normalize_bbox(-83.0, 28.0, -79.0, 24.0)
    assert s == 24.0
    assert n == 28.0

    # Polar clamping
    w, s, e, n = clamp_and_normalize_bbox(-83.0, -95.0, -79.0, 95.0)
    assert s == -80.0
    assert n == 85.0

    # Longitude wrapping
    w, s, e, n = clamp_and_normalize_bbox(-200.0, 24.0, 200.0, 28.0)
    assert w == 160.0  # -200 + 360
    assert e == -160.0 # 200 - 360

def test_generate_bbox_coords():
    # Normal box
    lats, lons = generate_bbox_coords(-80.0, 25.0, -78.0, 27.0, 1.0)
    # lats should have 25.0, 26.0, 27.0 repeated for each lon
    # cols = 3 (lons: -80, -79, -78), rows = 3 (lats: 25, 26, 27)
    # Total count = 9
    assert len(lats) == 9
    assert len(lons) == 9
    assert lats[0] == 25.0
    assert lons[0] == -80.0

    # Crossing antimeridian
    lats, lons = generate_bbox_coords(179.0, 25.0, -179.0, 27.0, 1.0)
    # lons: 179.0, 180.0, -180.0, -179.0. Total 4 columns * 3 rows = 12.
    assert len(lats) == 12
    assert len(lons) == 12

def test_choose_adaptive_resolution():
    assert choose_adaptive_resolution(0.1, 0.1) == 0.25
    assert choose_adaptive_resolution(10.0, 10.0) == 0.5
    assert choose_adaptive_resolution(50.0, 50.0) == 2.5
    assert choose_adaptive_resolution(200.0, 100.0) == 10.0

def test_is_inside_bounds():
    class MockBounds:
        def __init__(self, w, s, e, n):
            self.west = w
            self.south = s
            self.east = e
            self.north = n
            
    bounds = MockBounds(-80.0, 25.0, -78.0, 27.0)
    assert is_inside_bounds(26.0, -79.0, bounds) is True
    assert is_inside_bounds(24.0, -79.0, bounds) is False
    assert is_inside_bounds(26.0, -81.0, bounds) is False

    # Crossing antimeridian bounds
    bounds_wrap = MockBounds(178.0, 25.0, -178.0, 27.0)
    assert is_inside_bounds(26.0, 179.0, bounds_wrap) is True
    assert is_inside_bounds(26.0, -179.0, bounds_wrap) is True
    assert is_inside_bounds(26.0, 0.0, bounds_wrap) is False

def test_is_bbox_covered_by():
    class MockCoverage:
        def __init__(self, w, s, e, n):
            self.west = w
            self.south = s
            self.east = e
            self.north = n

    cov = MockCoverage(-85.0, 24.0, -79.0, 31.0)
    # Requested fully inside
    assert is_bbox_covered_by(-83.0, 25.0, -80.0, 28.0, cov) is True
    # Requested outside north
    assert is_bbox_covered_by(-83.0, 25.0, -80.0, 32.0, cov) is False

def test_bbox_intersection_area():
    class MockCoverage:
        def __init__(self, w, s, e, n):
            self.west = w
            self.south = s
            self.east = e
            self.north = n

    cov = MockCoverage(-85.0, 24.0, -79.0, 30.0)
    # Intersection with same box (area = 6 * 6 = 36)
    area = bbox_intersection_area(-85.0, 24.0, -79.0, 30.0, cov)
    assert abs(area - 36.0) < 0.001

    # Intersection with offset box
    area2 = bbox_intersection_area(-83.0, 25.0, -81.0, 27.0, cov)
    assert abs(area2 - 4.0) < 0.001

def test_select_best_candidate():
    class MockProduct:
        def __init__(self, name, is_estimated, west, south, east, north):
            self.name = name
            self.is_estimated = is_estimated
            self.coverage = type('Cov', (), {'west': west, 'south': south, 'east': east, 'north': north})()

    # 1. Authoritative takes priority over estimated
    auth = MockProduct("auth", False, -85.0, 24.0, -79.0, 31.0)
    est = MockProduct("est", True, -85.0, 24.0, -79.0, 31.0)
    
    best = select_best_candidate(
        authoritative_candidates=[(auth, 1.0)],
        estimated_candidates=[(est, 0.5)],
        req_w=-83.0, req_s=25.0, req_e=-81.0, req_n=27.0
    )
    assert best.name == "auth"

    # 2. Maximum intersection area match
    auth_small = MockProduct("auth_small", False, -82.0, 25.0, -80.0, 27.0) # overlaps less
    auth_large = MockProduct("auth_large", False, -85.0, 24.0, -79.0, 31.0) # overlaps fully
    
    best = select_best_candidate(
        authoritative_candidates=[(auth_small, 0.1), (auth_large, 0.1)],
        estimated_candidates=[],
        req_w=-84.0, req_s=25.0, req_e=-79.0, req_n=30.0
    )
    assert best.name == "auth_large"

    # 3. Tie break on smaller time difference
    auth_diff1 = MockProduct("auth_diff1", False, -85.0, 24.0, -79.0, 31.0)
    auth_diff2 = MockProduct("auth_diff2", False, -85.0, 24.0, -79.0, 31.0)
    
    best = select_best_candidate(
        authoritative_candidates=[(auth_diff1, 2.0), (auth_diff2, 0.5)],
        estimated_candidates=[],
        req_w=-83.0, req_s=25.0, req_e=-81.0, req_n=27.0
    )
    assert best.name == "auth_diff2"

def test_filter_grid_to_bbox_mutation_safety():
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-78.0, north=27.0)
    vectors = [
        GridVector(lat=25.0, lng=-80.0, u=1.0, v=0.0, speed=1.0, period=6.0),
        GridVector(lat=25.0, lng=-78.0, u=3.0, v=0.0, speed=3.0, period=8.0),
        GridVector(lat=27.0, lng=-80.0, u=1.0, v=2.0, speed=2.236, period=10.0),
        GridVector(lat=27.0, lng=-78.0, u=3.0, v=2.0, speed=3.605, period=12.0)
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
        source_variables=["wave_height"],
        freshness_sec=1800
    )

    # Filter to smaller box
    filtered = filter_grid_to_bbox(product, "-80.0,25.0,-79.0,26.0")
    
    # Original product MUST NOT be mutated
    assert product.grid.bounds.north == 27.0
    assert len(product.grid.vectors) == 4
    
    # Filtered product must have correct modified dimensions
    assert filtered.grid.bounds.north == 25.0
    assert len(filtered.grid.vectors) == 1

def test_make_unsupported_icon_swell2_responses():
    target_dt = datetime.now(timezone.utc)
    res_grid = make_unsupported_icon_swell2_grid_response("marine", target_dt)
    assert res_grid.status_code == 200
    
    res_point = make_unsupported_icon_swell2_point_response("marine", 25.0, -80.0, target_dt)
    assert res_point.status_code == 200

def test_wrap_longitude_modulo_edge_cases():
    # Verify exact equivalence and robustness for wrap_longitude
    assert wrap_longitude(180.0) == 180.0
    assert wrap_longitude(-180.0) == -180.0
    assert wrap_longitude(200.0) == -160.0
    assert wrap_longitude(-200.0) == 160.0
    assert wrap_longitude(540.0) == 180.0
    assert wrap_longitude(-540.0) == -180.0
    assert wrap_longitude(1e9) == -80.0
    assert wrap_longitude(-1e9) == 80.0

def test_generate_bbox_coords_resolution_guard():
    with pytest.raises(ValueError, match="Resolution must be greater than zero."):
        generate_bbox_coords(-80.0, 25.0, -78.0, 27.0, 0.0)
    with pytest.raises(ValueError, match="Resolution must be greater than zero."):
        generate_bbox_coords(-80.0, 25.0, -78.0, 27.0, -0.5)

def test_filter_grid_to_bbox_backfill_defaults():
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-78.0, north=27.0)
    vectors = [
        GridVector(lat=25.0, lng=-80.0, u=1.0, v=0.0, speed=1.0, period=6.0),
        # lat=25.0, lng=-78.0 is missing
        GridVector(lat=27.0, lng=-80.0, u=1.0, v=2.0, speed=2.236, period=10.0),
        GridVector(lat=27.0, lng=-78.0, u=3.0, v=2.0, speed=3.605, period=12.0)
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
        source_variables=["wave_height"],
        freshness_sec=1800
    )

    filtered = filter_grid_to_bbox(product, "-80.0,25.0,-78.0,27.0")
    # There should be 4 vectors now because (25.0, -78.0) is backfilled
    assert len(filtered.grid.vectors) == 4
    
    # Locate the backfilled vector
    backfilled = [v for v in filtered.grid.vectors if v.lat == 25.0 and v.lng == -78.0][0]
    assert backfilled.is_valid is False
    assert backfilled.speed == 0.0
    assert backfilled.period == 0.0
    assert backfilled.gust is None
    assert backfilled.value is None
