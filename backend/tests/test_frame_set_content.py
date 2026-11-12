"""Content-keyed frame carry (services/frame_set_content.py, FRAME_CONTENT_CARRY, 2026-11-12).

The pilots lane re-ingests the same CMEMS run every fire with a new run_time + ingested_at, so frame_set's identity carry never
held and every EURO swell frame was rebuilt (74-118 per set per run). Pins: a re-ingest of the same bytes is carried, and the
carried frames are EXACTLY what a rebuild writes (path, sha, grid, meta with the new run_time / ingested_at); changed bytes, a
new model run, a changed fill donor, a new code fingerprint or an unsafe key layout rebuild; OFF keeps today's behaviour; the
pilots workflow passes the switch ON by default. Offline only (LocalCache, no sink).
"""
import json
import math
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_content as fsc  # noqa: E402
from services import frame_set_fill as fsf  # noqa: E402

_DONOR_LRU = fsf.cgf._DONOR_LRU                         # the route's process-wide donor LRU (coarse_gulf_fill)

PLAIN = next(t for t in fs.EURO_SWELL_SETS if t["layer"] == "swell_1" and not t.get("variant"))
FILLED = next(t for t in fs.EURO_SWELL_SETS if t["layer"] == "swell_1" and t.get("variant"))
RUN = "2026-11-11T12:00:00Z"                           # the CMEMS cycle (model_run_time)
GFS_RUN = "2026-11-11T18:00:00Z"
VALIDS = ["2026-11-12T03:00:00Z", "2026-11-12T06:00:00Z", "2026-11-12T09:00:00Z"]
COLS, ROWS = 181, 3                                    # a world span, 2 deg (the fill's lattice)
FIRST = ("2026-11-12T01:47:12.123456Z", "2026-11-12T02:17:45Z")     # (run_time = registration, ingested_at) of ingest 1
AGAIN = ("2026-11-12T04:42:06.654321Z", "2026-11-12T05:11:22Z")     # the next fire's re-ingest of the same run


def _vec(lat, lng, h, d, period, valid):
    if not valid:
        return {"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0, "gust": None,
                "value": None, "is_valid": False, "dir_confidence": None}
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4),
            "period": period, "gust": None, "value": None, "is_valid": True, "dir_confidence": 0.9}


def _product(model, valid, run, reg, sea, base):
    vecs = [_vec(-2.0 + 2.0 * r, -180.0 + 2.0 * c, round(base + 0.01 * c + 0.1 * r, 3), round((13.0 * c + 5.0 * r) % 360.0, 2),
                 round(7.0 + 0.5 * r + 0.01 * c, 2), sea(r, c)) for r in range(ROWS) for c in range(COLS)]
    return {"model": model, "provider": "test", "domain": "marine", "layer": "swell_1", "run_time": reg[0], "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": reg[1], "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
            "source_dataset": "test", "upstream_provider": "test", "region_id": "global_mid", "resolution": 2.0,
            "freshness_sec": 1800, "source_variables": [], "coverage": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
            "grid": {"cols": COLS, "rows": ROWS, "bounds": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _name(model, vt):
    return f"{model.lower()}_marine_swell_1_global_mid_{vt.replace('-', '').replace(':', '')}.json"


def _entry(model, vt, run, reg):
    return {"model": model, "domain": "marine", "layer": "swell_1", "region_id": "global_mid", "resolution": 2.0,
            "filename": _name(model, vt), "valid_time_start": vt, "model_run_time": run, "run_time": reg[0],
            "ingested_at": reg[1], "is_estimated": False}


def _write(store, reg=FIRST, run=RUN, bump=None, gfs_run=GFS_RUN, gfs_reg=FIRST, gfs_base=1.0, compact=True):
    """One ingest: EURO swell_1 (masks c%7, c%5) + the GFS swell_1 donor (land c%7). `bump` = {valid: added height}."""
    store.mkdir(parents=True, exist_ok=True)
    dump = (lambda o: json.dumps(o, separators=(",", ":"))) if compact else json.dumps
    entries = []
    for vt in VALIDS:
        p = _product("EURO", vt, run, reg, lambda r, c: not (c % 7 == 0 or c % 5 == 0), 2.0 + (bump or {}).get(vt, 0.0))
        (store / _name("EURO", vt)).write_text(dump(p))
        entries.append(_entry("EURO", vt, run, reg))
        (store / _name("GFS", vt)).write_text(dump(_product("GFS", vt, gfs_run, gfs_reg, lambda r, c: c % 7 != 0, gfs_base)))
        entries.append(_entry("GFS", vt, gfs_run, gfs_reg))
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "1")
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    monkeypatch.delenv("MARINE_FILL_PROVENANCE_NODES", raising=False)
    monkeypatch.delenv(fsc.FLAG, raising=False)                          # the code default: ON
    _DONOR_LRU.clear()
    yield
    _DONOR_LRU.clear()


def _publish(store, target, prev=None):
    up = []
    index, stats = fs.publish_set(pub.LocalCache(store), None, target, prev, up.extend, log=lambda *_: None)
    return index, stats, up


def _strip(frames):
    return [{k: v for k, v in f.items() if k != "content"} for f in frames]


@pytest.mark.parametrize("target", [PLAIN, FILLED], ids=["plain", "filled"])
@pytest.mark.parametrize("compact", [True, False], ids=["compact-json", "spaced-json"])
def test_a_reingest_of_the_same_run_is_carried_exactly_as_a_rebuild_writes_it(tmp_path, monkeypatch, target, compact):
    store = tmp_path / "s"
    _write(store, FIRST, compact=compact)
    first, s1, _ = _publish(store, target)
    assert s1["built"] == 3 and all(f.get("content") for f in first["frames"])
    _write(store, AGAIN, gfs_reg=AGAIN, compact=compact)           # the next fire: same bytes, new run_time + ingested_at
    on, s_on, up_on = _publish(store, target, first)
    assert (s_on["content_carried"], s_on["built"], s_on["carried"], up_on) == (3, 0, 0, [])
    monkeypatch.setenv(fsc.FLAG, "0")
    off, s_off, up_off = _publish(store, target, first)               # today's path from the same previous index
    assert (s_off["built"], s_off["unchanged"], s_off["content_carried"], up_off) == (3, 3, 0, [])
    # THE PARITY CLAIM: the content-carried frames are the rebuild's frames (paths, shas, grids, sources, meta), byte for byte.
    assert _strip(on["frames"]) == off["frames"] and on["common_meta"] == off["common_meta"] and on["grid"] == off["grid"]
    meta = {**on["common_meta"], **on["frames"][0].get("meta", {})}
    assert (meta["run_time"], meta["ingested_at"]) == (fs.iso(AGAIN[0]), fs.iso(AGAIN[1]))   # the meta follows the re-ingest


def test_changed_bytes_rebuild_and_upload_only_that_frame(tmp_path):
    store = tmp_path / "s"
    _write(store, FIRST)
    first, _, _ = _publish(store, PLAIN)
    _write(store, AGAIN, bump={VALIDS[1]: 0.25})
    index, stats, up = _publish(store, PLAIN, first)
    assert (stats["content_carried"], stats["built"], stats["uploaded"]) == (2, 1, 1)
    old = {f["valid_time"]: f["sha256"] for f in first["frames"]}
    new = {f["valid_time"]: f["sha256"] for f in index["frames"]}
    assert new[VALIDS[1]] != old[VALIDS[1]] and new[VALIDS[0]] == old[VALIDS[0]]


def test_a_new_model_run_with_the_same_field_rebuilds(tmp_path):
    """The encoder writes model_run_time into the header; a new cycle must never ride an old frame."""
    store = tmp_path / "s"
    _write(store, FIRST)
    first, _, _ = _publish(store, PLAIN)
    _write(store, AGAIN, run="2026-11-12T00:00:00Z")
    _, stats, up = _publish(store, PLAIN, first)
    assert (stats["content_carried"], stats["built"], len(up)) == (0, 3, 3)


def test_a_changed_fill_donor_rebuilds_the_filled_frames(tmp_path):
    store = tmp_path / "s"
    _write(store, FIRST)
    first, _, _ = _publish(store, FILLED)
    _write(store, AGAIN, gfs_run="2026-11-12T00:00:00Z", gfs_reg=AGAIN, gfs_base=1.5)   # a new GFS cycle, new donor values
    index, stats, up = _publish(store, FILLED, first)
    assert (stats["content_carried"], stats["built"], len(up)) == (0, 3, 3)
    assert all(f["sha256"] != p["sha256"] for f, p in zip(index["frames"], first["frames"]))
    # ... and a donor whose bytes alone changed (same cycle, same filename) still rebuilds: the donor's content is in the key
    _write(store, FIRST)
    again, _, _ = _publish(store, FILLED)
    _write(store, AGAIN, gfs_reg=AGAIN, gfs_base=1.25)
    _, stats, _ = _publish(store, FILLED, again)
    assert (stats["content_carried"], stats["built"]) == (0, 3)


def test_off_keeps_todays_behaviour(tmp_path, monkeypatch):
    monkeypatch.setenv(fsc.FLAG, "0")
    store = tmp_path / "s"
    _write(store, FIRST)
    first, s1, _ = _publish(store, PLAIN)
    assert s1["built"] == 3 and not any("content" in f for f in first["frames"])
    _write(store, AGAIN)
    _, stats, up = _publish(store, PLAIN, first)
    assert (stats["content_carried"], stats["built"], stats["unchanged"], up) == (0, 3, 3, [])
    _write(store, FIRST)                                                   # the identity carry is untouched either way
    _, stats, _ = _publish(store, PLAIN, first)
    assert (stats["carried"], stats["built"]) == (3, 0)


def test_a_new_code_fingerprint_rebuilds(tmp_path, monkeypatch):
    store = tmp_path / "s"
    _write(store, FIRST)
    first, _, _ = _publish(store, PLAIN)
    _write(store, AGAIN)
    monkeypatch.setattr(fsc, "_code", "deadbeef0000")                      # a deploy that changed the encoder or the fill
    _, stats, _ = _publish(store, PLAIN, first)
    assert (stats["content_carried"], stats["built"]) == (0, 3)


def test_a_disk_copy_from_another_registration_is_not_carried(tmp_path):
    """The bytes say one ingested_at, the manifest another: not provably the product the manifest names, so it rebuilds."""
    store = tmp_path / "s"
    _write(store, FIRST)
    first, _, _ = _publish(store, PLAIN)
    _write(store, AGAIN)
    manifest = json.loads((store / "manifest.json").read_text())
    for e in manifest["products"]:
        e["ingested_at"] = "2026-11-12T09:09:09Z"
    (store / "manifest.json").write_text(json.dumps(manifest))
    _, stats, _ = _publish(store, PLAIN, first)
    assert (stats["content_carried"], stats["built"]) == (0, 3)


def test_masking_refuses_layouts_it_cannot_prove_safe():
    base = {"model_run_time": RUN, "run_time": "a", "ingested_at": "b", "grid": {"x": 1}}
    ok = fsc.masked(json.dumps(base).encode())
    assert ok is not None and ok[1] == {"run_time": "a", "ingested_at": "b"}
    # the volatile values do not move the key; every other byte does, model_run_time included
    assert fsc.masked(json.dumps(dict(base, run_time="z", ingested_at="y")).encode())[0] == ok[0]
    assert fsc.masked(json.dumps(dict(base, model_run_time="2026-11-12T00:00:00Z")).encode())[0] != ok[0]
    assert fsc.masked(json.dumps(dict(base, grid={"x": 2})).encode())[0] != ok[0]
    assert fsc.masked(json.dumps({k: v for k, v in base.items() if k != "run_time"}).encode()) is None        # absent
    assert fsc.masked(json.dumps(dict(base, grid={"run_time": "c"})).encode()) is None                         # repeated
    nested = {"model_run_time": RUN, "inner": {"run_time": "a", "ingested_at": "b"}}
    assert fsc.masked(json.dumps(nested).encode()) is None                                                    # not top level
    assert fsc.masked(None) is None


def test_the_pilots_workflow_passes_the_switch_on_by_default():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    step = yml.split("- name: Publish static forecast frames (dark)", 1)[1].split("\n      - name:", 1)[0]
    assert "FRAME_CONTENT_CARRY: ${{ vars.FRAME_CONTENT_CARRY || '1' }}" in step
