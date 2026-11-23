"""served-wave-verify-v1 sampler (gate sections 2, 2a, 5, 6, 8) end to end on SYNTHETIC published frames: a fake public store,
the client's decoder in Node, a local archive. The census per (model, set, tier) accounts for every expected record; runs close
only when no set can still publish them; re-runs write nothing; only verify/point-archive/v1/ is written."""
import hashlib
import json
import os
import shutil

import pytest

from services import frame_binary as fb
from services.point_archive import core
from services.point_archive import served_sampler as ss
from services.point_archive.storage import LocalStore
from services.point_archive.writer import ArchiveWriter, read_jsonl_gz, verify_archive

if shutil.which("node") is None:
    if os.environ.get("CI"):
        raise RuntimeError("node is not on PATH in CI: the sampler test must run, not skip")
    pytest.skip("node not installed locally", allow_module_level=True)

R1, R2 = "2027-01-15T00:00:00Z", "2027-01-15T06:00:00Z"
WORLD = (-180.0, -60.0, 180.0, 60.0, 13, 7)        # west, south, east, north, cols, rows: 30 x 20 deg nodes
BOX = (-160.0, 15.0, -150.0, 25.0, 5, 5)           # 2.5 deg nodes
LEADS = (0, 3, 6, 252)                             # 252 h is past the 240 h limit: never sampled


def _doc():
    st = []
    for sid, lat, lon, box in (("S1", 20.0, -155.0, "boxa"), ("S2", 0.0, 0.0, None), ("S3", 20.0, 179.5, None)):
        st.append({"id": sid, "wmo_id": sid, "lat": lat, "lon": lon, "depth_m": 100.0, "region": "us_west", "sheltered": None,
                   "source": "ndbc", "exam_only": False, "purposes": ["served"], "stratum": "exposed",
                   "regional_box": {"GFS/waves": box} if box else {}})
    return {"version": "test-buoys/1", "stations": st}


def _value(r, c, k):
    return 1.0 + 0.01 * r + 0.001 * c + 0.1 * k


def _frame(grid, run, valid, k, land=(), period=True):
    w, s, e, n, cols, rows = grid
    vec = []
    for r in range(rows):
        for c in range(cols):
            lat, lng = s + r * (n - s) / (rows - 1), w + c * (e - w) / (cols - 1)
            if (r, c) in land:
                vec.append({"lat": lat, "lng": lng, "speed": None, "is_valid": False, "direction": 0.0})
            else:
                vec.append({"lat": lat, "lng": lng, "speed": _value(r, c, k), "is_valid": True, "direction": 10.0 * c,
                            "period": (8.0 + r) if period else None})
    prod = {"grid": {"cols": cols, "rows": rows, "vectors": vec}, "valid_time": valid, "model_run_time": run}
    return fb.gzip_frame(fb.encode_frame(prod))


class Frames:
    """The anonymous public read, faked: path -> bytes."""

    def __init__(self):
        self.objects = {}

    def get(self, path, bust=False):
        return self.objects.get(path)

    def put_json(self, path, obj):
        self.objects[path] = json.dumps(obj).encode()
        return path


def _valid(run, lead):
    return core.iso_z(core.parse_time(run).timestamp() + lead * 3600)


def world_index(fr, layer, run, *, missing_lead=None, other_run_lead=None, land_at_lead6=()):
    prefix = f"v1/gfs/marine/{layer}/global_mid"
    frames = []
    for k, lead in enumerate(LEADS):
        vt = _valid(run, lead)
        hdr_run = R1 if lead == other_run_lead else run
        gz = _frame(WORLD, hdr_run, vt, k, land=land_at_lead6 if lead == 6 else ())
        path = f"{prefix}/{core.run_stamp(run)}/{lead}-{hashlib.sha256(gz).hexdigest()[:12]}.bin"
        if lead != missing_lead:
            fr.objects[path] = gz
        frames.append({"valid_time": vt, "is_estimated": False, "path": path})
        if lead == 3:                                  # an estimated duplicate: the client draws the authoritative one
            frames.append({"valid_time": vt, "is_estimated": True, "path": path + ".est"})
    frames.append({"valid_time": _valid(run, 9), "is_estimated": False, "path": None, "unbuilt": "not_local"})
    return fr.put_json(f"{prefix}/index/{core.run_stamp(run)}-{layer}.json",
                       {"run": run, "path": f"{prefix}/index/{core.run_stamp(run)}-{layer}.json", "frames": frames})


def box_index(fr, run, *, bad_sha_lead=None):
    prefix = "v1/gfs/marine/waves/boxa"
    blob, frames = b"", []
    for k, lead in enumerate(LEADS):
        gz = _frame(BOX, run, _valid(run, lead), k)
        sha = hashlib.sha256(gz).hexdigest()[:12]
        frames.append({"valid_time": _valid(run, lead), "is_estimated": False, "offset": len(blob), "length": len(gz),
                       "sha12": "000000000000" if lead == bad_sha_lead else sha})
        blob += gz
    bpath = f"{prefix}/{core.run_stamp(run)}/bundle-x.bin"
    fr.objects[bpath] = blob
    ipath = f"{prefix}/index/{core.run_stamp(run)}.json"
    return fr.put_json(ipath, {"run": run, "path": ipath, "frames": frames, "bundle": {"path": bpath}})


def _rows(store, model, run):
    return read_jsonl_gz(store.read(core.run_path("served", model, run)))


def _census(rows, layer, tier):
    return [r for r in rows if r["row_type"] == "census" and r["frame_set"] == layer and r["tier"] == tier]


@pytest.fixture()
def world(tmp_path):
    fr = Frames()
    store = LocalStore(tmp_path)
    s = ss.Sampler(_doc(), fr, ArchiveWriter(store), log=lambda *_: None)
    return fr, store, s


def test_closed_run_rule_and_the_census(world):
    fr, store, s = world
    w1 = world_index(fr, "waves", R1, land_at_lead6={(3, 6)})       # S2 (0, 0) -> node row 3, col 6: masked at lead 6
    w2 = world_index(fr, "waves", R2, missing_lead=6, other_run_lead=3)
    sw1 = world_index(fr, "swell_1", R1)
    b2 = box_index(fr, R2, bad_sha_lead=3)
    latest = {"sets": {"GFS/marine/waves/global_mid": {"index": w2, "previous_index": w1},
                       "GFS/marine/swell_1/global_mid": {"index": sw1},
                       "GFS/marine/waves/boxa": {"index": b2, "bundle": {}}}}
    rep = s.run(latest)
    assert [x["run"] for x in rep["GFS"] if "path" in x] == [R1]
    assert [x["run"] for x in rep["GFS"] if "deferred" in x] == [R2]      # swell_1 still before R2: it may publish R2

    rows = _rows(store, "gfs", R1)
    recs = [r for r in rows if r["row_type"] == "record"]
    assert {r["lead_h"] for r in recs} == {0, 3, 6}                       # 252 h never; the unbuilt 9 h is not a frame
    cw = _census(rows, "waves", "global_mid")[0]
    assert cw["leads"] == 3 and cw["buoys"] == 3 and cw["unbuilt"] == 1
    assert cw["counts"] == {"cell_masked": 1, "ok": 8} and cw["expected"] == 9
    assert _census(rows, "swell_2", "global_mid")[0]["set_unpublished"] is True
    assert _census(rows, "wind_waves", "global_mid")[0]["set_unpublished"] is True
    assert _census(rows, "waves", "boxa")[0]["set_unpublished"] is True   # the box only has R2
    assert _census(rows, "waves", "regional")[0]["no_regional_tier"] == 2  # S2, S3: once per run, not per lead
    assert _census(rows, "swell_1", "regional")[0]["no_regional_tier"] == 3

    # the next publish moves swell_1 to R2: R2 closes; R1 is already archived and skipped
    sw2 = world_index(fr, "swell_1", R2)
    latest["sets"]["GFS/marine/swell_1/global_mid"] = {"index": sw2, "previous_index": sw1}
    rep2 = s.run(latest)
    assert [x["run"] for x in rep2["GFS"] if "path" in x] == [R2]
    rows2 = _rows(store, "gfs", R2)
    cw2 = _census(rows2, "waves", "global_mid")[0]
    assert cw2["other_run"] == 1                                          # a frame whose header run is not R2
    assert cw2["counts"] == {"ok": 3, "sampler_fail": 3}                  # lead 0 ok; lead 6 pruned; lead 3 other run
    fails = [r for r in rows2 if r.get("status") == "sampler_fail" and r["tier"] == "global_mid"]
    assert {r["cause"] for r in fails} == {"pruned"}
    cb = _census(rows2, "waves", "boxa")[0]
    assert cb["buoys"] == 1 and cb["counts"] == {"ok": 2, "sampler_fail": 1}
    assert [r["cause"] for r in rows2 if r.get("status") == "sampler_fail" and r["tier"] == "boxa"] == ["sha12"]

    # every census row accounts for every expected record
    for rows_ in (rows, rows2):
        for c in (r for r in rows_ if r["row_type"] == "census" and not r["set_unpublished"] and r["tier"] != "regional"):
            assert sum(v for k, v in c["counts"].items() if k != "out_of_domain") == c["expected"], c

    # idempotent: nothing new on a re-run
    before = sorted(store.list("verify"))
    assert all(not x for x in s.run(latest).values())
    assert sorted(store.list("verify")) == before
    assert all(p.startswith("verify/point-archive/v1/") for p in before)
    assert verify_archive(store, "verify/point-archive/v1/served/gfs") == []


def test_records_carry_the_decoded_served_values_and_provenance(world):
    fr, store, s = world
    w1 = world_index(fr, "waves", R1)
    sw1 = world_index(fr, "swell_1", R1)
    s.run({"sets": {"GFS/marine/waves/global_mid": {"index": w1}, "GFS/marine/swell_1/global_mid": {"index": sw1}}})
    rows = _rows(store, "gfs", R1)
    r = next(x for x in rows if x["row_type"] == "record" and x["frame_set"] == "waves" and x["station_id"] == "S2"
             and x["lead_h"] == 3)
    assert (r["cell_row"], r["cell_col"], r["status"]) == (3, 6, "ok")
    assert r["hs_m"] == pytest.approx(_value(3, 6, 1), abs=fb.TOLERANCE[fb.HEIGHT])
    assert r["tp_s"] == pytest.approx(11.0, abs=fb.TOLERANCE[fb.PERIOD]) and "tm_s" not in r   # GFS waves: a peak period
    assert r["dir_deg"] == pytest.approx(60.0, abs=fb.TOLERANCE[fb.DIRECTION])
    assert r["decoder_version"] == ss.dec.decoder_version() and len(r["grid_hash"]) == 64
    assert r["frame_hash"] == hashlib.sha256(fr.objects[json.loads(fr.objects[w1])["frames"][1]["path"]]).hexdigest()
    for k in ("schema", "purpose", "model", "run_time", "valid_time", "lead_h", "station_id", "buoy_list_version",
              "buoy_list_hash", "status", "writer_version", "run_hash", "sampler_version", "tier", "frame_set"):
        assert k in r
    assert r["run_time"] == R1 and r["valid_time"] == _valid(R1, 3) and r["model"] == "gfs"
    p = next(x for x in rows if x["row_type"] == "record" and x["frame_set"] == "swell_1" and x["station_id"] == "S3"
             and x["lead_h"] == 0)
    assert p["period_kind"] == "tm" and p["partitions"][0]["kind"] == "swell_1" and set(p["partitions"][0]) == {
        "kind", "h", "tp", "dir"}
    assert "hs_m" not in p                                     # a partition is never written as the bulk height
    cells = [x for x in store.list("verify/point-archive/v1/served/cells") if x.endswith(".json")]
    assert cells and json.loads(store.read(cells[0]))["rule"].startswith("nearest wet node")


def test_unarchived_run_closes_when_it_is_about_to_be_pruned(world):
    fr, store, s = world
    w1, w2 = world_index(fr, "waves", R1), world_index(fr, "waves", R2)
    sw0 = world_index(fr, "swell_1", "2027-01-14T18:00:00Z")
    # swell_1 lags (18Z) but waves holds R1 only as PREVIOUS: its next publish prunes R1 -> write R1 now
    rep = s.run({"sets": {"GFS/marine/waves/global_mid": {"index": w2, "previous_index": w1},
                          "GFS/marine/swell_1/global_mid": {"index": sw0}}})
    assert any(x.get("run") == R1 and "path" in x and "expiring" in x["why"] for x in rep["GFS"])
    assert any(x.get("run") == R2 and "deferred" in x for x in rep["GFS"])


def test_a_whole_job_failure_leaves_a_marker(tmp_path):
    w = ArchiveWriter(LocalStore(tmp_path))
    path = ss.failure_marker(w, core.parse_time("2027-01-15T03:50:00Z"), "job", "RuntimeError: latest.json missing")
    assert path.startswith("verify/point-archive/v1/served/_sampler_fail/20270115T0350Z-")
    body = json.loads(LocalStore(tmp_path).read(path))
    assert body["status"] == "sampler_fail" and body["cause"] == "job"
