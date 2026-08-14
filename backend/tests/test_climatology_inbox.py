"""The climatology inbox + self-erase guard (2026-07-30, both measured in production).

A workstation backfill read-modify-wrote the blob WITH a verify-after-upload race guard, watched
the guard fire and recover — and was erased anyway within the hour: two writers on one key cannot
be made safe by checking harder. And the cron itself could self-erase: merging frames onto a None
base (one transient load failure) rebuilt the whole blob from scratch. These tests pin the fixes:
the precompute is the ONLY writer, everyone else contributes through an inbox it folds in, and a
failed base load skips the cycle instead of resetting history."""
from unittest.mock import patch

import services.weather_pipeline.spot_size_climatology as sc


def _batch(bid, sid="42", counts=(0, 3, 2), marker=("backfill", {"v": 2, "n": 5})):
    hist = sc.empty_hist()
    for i, c in enumerate(counts):
        hist[i] = c
    rec = {"hist": hist, "n": sum(counts)}
    key, val = marker
    rec[key] = val
    return {"batch_id": bid, "spots": {sid: rec}}


def test_inbox_fold_adds_binwise_and_carries_markers():
    base_hist = sc.merge_samples(None, [0.3, 0.5])            # 2 samples in low bins
    clim = {"schema_version": 1, "spots": {"42": {"hist": base_hist, "n": 2}}}
    with patch.object(sc, "list_inbox_keys", return_value=[sc.INBOX_PREFIX + "b1.json"]), \
         patch.object(sc, "load_size_climatology_l2", return_value=_batch("b1")):
        merged, consumed = sc.merge_inbox_into_climatology(clim)
    rec = merged["spots"]["42"]
    assert sc.hist_count(rec["hist"]) == 2 + 5                # bin-wise ADD, nothing replaced
    assert rec["backfill"] == {"v": 2, "n": 5}                # marker carried for resume filters
    assert consumed == [sc.INBOX_PREFIX + "b1.json"]
    assert "b1" in merged["merged_batches"]


def test_inbox_dedupes_by_batch_id_so_failed_delete_cannot_double_count():
    clim = {"schema_version": 1, "spots": {}, "merged_batches": ["b1"]}
    with patch.object(sc, "list_inbox_keys", return_value=[sc.INBOX_PREFIX + "b1.json"]), \
         patch.object(sc, "load_size_climatology_l2", return_value=_batch("b1")):
        merged, consumed = sc.merge_inbox_into_climatology(clim)
    assert merged["spots"] == {}                              # NOT folded a second time
    assert consumed == [sc.INBOX_PREFIX + "b1.json"]          # but still consumed (deleted)


def test_inbox_malformed_batch_is_consumed_without_wedging():
    clim = {"schema_version": 1, "spots": {}}
    with patch.object(sc, "list_inbox_keys", return_value=[sc.INBOX_PREFIX + "junk.json"]), \
         patch.object(sc, "load_size_climatology_l2", return_value={"nope": True}):
        merged, consumed = sc.merge_inbox_into_climatology(clim)
    assert consumed == [sc.INBOX_PREFIX + "junk.json"]
    assert merged["spots"] == {}


def test_inbox_new_spot_creates_record():
    clim = {"schema_version": 1, "spots": {}}
    with patch.object(sc, "list_inbox_keys", return_value=[sc.INBOX_PREFIX + "b2.json"]), \
         patch.object(sc, "load_size_climatology_l2",
                      return_value=_batch("b2", sid="777", marker=("era5", {"v": 3}))):
        merged, _ = sc.merge_inbox_into_climatology(clim)
    assert merged["spots"]["777"]["n"] == 5
    assert merged["spots"]["777"]["era5"] == {"v": 3}


def test_self_erase_guard_skips_accumulation_when_base_unreadable():
    """The spot_ratings block must SKIP (not rebuild) when the blob load returns None twice —
    re-enacts the production erasure: a None base + merge_frames == a from-scratch blob."""
    import re
    from pathlib import Path
    # SPLIT 2026-08-14: the RATING_SIZE_CLIMATOLOGY writer moved to the precompute lane with the
    # rest of `run_spot_ratings_precompute`. Repointed in the same commit — a path-reading guard
    # left behind grades a file that no longer contains the block it names.
    src = Path(sc.__file__).resolve().parent / "spot_ratings_precompute.py"
    text = src.read_text(encoding="utf-8")
    block = text[text.index("RATING_SIZE_CLIMATOLOGY"):]
    # The guard's shape: a second load attempt, then a skip path that never calls merge/upload.
    assert "self-erase guard" in block
    assert block.index("if _existing is None:") < block.index("merge_frames_into_climatology(")
    # And the merge is called with the CHECKED base, never a bare load result.
    assert re.search(r"merge_frames_into_climatology\(_existing,", block)
    assert "merge_inbox_into_climatology" in block            # inbox folds inside the single writer
