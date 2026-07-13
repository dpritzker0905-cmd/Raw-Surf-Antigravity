"""
Tests for the EURO marine 0.25° regional pilot (2026-07-13 — the EURO rating-band resolution fix).

The EURO rating band was the last one stuck on the ~2° global_mid clip at close zoom (GFS + ICON
bands serve 0.25° regional tiles). This pilot reuses the FREE ECMWF Open Data wave stream (natively
0.25°, the same fetcher that lights the EURO mid tier) with regional bboxes — deliberately NO CMEMS
(the throttle landmine). The actual GRIB fetch is verified on the mid lane; here
fetch_euro_marine_waves_global is mocked.
"""
import pytest
from datetime import datetime, timezone, timedelta


def _ecmwf_wave_points(om_provider, region, resolution=0.25):
    """ECMWF-wave-shaped points (TOTAL sea only: height/period/direction), 6 three-hourly steps."""
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(6)]
    pts = []
    for lat, lon in zip(lats, lons):
        hourly = {"time": times,
                  "wave_height": [1.2 for _ in times],
                  "wave_period": [9.0 for _ in times],
                  "wave_direction": [200.0 for _ in times]}
        pts.append({"latitude": lat, "longitude": lon, "__provider": "ecmwf",
                    "hourly_units": {}, "hourly": hourly})
    return pts


@pytest.mark.asyncio
async def test_euro_marine_pilot_ecmwf_direct_regional(tmp_path, monkeypatch):
    """
    The pilot must fetch ECMWF-direct for every flagship region at 0.25° and save waves-layer
    regional tiles manifest-identical to the mid lane: provider='open-meteo',
    source_dataset='ecmwf_wam025', coverage_mode='regional_tile', superseded runs pruned.
    """
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    import services.ecmwf_wave_service as ecmwf_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_PILOT_FORECAST_DAYS", "1")

    called_regions = []

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10, timeout_s=1800):
        called_regions.append((round(bbox["west"], 2), round(bbox["east"], 2), resolution))
        return _ecmwf_wave_points(scheduler.om_provider, bbox, resolution)

    monkeypatch.setattr(ecmwf_svc, "fetch_euro_marine_waves_global", fake_ecmwf)

    success = await scheduler.ingest_euro_marine_pilot()
    assert success is True
    assert len(called_regions) == len(REGIONAL_CONFIGS)
    for (_w, _e, res) in called_regions:
        assert res == 0.25

    products = temp_store.get_manifest().products
    for region_id in REGIONAL_CONFIGS:
        regionals = [p for p in products
                     if p.model == "EURO" and p.domain == "marine" and p.region_id == region_id]
        assert len(regionals) > 0, f"no EURO regional products saved for {region_id}"
        for p in regionals:
            assert p.layer == "waves"        # free wave stream = TOTAL sea only
            assert p.provider == "open-meteo"
            assert p.source_dataset == "ecmwf_wam025"
            assert p.is_estimated is False
            assert p.is_forecast_authoritative is True
            assert p.coverage_mode == "regional_tile"
            assert p.resolution == REGIONAL_CONFIGS[region_id]["resolution"]


@pytest.mark.asyncio
async def test_euro_marine_pilot_no_cmems_fallback(tmp_path, monkeypatch):
    """A failed ECMWF fetch must SKIP the region (mid tier covers) — never touch CMEMS from the
    pilot (the throttle landmine that kept EURO mid OFF for weeks). In test env the mock path
    still saves so the job reports success without any network dependency."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as ecmwf_svc
    import services.copernicus_marine_service as cmems_svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    async def fake_ecmwf_down(bbox, resolution=2.0, forecast_days=10, timeout_s=1800):
        return None

    cmems_called = {"n": 0}

    async def fake_cmems(*a, **k):
        cmems_called["n"] += 1
        return None

    monkeypatch.setattr(ecmwf_svc, "fetch_euro_marine_waves_global", fake_ecmwf_down)
    monkeypatch.setattr(cmems_svc, "fetch_euro_marine_global_coarse", fake_cmems, raising=False)

    success = await scheduler.ingest_euro_marine_pilot()
    assert success is True          # test-env mock path saved products
    assert cmems_called["n"] == 0   # CMEMS never touched
