"""Duplicate-valid_time manifest sweep (2026-07-04, manifest-bloat audit).

Per-layer prune_superseded_products only runs after a layer's save loop completes, so CANCELLED
ingestion runs upload early hours and never prune — GFS accumulated ~763 products/layer (~6-7 run
generations) vs EURO 112. The sweep keeps only the newest run_time per
(model, domain, layer, region, valid_time) and MUST be coverage-safe: an hour only an OLDER run
covers keeps its sole product.
"""
from datetime import datetime, timezone, timedelta

import pytest

from services.weather_pipeline.schemas import ManifestProduct, PipelineManifest, CoverageBounds
from services.weather_pipeline.store import ProductStore


def _prod(model, layer, valid_time, run_time, filename):
    return ManifestProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer,
        run_time=run_time, valid_time_start=valid_time, valid_time_end=valid_time,
        resolution=10.0, freshness_sec=1800, is_forecast_authoritative=True,
        coverage=CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0),
        filename=filename, region_id="global_coarse", coverage_mode="global_tile",
        product_id=filename,
    )


@pytest.fixture
def store_with_dupes(tmp_path):
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 4, 0, 0, tzinfo=timezone.utc)
    old_run = datetime(2026, 7, 3, 6, 0, tzinfo=timezone.utc)
    new_run = datetime(2026, 7, 3, 18, 0, tzinfo=timezone.utc)

    products = [
        # duplicate valid_time T0: old + new run -> old must go
        _prod("GFS", "waves", t0, old_run, "gfs_waves_t0_old.json"),
        _prod("GFS", "waves", t0, new_run, "gfs_waves_t0_new.json"),
        # duplicate valid_time T3: old + new run -> old must go
        _prod("GFS", "waves", t0 + timedelta(hours=3), old_run, "gfs_waves_t3_old.json"),
        _prod("GFS", "waves", t0 + timedelta(hours=3), new_run, "gfs_waves_t3_new.json"),
        # T6 covered ONLY by the old run (the new run was cancelled early) -> MUST be kept
        _prod("GFS", "waves", t0 + timedelta(hours=6), old_run, "gfs_waves_t6_old_only.json"),
        # different layer, same valid_time as waves T0 -> untouched
        _prod("GFS", "swell_1", t0, old_run, "gfs_swell1_t0_old.json"),
        # different model, same valid_time -> untouched
        _prod("EURO", "waves", t0, old_run, "euro_waves_t0_old.json"),
    ]
    manifest = PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc))
    store._save_manifest(manifest)
    # touch the files so disk deletion paths run
    for p in products:
        (tmp_path / p.filename).write_text("{}")
    return store


def test_sweep_prunes_only_true_duplicates(store_with_dupes, tmp_path):
    pruned = store_with_dupes.prune_duplicate_valid_times()
    assert pruned == 2  # exactly the two old-run duplicates

    remaining = {p.filename for p in store_with_dupes.get_manifest().products}
    assert remaining == {
        "gfs_waves_t0_new.json",
        "gfs_waves_t3_new.json",
        "gfs_waves_t6_old_only.json",   # coverage safety: sole product for its hour survives
        "gfs_swell1_t0_old.json",       # other layer untouched
        "euro_waves_t0_old.json",       # other model untouched
    }
    # pruned files removed from disk; survivors still present
    assert not (tmp_path / "gfs_waves_t0_old.json").exists()
    assert not (tmp_path / "gfs_waves_t3_old.json").exists()
    assert (tmp_path / "gfs_waves_t6_old_only.json").exists()


def test_sweep_is_idempotent(store_with_dupes):
    assert store_with_dupes.prune_duplicate_valid_times() == 2
    assert store_with_dupes.prune_duplicate_valid_times() == 0
