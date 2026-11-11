"""ING-6 / ING-7 (audit 2026-11-10): a green run must have produced something, and the health horizon must read
the NEWEST run only.

ING-6: `run_spot_ratings_precompute` returns `(n, 0)` without raising when every model is refused or below
coverage, so `precompute_ci.main()` exited 0 with nothing published. The ingest entrypoint logged
`status=critical` and still returned 0.
ING-7: `data_health` took the max `valid_time_end` over ALL runs in a lane, so a newest run truncated to 144 h
still reported the older run's 240 h tail.
"""
import asyncio
import importlib.util
import logging
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from services.weather_pipeline.data_health import EXPECTED_LANES, compute_data_health
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest

SCRIPTS = Path(__file__).resolve().parents[1] / "scripts"
NOW = datetime(2026, 11, 10, 12, 0, 0, tzinfo=timezone.utc)
COV = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _load(name):
    spec = importlib.util.spec_from_file_location(f"_t_{name}", SCRIPTS / f"{name}.py")
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


# ── ING-7 ───────────────────────────────────────────────────────────────────────────────────────────────
def _p(model, domain, run_age_h, horizon_h, layer="waves"):
    rt = NOW - timedelta(hours=run_age_h)
    return ManifestProduct(
        model=model, provider="open-meteo", domain=domain, layer=layer,
        model_run_time=rt, model_run_time_status="known",
        run_time=rt, valid_time_start=rt, valid_time_end=NOW + timedelta(hours=horizon_h),
        resolution=10.0, freshness_sec=3600, is_forecast_authoritative=True, coverage=COV,
        filename=f"{model}_{domain}_{layer}_{run_age_h}_{horizon_h}.json", region_id="global_coarse",
        coverage_mode="global_tile", source_dataset="ncep_gfswave025")


class _Store:
    def __init__(self, products):
        self._m = PipelineManifest(last_manifest_update=NOW, products=products)

    def get_manifest(self):
        return self._m


def _gfs_marine_horizon(products):
    base = [_p(m, d, 1.0, 336.0) for (m, d) in EXPECTED_LANES if (m, d) != ("GFS", "marine")]
    h = compute_data_health(_Store(base + products), now=NOW)
    return h["lanes"]["GFS/marine"]["horizon_h"]


def test_horizon_ignores_an_older_runs_surviving_tail():
    newest_truncated = _p("GFS", "marine", 1.0, 144.0)
    older_full = _p("GFS", "marine", 7.0, 336.0)
    assert _gfs_marine_horizon([newest_truncated, older_full]) == 144.0
    assert _gfs_marine_horizon([older_full, newest_truncated]) == 144.0   # order independent


def test_truncated_newest_run_now_warns_on_horizon():
    base = [_p(m, d, 1.0, 336.0) for (m, d) in EXPECTED_LANES if (m, d) != ("GFS", "marine")]
    products = base + [_p("GFS", "marine", 1.0, 144.0), _p("GFS", "marine", 7.0, 336.0)]
    h = compute_data_health(_Store(products), now=NOW)
    assert h["lanes"]["GFS/marine"]["verdict"] == "warn"
    assert any("GFS/marine" in a and "horizon only" in a for a in h["alerts"])


def test_horizon_still_takes_the_furthest_product_within_the_newest_run():
    short_layer = _p("GFS", "marine", 1.0, 96.0, layer="waves")
    long_layer = _p("GFS", "marine", 1.0, 336.0, layer="period")
    assert _gfs_marine_horizon([short_layer, long_layer]) == 336.0
    assert _gfs_marine_horizon([long_layer, short_layer]) == 336.0


# ── ING-7 side effect: EURO 06/18Z cycles reach only 144 h ─────────────────────────────────────────────
def _euro_marine(cycle_hour, reach_h, run_age_h=1.0):
    cyc = NOW.replace(hour=cycle_hour) - timedelta(days=0 if cycle_hour <= NOW.hour else 1)
    p = _p("EURO", "marine", run_age_h, 0.0)
    return p.model_copy(update={"model_run_time": cyc, "valid_time_end": cyc + timedelta(hours=reach_h)})


def _euro_marine_lane(product):
    base = [_p(m, d, 1.0, 336.0) for (m, d) in EXPECTED_LANES if (m, d) != ("EURO", "marine")]
    return compute_data_health(_Store(base + [product]), now=NOW)["lanes"]["EURO/marine"]


@pytest.mark.parametrize("hour", [6, 18])
def test_euro_short_cycle_full_144h_reach_is_not_a_horizon_warn(hour):
    lane = _euro_marine_lane(_euro_marine(hour, 144.0))
    assert not any("horizon" in r for r in [lane.get("reason", "")]) and lane["verdict"] != "warn"


@pytest.mark.parametrize("hour", [6, 18])
def test_euro_short_cycle_truncated_below_its_own_reach_still_warns(hour):
    assert _euro_marine_lane(_euro_marine(hour, 96.0))["verdict"] == "warn"


@pytest.mark.parametrize("hour", [0, 12])
def test_euro_long_cycle_keeps_the_192h_floor(hour):
    assert _euro_marine_lane(_euro_marine(hour, 144.0))["verdict"] == "warn"
    assert _euro_marine_lane(_euro_marine(hour, 240.0))["verdict"] == "ok"


# ── ING-6: precompute ───────────────────────────────────────────────────────────────────────────────────
@pytest.fixture
def precompute(monkeypatch):
    mod = _load("precompute_ci")
    from services.weather_pipeline import prefetcher, spot_ratings_precompute, store

    class _FakeStore:
        def restore_from_supabase(self):
            return 5, []

    async def _noop():
        return None

    monkeypatch.setattr(store, "ProductStore", _FakeStore)
    monkeypatch.setattr(prefetcher, "prefetch_supabase_products", _noop)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    monkeypatch.setenv("SPOT_RATINGS_PRECOMPUTE", "1")
    monkeypatch.delenv("BUOY_CALIBRATION", raising=False)
    monkeypatch.delenv("REPORT_CALIBRATION", raising=False)
    monkeypatch.delenv("PRECOMPUTE_FAIL_ON_ZERO_FRAMES", raising=False)

    def _set(result):
        monkeypatch.setattr(spot_ratings_precompute, "run_spot_ratings_precompute", lambda: result)
        return mod

    return _set


def test_precompute_with_zero_frames_exits_nonzero(precompute):
    assert precompute((120, 0)).main() == 1


def test_precompute_with_frames_exits_zero(precompute):
    assert precompute((120, 4)).main() == 0


def test_precompute_zero_frame_kill_switch(precompute, monkeypatch):
    mod = precompute((120, 0))
    monkeypatch.setenv("PRECOMPUTE_FAIL_ON_ZERO_FRAMES", "0")
    assert mod.main() == 0


# ── ING-6: ingest ───────────────────────────────────────────────────────────────────────────────────────
def test_ingest_critical_health_is_nonzero_and_kill_switch_restores_green(monkeypatch):
    mod = _load("ingest_forecast_ci")
    monkeypatch.delenv("HEALTH_FAIL_ON_CRITICAL", raising=False)
    assert mod.health_is_critical({"status": "critical"}) is True
    assert mod.health_is_critical({"status": "warn"}) is False
    assert mod.health_is_critical({"status": "ok"}) is False
    assert mod.health_is_critical(None) is False
    monkeypatch.setenv("HEALTH_FAIL_ON_CRITICAL", "0")
    assert mod.health_is_critical({"status": "critical"}) is False


def test_ingest_main_returns_one_when_health_is_critical(monkeypatch):
    """End to end through _main: acknowledged uploads, but compute_data_health says critical."""
    mod = _load("ingest_forecast_ci")
    from scheduler import forecast
    from services.weather_pipeline import data_health, product_upload_progress, store

    class _Progress:
        def wait(self, _t):
            return {"submitted": 3, "acknowledged": 3, "pending": 0, "failed": 0}

    class _Ctx:
        def __enter__(self):
            return _Progress()

        def __exit__(self, *a):
            return False

    class _FakeStore:
        def restore_from_supabase(self):
            return 1, []

        def prune_duplicate_valid_times(self):
            return 0

        def _upload_to_supabase(self, *_a, **_k):
            return None

        def get_persistence_diagnostics(self):
            return {}

    monkeypatch.setattr(store, "ProductStore", _FakeStore)
    monkeypatch.setattr(forecast, "ingest_marine_forecast_task", lambda: None)
    monkeypatch.setattr(product_upload_progress, "collect_product_uploads", lambda: _Ctx())
    monkeypatch.setattr(data_health, "compute_data_health",
                        lambda _s: {"status": "critical", "alerts": ["x"], "freshest_run_age_h": 30})
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "test")
    for k in ("SPOT_RATINGS_PRECOMPUTE", "BUOY_CALIBRATION", "REPORT_CALIBRATION", "HEALTH_FAIL_ON_CRITICAL"):
        monkeypatch.delenv(k, raising=False)
    assert mod._main() == 1
    monkeypatch.setenv("HEALTH_FAIL_ON_CRITICAL", "0")
    assert mod._main() == 0
