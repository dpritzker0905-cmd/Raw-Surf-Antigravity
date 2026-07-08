"""Hermetic tests for the orphan-identification logic (2026-07-08). Pure — no Supabase, no deletes."""
from datetime import datetime, timezone, timedelta

from scripts.sweep_orphaned_l2 import is_orphan

NOW = datetime(2026, 7, 8, 12, 0, 0, tzinfo=timezone.utc)
MANIFEST = {"gfs_marine_waves_global_coarse_20260708T060000Z.json"}


def _old():
    return NOW - timedelta(hours=48)


def test_object_in_manifest_is_never_orphan():
    assert is_orphan("gfs_marine_waves_global_coarse_20260708T060000Z.json", MANIFEST, _old(), NOW, 24) is False


def test_reserved_keys_are_never_orphans():
    # Bare folder entries AND their contents are both spared (list() returns both forms).
    for key in ("manifest.json", "health.json", "spot_ratings", "spot_ratings/latest.json",
                "calibration", "calibration/report.json", "reports"):
        assert is_orphan(key, MANIFEST, _old(), NOW, 24) is False


def test_superseded_old_product_is_orphan():
    # An old run's product no longer in the manifest, older than the margin -> orphan.
    assert is_orphan("gfs_marine_waves_global_coarse_20260701T060000Z.json", MANIFEST, _old(), NOW, 24) is True


def test_recent_unmanifested_object_is_spared():
    # Not in the manifest but uploaded 2h ago (an in-flight ingest) -> NOT an orphan (margin protects it).
    recent = NOW - timedelta(hours=2)
    assert is_orphan("gfs_marine_waves_global_coarse_20260708T090000Z.json", MANIFEST, recent, NOW, 24) is False


def test_unknown_created_at_still_orphan_if_unmanifested():
    # No timestamp available -> the margin can't spare it; unmanifested + non-reserved -> orphan.
    assert is_orphan("stale_product.json", MANIFEST, None, NOW, 24) is True
