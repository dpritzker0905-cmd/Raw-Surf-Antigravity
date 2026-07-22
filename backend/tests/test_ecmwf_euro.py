"""
Tests for EURO wind + pressure ECMWF-Open-Data-direct ingestion (EURO atmo off open-meteo — the finish).

Verifies the ECMWF-first path in ingest_euro_wind_global / ingest_euro_pressure_global produces products
manifest-identical to the open-meteo path (provider='open-meteo', source_dataset='ecmwf_ifs',
authoritative), falls back to open-meteo when ECMWF yields nothing, and honours the kill switch. The
actual IFS GRIB fetch/decode (ecmwf_opendata_fetcher.py / ecmwf-opendata + pygrib) is verified on Render
via the standalone fetcher; here the ecmwf service functions are mocked.
"""
import pytest


# ───────────────────────────── EURO WIND ─────────────────────────────
@pytest.mark.asyncio
async def test_euro_wind_ecmwf_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_wind_results
    import services.ecmwf_wind_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_WIND_ECMWF_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_wind_results(scheduler.om_provider, region, resolution=10.0,
                                     forecast_days=1, is_test_fixture=False)
    for p in pts:
        p["__provider"] = "ecmwf"

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_euro_wind_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    assert called["ecmwf"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ecmwf_ifs"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_euro_wind_ecmwf_fallback_to_open_meteo(tmp_path, monkeypatch, hermetic_om_wind):
    """Real ecmwf_wind_service returns None in the test env -> the open-meteo path runs unchanged."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "wind" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider in ("open-meteo", "test-fixture")
        assert p.layer == "wind"


@pytest.mark.asyncio
async def test_euro_wind_ecmwf_kill_switch(tmp_path, monkeypatch, hermetic_om_wind):
    """EURO_WIND_ECMWF_DIRECT=0 must skip ECMWF entirely before the service is consulted."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wind_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    hermetic_om_wind(scheduler)  # wind is excluded from the provider test mocks - keep this test off the network
    monkeypatch.setenv("EURO_WIND_ECMWF_DIRECT", "0")

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return []

    monkeypatch.setattr(svc, "fetch_euro_wind_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_wind_global()
    assert ok is True
    assert called["ecmwf"] is False


# ─────────────────────────── EURO PRESSURE ───────────────────────────
@pytest.mark.asyncio
async def test_euro_pressure_ecmwf_direct_ingestion(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    from services.weather_pipeline.scheduler_helpers import generate_mock_pressure_results
    import services.ecmwf_pressure_service as svc

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_PRESSURE_ECMWF_DIRECT", "1")

    region = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    pts = generate_mock_pressure_results(scheduler.om_provider, region, 10.0)
    for p in pts:
        p.pop("is_test_fixture", None)
        p["__provider"] = "ecmwf"

    called = {"ecmwf": False}

    async def fake_ecmwf(bbox, resolution=10.0, forecast_days=10):
        called["ecmwf"] = True
        return pts

    monkeypatch.setattr(svc, "fetch_euro_pressure_global_coarse", fake_ecmwf)

    ok = await scheduler.ingest_euro_pressure_global()
    assert ok is True
    assert called["ecmwf"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ecmwf_ifs"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_euro_pressure_ecmwf_fallback_to_open_meteo(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")

    ok = await scheduler.ingest_euro_pressure_global()
    assert ok is True
    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "weather" and p.layer == "pressure" and p.region_id == "global_coarse"]
    assert len(prods) > 0
    assert all(p.layer == "pressure" for p in prods)


# ──────────────────────── EURO MARINE MID (waves via the wave stream) ────────────────────────
# The EURO global_mid tier (the rating band's data) sources the FREE ECMWF wave stream
# (swh/mwp/pp1d/mwd) instead of a 2nd ~15-30 min CMEMS fetch — the budget caution that kept the job
# default-OFF and left EURO with ZERO global_mid products ("band only on GFS"). waves layer ONLY (no
# partitions in the free feed). CMEMS stays as the fallback + EURO_MARINE_MID_ECMWF=0 kill switch.

def _mock_ecmwf_wave_points(n_lat: int = 5, n_lon: int = 7, n_steps: int = 8) -> list:
    """Points shaped exactly like ecmwf_opendata_fetcher layer='waves' output (make_point_dict shape,
    NO is_test_fixture flag — the normalizer must stamp real open-meteo/ecmwf_wam025 provenance)."""
    from datetime import datetime, timedelta, timezone
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * i)).strftime("%Y-%m-%dT%H:00:00Z") for i in range(n_steps)]
    pts = []
    for la in range(n_lat):
        for lo in range(n_lon):
            pts.append({
                "latitude": -20.0 + 10.0 * la, "longitude": -170.0 + 50.0 * lo,
                "generationtime_ms": 0, "utc_offset_seconds": 0,
                "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                "__provider": "ecmwf",
                "hourly_units": {"time": "iso8601", "wave_height": "m", "wave_period": "s",
                                 "wave_direction": "°"},
                "hourly": {"time": times,
                           "wave_height": [1.5 + 0.1 * la for _ in times],
                           "wave_period": [12.0 for _ in times],
                           "wave_direction": [240.0 for _ in times]},
            })
    return pts


def _mock_cmems_marine_points(n_steps: int = 8) -> list:
    """All-4-layer CMEMS-shaped marine points (no is_test_fixture) for the fallback/kill-switch paths."""
    from datetime import datetime, timedelta, timezone
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * i)).strftime("%Y-%m-%dT%H:00:00Z") for i in range(n_steps)]
    pts = []
    for la in range(3):
        for lo in range(5):
            pts.append({
                "latitude": -10.0 + 10.0 * la, "longitude": -160.0 + 70.0 * lo,
                "generationtime_ms": 0, "utc_offset_seconds": 0,
                "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                "__provider": "copernicus",
                "hourly_units": {"time": "iso8601", "wave_height": "m", "wave_period": "s",
                                 "wave_direction": "°"},
                "hourly": {"time": times,
                           "wave_height": [1.0 for _ in times],
                           "wave_direction": [200.0 for _ in times],
                           "wave_period": [9.0 for _ in times],
                           "swell_wave_height": [0.8 for _ in times],
                           "swell_wave_direction": [190.0 for _ in times],
                           "swell_wave_period": [11.0 for _ in times],
                           "secondary_swell_wave_height": [0.3 for _ in times],
                           "secondary_swell_wave_direction": [150.0 for _ in times],
                           "secondary_swell_wave_period": [7.0 for _ in times],
                           "wind_wave_height": [0.4 for _ in times],
                           "wind_wave_direction": [90.0 for _ in times],
                           "wind_wave_period": [4.0 for _ in times]},
            })
    return pts


@pytest.mark.asyncio
async def test_euro_marine_mid_ecmwf_direct(tmp_path, monkeypatch):
    """ECMWF-direct primary: waves-only global_mid products with honest native provenance
    (provider='open-meteo' -> source_dataset='ecmwf_wam025'), CMEMS never consulted."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as wave_svc
    import services.copernicus_marine_service as cms

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_MID_ECMWF", "1")
    monkeypatch.setenv("EURO_MID_RES", "10.0")

    called = {"ecmwf": False, "cmems": False}
    pts = _mock_ecmwf_wave_points()

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10):
        called["ecmwf"] = True
        return pts

    async def fake_cmems(region, resolution, days):
        called["cmems"] = True
        return _mock_cmems_marine_points()

    monkeypatch.setattr(wave_svc, "fetch_euro_marine_waves_global", fake_ecmwf)
    monkeypatch.setattr(cms, "fetch_euro_marine_global_coarse", fake_cmems)

    ok = await scheduler.ingest_euro_marine_global_mid()
    assert ok is True
    assert called["ecmwf"] is True
    assert called["cmems"] is False, "ECMWF succeeded — the CMEMS fallback must not run"

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "marine" and p.region_id == "global_mid"]
    assert len(prods) > 0
    assert all(p.layer == "waves" for p in prods), "free wave stream is TOTAL sea only"
    for p in prods:
        assert p.provider == "open-meteo"
        assert p.source_dataset == "ecmwf_wam025"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True


@pytest.mark.asyncio
async def test_euro_marine_mid_ecmwf_kill_switch(tmp_path, monkeypatch):
    """EURO_MARINE_MID_ECMWF=0 must skip ECMWF entirely and run the legacy CMEMS 4-layer path."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as wave_svc
    import services.copernicus_marine_service as cms

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_MID_ECMWF", "0")
    monkeypatch.setenv("EURO_MID_RES", "10.0")

    called = {"ecmwf": False, "cmems": False}

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10):
        called["ecmwf"] = True
        return _mock_ecmwf_wave_points()

    async def fake_cmems(region, resolution, days):
        called["cmems"] = True
        return _mock_cmems_marine_points()

    monkeypatch.setattr(wave_svc, "fetch_euro_marine_waves_global", fake_ecmwf)
    monkeypatch.setattr(cms, "fetch_euro_marine_global_coarse", fake_cmems)

    ok = await scheduler.ingest_euro_marine_global_mid()
    assert ok is True
    assert called["ecmwf"] is False, "kill switch must gate the ECMWF service call"
    assert called["cmems"] is True

    prods = [p for p in temp_store.get_manifest().products
             if p.model == "EURO" and p.domain == "marine" and p.region_id == "global_mid"]
    layers = {p.layer for p in prods}
    assert "waves" in layers
    assert {"swell_1", "swell_2", "wind_waves"} <= layers, "CMEMS path keeps all 4 layers"


@pytest.mark.asyncio
async def test_euro_marine_mid_ecmwf_fallback_to_cmems(tmp_path, monkeypatch):
    """ECMWF returning nothing (outage / test env) must fall through to the CMEMS path."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as wave_svc
    import services.copernicus_marine_service as cms

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_MID_ECMWF", "1")
    monkeypatch.setenv("EURO_MID_RES", "10.0")

    called = {"cmems": False}

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10):
        return None

    async def fake_cmems(region, resolution, days):
        called["cmems"] = True
        return _mock_cmems_marine_points()

    monkeypatch.setattr(wave_svc, "fetch_euro_marine_waves_global", fake_ecmwf)
    monkeypatch.setattr(cms, "fetch_euro_marine_global_coarse", fake_cmems)

    ok = await scheduler.ingest_euro_marine_global_mid()
    assert ok is True
    assert called["cmems"] is True


def test_ecmwf_fetcher_declares_wave_layer():
    """The fetcher must request the probe-verified wave params on the wave stream (swh + mwd required;
    pp1d peak period primary with mwp mean fallback)."""
    from services import ecmwf_opendata_fetcher as f
    assert f.LAYER_PARAMS["waves"] == ["swh", "mwp", "pp1d", "mwd"]
    assert f.LAYER_STREAM["waves"] == "wave"
    assert f.LAYER_STREAM["wind"] == "oper"


def test_euro_mid_registration_default_on():
    """EURO_MARINE_MID_RES_INGEST defaults ON since the free-ECMWF source landed (2026-07-12) — a
    silent revert of the default re-creates the 'band only on GFS' hole."""
    import inspect
    from scheduler import forecast
    src = inspect.getsource(forecast.ingest_marine_forecast_task)
    assert 'os.environ.get("EURO_MARINE_MID_RES_INGEST", "1")' in src


# ── EURO marine COARSE-tier Gulf fix (2026-07-22): route the `waves` layer through ECMWF Open-Data
#    (has the Gulf/enclosed seas, where CMEMS structurally masks them), keep swells on CMEMS. Direct
#    port of the mid-tier hybrid (test_euro_marine_mid_ecmwf_* above). Kill: EURO_MARINE_COARSE_ECMWF. ──

async def _run_coarse_ingest(tmp_path, monkeypatch, coarse_ecmwf, ecmwf_returns):
    """Shared harness: mock both fetchers, run ingest_euro_marine_global, return (scheduler, called)."""
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    import services.ecmwf_wave_service as wave_svc
    import services.copernicus_marine_service as cms

    temp_store = ProductStore(cache_dir=tmp_path)
    scheduler = WeatherPipelineScheduler(store=temp_store)
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("EURO_MARINE_COARSE_ECMWF", coarse_ecmwf)

    called = {"ecmwf": False, "cmems": False}

    async def fake_ecmwf(bbox, resolution=2.0, forecast_days=10):
        called["ecmwf"] = True
        return _mock_ecmwf_wave_points() if ecmwf_returns else None

    async def fake_cmems(region, resolution, days):
        called["cmems"] = True
        return _mock_cmems_marine_points()

    monkeypatch.setattr(wave_svc, "fetch_euro_marine_waves_global", fake_ecmwf)
    monkeypatch.setattr(cms, "fetch_euro_marine_global_coarse", fake_cmems)

    ok = await scheduler.ingest_euro_marine_global()
    return temp_store, called, ok


def _coarse_prods(store, layer=None, native_only=False):
    out = []
    for p in store.get_manifest().products:
        if p.model == "EURO" and p.domain == "marine" and (p.region_id or "") == "global_coarse":
            if layer is not None and p.layer != layer:
                continue
            if native_only and p.is_estimated:
                continue
            out.append(p)
    return out


@pytest.mark.asyncio
async def test_euro_marine_coarse_ecmwf_direct(tmp_path, monkeypatch):
    """The `waves` layer is sourced from ECMWF (has the Gulf) with honest native provenance
    (provider='open-meteo' -> source_dataset='ecmwf_wam025'); swells stay on CMEMS."""
    store, called, ok = await _run_coarse_ingest(tmp_path, monkeypatch, "1", ecmwf_returns=True)
    assert ok is True
    assert called["ecmwf"] is True, "waves must be sourced from ECMWF (Gulf-covered)"
    assert called["cmems"] is True, "swells still need CMEMS"

    waves_native = _coarse_prods(store, layer="waves", native_only=True)
    assert waves_native, "expected a native EURO coarse waves product"
    for p in waves_native:
        assert p.provider == "open-meteo", "coarse waves must be ECMWF-sourced (Gulf-covered)"
        assert p.source_dataset == "ecmwf_wam025"
        assert p.is_estimated is False
        assert p.is_forecast_authoritative is True
    swells_native = [p for p in _coarse_prods(store)
                     if p.layer in ("swell_1", "swell_2", "wind_waves") and not p.is_estimated]
    assert swells_native, "expected native EURO coarse swell products"
    assert all(p.provider == "copernicus" for p in swells_native), "native swells stay on CMEMS"


@pytest.mark.asyncio
async def test_euro_marine_coarse_ecmwf_kill_switch(tmp_path, monkeypatch):
    """EURO_MARINE_COARSE_ECMWF=0 -> legacy CMEMS-primary waves (the Gulf drops again)."""
    store, called, ok = await _run_coarse_ingest(tmp_path, monkeypatch, "0", ecmwf_returns=True)
    assert ok is True
    assert called["ecmwf"] is False, "kill switch must gate the ECMWF service call"
    assert called["cmems"] is True

    waves_native = _coarse_prods(store, layer="waves", native_only=True)
    assert waves_native, "expected a native EURO coarse waves product"
    assert all(p.provider == "copernicus" for p in waves_native), "kill switch -> waves back on CMEMS"


@pytest.mark.asyncio
async def test_euro_marine_coarse_ecmwf_fallback_to_cmems(tmp_path, monkeypatch):
    """ECMWF fetch returns None (outage) -> `waves` falls back to CMEMS, no regression."""
    store, called, ok = await _run_coarse_ingest(tmp_path, monkeypatch, "1", ecmwf_returns=False)
    assert ok is True
    assert called["ecmwf"] is True, "ECMWF was attempted"
    assert called["cmems"] is True

    waves_native = _coarse_prods(store, layer="waves", native_only=True)
    assert waves_native, "expected a native EURO coarse waves product"
    assert all(p.provider == "copernicus" for p in waves_native), "ECMWF outage -> waves on CMEMS (no regression)"
