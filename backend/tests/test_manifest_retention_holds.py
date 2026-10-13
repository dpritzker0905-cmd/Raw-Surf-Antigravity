"""Manifest retention must hold across uploads (audit 15.0, 2026-09-26).

THE DEFECT. The cadence prune drops products past the retention cutoff and passes `exclude_keys`, but
its manifest upload is only QUEUED. The same lane's next save reconciles WITHOUT exclusions while the
remote still holds the pruned entries, and folds them straight back. Measured on core ingest
36244160502: prune at 14:22:27, then "folded in 1135 concurrent-writer entries" at 14:22:30. The live
manifest carried 1,324 products older than the 2-day cutoff out of 15,901 that afternoon (including 28
per stale island region), so the retention the prune exists to enforce never stuck. A lane whose
snapshot was restored before another lane's prune re-uploads the pruned entries the same way.
"""
import json
from datetime import datetime, timedelta, timezone

import pytest

import services.weather_pipeline.store as store_mod
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import (
    manifest_retention_cutoff, reconcile_manifest_products_for_upload,
)

NOW = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)


def _product(pid, days_ago):
    vt = NOW - timedelta(days=days_ago)
    return ManifestProduct(
        model="EURO", provider="copernicus", domain="marine", layer="swell_1",
        run_time=vt, valid_time_start=vt, valid_time_end=vt, resolution=0.083,
        freshness_sec=3600, is_forecast_authoritative=True,
        coverage=CoverageBounds(west=-28.0, south=36.0, east=-24.0, north=40.0),
        filename=pid, product_id=pid,
    )


def _raw(pid, days_ago):
    return json.loads(_product(pid, days_ago).model_dump_json())


def _manifest(*items):
    return PipelineManifest(last_manifest_update=NOW, products=[_product(p, d) for p, d in items])


def test_a_pruned_entry_the_remote_still_holds_is_not_folded_back(monkeypatch):
    """THE OBSERVED SEQUENCE: after the prune, the next save reconciles with no exclusions."""
    manifest = _manifest(("fresh.json", 0))                     # post-prune local snapshot
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [
        _raw("fresh.json", 0),
        _raw("island_azores_old.json", 3),                       # pruned locally, prune upload queued
        _raw("concurrent_new.json", 0),                          # a real concurrent registration
    ])
    folded = reconcile_manifest_products_for_upload(manifest)    # NO exclude_keys, as in the save path
    names = {p.filename for p in manifest.products}
    assert "island_azores_old.json" not in names, "the prune was undone by the next upload"
    assert names == {"fresh.json", "concurrent_new.json"} and folded == 1


def test_a_stale_snapshot_does_not_reupload_its_own_expired_entries(monkeypatch):
    """A lane that restored before another lane's prune still holds the old entries itself."""
    manifest = _manifest(("fresh.json", 0), ("old_restored.json", 4))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [_raw("fresh.json", 0)])
    reconcile_manifest_products_for_upload(manifest)
    assert {p.filename for p in manifest.products} == {"fresh.json"}


def test_an_entry_inside_the_window_is_kept_on_both_sides(monkeypatch):
    manifest = _manifest(("yesterday.json", 1))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                        lambda: [_raw("yesterday.json", 1), _raw("other_recent.json", 1.5)])
    reconcile_manifest_products_for_upload(manifest)
    assert {p.filename for p in manifest.products} == {"yesterday.json", "other_recent.json"}


def test_the_window_is_the_one_policy_env(monkeypatch):
    monkeypatch.setenv("MANIFEST_RETENTION_DAYS", "5")
    manifest = _manifest(("four_days.json", 4))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [_raw("four_days.json", 4)])
    reconcile_manifest_products_for_upload(manifest)
    assert [p.filename for p in manifest.products] == ["four_days.json"]
    assert manifest_retention_cutoff(NOW) == NOW - timedelta(days=5)


def test_the_cadence_prune_uses_the_same_cutoff():
    """One policy: the scheduler's prune and the upload filter must not drift apart."""
    import inspect
    from scheduler import forecast
    src = inspect.getsource(forecast)
    assert "manifest_retention_cutoff()" in src
    assert "timedelta(days=2)" not in src


def test_without_a_remote_manifest_nothing_is_dropped(monkeypatch):
    """Retention applies only on a real L2 upload; local/test manifests are left alone."""
    manifest = _manifest(("old.json", 30))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: None)
    reconcile_manifest_products_for_upload(manifest)
    assert [p.filename for p in manifest.products] == ["old.json"]


def test_an_unparseable_remote_time_is_never_treated_as_expired(monkeypatch):
    manifest = _manifest(("fresh.json", 0))
    bad = _raw("weird.json", 0)
    bad["valid_time_start"] = "not-a-time"
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [_raw("fresh.json", 0), bad])
    assert store_mod._past_retention("not-a-time", manifest_retention_cutoff()) is False


def test_the_kill_switch_restores_the_old_fold(monkeypatch):
    monkeypatch.setenv("MANIFEST_RETENTION_ON_UPLOAD", "0")
    manifest = _manifest(("fresh.json", 0))
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                        lambda: [_raw("fresh.json", 0), _raw("old.json", 3)])
    reconcile_manifest_products_for_upload(manifest)
    assert "old.json" in {p.filename for p in manifest.products}
