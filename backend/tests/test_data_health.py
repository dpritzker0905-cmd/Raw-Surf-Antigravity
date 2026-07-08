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
