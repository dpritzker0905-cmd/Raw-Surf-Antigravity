"""FRAME_TAIL_REFETCH_STALE (2026-11-15): a tail product on the runner's disk from another run is re-downloaded, not refused.

The live defect (pilots 43758884390): the ICON swell_2 blend restored the 42 EURO swell_2 tail products to the runner's disk, the core
lane re-baked the tail, and the frames step skipped the download ("on disk") and refused the old copies as stale_local. Offline here:
a disk copy of an OLDER run while the manifest and the bucket name the NEW one. Controls: the switch off reproduces the defect; a
disk copy of the current run is never downloaded; a download that is itself still stale is still refused.
"""
import json
import math
import re
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_tail_stale as fts  # noqa: E402

EURO = {"model": "EURO", "domain": "marine", "layer": "waves", "region_id": "global_mid"}
OLD, NEW = "2026-11-15T00:00:00Z", "2026-11-15T12:00:00Z"
AUTH = ["2026-11-20T06:00:00Z", "2026-11-20T09:00:00Z", "2026-11-20T12:00:00Z", "2026-11-20T15:00:00Z"]
TAILS = ["2026-11-26T12:00:00Z", "2026-11-26T15:00:00Z", "2026-11-26T18:00:00Z"]
WORKFLOW = Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml"


@pytest.fixture(autouse=True)
def _clean_env(monkeypatch):
    for k in (fts.FLAG, "FRAME_TAIL_DOWNLOAD", "FRAME_TAIL_DOWNLOAD_MAX", "FRAME_SETS", "FRAME_CONTENT_CARRY"):
        monkeypatch.delenv(k, raising=False)


def _product(vt, run, est):
    vecs = []
    for r in range(4):
        for c in range(6):
            h, d = round(1.0 + 0.1 * r + 0.01 * c, 4), round((30.0 * c + 7.0 * r) % 360.0, 2)
            rad = math.radians(d)
            vecs.append({"lat": -60.0 + r * 40.0, "lng": -180.0 + c * 72.0, "speed": h, "direction": d,
                         "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4), "period": round(8.0 + r, 2),
                         "gust": None, "value": None, "is_valid": True, "dir_confidence": 0.9})
    return {"model": "EURO", "provider": "estimated" if est else "copernicus", "domain": "marine", "layer": "waves",
            "run_time": run, "model_run_time": run, "model_run_time_status": "known", "ingested_at": None if est else run,
            "valid_time": vt, "is_forecast_authoritative": not est, "is_estimated": est,
            "estimate_basis": {"type": "euro_persistence_gfs_blend"} if est else None, "value_kind": "wave_height",
            "value_unit": "m", "display_unit_hint": "ft", "region_id": "global_mid",
            "grid": {"cols": 6, "rows": 4, "bounds": {"west": -180.0, "south": -62.0, "east": 180.0, "north": 61.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _name(vt, est):
    return f"euro_marine_waves_global_mid_{vt.replace('-', '').replace(':', '')}{'_estimated' if est else ''}.json"


def _stores(tmp, disk_tail_run=OLD, bucket_tail_run=NEW, on_disk=TAILS):
    """The manifest and the bucket name the NEW tail run; the disk holds `on_disk` tail hours of `disk_tail_run` (a restore)."""
    disk, bucket = tmp / "disk", tmp / "bucket"
    disk.mkdir(parents=True)
    bucket.mkdir(parents=True)
    entries = []
    for vt, est in [(v, False) for v in AUTH] + [(v, True) for v in TAILS]:
        name = _name(vt, est)
        (bucket / name).write_text(json.dumps(_product(vt, bucket_tail_run if est else NEW, est)))
        if not est:
            (disk / name).write_text(json.dumps(_product(vt, NEW, est)))
        elif vt in on_disk:
            (disk / name).write_text(json.dumps(_product(vt, disk_tail_run, est)))
        entries.append({**EURO, "filename": name, "valid_time_start": vt, "model_run_time": NEW, "run_time": NEW,
                        "ingested_at": None if est else NEW, "is_estimated": est})
    (disk / "manifest.json").write_text(json.dumps({"products": entries}))
    return disk, bucket


def _run(disk, bucket, out, cap=320):
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), cap=cap, log=lambda *_: None)
    return pub.publish_frame_sets(src, pub.LocalSink(out), sets=[EURO], log=lambda *_: None)[fs.set_key(EURO)], src


def test_a_disk_copy_of_an_older_run_is_downloaded_again_and_built(tmp_path):
    disk, bucket = _stores(tmp_path)
    stats, src = _run(disk, bucket, tmp_path / "out")
    assert (stats["built"], stats["stale_local"], stats["coverage"]) == (7, 0, 1.0)
    assert (stats["tail_downloaded"], stats["stale_refetched"], src.stats["stale_refetched"]) == (3, 3, 3)
    assert isinstance(stats["stale_check_s"], float) and stats["stale_check_s"] >= 0.0   # the parse's cost, reported per set
    latest = json.loads((tmp_path / "out" / fs.LATEST).read_text())["sets"][fs.set_key(EURO)]
    index = json.loads((tmp_path / "out" / latest["index"]).read_text())
    meta = lambda f: {**(index.get("common_meta") or {}), **(f.get("meta") or {})}   # noqa: E731
    assert all(f["path"] and meta(f)["run_time"] == NEW for f in index["frames"] if f["is_estimated"])


def test_the_switch_off_keeps_todays_refusal(tmp_path, monkeypatch):
    """The null control: the defect as it ran live (the disk copy is trusted, then refused)."""
    monkeypatch.setenv(fts.FLAG, "0")
    disk, bucket = _stores(tmp_path)
    stats, src = _run(disk, bucket, tmp_path / "out")
    assert (stats["built"], stats["stale_local"], stats["tail_downloaded"], stats["stale_refetched"]) == (4, 3, 0, 0)
    assert src.stats["downloaded"] == 0


def test_a_current_disk_copy_is_never_downloaded(tmp_path):
    disk, bucket = _stores(tmp_path, disk_tail_run=NEW)
    stats, src = _run(disk, bucket, tmp_path / "out")
    assert (stats["built"], stats["stale_local"], stats["tail_downloaded"], stats["stale_refetched"]) == (7, 0, 0, 0)
    assert src.stats["downloaded"] == 0


def test_only_the_stale_hours_are_refetched_beside_plain_missing_ones(tmp_path):
    disk, bucket = _stores(tmp_path, on_disk=TAILS[:1])           # one stale copy on disk, two tail hours not on disk
    stats, _src = _run(disk, bucket, tmp_path / "out")
    assert (stats["built"], stats["tail_downloaded"], stats["stale_refetched"], stats["stale_local"]) == (7, 3, 1, 0)


def test_a_download_that_is_still_another_run_is_still_refused(tmp_path):
    """The bucket read races the core lane's write: the refetch never builds what publish_set would refuse."""
    disk, bucket = _stores(tmp_path, bucket_tail_run=OLD)
    stats, _src = _run(disk, bucket, tmp_path / "out")
    assert (stats["built"], stats["stale_local"], stats["stale_refetched"]) == (4, 3, 3)


def test_the_refetch_stays_inside_the_download_cap(tmp_path):
    disk, bucket = _stores(tmp_path)
    stats, src = _run(disk, bucket, tmp_path / "out", cap=1)
    assert (src.stats["downloaded"], src.stats["download_capped"], stats["stale_refetched"]) == (1, 2, 1)
    assert (stats["built"], stats["stale_local"]) == (5, 2)


def test_a_download_is_read_before_the_disk_copy(tmp_path):
    disk, bucket = _stores(tmp_path)
    src = pub.TailDownloads(pub.LocalCache(disk), pub.local_product_fetcher(bucket), log=lambda *_: None)
    name = _name(TAILS[0], True)
    assert json.loads(src.product_bytes(name))["run_time"] == OLD
    src.prefetch(EURO)
    assert json.loads(src.product_bytes(name))["run_time"] == NEW
    assert json.loads(src.product_bytes(_name(AUTH[0], False)))["run_time"] == NEW      # a disk-only product still reads from disk


def test_is_stale_is_publish_sets_own_run_check():
    entry = {"model_run_time": NEW, "run_time": NEW}
    same = json.dumps({"model_run_time": "2026-11-15T12:00:00+00:00", "run_time": NEW}).encode()
    assert not fts.is_stale(same, entry)                                   # the same instant in another spelling
    assert fts.is_stale(json.dumps({"model_run_time": NEW, "run_time": OLD}).encode(), entry)
    assert fts.is_stale(json.dumps({"model_run_time": OLD, "run_time": NEW}).encode(), entry)
    assert fts.is_stale(b"{not json", entry) and fts.is_stale(b"[]", entry)


def test_the_switch_is_on_by_default_and_declared_in_the_publish_step(monkeypatch):
    assert fts.enabled()
    monkeypatch.setenv(fts.FLAG, "0")
    assert not fts.enabled()
    wf = WORKFLOW.read_text(encoding="utf-8")
    step = wf[wf.index("- name: Publish static forecast frames (dark)"):wf.index("run: python scripts/publish_frame_images.py")]
    assert re.search(r"^\s+FRAME_TAIL_REFETCH_STALE: \$\{\{ vars\.FRAME_TAIL_REFETCH_STALE \|\| '1' \}\}$", step, re.M)
