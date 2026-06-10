import pytest
from datetime import datetime, timezone
from tests.test_dynamic_viewport import mock_weather_setup, client
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

async def test_gfs_wind_global_ingestion(mock_weather_setup):
    """Verify that ingest_gfs_wind_global runs successfully and saves a global coarse product."""
    store, dynamic_idx = mock_weather_setup
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    
    scheduler = WeatherPipelineScheduler(store=store)
    success = await scheduler.ingest_gfs_wind_global()
    assert success is True
    
    # Check if global_coarse product exists in the manifest
    manifest = store.get_manifest()
    global_products = [p for p in manifest.products if p.region_id == "global_coarse"]
    assert len(global_products) > 0
    assert global_products[0].coverage_mode == "global_tile"
    assert global_products[0].coverage.west == -180.0
    assert global_products[0].coverage.east == 180.0

def test_candidate_selection_tie_breaking(mock_weather_setup, monkeypatch):
    """Verify that candidate selection prioritizes the regional tile (smaller coverage bounds) over the global tile for a local viewport query, and selects the global tile for a wider viewport query."""
    store, dynamic_idx = mock_weather_setup
    
    # 1. Mock fetch_grid to raise a rate limit error (429) to force fallback to manifest candidates
    async def mock_fail_fetch_grid(*args, **kwargs):
        from fastapi import HTTPException
        raise HTTPException(status_code=429, detail="Rate limit exceeded")
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", mock_fail_fetch_grid)
    
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds, NormalizedProduct, NormalizedGrid
    
    target_dt = datetime(2026, 6, 2, 12, 0, 0, tzinfo=timezone.utc)
    
    # Product A: Regional Florida Wind (west=-82.0, south=24.0, east=-79.0, north=30.0)
    cov_regional = CoverageBounds(west=-82.0, south=24.0, east=-79.0, north=30.0)
    # Product B: Global Coarse Wind (west=-180.0, south=-80.0, east=180.0, north=85.0)
    cov_global = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    
    manifest_regional = ManifestProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=target_dt, valid_time_start=target_dt, valid_time_end=target_dt,
        resolution=0.25, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=cov_regional, filename="prod_regional.json", product_id="prod_regional.json",
        region_id="florida", coverage_mode="regional_tile"
    )
    
    manifest_global = ManifestProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=target_dt, valid_time_start=target_dt, valid_time_end=target_dt,
        resolution=2.5, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=cov_global, filename="prod_global.json", product_id="prod_global.json",
        region_id="global_coarse", coverage_mode="global_tile"
    )
    
    manifest = store.get_manifest()
    manifest.products = [manifest_regional, manifest_global]
    store._save_manifest(manifest)
    
    # Save dummy products to cache
    for name, cov in [("prod_regional.json", cov_regional), ("prod_global.json", cov_global)]:
        dummy = NormalizedProduct(
            model="GFS", provider="open-meteo", domain="wind", layer="wind",
            run_time=target_dt, valid_time=target_dt, is_forecast_authoritative=True,
            is_estimated=False, coverage=cov,
            grid=NormalizedGrid(bounds=cov, cols=2, rows=2, vectors=[]),
            value_kind="wind", value_unit="kn", display_unit_hint="kn",
            product_id=name, source_variables=["wind_speed_10m"], freshness_sec=3600,
            region_id=name.split(".")[0], coverage_mode="regional_tile" if "regional" in name else "global_tile"
        )
        with open(store.cache_dir / name, "w") as f:
            f.write(dummy.model_dump_json(indent=2))
            
    # Query case 1: Zoomed in viewport within Florida bounds (-81.0, 25.0, -80.0, 29.0)
    # Both regional and global cover this viewport.
    # Because regional has smaller coverage area, it should win.
    response1 = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-06-02T12:00:00Z&bbox=-81,25,-80,29"
    )
    assert response1.status_code == 200
    json_data1 = response1.json()
    assert json_data1["product_id"] == "prod_regional.json"
    
    # Query case 2: Zoomed out global viewport (-180, -80, 180, 85)
    # Regional does not cover this viewport, only global does.
    # Therefore, global should win.
    response2 = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time=2026-06-02T12:00:00Z&bbox=-180,-80,180,85"
    )
    assert response2.status_code == 200
    json_data2 = response2.json()
    assert json_data2["product_id"] == "prod_global.json"
