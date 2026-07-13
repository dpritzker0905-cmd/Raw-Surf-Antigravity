"""
Tests for ICON marine DWD-direct ingestion (ICON marine off open-meteo).

Verifies the DWD-first path in ingest_icon_marine_global produces products manifest-identical to the
open-meteo path (zero regression), and that it falls back to open-meteo when DWD yields nothing.
The actual bz2/GRIB fetch/decode (dwd_gwam_fetcher.py / pygrib) is verified on Render via the
standalone fetcher; here fetch_icon_marine_global_coarse is mocked.
"""
import pytest
from datetime import datetime, timezone, timedelta


def _gwam_like_points(om_provider, region, resolution=10.0):
    """Full grid at `resolution`, GWAM-shaped (3 layers, no swell_2), 6 three-hourly steps, authoritative."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(6)]
    vars9 = ["wave_height", "wave_direction", "wave_period",
             "swell_wave_height", "swell_wave_direction", "swell_wave_period",
             "wind_wave_height", "wind_wave_direction", "wind_wave_period"]
    pts = []
    for lat, lon in zip(lats, lons):
        hourly = {"time": times}
        for v in vars9:
            hourly[v] = [(200.0 if "direction" in v else (8.0 if "period" in v else 1.0)) for _ in times]
        pts.append({"latitude": lat, "longitude": lon, "__provider": "dwd",
                    "hourly_units": {}, "hourly": hourly})
    return pts


@pytest.mark.asyncio
async def test_icon_marine_dwd_direct_ingestion(tmp_path, monkeypatch):
    """DWD-direct path -> AUTHORITATIVE products identical to the open-meteo path:
    provider='open-meteo', source_dataset='dwd_gwam', is_estimated=False, 3 layers (no swell_2)."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.dwd_marine_service as dwd_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_MARINE_DWD_DIRECT", "1")

    global_region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    points = _gwam_like_points(scheduler.om_provider, global_region)

    called = {"dwd": False}

    async def fake_dwd(bbox, resolution=10.0, forecast_days=7):
        called["dwd"] = True
        return points

    monkeypatch.setattr(dwd_svc, "fetch_icon_marine_global_coarse", fake_dwd)

    success = await scheduler.ingest_icon_marine_global()
    assert success is True
    assert called["dwd"] is True  # DWD primary path taken (not the open-meteo fallback)

    products = temp_store.get_manifest().products
    icon = [p for p in products if p.model == "ICON" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(icon) > 0
    for p in icon:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "dwd_gwam"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True
    layers = {p.layer for p in icon}
    assert {"waves", "swell_1", "wind_waves"}.issubset(layers)
    assert "swell_2" not in layers  # gwam has no secondary swell


@pytest.mark.asyncio
async def test_icon_marine_pilot_multi_bbox_single_pass(tmp_path, monkeypatch):
    """
    MULTI-BBOX single-download-pass (2026-07-13): ONE fetch_icon_marine_regions call must cover
    every pilot region (no per-region download passes — the run 29249603524 budget lesson), and
    each region's points save as regional_tile products manifest-identical to the per-region path.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.dwd_marine_service as dwd_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_MARINE_PILOT_FORECAST_DAYS", "1")

    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=2, timeout_s=900):
        calls.append(dict(bboxes))
        return {rid: _gwam_like_points(scheduler.om_provider, bb, resolution)
                for rid, bb in bboxes.items()}

    monkeypatch.setattr(dwd_svc, "fetch_icon_marine_regions", fake_multi)

    success = await scheduler.ingest_icon_marine_pilot()
    assert success is True
    assert len(calls) == 1                                   # ONE pass, not per-region
    assert set(calls[0]) == set(REGIONAL_CONFIGS)            # test env = flagship set

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "ICON" and p.domain == "marine" and p.region_id == region_id]
        assert len(regionals) > 0, f"no ICON regional products saved for {region_id} (multi path)"
        for p in regionals:
            assert p.provider == "open-meteo"
            assert p.source_dataset == "dwd_gwam"
            assert p.coverage_mode == "regional_tile"
        assert {"waves", "swell_1", "wind_waves"}.issubset({p.layer for p in regionals})


@pytest.mark.asyncio
async def test_icon_marine_pilot_dwd_direct_regional(tmp_path, monkeypatch):
    """
    Regression guard for the ICON close-zoom resolution ceiling (2026-07-13, round-12 §2a-i) —
    now exercises the per-region FALLBACK path (the multi-bbox fetch short-circuits to None in
    test env, so the pilot falls through to per-region DWD-direct): every flagship region at
    0.25°, manifest-identical to the global lane: provider='open-meteo',
    source_dataset='dwd_gwam', coverage_mode='regional_tile', 3 layers (gwam has no swell_2).
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.dwd_marine_service as dwd_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("ICON_MARINE_DWD_DIRECT", "1")
    monkeypatch.setenv("ICON_MARINE_PILOT_FORECAST_DAYS", "1")  # small/fast mock time-axis

    called_regions = []

    async def fake_dwd(bbox, resolution=10.0, forecast_days=7, timeout_s=1800):
        called_regions.append((round(bbox["west"], 2), round(bbox["east"], 2), resolution))
        return _gwam_like_points(scheduler.om_provider, bbox, resolution)

    monkeypatch.setattr(dwd_svc, "fetch_icon_marine_global_coarse", fake_dwd)

    success = await scheduler.ingest_icon_marine_pilot()
    assert success is True
    # DWD primary taken for BOTH flagship pilot regions at their configured 0.25° (test env =
    # flagship-only via get_pilot_regions; not the open-meteo fallback).
    assert len(called_regions) == len(REGIONAL_CONFIGS)
    for (_w, _e, res) in called_regions:
        assert res == 0.25

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "ICON" and p.domain == "marine" and p.region_id == region_id]
        assert len(regionals) > 0, f"no ICON regional products saved for {region_id}"
        for p in regionals:
            assert p.provider == "open-meteo"
            assert p.source_dataset == "dwd_gwam"
            assert p.is_estimated is False
            assert p.is_forecast_authoritative is True
            assert p.coverage_mode == "regional_tile"
            assert p.resolution == REGIONAL_CONFIGS[region_id]["resolution"]
        assert "swell_2" not in {p.layer for p in regionals}  # gwam has no secondary swell


@pytest.mark.asyncio
async def test_icon_marine_dwd_fallback_to_open_meteo(tmp_path, monkeypatch):
    """DWD yields nothing (real fetch returns None in test env) -> open-meteo fallback, no regression."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    success = await scheduler.ingest_icon_marine_global()
    assert success is True

    products = temp_store.get_manifest().products
    icon = [p for p in products if p.model == "ICON" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(icon) > 0
    assert {"waves", "swell_1", "wind_waves"}.issubset({p.layer for p in icon})
