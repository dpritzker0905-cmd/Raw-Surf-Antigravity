import pytest
import math
from datetime import datetime, timezone, timedelta
from fastapi.testclient import TestClient
from services.weather_pipeline.schemas import (
    GridVector, NormalizedGrid, NormalizedProduct, CoverageBounds
)
from services.weather_pipeline.estimator import (
    get_estimate_weights, blend_direction, blend_period, resample_from_grid, estimate_euro_grid
)
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.sampler import PointSampler
from server import app

client = TestClient(app)

@pytest.fixture(autouse=True)
def isolated_store(tmp_path, monkeypatch):
    """Fixture that uses a temporary directory for ProductStore and mocks the routes' store instance."""
    temp_cache_dir = tmp_path / "weather_products"
    temp_cache_dir.mkdir()
    temp_store = ProductStore(cache_dir=temp_cache_dir)
    
    # Monkeypatch the global store instance inside routes.weather
    import routes.weather
    monkeypatch.setattr(routes.weather, "store", temp_store)
    
    return temp_store

def test_weights_curves():
    # 1. Day 0 past limit, ICON valid
    w1 = get_estimate_weights(target_hour=72, native_limit=72, is_icon_valid=True)
    assert abs(w1["persistence"] - 0.6) < 0.01
    assert abs(w1["gfs"] - 0.3) < 0.01
    assert abs(w1["icon"] - 0.1) < 0.01
    assert abs(w1["confidence"] - 1.0) < 0.01

    # 2. Day 1 past limit, ICON valid
    w2 = get_estimate_weights(target_hour=96, native_limit=72, is_icon_valid=True)
    assert abs(w2["persistence"] - 0.4) < 0.01
    assert abs(w2["gfs"] - 0.5) < 0.01
    assert abs(w2["icon"] - 0.1) < 0.01
    assert abs(w2["confidence"] - 0.85) < 0.01

    # 3. Day 6 past limit, ICON valid but hour > 168 (so icon becomes invalid/ignored)
    w3 = get_estimate_weights(target_hour=384, native_limit=240, is_icon_valid=True)
    assert w3["persistence"] == 0.0
    assert w3["gfs"] == 1.0
    assert w3["icon"] == 0.0
    assert abs(w3["confidence"] - 0.10) < 0.01  # confidence decays, capped at 0.10

    # 4. Day 0 past limit, ICON invalid
    w4 = get_estimate_weights(target_hour=72, native_limit=72, is_icon_valid=False)
    assert abs(w4["persistence"] - 0.7) < 0.01
    assert abs(w4["gfs"] - 0.3) < 0.01
    assert w4["icon"] == 0.0

def test_direction_blending():
    # 1. Balanced orthogonal vectors (90 deg and 180 deg) with equal weights
    # Heights = [1.0, 1.0], weights = [0.5, 0.5]
    res1 = blend_direction(heights=[1.0, 1.0], directions=[90.0, 180.0], weights=[0.5, 0.5])
    # Average direction of 90 and 180 should be 135.0 degrees
    assert abs(res1 - 135.0) < 0.1

    # 2. Null fallback
    res2 = blend_direction(heights=[None], directions=[None], weights=[1.0])
    assert res2 is None

    # 3. Persistence fallback when weights or heights are 0
    res3 = blend_direction(heights=[0.0, 0.0], directions=[45.0, 90.0], weights=[0.5, 0.5])
    assert res3 == 45.0

def test_period_blending():
    res1 = blend_period(periods=[8.0, 10.0, 0.0, None], weights=[0.5, 0.5, 0.1, 0.1])
    # Only 8.0 and 10.0 with w=0.5 are valid: (8*0.5 + 10*0.5) / 1.0 = 9.0
    assert res1 == 9.0

    res2 = blend_period(periods=[0.0, None], weights=[1.0, 1.0])
    assert res2 is None

def test_grid_resampling():
    bounds = CoverageBounds(west=-80.0, south=25.0, east=-78.0, north=27.0)
    # 2x2 grid:
    # lat: 25.0 -> 27.0, lng: -80.0 -> -78.0
    vectors = [
        GridVector(lat=25.0, lng=-80.0, u=1.0, v=0.0, speed=1.0, period=6.0),
        GridVector(lat=25.0, lng=-78.0, u=3.0, v=0.0, speed=3.0, period=8.0),
        GridVector(lat=27.0, lng=-80.0, u=1.0, v=2.0, speed=2.236, period=10.0),
        GridVector(lat=27.0, lng=-78.0, u=3.0, v=2.0, speed=3.605, period=12.0)
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors)

    # Resample at exactly the center (26.0, -79.0)
    res = resample_from_grid(lat=26.0, lng=-79.0, grid=grid)
    assert res is not None
    # Bilinear midpoint: u should be (1+3+1+3)/4 = 2.0, v should be (0+0+2+2)/4 = 1.0
    assert abs(res["u"] - 2.0) < 0.01
    assert abs(res["v"] - 1.0) < 0.01
    assert abs(res["period"] - 9.0) < 0.01

def test_grid_estimate_end_to_end(isolated_store, monkeypatch):
    monkeypatch.setenv("NODE_ENV", "test")
    
    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    
    def make_mock_product(model, provider, valid_time, speed_val):
        vectors = [
            GridVector(lat=24.0, lng=-85.0, speed=speed_val, u=-speed_val, v=0.0, period=8.0, is_valid=True)
        ]
        grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=vectors)
        return NormalizedProduct(
            model=model,
            provider=provider,
            domain="marine",
            layer="waves",
            run_time=datetime.now(timezone.utc),
            valid_time=valid_time,
            is_forecast_authoritative=(provider != "estimated"),
            is_estimated=(provider == "estimated"),
            coverage=bounds,
            grid=grid,
            value_kind="wave_height",
            value_unit="m",
            display_unit_hint="ft",
            source_variables=["wave_height"],
            freshness_sec=1800,
            region_id="florida_east_coast",
            tile_id="florida_east_coast",
            coverage_mode="regional_tile"
        )

    t0 = datetime(2035, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    # Set t1 to t0 + 6 hours so that the authoritative anchor (t0) is >3 hours away 
    # from the target valid time (t1) and won't get matched as a candidate.
    t1 = t0 + timedelta(hours=6)

    euro_anchor = make_mock_product("EURO", "copernicus", t0, 2.0)
    gfs_anchor = make_mock_product("GFS", "open-meteo", t0, 1.8)
    gfs_target = make_mock_product("GFS", "open-meteo", t1, 2.2)

    # Save source products first to register them in the manifest
    euro_anchor.product_id = isolated_store.save_product(euro_anchor)
    gfs_anchor.product_id = isolated_store.save_product(gfs_anchor)
    gfs_target.product_id = isolated_store.save_product(gfs_target)

    # 1. Generate grid estimate with valid times passed to record in basis
    est = estimate_euro_grid(
        target_hour=78.0,
        native_limit=72.0,
        active_layer="waves",
        euro_anchor_product=euro_anchor,
        gfs_target_product=gfs_target,
        gfs_anchor_product=gfs_anchor,
        euro_anchor_valid_time=t0,
        gfs_anchor_valid_time=t0,
        gfs_target_valid_time=t1
    )

    assert est is not None
    assert est.is_estimated is True
    assert est.provider == "estimated"
    assert est.model == "EURO"
    assert est.valid_time == gfs_target.valid_time
    assert est.estimate_basis is not None
    assert est.estimate_basis["type"] == "euro_persistence_gfs_blend"
    assert abs(est.estimate_basis["confidence"] - 0.9625) < 0.001

    v = est.grid.vectors[0]
    # w_persist=0.625, w_gfs=0.375
    # h_euro_anchor = 2.0
    # h_gfs_trend = 2.0 + (2.2 - 1.8) = 2.4
    # blended_height = 0.625 * 2.0 + 0.375 * 2.4 = 1.25 + 0.90 = 2.15
    assert abs(v.speed - 2.15) < 0.01

    # 2. Test Store Saving & Manifest Registry
    filename = isolated_store.save_product(est)
    assert filename is not None
    assert filename.endswith("_estimated.json")
    
    # Reload and check manifest
    manifest = isolated_store.get_manifest()
    registered = [p for p in manifest.products if p.filename == filename]
    assert len(registered) == 1
    assert registered[0].is_estimated is True
    assert registered[0].estimate_basis["type"] == "euro_persistence_gfs_blend"

    # 3. Test validate_copernicus_product allows estimated
    valid, reason = isolated_store.validate_copernicus_product(est)
    assert valid is True
    assert "Valid estimated product" in reason

    # 4. Test API routing grid retrieval
    valid_time_str = gfs_target.valid_time.strftime("%Y-%m-%dT%H:%M:%SZ")
    response_grid = client.get(
        f"/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time={valid_time_str}&bbox=-85.0,24.0,-79.0,31.0"
    )
    assert response_grid.status_code == 200
    grid_json = response_grid.json()
    assert grid_json["is_estimated"] is True
    assert grid_json["provider"] == "estimated"
    assert grid_json["product_id"] == filename

    # 5. Test API routing point retrieval samples the same file
    response_point = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=waves&lat=24.0&lng=-85.0&valid_time={valid_time_str}"
    )
    assert response_point.status_code == 200
    point_json = response_point.json()
    assert point_json["is_estimated"] is True
    assert point_json["product_id"] == filename
    assert abs(point_json["point"]["speed"] - 2.15) < 0.01

def test_route_selection_prioritization(isolated_store):
    t0 = datetime(2035, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    t0_str = t0.strftime("%Y-%m-%dT%H:%M:%SZ")
    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    
    def make_mock_grid_product(model, provider, valid_time, is_estimated, is_authoritative):
        vectors = [
            GridVector(lat=24.0, lng=-85.0, speed=1.5, u=-1.5, v=0.0, period=8.0, is_valid=True)
        ]
        grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=vectors)
        return NormalizedProduct(
            model=model,
            provider=provider,
            domain="marine",
            layer="waves",
            run_time=datetime.now(timezone.utc),
            valid_time=valid_time,
            is_forecast_authoritative=is_authoritative,
            is_estimated=is_estimated,
            coverage=bounds,
            grid=grid,
            value_kind="wave_height",
            value_unit="m",
            display_unit_hint="ft",
            source_variables=["wave_height"],
            freshness_sec=1800,
            region_id="florida_east_coast",
            tile_id="florida_east_coast",
            coverage_mode="regional_tile"
        )
        
    auth_prod = make_mock_grid_product("EURO", "copernicus", t0, is_estimated=False, is_authoritative=True)
    est_prod = make_mock_grid_product("EURO", "estimated", t0, is_estimated=True, is_authoritative=False)
    
    est_prod.estimate_basis = {
        "type": "euro_persistence_gfs_blend",
        "target_valid_time": t0.isoformat(),
        "layer": "waves",
        "region_id": "florida_east_coast",
        "tile_id": "florida_east_coast",
        "native_limit_hours": 72,
        "euro_anchor_product_id": "anchor.json",
        "gfs_anchor_product_id": "gfs_anchor.json",
        "gfs_target_product_id": "gfs_target.json"
    }
    
    # Save both
    auth_fn = isolated_store.save_product(auth_prod)
    est_fn = isolated_store.save_product(est_prod)
    
    # 1. Prioritization: should pick authoritative product
    response = client.get(f"/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time={t0_str}")
    assert response.status_code == 200
    assert response.json()["is_estimated"] is False
    assert response.json()["product_id"] == auth_fn

    response_pt = client.get(f"/api/weather/point?model=EURO&domain=marine&layer=waves&lat=24.0&lng=-85.0&valid_time={t0_str}")
    assert response_pt.status_code == 200
    assert response_pt.json()["is_estimated"] is False
    assert response_pt.json()["product_id"] == auth_fn

    # 2. Fallback: delete authoritative, should fallback to estimated
    import os
    os.remove(isolated_store.cache_dir / auth_fn)
    # Refresh manifest
    manifest = isolated_store.get_manifest()
    manifest.products = [p for p in manifest.products if p.filename != auth_fn]
    isolated_store._save_manifest(manifest)
    
    response = client.get(f"/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time={t0_str}")
    assert response.status_code == 200
    assert response.json()["is_estimated"] is True
    assert response.json()["product_id"] == est_fn

    response_pt = client.get(f"/api/weather/point?model=EURO&domain=marine&layer=waves&lat=24.0&lng=-85.0&valid_time={t0_str}")
    assert response_pt.status_code == 200
    assert response_pt.json()["is_estimated"] is True
    assert response_pt.json()["product_id"] == est_fn

    # 3. No Coverage: delete estimated, should return 404 with is_estimated = False
    os.remove(isolated_store.cache_dir / est_fn)
    manifest = isolated_store.get_manifest()
    manifest.products = [p for p in manifest.products if p.filename != est_fn]
    isolated_store._save_manifest(manifest)
    
    response = client.get(f"/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time={t0_str}")
    assert response.status_code == 404
    assert response.json()["is_estimated"] is False

    response_pt = client.get(f"/api/weather/point?model=EURO&domain=marine&layer=waves&lat=24.0&lng=-85.0&valid_time={t0_str}")
    assert response_pt.status_code == 404
    assert response.json()["is_estimated"] is False

def test_validation_and_quarantine(isolated_store):
    t0 = datetime(2035, 6, 4, 12, 0, 0, tzinfo=timezone.utc)
    t1 = t0 + timedelta(hours=3)
    bounds = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    
    def make_mock_product(model, provider, valid_time):
        vectors = [
            GridVector(lat=24.0, lng=-85.0, speed=1.0, u=-1.0, v=0.0, period=8.0, is_valid=True)
        ]
        grid = NormalizedGrid(bounds=bounds, cols=1, rows=1, vectors=vectors)
        return NormalizedProduct(
            model=model,
            provider=provider,
            domain="marine",
            layer="waves",
            run_time=datetime.now(timezone.utc),
            valid_time=valid_time,
            is_forecast_authoritative=(provider != "estimated"),
            is_estimated=(provider == "estimated"),
            coverage=bounds,
            grid=grid,
            value_kind="wave_height",
            value_unit="m",
            display_unit_hint="ft",
            source_variables=["wave_height"],
            freshness_sec=1800,
            region_id="florida_east_coast",
            tile_id="florida_east_coast",
            coverage_mode="regional_tile"
        )

    euro_anchor = make_mock_product("EURO", "copernicus", t0)
    gfs_anchor = make_mock_product("GFS", "open-meteo", t0)
    gfs_target = make_mock_product("GFS", "open-meteo", t1)
    
    euro_fn = isolated_store.save_product(euro_anchor)
    gfs_anchor_fn = isolated_store.save_product(gfs_anchor)
    gfs_target_fn = isolated_store.save_product(gfs_target)
    
    # Create an estimated product that violates grid contract (vectors length mismatch: cols=2, rows=2, but len(vectors)=1)
    vectors = [
        GridVector(lat=24.0, lng=-85.0, speed=1.5, u=-1.5, v=0.0, period=8.0, is_valid=True)
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=2, vectors=vectors, diagnostics={"vectorCount": 1, "nonzeroCount": 1})
    
    invalid_prod = NormalizedProduct(
        model="EURO",
        provider="estimated",
        domain="marine",
        layer="waves",
        run_time=datetime.now(timezone.utc),
        valid_time=t1,
        is_forecast_authoritative=False,
        is_estimated=True,
        estimate_basis={
            "type": "euro_persistence_gfs_blend",
            "target_valid_time": t1.isoformat(),
            "layer": "waves",
            "region_id": "florida_east_coast",
            "tile_id": "florida_east_coast",
            "native_limit_hours": 72,
            "euro_anchor_product_id": euro_fn,
            "gfs_anchor_product_id": gfs_anchor_fn,
            "gfs_target_product_id": gfs_target_fn
        },
        coverage=bounds,
        grid=grid,
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="ft",
        source_variables=["wave_height"],
        freshness_sec=1800,
        region_id="florida_east_coast",
        tile_id="florida_east_coast",
        coverage_mode="regional_tile",
        source_dataset="estimated_blend"
    )
    
    # Save bypassing validation
    filename = isolated_store.save_product(invalid_prod)
    
    # 1. Validate should return False due to cols*rows mismatch
    valid, reason = isolated_store.validate_copernicus_product(invalid_prod)
    assert valid is False
    assert "Grid contract mismatch" in reason or "Grid contract violation" in reason
    
    # 2. Run quarantine scan
    isolated_store.quarantine_invalid_copernicus_products()
    
    # Check that file is moved to quarantine directory
    filepath = isolated_store.cache_dir / filename
    quarantine_path = isolated_store.cache_dir / "quarantine" / filename
    assert not filepath.exists()
    assert quarantine_path.exists()
    
    # Check that it's removed from manifest
    manifest = isolated_store.get_manifest()
    registered = [p for p in manifest.products if p.filename == filename]
    assert len(registered) == 0

def test_point_estimate_blend(monkeypatch):
    from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
    
    t0 = datetime.now(timezone.utc)
    t0_str = t0.strftime("%Y-%m-%dT%H:00Z")
    
    anchor_dt = t0 + timedelta(days=2)
    anchor_str = anchor_dt.strftime("%Y-%m-%dT%H:00Z")
    
    target_dt = t0 + timedelta(days=4)
    target_str = target_dt.strftime("%Y-%m-%dT%H:00Z")
    
    async def mock_fetch_euro_marine(*args, **kwargs):
        return [{
            "hourly": {
                "time": [t0_str, anchor_str],
                "swell_wave_height": [2.0, 2.0],
                "swell_wave_direction": [90.0, 90.0],
                "swell_wave_period": [8.0, 8.0]
            }
        }]
        
    async def mock_fetch_point(self, model, domain, layer, lat, lng, forecast_days):
        if model == "GFS":
            return {
                "hourly": {
                    "time": [t0_str, anchor_str, target_str],
                    "swell_wave_height": [1.8, 1.8, 2.2],
                    "swell_wave_direction": [180.0, 180.0, 180.0],
                    "swell_wave_period": [8.0, 8.0, 10.0]
                }
            }
        elif model == "ICON":
            return {
                "hourly": {
                    "time": [t0_str, anchor_str, target_str],
                    "swell_wave_height": [1.5, 1.5, 1.5],
                    "swell_wave_direction": [90.0, 90.0, 90.0],
                    "swell_wave_period": [8.0, 8.0, 8.0]
                }
            }
        return None

    monkeypatch.setattr("services.copernicus_marine_service.fetch_euro_marine", mock_fetch_euro_marine)
    monkeypatch.setattr(OpenMeteoProvider, "fetch_point", mock_fetch_point)
    
    response = client.get(
        f"/api/weather/point?model=EURO&domain=marine&layer=swell_1&lat=28.4&lng=-80.6&valid_time={target_str}"
    )
    assert response.status_code == 200
    res_json = response.json()
    assert res_json["is_estimated"] is True
    assert res_json["provider"] == "estimated"
    assert "point_estimate_blend" in res_json["point"]["interpolation_method"]
    assert res_json["point"]["speed"] > 0.0

