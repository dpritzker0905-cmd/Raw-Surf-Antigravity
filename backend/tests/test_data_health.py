"""Hermetic tests for data_health.compute_data_health (2026-07-08). Pure/read-only — builds a manifest
in memory and asserts the freshness/presence/parity/horizon verdicts that catch the recurring
silent-staleness failure classes. No live sources (verification of LIVE flow is the cron's job)."""
from datetime import datetime, timezone, timedelta

from services.weather_pipeline.data_health import compute_data_health, EXPECTED_LANES
from services.weather_pipeline.schemas import PipelineManifest, ManifestProduct, CoverageBounds

NOW = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)
COV = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _p(model, domain, run_age_h=1.0, horizon_h=336.0, layer="waves"):
    rt = NOW - timedelta(hours=run_age_h)
    return ManifestProduct(
        model=model, provider="open-meteo", domain=domain, layer=layer,
        run_time=rt, valid_time_start=rt, valid_time_end=NOW + timedelta(hours=horizon_h),
        resolution=10.0, freshness_sec=3600, is_forecast_authoritative=True, coverage=COV,
        filename=f"{model}_{domain}_{layer}_global_coarse.json", region_id="global_coarse",
        coverage_mode="global_tile", source_dataset="ncep_gfswave025")


class _Store:
    def __init__(self, products):
        self._m = PipelineManifest(last_manifest_update=NOW, products=products)
    def get_manifest(self):
        return self._m


def _all_healthy():
    return [_p(m, d, run_age_h=1.0) for (m, d) in EXPECTED_LANES]


def test_all_lanes_fresh_is_ok():
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert rep["status"] == "ok"
    assert not rep["alerts"]
    assert len(rep["lanes"]) == len(EXPECTED_LANES)
    assert all(l["verdict"] == "ok" for l in rep["lanes"].values())


def test_missing_lane_is_critical():
    products = [_p(m, d) for (m, d) in EXPECTED_LANES if (m, d) != ("EURO", "marine")]
    rep = compute_data_health(_Store(products), now=NOW)
    assert rep["status"] == "critical"
    assert rep["lanes"]["EURO/marine"]["verdict"] == "critical"
    assert any("EURO/marine" in a and "MISSING" in a for a in rep["alerts"])


def test_cron_down_when_everything_is_old():
    # Every lane present but all ~13h old (cron stopped ~4 cycles ago) -> critical liveness.
    products = [_p(m, d, run_age_h=13.0) for (m, d) in EXPECTED_LANES]
    rep = compute_data_health(_Store(products), now=NOW)
    assert rep["status"] == "critical"
    assert any("cron appears DOWN" in a for a in rep["alerts"])


def test_one_lane_lagging_is_warn():
    # All fresh except ICON/marine which lags the freshest by ~8h (its DWD source silently degraded).
    products = _all_healthy()
    products = [p for p in products if not (p.model == "ICON" and p.domain == "marine")]
    products.append(_p("ICON", "marine", run_age_h=9.0))
    rep = compute_data_health(_Store(products), now=NOW)
    assert rep["status"] == "warn"
    assert rep["lanes"]["ICON/marine"]["verdict"] == "warn"
    assert any("ICON/marine" in a and "lags" in a for a in rep["alerts"])


def test_icon_native_short_horizon_is_NOT_warn():
    # ICON native is only ~5-7d (DWD limit, blended to 14d on the frontend). A fixed 7d floor would
    # cry-wolf on every ICON lane (the live-check false positive). Model-aware floor (ICON=96h) must
    # pass ICON lanes at their normal ~120-165h horizon while still catching a real collapse.
    products = [p for p in _all_healthy() if p.model != "ICON"]
    products.append(_p("ICON", "marine", run_age_h=1.0, horizon_h=152.0))
    products.append(_p("ICON", "wind", run_age_h=1.0, horizon_h=119.0))
    products.append(_p("ICON", "weather", run_age_h=1.0, horizon_h=164.0))
    rep = compute_data_health(_Store(products), now=NOW)
    assert rep["status"] == "ok", f"ICON native horizons should not warn: {rep['alerts']}"
    assert not any("ICON" in a for a in rep["alerts"])


def test_short_horizon_is_warn():
    # EURO/marine present + fresh but only extends 48h ahead (tail-loss, the EURO-estimates class).
    products = [p for p in _all_healthy() if not (p.model == "EURO" and p.domain == "marine")]
    products.append(_p("EURO", "marine", run_age_h=1.0, horizon_h=48.0))
    rep = compute_data_health(_Store(products), now=NOW)
    assert rep["status"] == "warn"
    assert any("EURO/marine" in a and "horizon" in a for a in rep["alerts"])


def test_empty_manifest_is_critical_not_a_crash():
    rep = compute_data_health(_Store([]), now=NOW)
    assert rep["status"] == "critical"
    assert rep["lanes"] == {}


def test_written_by_absent_is_surfaced_not_alerted():
    # Transition-safe: pre-gate manifests (and hermetic test manifests) carry no stamp — the report
    # exposes it for the monitor to annotate, but health itself stays quiet (audit #28).
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert rep["manifest_written_by"] is None
    assert rep["status"] == "ok"


def test_written_by_non_designated_writer_is_warn():
    # A non-designated writer on the SERVED manifest = the designated-writer gate was bypassed or
    # killed (the rogue-local-backend class, audit #28) — warn loudly with the identity.
    store = _Store(_all_healthy())
    store._m.written_by = "non-writer:some-dev-laptop"
    rep = compute_data_health(store, now=NOW)
    assert rep["status"] == "warn"
    assert rep["manifest_written_by"] == "non-writer:some-dev-laptop"
    assert any("NON-DESIGNATED" in a and "some-dev-laptop" in a for a in rep["alerts"])


def test_written_by_designated_writer_is_clean():
    store = _Store(_all_healthy())
    store._m.written_by = "designated:gh-run-29138494882"
    rep = compute_data_health(store, now=NOW)
    assert rep["status"] == "ok"
    assert rep["manifest_written_by"] == "designated:gh-run-29138494882"
    assert not rep["alerts"]


# ── ratings/precomputed lane (2026-07-13, melt round 4: the lane that was invisible while it froze 9h) ──
def _ratings_obj(frame_ages_h):
    return {"frames": [{"model": "GFS", "valid_time": (NOW - timedelta(hours=h)).strftime("%Y-%m-%dT%H:00:00Z"),
                        "spots": []} for h in frame_ages_h]}


def _with_ratings(monkeypatch, obj):
    from services.weather_pipeline import spot_ratings as sr
    from services.weather_pipeline import copernicus_validator as cv
    monkeypatch.setenv("SUPABASE_URL", "https://example.supabase.co")
    monkeypatch.setattr(cv, "is_test_environment", lambda: False)   # simulate the real serve box
    monkeypatch.setattr(sr, "load_spot_ratings_l2_cached", lambda: obj)


def test_ratings_lane_absent_in_test_env_and_without_supabase():
    # pytest = test environment → lane intentionally absent (also absent without SUPABASE_URL),
    # so every hermetic manifest test above is untouched by the ratings lane.
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert "ratings/precomputed" not in rep["lanes"]
    assert rep["status"] == "ok"


def test_ratings_lane_fresh_is_ok(monkeypatch):
    _with_ratings(monkeypatch, _ratings_obj([1.0, 4.0]))  # newest frame 1h old
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    lane = rep["lanes"]["ratings/precomputed"]
    assert lane["verdict"] == "ok" and lane["age_h"] == 1.0 and lane["frames"] == 2
    assert rep["status"] == "ok"


def test_ratings_lane_missed_cadence_is_warn(monkeypatch):
    _with_ratings(monkeypatch, _ratings_obj([5.0]))       # past the 3.5h cadence, inside the 6h stale bound
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert rep["lanes"]["ratings/precomputed"]["verdict"] == "warn"
    assert rep["status"] == "warn"
    assert any("missing their cadence" in a for a in rep["alerts"])


def test_ratings_lane_past_stale_bound_is_critical_melt_risk(monkeypatch):
    _with_ratings(monkeypatch, _ratings_obj([9.0]))       # the 07-13 shape: frozen past the 6h stale bound
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert rep["lanes"]["ratings/precomputed"]["verdict"] == "critical"
    assert rep["status"] == "critical"                    # -> /health/data returns 503 -> external probe pages
    assert any("melt risk" in a for a in rep["alerts"])


def test_ratings_lane_empty_object_is_critical(monkeypatch):
    _with_ratings(monkeypatch, {"frames": []})
    rep = compute_data_health(_Store(_all_healthy()), now=NOW)
    assert rep["lanes"]["ratings/precomputed"]["verdict"] == "critical"
    assert any("live path" in a for a in rep["alerts"])
