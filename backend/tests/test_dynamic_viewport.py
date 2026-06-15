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
    assert len(products) == 4
    waves_prod = next(p for p in products if p["layer"] == "waves")
    assert waves_prod["product_id"] == product_id
    assert waves_prod["model"] == "GFS"

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
        expected_provider = "open-meteo"
        assert json_data["provider"] == expected_provider, f"{model} {domain} {layer} provider should be {expected_provider}"
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

def test_manifest_self_healing_future_pruning(mock_weather_setup):
    """Verify that impossible future-dated products (e.g. 2035) are pruned on get_manifest."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Create a mock manifest with a valid product and a future-dated 2035 product
    from services.weather_pipeline.schemas import PipelineManifest, ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta
    
    now = datetime.now(timezone.utc)
    valid_time = now + timedelta(hours=1)
    future_time = now + timedelta(days=45) # > 30 days
    
    coverage = CoverageBounds(west=-85, south=24, east=-80, north=30)
    
    manifest_data = PipelineManifest(
        last_manifest_update=now,
        products=[
            ManifestProduct(
                model="EURO",
                provider="copernicus",
                domain="marine",
                layer="waves",
                run_time=now,
                valid_time_start=valid_time,
                valid_time_end=valid_time,
                resolution=0.25,
                freshness_sec=3600,
                is_forecast_authoritative=True,
                coverage=coverage,
                filename="euro_marine_waves_florida_east_coast_valid_estimated.json",
                product_id="euro_marine_waves_florida_east_coast_valid_estimated.json"
            ),
            ManifestProduct(
                model="EURO",
                provider="estimated",
                domain="marine",
                layer="waves",
                run_time=now,
                valid_time_start=future_time,
                valid_time_end=future_time,
                resolution=0.25,
                freshness_sec=3600,
                is_forecast_authoritative=False,
                is_estimated=True,
                coverage=coverage,
                filename="euro_marine_waves_florida_east_coast_20350604T150000Z_estimated.json",
                product_id="euro_marine_waves_florida_east_coast_20350604T150000Z_estimated.json"
            )
        ]
    )
    
    # Save this corrupt manifest to disk (L1)
    with open(store.manifest_path, "w") as f:
        f.write(manifest_data.model_dump_json(indent=2))
        
    # 2. Call get_manifest() to trigger self-healing with FORCE_MANIFEST_PRUNING
    import os
    os.environ["FORCE_MANIFEST_PRUNING"] = "true"
    try:
        cleaned_manifest = store.get_manifest()
    finally:
        os.environ.pop("FORCE_MANIFEST_PRUNING", None)
    
    # Verify the 2035 product is pruned in memory
    assert len(cleaned_manifest.products) == 1
    assert cleaned_manifest.products[0].product_id == "euro_marine_waves_florida_east_coast_valid_estimated.json"
    
    # Verify the diagnostics report the pruning details
    diags = store.get_persistence_diagnostics()
    assert diags["pruned_anomalous_count"] == 1
    assert "euro_marine_waves_florida_east_coast_20350604T150000Z_estimated.json" in diags["pruned_anomalous_ids"]
    
    # Verify the cleaned manifest was resaved to disk (L1)
    with open(store.manifest_path, "r") as f:
        disk_data = json.load(f)
        assert len(disk_data["products"]) == 1
        assert disk_data["products"][0]["product_id"] == "euro_marine_waves_florida_east_coast_valid_estimated.json"

def test_regional_partial_does_not_prevent_dynamic_fetch(mock_weather_setup):
    """Verify that a regional manifest product does not prevent a dynamic viewport fetch from being attempted."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Register a Florida regional product in the manifest
    from services.weather_pipeline.schemas import PipelineManifest, ManifestProduct, CoverageBounds, NormalizedProduct, NormalizedGrid
    from datetime import datetime, timezone
    
    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    florida_coverage = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    
    manifest_item = ManifestProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=target_dt,
        valid_time_start=target_dt,
        valid_time_end=target_dt,
        resolution=0.25,
        freshness_sec=3600,
        is_forecast_authoritative=True,
        coverage=florida_coverage,
        filename="gfs_marine_waves_florida_east_coast_20260602T120000Z.json",
        product_id="gfs_marine_waves_florida_east_coast_20260602T120000Z.json",
        region_id="florida_east_coast",
        coverage_mode="regional_tile"
    )
    
    # Save the manifest with this item
    manifest = store.get_manifest()
    manifest.products.append(manifest_item)
    store._save_manifest(manifest)
    
    # Save the dummy product file to L1 store so it can be loaded if fallback occurs
    dummy_product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=target_dt,
        valid_time=target_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=florida_coverage,
        grid=NormalizedGrid(bounds=florida_coverage, cols=2, rows=2, vectors=[]),
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="m",
        product_id="gfs_marine_waves_florida_east_coast_20260602T120000Z.json",
        source_variables=["wave_height"],
        freshness_sec=3600,
        region_id="florida_east_coast",
        coverage_mode="regional_tile"
    )
    
    with open(store.cache_dir / "gfs_marine_waves_florida_east_coast_20260602T120000Z.json", "w") as f:
        f.write(dummy_product.model_dump_json(indent=2))
        
    # 2. Query a bbox wider than Florida (should trigger dynamic fetch first)
    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-95,20,-70,35"
    )
    assert response.status_code == 200
    json_data = response.json()
    
    # It must be a dynamic viewport product (cache miss), not the regional manifest product
    assert json_data["is_dynamic_viewport_product"] is True
    assert json_data["partial_coverage"] is False
    assert json_data["product_id"] != "gfs_marine_waves_florida_east_coast_20260602T120000Z.json"

def test_dynamic_fetch_failure_regional_partial_fallback(mock_weather_setup, monkeypatch):
    """Verify that if dynamic fetch fails, the endpoint falls back to regional_partial manifest overlap."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Register a Florida regional product in the manifest
    from services.weather_pipeline.schemas import PipelineManifest, ManifestProduct, CoverageBounds, NormalizedProduct, NormalizedGrid, GridVector
    from datetime import datetime, timezone
    
    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    florida_coverage = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)
    
    manifest_item = ManifestProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=target_dt,
        valid_time_start=target_dt,
        valid_time_end=target_dt,
        resolution=0.5,
        freshness_sec=3600,
        is_forecast_authoritative=True,
        coverage=florida_coverage,
        filename="gfs_marine_waves_florida_east_coast_fallback.json",
        product_id="gfs_marine_waves_florida_east_coast_fallback.json",
        region_id="florida_east_coast",
        coverage_mode="regional_tile"
    )
    
    # Save the manifest with this item
    manifest = store.get_manifest()
    manifest.products.append(manifest_item)
    store._save_manifest(manifest)
    
    # Save the dummy product file to L1 store with a vector so we can verify speed interpolation
    dummy_product = NormalizedProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=target_dt,
        valid_time=target_dt,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=florida_coverage,
        grid=NormalizedGrid(
            bounds=florida_coverage, 
            cols=2, 
            rows=2, 
            vectors=[
                GridVector(lat=24.0, lng=-85.0, speed=4.0),
                GridVector(lat=24.0, lng=-79.0, speed=4.0),
                GridVector(lat=31.0, lng=-85.0, speed=4.0),
                GridVector(lat=31.0, lng=-79.0, speed=4.0)
            ]
        ),
        value_kind="wave_height",
        value_unit="m",
        display_unit_hint="m",
        product_id="gfs_marine_waves_florida_east_coast_fallback.json",
        source_variables=["wave_height"],
        freshness_sec=3600,
        region_id="florida_east_coast",
        coverage_mode="regional_tile"
    )
    
    with open(store.cache_dir / "gfs_marine_waves_florida_east_coast_fallback.json", "w") as f:
        f.write(dummy_product.model_dump_json(indent=2))
        
    # 2. Mock fetch_grid to raise a rate limit error (429)
    async def mock_fail_fetch_grid(*args, **kwargs):
        from fastapi import HTTPException
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
        
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fail_fetch_grid)
    
    # 3. Query a bbox wider than Florida (should try dynamic fetch, fail, and then fallback to regional_partial)
    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-86,23.5,-78.5,31.5"
    )
    assert response.status_code == 200
    json_data = response.json()
    
    # It must be the regional manifest product served as regional_partial fallback
    assert json_data["is_dynamic_viewport_product"] is False
    assert json_data["coverage_scope"] == "regional_partial"
    assert json_data["partial_coverage"] is True
    assert json_data["product_id"] == "gfs_marine_waves_florida_east_coast_fallback.json"
    
    # 4. Now, if we remove the overlapping product, it should raise a 429/503/504 error
    store.manifest_path.unlink() # Delete manifest
    response_error = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-86,23.5,-78.5,31.5"
    )
    assert response_error.status_code in (429, 503, 504)

def test_negative_cache_stale_fallback_success(mock_weather_setup, monkeypatch):
    """Verify that if negative cache is active, it still checks and returns a stale fallback product."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Seed a conformed dynamic viewport product for GFS waves at 2026-06-02T12:00:00Z
    response1 = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response1.status_code == 200
    p1_data = response1.json()
    p1_id = p1_data["product_id"]
    
    # Let's confirm it's cached in the index
    items = dynamic_idx._load_index()
    assert len(items) == 4
    assert any(item["product_id"] == p1_id for item in items)
    
    # 2. Add a negative cache entry for a query 1 hour later (2026-06-02T13:00:00Z)
    from services.weather_pipeline.route_helpers import parse_bbox, clamp_and_normalize_bbox, build_dynamic_cache_key
    from services.weather_pipeline.viewport_service import ViewportService
    
    target_dt = datetime(2026, 6, 2, 13, 0, 0, tzinfo=timezone.utc)
    bbox_str = "-85,24,-80,30"
    req_w, req_s, req_e, req_n = parse_bbox(bbox_str)
    model = "GFS"
    tileSize = 1.0 if model.upper() == "GFS" else 2.0
    snap_w = math.floor(req_w / tileSize) * tileSize
    snap_s = math.floor(req_s / tileSize) * tileSize
    snap_e = math.ceil(req_e / tileSize) * tileSize
    snap_n = math.ceil(req_n / tileSize) * tileSize
    west, south, east, north = clamp_and_normalize_bbox(snap_w, snap_s, snap_e, snap_n)
    cache_key = build_dynamic_cache_key("GFS", "marine", "waves", target_dt, west, south, east, north)
    
    # Activate negative cache for this key
    from routes import weather
    weather.viewport_service.NEGATIVE_CACHE[cache_key] = datetime.now(timezone.utc).timestamp() + 60
    
    # Mock OpenMeteoProvider.fetch_grid to raise error if called
    async def mock_fetch_grid_should_not_be_called(*args, **kwargs):
        raise AssertionError("Upstream fetch was called despite negative cache and stale fallback!")
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fetch_grid_should_not_be_called)
    
    # 3. Query the API for 2026-06-02T13:00:00Z (should hit negative cache, check stale fallback, find p1, and return it!)
    response2 = client.get(
        f"/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T13:00:00Z&bbox={bbox_str}"
    )
    assert response2.status_code == 200
    p2_data = response2.json()
    assert p2_data["stale"] is True
    assert p2_data["cache_hit"] == "stale_cache_hit"
    assert p2_data["staleReason"] == "upstream_rate_limited"
    assert p2_data["fallbackReason"] == "upstream_rate_limited"
    assert p2_data["product_id"] == p1_id
    
    # Clean up negative cache
    weather.viewport_service.NEGATIVE_CACHE.clear()

def test_aged_dynamic_product_diagnostics(mock_weather_setup):
    """Verify diagnostics are correctly set and marked stale/SWR for aged dynamic products."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Seed dynamic product
    response1 = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response1.status_code == 200
    p1_data = response1.json()
    p1_id = p1_data["product_id"]
    
    # 2. Modify created_at to be 40 minutes in the past
    from datetime import timedelta
    items = dynamic_idx._load_index()
    assert len(items) == 4
    for item in items:
        item["created_at"] = (datetime.now(timezone.utc) - timedelta(minutes=40)).isoformat()
    dynamic_idx._save_index(items)
    
    # 3. Query again to hit stale cache with SWR
    response2 = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,24,-80,30"
    )
    assert response2.status_code == 200
    p2_data = response2.json()
    assert p2_data["stale"] is True
    assert p2_data["cache_hit"] == "stale_cache_hit"
    assert p2_data["staleReason"] == "swr_revalidation_pending"
    assert p2_data["product_id"] == p1_id
    
    diags = p2_data["grid"]["diagnostics"]
    assert diags["stale"] is True
    assert diags["cache_hit"] == "stale_cache_hit"
    assert diags["staleReason"] == "swr_revalidation_pending"
    assert diags["renderable"] is True
    # Ensure diagnostics valid_time is ISO and matches requested valid_time
    assert diags["valid_time"] == "2026-06-02T12:00:00Z"

def test_query_bbox_clamped_snapped(mock_weather_setup):
    """Verify that query_bbox uses clamped/snapped normalized coordinates near boundaries."""
    # Query close to North Pole (lat=84, north boundary snaps to 86 which gets clamped to 85.0)
    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-85,83,-80,84"
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["is_dynamic_viewport_product"] is True
    
    query_bbox = json_data["query_bbox"]
    parts = [float(x) for x in query_bbox.split(",")]
    # Latitude must be <= 85.0
    assert parts[3] <= 85.0
    
    # Let's test antimeridian crossing query
    response_am = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=179,24,-179,30"
    )
    assert response_am.status_code == 200
    json_am = response_am.json()
    query_bbox_am = json_am["query_bbox"]
    parts_am = [float(x) for x in query_bbox_am.split(",")]
    # West should be positive, East should be negative (or normalized wrapper)
    assert abs(parts_am[0]) <= 180.0
    assert abs(parts_am[2]) <= 180.0
    
    # Verify wrapped longitudes and correct row-major sorting for GFS
    vectors_am = json_am["grid"]["vectors"]
    assert len(vectors_am) > 0
    for v in vectors_am:
        assert -180.0 <= v["lng"] <= 180.0
    
    # Checked row lat=24.0: first >= 179.0, then < 179.0 (wrapped)
    lons_am = [v["lng"] for v in vectors_am if v["lat"] == 24.0]
    expected_lons_gfs = [
        179.0, 179.25, 179.5, 179.75, 180.0, -179.75, -179.5, -179.25, -179.0
    ]
    assert lons_am == expected_lons_gfs

    # Let's test antimeridian crossing query for EURO
    # EURO has resolution 0.5, so snapping tile size is 2.0.
    # Therefore, bbox=179,24,-179,30 snaps to 178,24,-178,30.
    # Under the new coordinate cap (<100 points), GFS snaps/steps up to 0.5 and EURO snaps/steps up to 1.0.
    response_euro = client.get(
        "/api/weather/grid?model=EURO&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=179,24,-179,30"
    )
    assert response_euro.status_code == 200
    json_euro = response_euro.json()
    assert json_euro["is_dynamic_viewport_product"] is True
    
    vectors_euro = json_euro["grid"]["vectors"]
    assert len(vectors_euro) > 0
    for v in vectors_euro:
        assert -180.0 <= v["lng"] <= 180.0
        
    lons_euro = [v["lng"] for v in vectors_euro if v["lat"] == 24.0]
    expected_lons_euro = [
        179.0, 179.5, 180.0, -179.5, -179.0
    ]
    assert lons_euro == expected_lons_euro

def test_two_overlapping_regional_products_ranking(mock_weather_setup, monkeypatch):
    """Verify that Step 6 fallback correctly ranks overlapping regional manifest products by area, time, and authoritative."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Mock fetch_grid to raise a rate limit error (429)
    async def mock_fail_fetch_grid(*args, **kwargs):
        from fastapi import HTTPException
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fail_fetch_grid)
    
    # 2. Register two regional products in the manifest:
    # Product A: Florida (west=-82, south=24, east=-79, north=30), diff = 1 hour, authoritative
    # Product B: Wider Florida (west=-85, south=23, east=-78, north=31), diff = 0 hour, authoritative
    from services.weather_pipeline.schemas import PipelineManifest, ManifestProduct, CoverageBounds, NormalizedProduct, NormalizedGrid
    from datetime import timedelta
    
    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    time_a = target_dt + timedelta(hours=1)
    
    cov_a = CoverageBounds(west=-82.0, south=24.0, east=-79.0, north=30.0)
    cov_b = CoverageBounds(west=-85.0, south=23.0, east=-78.0, north=31.0)
    
    manifest_a = ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=target_dt, valid_time_start=time_a, valid_time_end=time_a,
        resolution=0.5, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=cov_a, filename="prod_a.json", product_id="prod_a.json",
        region_id="florida_a", coverage_mode="regional_tile"
    )
    
    manifest_b = ManifestProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=target_dt, valid_time_start=target_dt, valid_time_end=target_dt,
        resolution=0.5, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=cov_b, filename="prod_b.json", product_id="prod_b.json",
        region_id="florida_b", coverage_mode="regional_tile"
    )
    
    manifest = store.get_manifest()
    manifest.products = [manifest_a, manifest_b]
    store._save_manifest(manifest)
    
    # Save dummy products
    for name, cov in [("prod_a.json", cov_a), ("prod_b.json", cov_b)]:
        dummy = NormalizedProduct(
            model="GFS", provider="open-meteo", domain="marine", layer="waves",
            run_time=target_dt, valid_time=target_dt, is_forecast_authoritative=True,
            is_estimated=False, coverage=cov,
            grid=NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=[]),
            value_kind="wave_height", value_unit="m", display_unit_hint="m",
            product_id=name, source_variables=["wave_height"], freshness_sec=3600,
            region_id=name.split(".")[0], coverage_mode="regional_tile"
        )
        with open(store.cache_dir / name, "w") as f:
            f.write(dummy.model_dump_json(indent=2))
            
    # 3. Query a wider bbox so that it does not have full coverage in Step 3,
    # forcing Step 4 dynamic fetch which fails, and then falls back to Step 6 regional_partial.
    # Overlap area of B is larger, diff of B is smaller.
    # So Product B must be selected!
    response = client.get(
        "/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time=2026-06-02T12:00:00Z&bbox=-86,23.5,-78.5,31.5"
    )
    assert response.status_code == 200
    json_data = response.json()
    assert json_data["product_id"] == "prod_b.json"
    assert json_data["coverage_scope"] == "regional_partial"
    assert json_data["partial_coverage"] is True


