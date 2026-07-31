"""ALL THREE wind pilots take the multi-bbox path — GFS, ICON and EURO together.

WHY ALL THREE, AND WHY IN ONE FILE. Porting GFS alone would have created a refresh ASYMMETRY that
does not exist today. Measured live 2026-07-31 21:26Z, the 3-model 10 m wind spread at the starved
pair was NO WORSE than at fresh sites:

    uk_ireland     (29.9/29.8/29.3 h old)   GFS 9.0 / ICON 6.8 / EURO 6.3 kt   spread 2.7 kt
    east_australia (29.9/29.8/29.3 h old)   GFS 6.2 / ICON 3.7 / EURO 6.7 kt   spread 3.0 kt
    hawaii    FRESH ( 6.8/ 6.8/ 6.5 h old)  GFS 17.0 / ICON 17.9 / EURO 16.4   spread 1.5 kt
    florida   FRESH ( 6.8/ 6.8/ 6.5 h old)  GFS 7.9 / ICON 4.4 / EURO 5.2      spread 3.6 kt

That refutes "stale => models disagree" as a CURRENT effect: the three wind pilots run back-to-back
in one job and select the same region pair, so staleness is SYMMETRIC. But it is exactly why a
partial port is dangerous — with GFS covering 10 regions/fire and ICON/EURO covering 2, a starved
pair would read current on GFS and 30 h old on the other two. The obs gate grants Good/Epic only
where >=2 models agree, so the disagreement would be self-inflicted and would cap real ratings.

The parametrization below is the guard: adding a 4th wind model, or reverting one of the three,
fails here rather than silently reintroducing the asymmetry.
"""
import pytest
from datetime import datetime, timezone, timedelta

# (model, ingest method, service module, multi fn name, per-region fn name, direct-fetch kill switch)
LANES = [
    ("GFS",  "ingest_gfs_wind_pilot",  "services.noaa_wind_service",
     "fetch_gfs_wind_regions",  "fetch_gfs_wind_global_coarse",  "GFS_WIND_NOAA_DIRECT"),
    ("ICON", "ingest_icon_wind_pilot", "services.dwd_wind_service",
     "fetch_icon_wind_regions", "fetch_icon_wind_global_coarse", "ICON_WIND_DWD_DIRECT"),
    ("EURO", "ingest_euro_wind_pilot", "services.ecmwf_wind_service",
     "fetch_euro_wind_regions", "fetch_euro_wind_global_coarse", "EURO_WIND_ECMWF_DIRECT"),
]
IDS = [l[0] for l in LANES]


def _wind_points(om_provider, region, resolution=0.25):
    lats, lons = om_provider.generate_grid_coords(region, resolution)
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=3 * h)).strftime("%Y-%m-%dT%H:%M:%SZ") for h in range(6)]
    return [{
        "latitude": lat, "longitude": lon, "__provider": "test",
        "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
        "hourly": {"time": times,
                   "wind_speed_10m": [7.5 for _ in times],
                   "wind_direction_10m": [45.0 for _ in times]},
    } for lat, lon in zip(lats, lons)]


def _mk(tmp_path, monkeypatch):
    from services.weather_pipeline.scheduler import WeatherPipelineScheduler
    from services.weather_pipeline.store import ProductStore
    monkeypatch.setenv("NODE_ENV", "test")
    monkeypatch.setenv("WIND_PILOT_FORECAST_DAYS", "1")
    return WeatherPipelineScheduler(store=ProductStore(cache_dir=tmp_path))


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_one_pass_covers_every_region(tmp_path, monkeypatch, model, method, svc,
                                            multi_fn, single_fn, killsw):
    """Exactly ONE download pass per model, covering the whole pilot region set."""
    import importlib
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    sched = _mk(tmp_path, monkeypatch)
    mod = importlib.import_module(svc)
    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        calls.append(dict(bboxes))
        return {rid: _wind_points(sched.om_provider, bb, 5.0) for rid, bb in bboxes.items()}

    monkeypatch.setattr(mod, multi_fn, fake_multi)
    assert await getattr(sched, method)() is True
    assert len(calls) == 1, f"{model}: {len(calls)} passes — must be exactly one"
    assert set(calls[0]) == set(REGIONAL_CONFIGS)      # test env = flagship set

    saved = {p.region_id for p in sched.store.get_manifest().products
             if p.model == model and p.domain == "wind"}
    assert set(REGIONAL_CONFIGS).issubset(saved), f"{model} missing {set(REGIONAL_CONFIGS) - saved}"


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_pass_covers_all_worldwide_regions_not_a_rotating_slice(
        tmp_path, monkeypatch, model, method, svc, multi_fn, single_fn, killsw):
    """THE ASSERTION THAT DISCRIMINATES. Under pytest both selectors return flagship-only, so a
    flagship-set check passes with the rotating selector too and proves nothing. Lift the test-env
    short-circuit and only the non-rotating selector can cover all 10."""
    import importlib
    from services.weather_pipeline.scheduler_helpers import (
        REGIONAL_CONFIGS, WORLDWIDE_COASTAL_REGIONS)
    from services.weather_pipeline import copernicus_validator
    sched = _mk(tmp_path, monkeypatch)
    monkeypatch.setenv("WORLDWIDE_COASTAL", "1")
    monkeypatch.setenv("WORLDWIDE_REGIONS_PER_CYCLE", "2")
    monkeypatch.setattr(copernicus_validator, "is_test_environment", lambda: False)
    mod = importlib.import_module(svc)
    calls = []

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        calls.append(dict(bboxes))
        return {rid: _wind_points(sched.om_provider, bb, 5.0) for rid, bb in bboxes.items()}

    monkeypatch.setattr(mod, multi_fn, fake_multi)
    assert await getattr(sched, method)() is True
    expected = set(REGIONAL_CONFIGS) | set(WORLDWIDE_COASTAL_REGIONS)
    assert len(calls) == 1 and set(calls[0]) == expected, (
        f"{model} covered {len(calls[0]) if calls else 0} regions, expected all {len(expected)} — "
        "a rotating slice would cover only 2 worldwide regions")


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_one_run_time_across_regions(tmp_path, monkeypatch, model, method, svc,
                                           multi_fn, single_fn, killsw):
    """Per-region passes produced a staircase of run_times — the signal that made the starvation
    hard to see. One pass, one run_time."""
    import importlib
    sched = _mk(tmp_path, monkeypatch)
    mod = importlib.import_module(svc)

    async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        return {rid: _wind_points(sched.om_provider, bb, 5.0) for rid, bb in bboxes.items()}

    monkeypatch.setattr(mod, multi_fn, fake_multi)
    await getattr(sched, method)()
    runs = {p.run_time for p in sched.store.get_manifest().products
            if p.model == model and p.domain == "wind"}
    assert len(runs) == 1, f"{model}: {len(runs)} distinct run_times — not a single pass"


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_falls_back_to_per_region_when_multi_yields_nothing(
        tmp_path, monkeypatch, model, method, svc, multi_fn, single_fn, killsw):
    """A throughput optimisation must not become a single point of failure."""
    import importlib
    from services.weather_pipeline.scheduler_helpers import REGIONAL_CONFIGS
    sched = _mk(tmp_path, monkeypatch)
    mod = importlib.import_module(svc)

    async def no_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        return None

    async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None, **kw):
        return _wind_points(sched.om_provider, bbox, 5.0)

    monkeypatch.setattr(mod, multi_fn, no_multi)
    monkeypatch.setattr(mod, single_fn, per_region)
    assert await getattr(sched, method)() is True
    saved = {p.region_id for p in sched.store.get_manifest().products
             if p.model == model and p.domain == "wind"}
    assert set(REGIONAL_CONFIGS).issubset(saved), f"{model} fallback shipped nothing"


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_raising_multi_fetch_does_not_kill_the_job(
        tmp_path, monkeypatch, model, method, svc, multi_fn, single_fn, killsw):
    """One bad fetch costs the multi pass, not the whole pilot."""
    import importlib
    sched = _mk(tmp_path, monkeypatch)
    mod = importlib.import_module(svc)

    async def boom(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
        raise RuntimeError("upstream 503")

    async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None, **kw):
        return _wind_points(sched.om_provider, bbox, 5.0)

    monkeypatch.setattr(mod, multi_fn, boom)
    monkeypatch.setattr(mod, single_fn, per_region)
    assert await getattr(sched, method)() is True


@pytest.mark.parametrize("model,method,svc,multi_fn,single_fn,killsw", LANES, ids=IDS)
@pytest.mark.asyncio
async def test_kill_switches_skip_the_multi_pass(tmp_path, monkeypatch, model, method, svc,
                                                 multi_fn, single_fn, killsw):
    """WIND_PILOT_MULTI_BBOX=0 and each model's *_DIRECT=0 must both prevent the multi fetch."""
    import importlib
    for env_key in ("WIND_PILOT_MULTI_BBOX", killsw):
        sched = _mk(tmp_path / env_key, monkeypatch)
        monkeypatch.setenv(env_key, "0")
        mod = importlib.import_module(svc)
        called = []

        async def fake_multi(bboxes, resolution=0.25, forecast_days=8, timeout_s=1800):
            called.append(1)
            return {}

        async def per_region(bbox, resolution=0.25, forecast_days=8, timeout_sec=None, **kw):
            return _wind_points(sched.om_provider, bbox, 5.0)

        monkeypatch.setattr(mod, multi_fn, fake_multi)
        monkeypatch.setattr(mod, single_fn, per_region)
        await getattr(sched, method)()
        assert not called, f"{model}: {env_key}=0 did not prevent the multi-bbox fetch"
        monkeypatch.delenv(env_key, raising=False)


def test_every_wind_model_is_wired_to_the_multi_path():
    """THE ASYMMETRY GUARD. If a 4th wind model appears, or one of these three loses its multi
    wrapper, this fails — rather than letting refresh coverage diverge across models and turn the
    obs gate's >=2-model agreement into an artifact of our own ingest schedule."""
    import importlib
    from services.weather_pipeline import wind_ingestion as wi

    for model, method, svc, multi_fn, _single, _k in LANES:
        mod = importlib.import_module(svc)
        assert hasattr(mod, multi_fn), f"{model}: {svc}.{multi_fn} missing"

    src = __import__("inspect").getsource(wi)
    for model, _m, _s, multi_fn, _sg, _k in LANES:
        assert multi_fn in src, f"{model}: wind_ingestion never calls {multi_fn}"
    # exactly three wind pilots, all routed through the shared pass
    assert src.count("await multi_bbox_wind_pass(") == len(LANES)
