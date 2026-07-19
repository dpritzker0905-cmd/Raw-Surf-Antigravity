"""
Queue #5 (2026-07-19): NATIVE-upstream background recovery for the wind dynamic viewport lane.

When the dynamic wind lane's open-meteo fetch fails (rate limit / timeout / negative cache), the
request keeps serving the instant stale/coarse fallback, and wind_native_recovery spawns ONE
background task that fetches the same snapped bbox from the model's native upstream (GFS→NOAA,
ICON→DWD, EURO→ECMWF) and persists it through the standard dynamic-viewport pipeline — so the
client's next refetch upgrades from cache.

This is the ENUMERATING gate (every spawn guard asserted one by one — the soak-agreement lesson:
sampling hides per-branch failures) plus the end-to-end recovery integration proof and the
route-level wiring proof for BOTH hook sites (exception ladder + negative-cache hit).
"""
import asyncio
import os
from datetime import datetime, timezone, timedelta

import pytest
from fastapi.testclient import TestClient

from server import app
from services.weather_pipeline import wind_native_recovery as wnr
from services.weather_pipeline.viewport_service import ViewportService
from services.weather_pipeline.route_helpers import build_dynamic_cache_key
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

client = TestClient(app, raise_server_exceptions=False)

BBOX = dict(west=-85.0, south=24.0, east=-80.0, north=30.0)  # 5° Gulf box, GFS 1° snap = identity
BBOX_STR = "-85,24,-80,30"
BBOX_KEY = "-85.00_24.00_-80.00_30.00"


@pytest.fixture(autouse=True)
def _clean_recovery_state():
    """Recovery registries are module-level; isolate every test. The cached semaphore binds to the
    first event loop that awaits it — each test runs its own asyncio.run loop, so re-derive it.
    ProductStore._product_cache is CLASS-level and keyed by filename only: two tests that persist
    the same {model,hour,bbox} would cross-serve each other's in-memory products — clear it."""
    from services.weather_pipeline.store import ProductStore

    def _reset():
        wnr.RECOVERY_TASKS.clear()
        wnr.RECOVERY_COOLDOWN.clear()
        wnr._RECOVERY_SEMAPHORE = None
        with ProductStore._product_cache_lock:
            ProductStore._product_cache.clear()
            ProductStore._product_cache_vectors.clear()

    _reset()
    yield
    for t in wnr.RECOVERY_TASKS.values():
        if not t.done():
            t.cancel()
    _reset()


def _spawn(service, **overrides):
    kwargs = dict(
        model="GFS", domain="wind", layer="wind",
        target_dt=datetime.now(timezone.utc),
        west=BBOX["west"], south=BBOX["south"], east=BBOX["east"], north=BBOX["north"],
        resolution=1.0, bbox_str=BBOX_STR, bbox_key_str=BBOX_KEY,
        coverage_scope="viewport",
    )
    kwargs.update(overrides)
    return wnr.maybe_spawn_native_wind_recovery(service, **kwargs)


def _run_guard_matrix(monkeypatch):
    """Every guard branch, enumerated. Runs inside one event loop."""
    spawned_runs = []

    async def fake_recovery(service, **kwargs):
        spawned_runs.append(kwargs["model"])

    monkeypatch.setattr(wnr, "_run_native_recovery", fake_recovery)
    service = object()  # never touched by the guards or the fake

    async def scenario():
        results = {}
        # kill switch
        monkeypatch.setenv("WIND_NATIVE_VIEWPORT_FALLBACK", "0")
        results["kill_switch"] = _spawn(service)
        monkeypatch.delenv("WIND_NATIVE_VIEWPORT_FALLBACK", raising=False)
        # domain gate
        results["marine_domain"] = _spawn(service, domain="marine", layer="waves")
        # scope gate — a recovery must never build a world-span dynamic product
        results["global_scope"] = _spawn(service, coverage_scope="global_coarse")
        # unmapped model
        results["unknown_model"] = _spawn(service, model="NAM")
        # happy paths, one per mapped model
        results["gfs"] = _spawn(service)
        results["icon"] = _spawn(service, model="ICON", bbox_key_str="-86.00_24.00_-80.00_30.00")
        results["euro"] = _spawn(service, model="EURO", bbox_key_str="-86.00_24.00_-80.00_30.00")
        # dedup: same {model,bbox} while in flight (fake returns instantly but the task object
        # is still registered; cooldown also blocks) — must NOT double-spawn
        results["dup_key"] = _spawn(service)
        await asyncio.sleep(0)  # let fakes run
        # cooldown: task done, cooldown still active → blocked
        results["cooldown"] = _spawn(service)
        # cooldown expired → allowed again
        wnr.RECOVERY_COOLDOWN["GFS_" + BBOX_KEY] = 0.0
        results["cooldown_expired"] = _spawn(service)
        await asyncio.sleep(0)
        return results

    return asyncio.run(scenario()), spawned_runs


def test_spawn_guards_enumerated(monkeypatch):
    results, spawned_runs = _run_guard_matrix(monkeypatch)
    assert results["kill_switch"] is False
    assert results["marine_domain"] is False
    assert results["global_scope"] is False
    assert results["unknown_model"] is False
    assert results["gfs"] is True
    assert results["icon"] is True
    assert results["euro"] is True
    assert results["dup_key"] is False
    assert results["cooldown"] is False
    assert results["cooldown_expired"] is True
    assert spawned_runs.count("GFS") == 2 and "ICON" in spawned_runs and "EURO" in spawned_runs


def test_fetcher_mapping_resolves_to_real_callables():
    """The model map must point at importable async callables — catches renames/signature drift."""
    import importlib
    import inspect
    for model, (mod_path, fn_name, days) in wnr._NATIVE_WIND_FETCHERS.items():
        fn = getattr(importlib.import_module(mod_path), fn_name)
        assert inspect.iscoroutinefunction(fn), f"{model}: {fn_name} is not async"
        params = inspect.signature(fn).parameters
        assert "timeout_sec" in params, f"{model}: {fn_name} lacks timeout_sec pass-through"
        assert days >= 2


def test_native_forecast_days_defaults_and_override(monkeypatch):
    monkeypatch.delenv("WIND_NATIVE_RECOVERY_FORECAST_DAYS", raising=False)
    assert wnr.native_forecast_days("GFS") == 16
    assert wnr.native_forecast_days("ICON") == 5
    assert wnr.native_forecast_days("EURO") == 5
    monkeypatch.setenv("WIND_NATIVE_RECOVERY_FORECAST_DAYS", "3")
    assert wnr.native_forecast_days("GFS") == 3


def _fake_native_points(bbox, resolution, times, speed_ms=10.0, direction=90.0):
    """Open-Meteo-shaped point dicts exactly as the native fetchers emit them (m/s + °from)."""
    from services._fetch_common import coarse_axis
    lats = coarse_axis(bbox["south"], bbox["north"], resolution)
    lons = coarse_axis(bbox["west"], bbox["east"], resolution)
    points = []
    for la in lats:
        for lo in lons:
            points.append({
                "latitude": float(la), "longitude": float(lo),
                "generationtime_ms": 0, "utc_offset_seconds": 0,
                "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                "__provider": "noaa",
                "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
                "hourly": {
                    "time": list(times),
                    "wind_speed_10m": [speed_ms] * len(times),
                    "wind_direction_10m": [direction] * len(times),
                },
            })
    return points


def test_recovery_persists_and_next_request_upgrades(mock_weather_setup, monkeypatch):
    """End-to-end: _run_native_recovery → normalize/persist/index → the NEXT dynamic-lane cache
    lookup returns the fine product with correctly converted values (10 m/s → ~19.44 kn)."""
    store, dynamic_idx = mock_weather_setup
    service = ViewportService(store=store, dynamic_index=dynamic_idx)

    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * i)).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(9)]
    target_dt = base + timedelta(hours=6)  # exactly on a 3-hourly step

    calls = {}

    async def fake_fetch(bbox, resolution, forecast_days, timeout_sec=None):
        calls["args"] = (bbox, resolution, forecast_days, timeout_sec)
        return _fake_native_points(bbox, resolution, times)

    import services.noaa_wind_service as noaa_svc
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", fake_fetch)

    asyncio.run(wnr._run_native_recovery(
        service, model="GFS", layer="wind", target_dt=target_dt,
        west=BBOX["west"], south=BBOX["south"], east=BBOX["east"], north=BBOX["north"],
        resolution=1.0, bbox_str=BBOX_STR, bbox_key_str=BBOX_KEY,
    ))

    # forecast days honored + subprocess timeout forwarded
    assert calls["args"][2] == wnr.native_forecast_days("GFS")
    assert calls["args"][3] and calls["args"][3] > 0

    # target hour persisted under the standard dynamic cache key
    cache_key = build_dynamic_cache_key("GFS", "wind", "wind", target_dt,
                                        BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"])
    assert (store.cache_dir / f"{cache_key}.json").exists(), "target-hour product not persisted"

    # the next request's cache lookup upgrades to the fine product
    product = asyncio.run(service.get_cached_dynamic_product("GFS", "wind", "wind", target_dt, BBOX_STR))
    assert product is not None, "recovered product not found by the standard cache lookup"
    assert product.is_dynamic_viewport_product is True
    assert product.grid and product.grid.vectors
    speeds = [v.speed for v in product.grid.vectors if v.speed > 0]
    assert speeds, "recovered grid has no nonzero speeds"
    assert abs(speeds[0] - 19.43844) < 0.05, f"m/s→kn conversion broken: {speeds[0]}"

    # remaining hours persisted too (scrub coverage): another 3-hourly step is in cache
    other_dt = base + timedelta(hours=12)
    other_key = build_dynamic_cache_key("GFS", "wind", "wind", other_dt,
                                        BBOX["west"], BBOX["south"], BBOX["east"], BBOX["north"])
    assert (store.cache_dir / f"{other_key}.json").exists(), "remaining hours not persisted"


def test_route_failure_spawns_recovery_and_marine_does_not(mock_weather_setup, monkeypatch):
    """Route-level wiring: a failed FINE wind fetch calls the spawn hook (exception ladder AND the
    negative-cache path on the immediate retry); a failed marine fetch never spawns."""
    calls = []

    def recorder(service, **kwargs):
        calls.append(kwargs)
        return False  # do not actually create tasks inside the TestClient loop

    import services.weather_pipeline.viewport_service as vps
    monkeypatch.setattr(vps, "maybe_spawn_native_wind_recovery", recorder)

    async def failing_fetch_grid(*args, **kwargs):
        raise Exception("429 Too Many Requests")
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", failing_fetch_grid)

    valid_time = (datetime.now(timezone.utc) + timedelta(hours=6)).strftime("%Y-%m-%dT%H:%M:%SZ")

    # 1st wind request → upstream fails → exception-ladder hook
    r1 = client.get(f"/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time={valid_time}&bbox={BBOX_STR}")
    assert r1.status_code != 500, r1.text[:300]
    wind_calls = [c for c in calls if c["domain"] == "wind"]
    assert len(wind_calls) >= 1, "exception-ladder hook did not fire for wind"
    assert wind_calls[0]["model"] == "GFS"
    assert wind_calls[0]["coverage_scope"] == "viewport"
    assert wind_calls[0]["west"] == -85.0 and wind_calls[0]["north"] == 30.0  # snapped bbox forwarded

    # 2nd wind request inside the negative-cache TTL → negative-cache hook
    n_before = len(calls)
    r2 = client.get(f"/api/weather/grid?model=GFS&domain=wind&layer=wind&valid_time={valid_time}&bbox={BBOX_STR}")
    assert r2.status_code != 500
    assert len(calls) > n_before, "negative-cache hook did not fire on the immediate retry"

    # marine failure reaches the hook site but the REAL guard refuses marine — assert via the
    # real function (recorder removed) and an untouched task registry
    monkeypatch.setattr(vps, "maybe_spawn_native_wind_recovery", wnr.maybe_spawn_native_wind_recovery)
    rm = client.get(f"/api/weather/grid?model=GFS&domain=marine&layer=waves&valid_time={valid_time}&bbox={BBOX_STR}")
    assert rm.status_code != 500
    assert not wnr.RECOVERY_TASKS, "marine failure must never spawn a wind native recovery"


# ── Third forensic pass: failure semantics + the REAL subprocess boundary ──


def test_failed_recovery_no_partial_persist_and_cooldown_selfheals(mock_weather_setup, monkeypatch):
    """A native fetch that returns None (the wrapper's contract on ANY failure) must persist
    NOTHING, and the key must stay on cooldown until expiry, then spawn again."""
    store, dynamic_idx = mock_weather_setup
    service = ViewportService(store=store, dynamic_index=dynamic_idx)

    async def none_fetch(bbox, resolution, forecast_days, timeout_sec=None):
        return None

    import services.noaa_wind_service as noaa_svc
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", none_fetch)

    async def scenario():
        assert _spawn(service) is True
        await wnr.RECOVERY_TASKS["GFS_" + BBOX_KEY]
        blocked = _spawn(service)          # cooldown active
        wnr.RECOVERY_COOLDOWN["GFS_" + BBOX_KEY] = 0.0
        respawned = _spawn(service)        # cooldown expired → self-heals
        await wnr.RECOVERY_TASKS["GFS_" + BBOX_KEY]
        return blocked, respawned

    blocked, respawned = asyncio.run(scenario())
    assert blocked is False and respawned is True
    leftovers = list(store.cache_dir.glob("viewport_gfs_wind_*.json"))
    assert not leftovers, f"failed recovery must not partially persist: {leftovers}"


def test_real_subprocess_boundary_round_trip(mock_weather_setup, monkeypatch, tmp_path):
    """Drive the recovery through the REAL run_fetcher_subprocess plumbing (payload JSON → child
    process → output file → parse) with a stand-in fetcher script, then the full normalize/persist
    chain. pygrib is Linux-only in prod, so the GRIB decode itself is the one link not exercised —
    everything else is the production path."""
    import textwrap
    store, dynamic_idx = mock_weather_setup
    service = ViewportService(store=store, dynamic_index=dynamic_idx)

    script = tmp_path / "fake_wind_fetcher.py"
    script.write_text(textwrap.dedent("""
        import json, sys
        from datetime import datetime, timezone, timedelta
        payload = json.loads(sys.argv[1])
        bbox = payload["bbox"]; res = float(payload["resolution"])
        base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
        times = [(base + timedelta(hours=3*i)).strftime("%Y-%m-%dT%H:%M:%SZ") for i in range(9)]
        def axis(lo, hi, step):
            vals = []
            v = lo
            while v <= hi + 1e-9:
                vals.append(round(v, 6)); v += step
            return vals
        points = []
        for la in axis(bbox["south"], bbox["north"], res):
            for lo in axis(bbox["west"], bbox["east"], res):
                points.append({
                    "latitude": la, "longitude": lo,
                    "generationtime_ms": 0, "utc_offset_seconds": 0,
                    "timezone": "GMT", "timezone_abbreviation": "GMT", "elevation": 0,
                    "__provider": "noaa",
                    "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "\\u00b0"},
                    "hourly": {"time": times,
                               "wind_speed_10m": [7.5]*len(times),
                               "wind_direction_10m": [225.0]*len(times)},
                })
        with open(payload["output_path"], "w") as f:
            json.dump(points, f)
        print("SUMMARY: points=%d (stand-in fetcher)" % len(points))
    """))

    import services._fetch_common as fc
    monkeypatch.setattr(fc, "is_test_environment", lambda: False)  # let the subprocess really spawn

    async def real_boundary_fetch(bbox, resolution, forecast_days, timeout_sec=None):
        return await fc.run_fetcher_subprocess(
            str(script), bbox, resolution, forecast_days,
            log_tag="TEST-WIND", out_prefix="testwind",
            timeout=timeout_sec or 60,
        )

    import services.noaa_wind_service as noaa_svc
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", real_boundary_fetch)

    base = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    target_dt = base + timedelta(hours=6)
    asyncio.run(wnr._run_native_recovery(
        service, model="GFS", layer="wind", target_dt=target_dt,
        west=BBOX["west"], south=BBOX["south"], east=BBOX["east"], north=BBOX["north"],
        resolution=1.0, bbox_str=BBOX_STR, bbox_key_str=BBOX_KEY,
    ))

    product = asyncio.run(service.get_cached_dynamic_product("GFS", "wind", "wind", target_dt, BBOX_STR))
    assert product is not None, "subprocess-boundary recovery did not persist a servable product"
    speeds = [v.speed for v in product.grid.vectors if v.speed > 0]
    assert speeds and abs(speeds[0] - 7.5 * 1.943844) < 0.05


def test_semaphore_serializes_concurrent_recoveries(mock_weather_setup, monkeypatch):
    """WIND_NATIVE_RECOVERY_CONCURRENCY=1 must serialize two recoveries for different bboxes —
    the 512MB-box protection (one full-globe GRIB decode at a time)."""
    store, dynamic_idx = mock_weather_setup
    service = ViewportService(store=store, dynamic_index=dynamic_idx)
    monkeypatch.setenv("WIND_NATIVE_RECOVERY_CONCURRENCY", "1")
    events = []

    async def slow_fetch(bbox, resolution, forecast_days, timeout_sec=None):
        events.append(("start", bbox["west"]))
        await asyncio.sleep(0.05)
        events.append(("end", bbox["west"]))
        return None

    import services.noaa_wind_service as noaa_svc
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", slow_fetch)

    async def scenario():
        assert _spawn(service) is True
        assert _spawn(service, west=-95.0, bbox_key_str="-95.00_24.00_-80.00_30.00") is True
        await asyncio.gather(*wnr.RECOVERY_TASKS.values())

    asyncio.run(scenario())
    assert len(events) == 4
    # strict serialization: first recovery fully finishes before the second starts
    assert events[0][0] == "start" and events[1] == ("end", events[0][1])
    assert events[2][0] == "start" and events[3] == ("end", events[2][1])
