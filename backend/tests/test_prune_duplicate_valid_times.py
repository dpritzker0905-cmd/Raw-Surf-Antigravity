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


def _prod(model, layer, valid_time, run_time, filename, authoritative=True):
    return ManifestProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer,
        run_time=run_time, valid_time_start=valid_time, valid_time_end=valid_time,
        resolution=10.0, freshness_sec=1800, is_forecast_authoritative=authoritative,
        is_estimated=not authoritative,
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


# ── PROVENANCE GUARD (2026-07-06, the EURO waves lane wipe — run 28786800982) ────────────────
# A failed CMEMS fetch made the native job save ESTIMATED fallbacks with a NEWER run_time; the
# provenance-blind prunes then deleted the healthy natives at the same valid_times AND the whole
# lane's older products (including the 241-336h estimated tail, emptying the anchor pool).
# Invariant: authoritative products are only superseded by a NEWER AUTHORITATIVE run.

def test_sweep_never_lets_estimated_displace_authoritative(tmp_path):
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    native_run = datetime(2026, 7, 6, 4, 20, tzinfo=timezone.utc)
    fallback_run = datetime(2026, 7, 6, 11, 19, tzinfo=timezone.utc)  # newer but estimated
    products = [
        _prod("EURO", "waves", t0, native_run, "euro_waves_t0_native.json", authoritative=True),
        _prod("EURO", "waves", t0, fallback_run, "euro_waves_t0_estfallback.json", authoritative=False),
        # same-provenance duplicates still dedupe newest-wins
        _prod("EURO", "waves", t0 + timedelta(hours=3), native_run, "euro_waves_t3_old_est.json", authoritative=False),
        _prod("EURO", "waves", t0 + timedelta(hours=3), fallback_run, "euro_waves_t3_new_est.json", authoritative=False),
    ]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")

    pruned = store.prune_duplicate_valid_times()
    remaining = {p.filename for p in store.get_manifest().products}
    assert "euro_waves_t0_native.json" in remaining      # native survives the newer estimated
    assert "euro_waves_t0_estfallback.json" not in remaining
    assert "euro_waves_t3_new_est.json" in remaining     # est-vs-est: newest still wins
    assert "euro_waves_t3_old_est.json" not in remaining
    assert pruned == 2


def test_superseded_prune_estimated_batch_cannot_wipe_natives(tmp_path):
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    native_run = datetime(2026, 7, 6, 4, 20, tzinfo=timezone.utc)
    old_est_run = datetime(2026, 7, 6, 4, 25, tzinfo=timezone.utc)
    fallback_run = datetime(2026, 7, 6, 11, 19, tzinfo=timezone.utc)
    products = [
        # healthy natives from the earlier run (distinct valid_times)
        _prod("EURO", "waves", t0, native_run, "euro_waves_native_a.json", authoritative=True),
        _prod("EURO", "waves", t0 + timedelta(hours=3), native_run, "euro_waves_native_b.json", authoritative=True),
        # the old extended-estimates tail (older estimated run)
        _prod("EURO", "waves", t0 + timedelta(hours=288), old_est_run, "euro_waves_tail_est.json", authoritative=False),
        # the new estimated-fallback batch
        _prod("EURO", "waves", t0 + timedelta(hours=6), fallback_run, "euro_waves_fallback_new.json", authoritative=False),
    ]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")

    # the estimated-fallback batch completes and prunes with ITS run_time (the 11:19Z scenario)
    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", fallback_run)
    remaining = {p.filename for p in store.get_manifest().products}
    assert "euro_waves_native_a.json" in remaining   # natives survive an estimated batch
    assert "euro_waves_native_b.json" in remaining
    assert "euro_waves_tail_est.json" not in remaining  # older estimated still superseded
    assert "euro_waves_fallback_new.json" in remaining


def test_superseded_prune_native_batch_preserves_estimated_tail(tmp_path):
    """INGEST-WINDOW CONTINUITY (2026-07-10, run 29052535445): the native save's prune used to
    delete last cycle's 241-336h estimated tail ~20-45 min BEFORE the extended-estimates job
    regenerates it — a far-horizon outage every 4h cycle. A native batch now supersedes older
    NATIVES only; the estimated tail keeps serving until a newer estimated generation exists
    (write-new-then-delete-old). INGEST_PRUNE_PRESERVE_ESTIMATES=0 restores the old
    heal-the-whole-lane behavior (operator lever for purging a poisoned estimated generation)."""
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    old_native = datetime(2026, 7, 6, 4, 20, tzinfo=timezone.utc)
    old_est = datetime(2026, 7, 6, 11, 19, tzinfo=timezone.utc)
    new_native = datetime(2026, 7, 6, 14, 0, tzinfo=timezone.utc)
    products = [
        _prod("EURO", "waves", t0, old_native, "euro_waves_old_native.json", authoritative=True),
        _prod("EURO", "waves", t0 + timedelta(hours=288), old_est, "euro_waves_old_est.json", authoritative=False),
        _prod("EURO", "waves", t0, new_native, "euro_waves_new_native.json", authoritative=True),
    ]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")

    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", new_native)
    remaining = {p.filename for p in store.get_manifest().products}
    # old native superseded by the new native; the estimated tail SURVIVES the native prune
    assert remaining == {"euro_waves_new_native.json", "euro_waves_old_est.json"}


def test_superseded_prune_estimated_tail_goes_once_newer_estimates_exist(tmp_path):
    """The second half of write-new-then-delete-old: after the extended-estimates job saves the
    NEW tail, the next prune supersedes the old one (est-vs-est newest-run rule unchanged)."""
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    old_est = datetime(2026, 7, 6, 11, 19, tzinfo=timezone.utc)
    new_native = datetime(2026, 7, 6, 14, 0, tzinfo=timezone.utc)
    new_est = datetime(2026, 7, 6, 14, 25, tzinfo=timezone.utc)
    products = [
        _prod("EURO", "waves", t0 + timedelta(hours=288), old_est, "euro_waves_old_est.json", authoritative=False),
        _prod("EURO", "waves", t0, new_native, "euro_waves_new_native.json", authoritative=True),
        _prod("EURO", "waves", t0 + timedelta(hours=292), new_est, "euro_waves_new_est.json", authoritative=False),
    ]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")

    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", new_est)
    remaining = {p.filename for p in store.get_manifest().products}
    assert remaining == {"euro_waves_new_native.json", "euro_waves_new_est.json"}


def test_superseded_prune_kill_switch_restores_plain_rule(tmp_path, monkeypatch):
    monkeypatch.setenv("INGEST_PRUNE_PRESERVE_ESTIMATES", "0")
    store = ProductStore(cache_dir=tmp_path)
    t0 = datetime(2026, 7, 6, 0, 0, tzinfo=timezone.utc)
    old_native = datetime(2026, 7, 6, 4, 20, tzinfo=timezone.utc)
    old_est = datetime(2026, 7, 6, 11, 19, tzinfo=timezone.utc)
    new_native = datetime(2026, 7, 6, 14, 0, tzinfo=timezone.utc)
    products = [
        _prod("EURO", "waves", t0, old_native, "euro_waves_old_native.json", authoritative=True),
        _prod("EURO", "waves", t0 + timedelta(hours=288), old_est, "euro_waves_old_est.json", authoritative=False),
        _prod("EURO", "waves", t0, new_native, "euro_waves_new_native.json", authoritative=True),
    ]
    store._save_manifest(PipelineManifest(products=products, last_manifest_update=datetime.now(timezone.utc)))
    for p in products:
        (tmp_path / p.filename).write_text("{}")

    store.prune_superseded_products("EURO", "marine", "waves", "global_coarse", new_native)
    remaining = {p.filename for p in store.get_manifest().products}
    assert remaining == {"euro_waves_new_native.json"}  # old behavior: native run heals the whole lane
