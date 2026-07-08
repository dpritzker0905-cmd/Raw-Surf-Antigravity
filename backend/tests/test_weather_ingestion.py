"""Weather-pipeline ingestion + pruning tests.
Split from test_weather_services.py (2026-07-08) to keep both files < 800 LOC.
Hermetic: each test kills the live direct source (GFS_MARINE_NOAA_DIRECT=0 etc.) and returns a
fixture-stripped mock from fetch_grid, so ingested products are AUTHORITATIVE (production path),
letting the provenance guard prune the old run."""
import pytest

@pytest.mark.asyncio
async def test_gfs_marine_ingestion_and_pruning(tmp_path, monkeypatch):
    """
    Test GFS Marine regional and global coarse ingestion and verify that
    old forecast runs are correctly pruned.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    
    # 1. Create isolated ProductStore
    temp_store = ProductStore(cache_dir=tmp_path)
    
    # Initialize scheduler
    scheduler = WeatherPipelineScheduler(store=temp_store)
    
    # 2. Mock env to test env so we use generated mock results
    monkeypatch.setenv("NODE_ENV", "test")
    
    # 3. Save a dummy old product in store manifest to verify pruning
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta
    
    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    
    old_item = ManifestProduct(
        model="GFS",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=dummy_cov,
        filename="gfs_marine_waves_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="gfs_marine_waves_global_coarse_old.json"
    )
    
    # Write empty old file to disk to mock existence
    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")
        
    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)
    
    # Verify it exists in manifest
    assert len(temp_store.get_manifest().products) == 1
    
    # 4. Trigger global coarse waves ingestion
    # Hermetic (2026-07-08): skip the live NOAA-direct attempt + return fixture-stripped mock from
    # fetch_grid so the ingested products are AUTHORITATIVE (a test-fixture is stamped is_estimated),
    # letting the provenance guard (0756fafe) prune the old authoritative run. Mirrors test_icon_pressure.
    monkeypatch.setenv("GFS_MARINE_NOAA_DIRECT", "0")
    async def _mock_fetch_grid(*args, **kwargs):
        from services.weather_pipeline.scheduler_helpers import generate_mock_marine_results
        _res = generate_mock_marine_results(scheduler.om_provider, {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}, 10.0)
        for _r in _res:
            _r.pop("is_test_fixture", None)
        return _res
    monkeypatch.setattr(scheduler.om_provider, "fetch_grid", _mock_fetch_grid)
    success = await scheduler.ingest_gfs_marine_global()
    assert success is True
    
    # 5. Verify that:
    # - New global GFS waves products are saved.
    # - Old product is pruned (superseded).
    new_manifest = temp_store.get_manifest()
    products = new_manifest.products
    
    # Ensure old run is pruned
    assert not any(p.filename == "gfs_marine_waves_global_coarse_old.json" for p in products)
    assert not (tmp_path / "gfs_marine_waves_global_coarse_old.json").exists()
    
    # Ensure new waves products exist
    waves_products = [p for p in products if p.model == "GFS" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(waves_products) > 0

@pytest.mark.asyncio
async def test_euro_marine_global_ingestion(tmp_path, monkeypatch):
    """
    Test EURO Marine global coarse ingestion and verify that conformed products are saved,
    pruned, and marked as is_estimated=True.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")

    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    old_item = ManifestProduct(
        model="EURO",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=False,
        is_estimated=True,
        coverage=dummy_cov,
        filename="euro_marine_waves_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="euro_marine_waves_global_coarse_old.json"
    )

    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")

    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)

    assert len(temp_store.get_manifest().products) == 1

    success = await scheduler.ingest_euro_marine_global()
    assert success is True

    new_manifest = temp_store.get_manifest()
    products = new_manifest.products

    # Ensure old run is pruned
    assert not any(p.filename == "euro_marine_waves_global_coarse_old.json" for p in products)
    assert not (tmp_path / "euro_marine_waves_global_coarse_old.json").exists()

    # Ensure new waves products exist and are marked as estimated
    waves_products = [p for p in products if p.model == "EURO" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(waves_products) > 0
    for p in waves_products:
        assert p.is_estimated is True
        assert p.provider in ("open-meteo", "test-fixture")

@pytest.mark.asyncio
async def test_icon_marine_global_ingestion(tmp_path, monkeypatch):
    """
    Test ICON Marine global coarse ingestion and verify that conformed products are saved,
    pruned, and correct layers exist.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")

    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    old_item = ManifestProduct(
        model="ICON",
        provider="open-meteo",
        domain="marine",
        layer="waves",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=dummy_cov,
        filename="icon_marine_waves_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="icon_marine_waves_global_coarse_old.json"
    )

    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")

    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)

    assert len(temp_store.get_manifest().products) == 1

    # Hermetic (2026-07-08): skip live DWD-direct + fixture-stripped mock -> authoritative products.
    monkeypatch.setenv("ICON_MARINE_DWD_DIRECT", "0")
    async def _mock_fetch_grid(*args, **kwargs):
        from services.weather_pipeline.scheduler_helpers import generate_mock_icon_marine_results
        _res = generate_mock_icon_marine_results(scheduler.om_provider, {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}, 10.0)
        for _r in _res:
            _r.pop("is_test_fixture", None)
        return _res
    monkeypatch.setattr(scheduler.om_provider, "fetch_grid", _mock_fetch_grid)
    success = await scheduler.ingest_icon_marine_global()
    assert success is True

    new_manifest = temp_store.get_manifest()
    products = new_manifest.products

    # Ensure old run is pruned
    assert not any(p.filename == "icon_marine_waves_global_coarse_old.json" for p in products)
    assert not (tmp_path / "icon_marine_waves_global_coarse_old.json").exists()

    # Ensure new products exist for all supported ICON marine layers
    layers = ["waves", "swell_1", "wind_waves"]
    for layer in layers:
        layer_products = [p for p in products if p.model == "ICON" and p.domain == "marine" and p.layer == layer and p.region_id == "global_coarse"]
        assert len(layer_products) > 0
        for p in layer_products:
            # 2026-07-08: the hermetic mock is fixture-stripped -> AUTHORITATIVE native products
            # (matches production DWD-direct); ICON marine coarse global has no estimated tail.
            assert p.is_estimated is False
            assert p.provider in ("open-meteo", "test-fixture")

@pytest.mark.asyncio
async def test_gfs_pressure_global_ingestion(tmp_path, monkeypatch):
    """
    Test GFS Pressure global coarse ingestion and verify that conformed products are saved and pruned.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")

    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    old_item = ManifestProduct(
        model="GFS",
        provider="open-meteo",
        domain="weather",
        layer="pressure",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=dummy_cov,
        filename="gfs_pressure_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="gfs_pressure_global_coarse_old.json"
    )

    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")

    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)

    # Hermetic (2026-07-08): skip live NOAA-direct + fixture-stripped mock -> authoritative products.
    monkeypatch.setenv("GFS_PRESSURE_NOAA_DIRECT", "0")
    async def _mock_fetch_grid(*args, **kwargs):
        from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
        _res = generate_mock_pressure_results(scheduler.om_provider, {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}, 10.0)
        for _r in _res:
            _r.pop("is_test_fixture", None)
        return _res
    monkeypatch.setattr(scheduler.om_provider, "fetch_grid", _mock_fetch_grid)
    success = await scheduler.ingest_gfs_pressure_global()
    assert success is True

    new_manifest = temp_store.get_manifest()
    products = new_manifest.products

    # Ensure old run is pruned
    assert not any(p.filename == "gfs_pressure_global_coarse_old.json" for p in products)

    # Ensure new pressure products exist
    pressure_products = [p for p in products if p.model == "GFS" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(pressure_products) > 0
    for p in pressure_products:
        # 2026-07-08: the hermetic mock is fixture-stripped -> AUTHORITATIVE native products
        # (matches production NOAA/ECMWF-direct); pressure has no estimated tail.
        assert p.is_estimated is False

@pytest.mark.asyncio
async def test_icon_pressure_global_ingestion(tmp_path, monkeypatch):
    """
    Test ICON Pressure global coarse ingestion, including loop extrapolation and estimated flags.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")

    # Mock provider fetch_grid to return mock data without is_test_fixture flag so extension code executes
    async def mock_fetch_grid(*args, **kwargs):
        from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
        global_region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
        resolution = 10.0
        results = generate_mock_pressure_results(scheduler.om_provider, global_region, resolution)
        for r in results:
            if "is_test_fixture" in r:
                del r["is_test_fixture"]
        return results

    monkeypatch.setattr(scheduler.om_provider, "fetch_grid", mock_fetch_grid)

    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    old_item = ManifestProduct(
        model="ICON",
        provider="open-meteo",
        domain="weather",
        layer="pressure",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=dummy_cov,
        filename="icon_pressure_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="icon_pressure_global_coarse_old.json"
    )

    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")

    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)

    success = await scheduler.ingest_icon_pressure_global()
    assert success is True

    new_manifest = temp_store.get_manifest()
    products = new_manifest.products

    # Ensure old run is pruned
    assert not any(p.filename == "icon_pressure_global_coarse_old.json" for p in products)

    # Ensure new pressure products exist
    pressure_products = [p for p in products if p.model == "ICON" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(pressure_products) > 0
    
    # Check that estimated flag is applied correctly for hours >= 120 (5 days)
    # Since we stripped is_test_fixture, native products are authoritative (is_estimated=False) and only extrapolated ones have is_estimated=True.
    # We measure from base_date (start of run_time day) to match scheduler's idx mapping.
    native_products = [p for p in pressure_products if (p.valid_time_start - p.run_time.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds() / 3600.0 < 120.0]
    estimated_products = [p for p in pressure_products if (p.valid_time_start - p.run_time.replace(hour=0, minute=0, second=0, microsecond=0)).total_seconds() / 3600.0 >= 120.0]
    
    assert len(native_products) > 0
    assert len(estimated_products) > 0
    for p in native_products:
        assert p.is_estimated is False
        assert p.estimate_basis is None
    for p in estimated_products:
        assert p.is_estimated is True
        assert p.estimate_basis is not None
        assert p.estimate_basis["type"] == "icon_loop_extrapolation"

@pytest.mark.asyncio
async def test_euro_pressure_global_ingestion(tmp_path, monkeypatch):
    """
    Test EURO Pressure global coarse ingestion and verify that conformed products are saved and pruned.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.schemas import ManifestProduct, CoverageBounds
    from datetime import datetime, timezone, timedelta

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)

    monkeypatch.setenv("NODE_ENV", "test")

    old_run = datetime.now(timezone.utc) - timedelta(hours=12)
    dummy_cov = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)

    old_item = ManifestProduct(
        model="EURO",
        provider="open-meteo",
        domain="weather",
        layer="pressure",
        run_time=old_run,
        valid_time_start=datetime.now(timezone.utc),
        valid_time_end=datetime.now(timezone.utc),
        resolution=10.0,
        freshness_sec=1800,
        is_forecast_authoritative=True,
        is_estimated=False,
        coverage=dummy_cov,
        filename="euro_pressure_global_coarse_old.json",
        region_id="global_coarse",
        coverage_mode="global_tile",
        tile_id="global_coarse",
        product_id="euro_pressure_global_coarse_old.json"
    )

    with open(tmp_path / old_item.filename, "w") as f:
        f.write("{}")

    manifest = temp_store.get_manifest()
    manifest.products.append(old_item)
    temp_store._save_manifest(manifest)

    # Hermetic (2026-07-08): skip live ECMWF-direct + fixture-stripped mock -> authoritative products.
    monkeypatch.setenv("EURO_PRESSURE_ECMWF_DIRECT", "0")
    async def _mock_fetch_grid(*args, **kwargs):
        from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
        _res = generate_mock_pressure_results(scheduler.om_provider, {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}, 10.0)
        for _r in _res:
            _r.pop("is_test_fixture", None)
        return _res
    monkeypatch.setattr(scheduler.om_provider, "fetch_grid", _mock_fetch_grid)
    success = await scheduler.ingest_euro_pressure_global()
    assert success is True

    new_manifest = temp_store.get_manifest()
    products = new_manifest.products

    # Ensure old run is pruned
    assert not any(p.filename == "euro_pressure_global_coarse_old.json" for p in products)

    # Ensure new pressure products exist
    pressure_products = [p for p in products if p.model == "EURO" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(pressure_products) > 0
    for p in pressure_products:
        # 2026-07-08: the hermetic mock is fixture-stripped -> AUTHORITATIVE native products
        # (matches production NOAA/ECMWF-direct); pressure has no estimated tail.
        assert p.is_estimated is False
