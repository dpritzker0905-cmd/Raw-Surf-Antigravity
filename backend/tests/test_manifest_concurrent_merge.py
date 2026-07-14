"""
Manifest concurrency merge-on-upload (2026-07-14, next-phase queue #1).

manifest.json has no If-Match/CAS precondition: two ingest processes (core + pilots) racing
the upload each re-serialize their OWN full in-memory snapshot, so whichever lands last
silently erases every registration the other made since its restore. That lost-update risk is
why core+pilots have been forced into one serial GH concurrency group — congestion in that
shared group is the root of the pending-run eviction cascade (§4 of
HANDOFF-2026-07-14-marathon-close-stability-arc.md).

reconcile_manifest_products_for_upload() narrows the loss window: immediately before every
manifest.json upload, re-fetch the fresh remote product list and fold in anything present
there but absent from our own snapshot (a concurrent writer's registration since our
restore). Our own snapshot always wins on key collisions.
"""
from datetime import datetime, timezone

import services.weather_pipeline.store as store_mod
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest
from services.weather_pipeline.store import reconcile_manifest_products_for_upload


def _cov():
    return CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)


def _product(pid: str) -> ManifestProduct:
    now = datetime(2026, 7, 14, tzinfo=timezone.utc)
    return ManifestProduct(
        model="GFS", provider="noaa", domain="marine", layer="waves",
        run_time=now, valid_time_start=now, valid_time_end=now,
        resolution=0.25, freshness_sec=3600, is_forecast_authoritative=True,
        coverage=_cov(), filename=pid, product_id=pid,
    )


def _manifest(*pids: str) -> PipelineManifest:
    return PipelineManifest(
        last_manifest_update=datetime.now(timezone.utc),
        products=[_product(pid) for pid in pids],
    )


def _raw(pid: str) -> dict:
    import json
    return json.loads(_product(pid).model_dump_json())


def test_folds_in_concurrent_writer_entries_not_in_local_snapshot(monkeypatch):
    # We (e.g. "core") restored before "pilots" registered icon_hawaii; our snapshot only has
    # our own entry. The remote (fresh fetch) now has both.
    manifest = _manifest("gfs_florida.json")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                         lambda: [_raw("gfs_florida.json"), _raw("icon_hawaii.json")])

    folded = reconcile_manifest_products_for_upload(manifest)

    assert folded == 1
    filenames = {p.filename for p in manifest.products}
    assert filenames == {"gfs_florida.json", "icon_hawaii.json"}


def test_local_snapshot_wins_on_key_collision(monkeypatch):
    # Remote has a stale copy of a slice we just re-registered; ours must not be clobbered by
    # the remote's (older) copy of the same key.
    manifest = _manifest("gfs_florida.json")
    manifest.products[0].freshness_sec = 999  # mark "ours" distinctly
    remote_stale = _raw("gfs_florida.json")
    remote_stale["freshness_sec"] = 111
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: [remote_stale])

    reconcile_manifest_products_for_upload(manifest)

    assert len(manifest.products) == 1
    assert manifest.products[0].freshness_sec == 999


def test_no_remote_products_is_a_noop(monkeypatch):
    manifest = _manifest("gfs_florida.json")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", lambda: None)

    folded = reconcile_manifest_products_for_upload(manifest)

    assert folded == 0
    assert len(manifest.products) == 1


def test_remote_fetch_exception_never_raises(monkeypatch):
    manifest = _manifest("gfs_florida.json")

    def _boom():
        raise RuntimeError("network down")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products", _boom)

    folded = reconcile_manifest_products_for_upload(manifest)

    assert folded == 0
    assert len(manifest.products) == 1


def test_kill_switch_disables_reconciliation(monkeypatch):
    monkeypatch.setenv("MANIFEST_MERGE_ON_UPLOAD", "0")
    manifest = _manifest("gfs_florida.json")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                         lambda: [_raw("gfs_florida.json"), _raw("icon_hawaii.json")])

    folded = reconcile_manifest_products_for_upload(manifest)

    assert folded == 0
    assert len(manifest.products) == 1


def test_hot_save_paths_reconcile_before_every_upload():
    """Guard against silently dropping the wire-up: both registration call sites must reconcile
    immediately before dump_manifest_for_l2, not just at process start."""
    import inspect
    from services.weather_pipeline import store_helpers

    for fn in (store_helpers.save_product_helper, store_helpers.save_products_batch_helper):
        src = inspect.getsource(fn)
        assert "reconcile_manifest_products_for_upload(manifest)" in src
        assert src.index("reconcile_manifest_products_for_upload(manifest)") < src.index("dump_manifest_for_l2(manifest)")


def test_exclude_keys_prevents_resurrecting_pruned_entries(monkeypatch):
    # THE PRUNE HAZARD (why prune paths weren't wired blindly): our just-pruned entries are still
    # in the fresh remote manifest (our upload hasn't landed) — without the exclusion, reconcile
    # would fold them straight back in, minting dangling references to L2 objects we destroyed.
    manifest = _manifest("kept.json")   # post-prune snapshot: pruned.json already removed
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                         lambda: [_raw("kept.json"), _raw("pruned.json"), _raw("icon_hawaii.json")])

    folded = reconcile_manifest_products_for_upload(manifest, exclude_keys={"pruned.json"})

    filenames = {p.filename for p in manifest.products}
    assert folded == 1
    assert "pruned.json" not in filenames                 # deletion survives the reconcile
    assert filenames == {"kept.json", "icon_hawaii.json"}  # concurrent registration still folds in


def test_prune_paths_reconcile_with_exclusions_before_every_upload():
    """All three deletion sweeps must reconcile WITH their pruned-key exclusions before
    dump_manifest_for_l2 — a bare reconcile there would resurrect just-pruned entries."""
    import inspect
    from services.weather_pipeline import copernicus_validator as cv

    for fn in (cv.prune_old_products_helper, cv.prune_duplicate_valid_times_helper,
               cv.prune_superseded_products_helper):
        src = inspect.getsource(fn)
        call = "reconcile_manifest_products_for_upload(manifest, exclude_keys=pruned_keys)"
        assert call in src, f"{fn.__name__} missing exclusion-aware reconcile"
        assert src.index(call) < src.index("dump_manifest_for_l2(manifest)")


def test_malformed_remote_entry_is_skipped_not_fatal(monkeypatch):
    manifest = _manifest("gfs_florida.json")
    monkeypatch.setattr(store_mod, "_fetch_remote_manifest_products",
                         lambda: [{"filename": "icon_hawaii.json"}, _raw("euro_iberia.json")])

    folded = reconcile_manifest_products_for_upload(manifest)

    # the entry missing required ManifestProduct fields is skipped; the valid one still folds in
    assert folded == 1
    filenames = {p.filename for p in manifest.products}
    assert filenames == {"gfs_florida.json", "euro_iberia.json"}
