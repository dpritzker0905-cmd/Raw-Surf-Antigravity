"""
Regression: EURO marine 10->14d GFS-extension slice must not crash on naive-vs-aware datetimes.

open-meteo GFS times are offset-NAIVE ("...T00:00"); Copernicus native times are AWARE ("...Z").
Mixing them in _slice_after (_parse_iso(t) > after_dt) raised TypeError and aborted the entire EURO
ingest BEFORE any product was saved. The existing happy-path test didn't catch it because both mocks
emit "Z"-suffixed (aware) times; here we make the GFS-ext mock emit naive times like real open-meteo.
"""
import pytest
from datetime import datetime, timezone, timedelta


@pytest.mark.asyncio
async def test_euro_marine_gfs_ext_naive_times_no_crash(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.weather_pipeline.scheduler as sched_mod

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    OM_VARS = [
        "wave_height", "wave_direction", "wave_period",
        "swell_wave_height", "swell_wave_direction", "swell_wave_period",
        "secondary_swell_wave_height", "secondary_swell_wave_direction", "secondary_swell_wave_period",
        "wind_wave_height", "wind_wave_direction", "wind_wave_period",
    ]

    # GFS-extension mock with NAIVE times (no "Z"), extending well past the (aware) Copernicus horizon.
    def naive_gfs_mock(om_provider, region, resolution, include_swell_2=True):
        lats, lons = om_provider.generate_grid_coords(region, resolution)
        base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
        times = [(base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(0, 14 * 24)]
        pts = []
        for lat, lon in zip(lats, lons):
            hourly = {"time": times}
            for v in OM_VARS:
                hourly[v] = [1.0 for _ in times]
            pts.append({"latitude": lat, "longitude": lon, "hourly_units": {},
                        "hourly": hourly, "is_test_fixture": True})
        return pts

    monkeypatch.setattr(sched_mod, "generate_mock_marine_results", naive_gfs_mock)

    # Must not raise (previously: TypeError naive vs aware) and must save native EURO products.
    success = await scheduler.ingest_euro_marine_global()
    assert success is True
    euro = [p for p in temp_store.get_manifest().products
            if p.model == "EURO" and p.domain == "marine" and p.region_id == "global_coarse"]
    assert len(euro) > 0
