"""A cheaper rebuild for the Gulf-filled world frames (services/frame_set_fill_patch.py, 2026-11-15, FRAME_FILLED_PATCH).

Pins the pre-registered gate's first half: a patched filled frame is BYTE-IDENTICAL to today's full rebuild, and its index entry is
the same, across donor changes; every frame the patch cannot prove equal falls back to the full rebuild (content, fetch, header,
position, shape, times, fields); the verify switch catches a wrong patch and publishes the full frame; an EURO and an ICON filled
set share each GFS donor; the kill switch restores today's path; the pilots workflow passes the switch ON. Offline only.
"""
import gzip
import json
import math
import random
import sys
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_content as fsc  # noqa: E402
from services import frame_set_fill as fsf  # noqa: E402
from services import frame_set_fill_patch as fsfp  # noqa: E402

COLS, ROWS = 181, 3                                   # a world span at 2 deg: the fill's lattice
RUN = "2026-11-14T00:00:00Z"
VALIDS = ["2026-11-14T12:00:00Z", "2026-11-14T15:00:00Z", "2026-11-14T18:00:00Z"]
EURO_PLAIN = next(t for t in fs.SETS if t["model"] == "EURO" and t["layer"] == "waves" and not t.get("variant"))
EURO_FILLED = next(t for t in fsf.FILLED_SETS if t["model"] == "EURO" and t["layer"] == "waves")
ICON_PLAIN = next(t for t in fs.SETS if t["model"] == "ICON" and t["layer"] == "waves" and not t.get("variant"))
ICON_FILLED = next(t for t in fsf.FILLED_SETS if t["model"] == "ICON" and t["layer"] == "waves")


def _vec(lat, lng, h, d, p, ok, sign=-1.0):
    if not ok:
        return {"lat": lat, "lng": lng, "speed": 0.0, "direction": 0.0, "u": 0.0, "v": 0.0, "period": 0.0, "gust": None,
                "value": None, "is_valid": False, "dir_confidence": None}
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "speed": h, "direction": d, "u": round(sign * h * math.sin(rad), 4),
            "v": round(sign * h * math.cos(rad), 4), "period": p, "gust": None, "value": None, "is_valid": True,
            "dir_confidence": 0.9}


def _product(model, vt, run, sea, base, seed=0):
    k = VALIDS.index(vt)
    vecs = [_vec(-2.0 + 2.0 * r, -180.0 + 2.0 * c, round(base + 0.3 * math.sin(0.11 * c + r + k + seed), 3),
                 round((13.0 * c + 5.0 * r + 7 * seed) % 360.0, 2), round(7.0 + 0.5 * r + 0.01 * c + 0.1 * seed, 2), sea(r, c))
            for r in range(ROWS) for c in range(COLS)]
    return {"model": model, "provider": "t", "domain": "marine", "layer": "waves", "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": vt, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wave_height", "value_unit": "m", "display_unit_hint": "ft",
            "source_dataset": "t", "upstream_provider": "t", "region_id": "global_mid", "resolution": 2.0, "freshness_sec": 1800,
            "source_variables": [], "coverage": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
            "grid": {"cols": COLS, "rows": ROWS, "bounds": {"west": -180.0, "south": -2.0, "east": 180.0, "north": 2.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


def _name(model, vt):
    return f"{model.lower()}_marine_waves_global_mid_{vt.replace('-', '').replace(':', '')}.json"


def _gfs_sea(r, c):
    return c % 7 != 0


def _write(store, gfs_run="2026-11-13T18:00:00Z", gfs_seed=0, euro_run=RUN, euro_seed=0, icon=False):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    models = [("EURO", euro_run, euro_seed, lambda r, c: not (c % 7 == 0 or c % 5 == 0), 2.0)]
    if icon:
        models.append(("ICON", euro_run, euro_seed + 1, lambda r, c: not (c % 7 == 0 or c % 4 == 0), 1.7))
    for vt in VALIDS:
        for model, run, seed, sea, base in models + [("GFS", gfs_run, gfs_seed, _gfs_sea, 1.0)]:
            (store / _name(model, vt)).write_text(json.dumps(_product(model, vt, run, sea, base, seed), separators=(",", ":")))
            entries.append({"model": model, "domain": "marine", "layer": "waves", "region_id": "global_mid", "resolution": 2.0,
                            "filename": _name(model, vt), "valid_time_start": vt, "model_run_time": run, "run_time": run,
                            "ingested_at": run, "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setenv("MARINE_GULF_FILL_MID", "1")
    monkeypatch.setenv("MARINE_GULF_FILL_MID_TARGETED", "1")
    monkeypatch.setenv("FRAME_REGIONAL_BUNDLES", "0")
    for k in ("MARINE_FILL_PROVENANCE_NODES", fsfp.FLAG, fsfp.VERIFY, fsc.FLAG, "FRAME_SETS", "FRAME_LATEST_GUARD"):
        monkeypatch.delenv(k, raising=False)
    fsf.cgf._DONOR_LRU.clear()
    fsf._DONOR_CACHE.clear()
    yield
    fsf._DONOR_CACHE.clear()


def _run(store, out, sets):
    return pub.publish_frame_sets(pub.LocalCache(store), pub.LocalSink(out), sets=sets, log=lambda *_: None)


def _index(out, target):
    return json.loads((out / json.loads((out / fs.LATEST).read_text())["sets"][fs.set_key(target)]["index"]).read_text())


def _both(tmp_path, monkeypatch, sets, steps):
    """Run the same sequence of ingests with the patch OFF and ON; return the two out dirs and the last reports."""
    reports = {}
    for arm in ("off", "on"):
        monkeypatch.setenv(fsfp.FLAG, "0" if arm == "off" else "1")
        fsf._DONOR_CACHE.clear()
        for i, kw in enumerate(steps):
            _write(tmp_path / f"s_{arm}_{i}", **kw)
            reports[arm] = _run(tmp_path / f"s_{arm}_{i}", tmp_path / arm, sets)
    return tmp_path / "off", tmp_path / "on", reports


def _same(out_a, out_b, target):
    a, b = _index(out_a, target), _index(out_b, target)
    assert a["frames"] == b["frames"] and a["common_meta"] == b["common_meta"] and a["grid"] == b["grid"]
    for f in a["frames"]:
        if f.get("path"):
            assert (out_a / f["path"]).read_bytes() == (out_b / f["path"]).read_bytes()
    return a


def test_patched_frames_are_byte_identical_to_the_full_rebuild_across_donor_changes(tmp_path, monkeypatch):
    steps = [dict(), dict(gfs_run="2026-11-14T00:00:00Z", gfs_seed=3),                       # two donor cycles
             dict(gfs_run="2026-11-14T06:00:00Z", gfs_seed=5, euro_run="2026-11-14T12:00:00Z", euro_seed=2)]  # + a new EURO run
    off, on, rep = _both(tmp_path, monkeypatch, [EURO_PLAIN, EURO_FILLED], steps)
    idx = _same(off, on, EURO_FILLED)
    st = rep["on"][fs.set_key(EURO_FILLED)]
    assert st["patched"] == st["built"] == 3 and st["patch_mismatch"] == 0 and st["cells_filled"] > 0
    assert "patched" not in rep["off"][fs.set_key(EURO_FILLED)]
    assert any(f["meta"].get("coarse_fill") or idx["common_meta"].get("coarse_fill") for f in idx["frames"])


def test_patch_nodes_equals_encode_frame_for_any_changed_subset():
    rnd = random.Random(7)
    base = _product("EURO", VALIDS[0], RUN, lambda r, c: (r + c) % 3 != 0, 2.0)
    raw = fb.encode_frame(base)
    for trial in range(25):
        p = json.loads(json.dumps(base))
        vecs = p["grid"]["vectors"]
        idx = rnd.sample(range(len(vecs)), rnd.randint(0, 60))
        for i in idx:
            v = vecs[i]
            ok = rnd.random() < 0.8
            vecs[i] = _vec(v["lat"], v["lng"], round(rnd.uniform(0, 70), 3), round(rnd.uniform(-720, 720), 2),
                           rnd.choice([None, round(rnd.uniform(0, 30), 2)]), ok)
            if ok and rnd.random() < 0.2:
                vecs[i]["dir_confidence"] = None
        head, fids, _vecs = fb.encode_header(p)
        if raw[:len(head)] != head:                     # the uv convention moved: the patch path would fall back
            continue
        assert fb.patch_nodes(raw, len(head), fids, len(vecs), {i: vecs[i] for i in idx}) == fb.encode_frame(p), trial


def _plain_frames(tmp_path, monkeypatch):
    _write(tmp_path / "s")
    out = tmp_path / "o"
    _run(tmp_path / "s", out, [EURO_PLAIN])
    return tmp_path / "s", out, _index(out, EURO_PLAIN)


def _inputs(store, vt=VALIDS[0]):
    raw_json = (store / _name("EURO", vt)).read_bytes()
    unfilled = json.loads(raw_json)
    donor = next(e for e in json.loads((store / "manifest.json").read_text())["products"]
                 if e["model"] == "GFS" and e["valid_time_start"] == vt)
    filled, n = fsf.apply_fill(unfilled, donor, (store / donor["filename"]).read_bytes(), "waves")
    assert n > 0
    return raw_json, unfilled, filled


def test_each_unprovable_case_falls_back(tmp_path, monkeypatch):
    store, out, idx = _plain_frames(tmp_path, monkeypatch)
    plain = fsfp.PlainFrames(idx, pub.LocalSink(out))
    plain.prefetch()
    raw_json, unfilled, filled = _inputs(store)
    vt = VALIDS[0]
    got, why = fsfp.try_patch(plain, vt, False, raw_json, unfilled, filled, fb.DEFAULT_FIELDS)
    assert why == "patched" and got[0] == fb.encode_frame(filled) and got[1]["bad"] == 0
    assert fsfp.try_patch(plain, VALIDS[0], True, raw_json, unfilled, filled, fb.DEFAULT_FIELDS)[1] == "no_plain"
    other = raw_json.replace(b'"speed":2.', b'"speed":3.', 1)                      # different bytes: not the plain frame's product
    assert fsfp.try_patch(plain, vt, False, other, unfilled, filled, fb.DEFAULT_FIELDS)[1] == "content"
    assert fsfp.try_patch(plain, vt, False, raw_json, unfilled, filled, fb.DEFAULT_FIELDS + (fb.SPEED,))[1] == "fields"
    moved = json.loads(json.dumps(filled))
    i = next(i for i, (a, b) in enumerate(zip(unfilled["grid"]["vectors"], moved["grid"]["vectors"])) if a != b)
    moved["grid"]["vectors"][i]["lat"] += 0.5
    assert fsfp.try_patch(plain, vt, False, raw_json, unfilled, moved, fb.DEFAULT_FIELDS)[1] == "position"
    later = dict(filled, valid_time=VALIDS[1])
    assert fsfp.try_patch(plain, vt, False, raw_json, unfilled, later, fb.DEFAULT_FIELDS)[1] == "times"
    flipped = json.loads(json.dumps(filled))                                       # the first valid node now reads u = +h sin d
    first = next(v for v in flipped["grid"]["vectors"] if v["is_valid"] and abs(v["u"]) > 1e-3)
    first["u"], first["v"] = -first["u"], -first["v"]
    assert fsfp.try_patch(plain, vt, False, raw_json, unfilled, flipped, fb.DEFAULT_FIELDS)[1] == "header"
    plain.raw[(vt, False)] = plain.raw[(vt, False)][:-1] + b"\x00"                  # what a bad download would hold
    bad = fsfp.PlainFrames(idx, pub.LocalSink(out))
    (out / idx["frames"][0]["path"]).write_bytes(gzip.compress(b"not the frame"))
    bad.prefetch()
    assert fsfp.try_patch(bad, vt, False, raw_json, unfilled, filled, fb.DEFAULT_FIELDS)[1] == "fetch"


def test_the_verify_switch_publishes_the_full_frame_when_a_patch_is_wrong(tmp_path, monkeypatch):
    monkeypatch.setenv(fsfp.VERIFY, "1")
    real = fb.patch_nodes

    def wrong(raw, *a):
        out = bytearray(real(raw, *a))
        out[-1] ^= 0xFF
        return bytes(out)
    monkeypatch.setattr(fb, "patch_nodes", wrong)
    _write(tmp_path / "s")
    rep = _run(tmp_path / "s", tmp_path / "on", [EURO_PLAIN, EURO_FILLED])
    st = rep[fs.set_key(EURO_FILLED)]
    assert st["patch_mismatch"] == st["patched"] == 3
    monkeypatch.setenv(fsfp.FLAG, "0")
    _run(tmp_path / "s", tmp_path / "off", [EURO_PLAIN, EURO_FILLED])
    _same(tmp_path / "off", tmp_path / "on", EURO_FILLED)


def test_an_euro_and_an_icon_filled_set_share_each_gfs_donor(tmp_path, monkeypatch):
    builds = []
    real = fsf.cgf._CompactDonor

    def counting(*a, **k):
        builds.append(a[0])
        return real(*a, **k)
    monkeypatch.setattr(fsf.cgf, "_CompactDonor", counting)
    sets = [EURO_PLAIN, ICON_PLAIN, EURO_FILLED, ICON_FILLED]
    _write(tmp_path / "s", icon=True)
    _run(tmp_path / "s", tmp_path / "on", sets)
    assert len(builds) == len(VALIDS)                                              # one donor per hour, used by both sets
    builds.clear()
    monkeypatch.setenv(fsfp.FLAG, "0")
    _run(tmp_path / "s", tmp_path / "off", sets)
    assert len(builds) == 2 * len(VALIDS)                                          # off: each set builds its own
    for t in (EURO_FILLED, ICON_FILLED):
        _same(tmp_path / "off", tmp_path / "on", t)


def test_a_changed_donor_is_never_served_from_the_cache(tmp_path, monkeypatch):
    builds = []
    real = fsf.cgf._CompactDonor
    monkeypatch.setattr(fsf.cgf, "_CompactDonor", lambda *a, **k: (builds.append(a[0]), real(*a, **k))[1])
    _write(tmp_path / "s1")
    _run(tmp_path / "s1", tmp_path / "on", [EURO_PLAIN, EURO_FILLED])
    _write(tmp_path / "s2", gfs_run="2026-11-14T00:00:00Z", gfs_seed=3)          # same filenames, new bytes
    _run(tmp_path / "s2", tmp_path / "on", [EURO_PLAIN, EURO_FILLED])
    assert len(builds) == 2 * len(VALIDS)


def test_parity_only_checks_the_named_nodes():
    p = _product("EURO", VALIDS[0], RUN, lambda r, c: True, 2.0)
    d = fb.decode_frame(fb.encode_frame(p))
    d["fields"][fb.HEIGHT][5] += 1.0                                               # node 5 is wrong
    assert fb.parity(p, d)["bad"] == 1 and fb.parity(p, d, only={4, 6})["bad"] == 0
    assert fb.parity(p, d, only={5})["bad"] == 1 and fb.parity(p, d, only={4, 6})["nodes"] == 2


def test_the_content_scan_is_memoised_on_the_bytes_object():
    a = json.dumps({"model_run_time": RUN, "run_time": "x", "ingested_at": "y", "grid": {}}).encode()
    b = bytes(bytearray(a))                                                        # equal bytes, another object
    assert fsc.masked(a) is fsc.masked(a) and fsc.masked(b) == fsc.masked(a) and fsc.masked(bytearray(a)) == fsc.masked(a)


def test_the_kill_switch_and_the_workflow():
    yml = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "forecast-ingest-pilots.yml").read_text(encoding="utf-8")
    step = yml.split("- name: Publish static forecast frames (dark)", 1)[1].split("\n      - name:", 1)[0]
    assert "FRAME_FILLED_PATCH: ${{ vars.FRAME_FILLED_PATCH || '1' }}" in step
    assert "FRAME_FILLED_PATCH_VERIFY: ${{ vars.FRAME_FILLED_PATCH_VERIFY || '0' }}" in step
    assert fsfp.enabled() and not fsfp.verify_mode()
