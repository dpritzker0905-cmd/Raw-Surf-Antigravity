"""The lane-window rebuild of the static GFS wind frames (2026-10-23, PR B): services/frame_set_wind_rebuild.py.

Pinned, offline (the synthetic lanes and products of test_frame_set_wind.py):
  * a new HRRR lane rebuilds ONLY the frames inside the old or the new lane's window, from their stored product (one download
    each), and carries every other frame with its bytes and path, renamed to the new lane with the stamp /grid puts on it;
  * the new index names the new lane and is named in the lane pointer (`frames`); latest.json is never written;
  * the no-op paths: the published index already carries the lane, the pointer already names a rebuild of this run, the
    pointer names another lane (nothing named), the kill, no lane.
"""
import json

import pytest

from services import frame_set as fs
from services import frame_set_wind as fsw
from services import frame_set_wind_rebuild as fswr
from test_frame_set_wind import WIND, _publish_wind, _write_wind_store, publish_lane, pub, wind_product  # noqa: F401

RUN = "2026-10-22T12:00:00Z"
BEFORE, IN_A, IN_B, BEYOND = "2026-10-22T12:00:00Z", "2026-10-23T03:00:00Z", "2026-10-25T03:00:00Z", "2026-10-28T00:00:00Z"
LANE_B_KEY = "wind_lane/hrrr-2026102400.json"


def _lane_b():
    from datetime import datetime, timezone
    return publish_lane(ms=9.0, cycle=datetime(2026, 10, 24, 0, tzinfo=timezone.utc), key=LANE_B_KEY)


def _published(tmp_path):
    """Lane A's published wind set (latest.json -> its index), the store it came from, and a pointer naming lane B."""
    store, out = tmp_path / "store", tmp_path / "out"
    _write_wind_store(store, [BEFORE, IN_A, IN_B, BEYOND], run=RUN)
    lane_a = publish_lane(ms=15.45)
    index, _ = _publish_wind(store, out, lane_a)
    sink = pub.LocalSink(out)
    sink.write(index["path"], fs.index_bytes(index), fs.JSON_TYPE, fs.IMMUTABLE)
    latest = {"version": 1, "sets": {fswr.WIND_SET_KEY: fs.latest_record(index, None, RUN, "test")}}
    sink.write(fs.LATEST, json.dumps(latest).encode(), fs.JSON_TYPE, fs.REVALIDATE)
    lane_b = _lane_b()
    ident = lane_b.identity()
    ptr = fsw.pointer_record({"key": ident["key"], "cycle": ident["cycle"], "horizon": ident["horizon"], "hours": 49}, None)
    sink.write(fsw.LANE_POINTER, json.dumps(ptr).encode(), fs.JSON_TYPE, fs.REVALIDATE)
    return store, out, index, lane_a, lane_b


def _rebuild(store, out, lane, fetched=None):
    sink = pub.LocalSink(out)

    def fetch(name):
        if fetched is not None:
            fetched.append(name)
        return pub.LocalCache(store).product_bytes(name)
    return fswr.rebuild_for_lane(sink, lane, lambda jobs: [sink.write(*j) for j in jobs], fetch=fetch, log=lambda *_: None)


def _frames(index):
    return {f["valid_time"]: (f, {**index.get("common_meta", {}), **(f.get("meta") or {})}) for f in index["frames"]}


def test_a_new_lane_rebuilds_only_the_window_frames_and_the_pointer_names_them(tmp_path):
    store, out, index_a, lane_a, lane_b = _published(tmp_path)
    latest_before = (out / fs.LATEST).read_bytes()
    fetched = []
    report = _rebuild(store, out, lane_b, fetched)
    assert report["status"] == "published", report
    assert sorted(fetched) == sorted(f"gfs_wind_wind_global_mid_{vt.replace('-', '').replace(':', '')}.json" for vt in (IN_A, IN_B))
    sink = pub.LocalSink(out)
    index_b = json.loads(sink.read(report["index"]))
    assert index_b["wind_lane"] == lane_b.identity() and index_b["run"] == index_a["run"]
    a, b = _frames(index_a), _frames(index_b)
    for vt in (BEFORE, BEYOND):                                           # GFS on both sides: same bytes, renamed lane
        assert b[vt][0]["path"] == a[vt][0]["path"] and b[vt][0]["source"]["wind_lane"] == LANE_B_KEY
        # the stamp is exactly what /grid stamps on this product under lane B (the same apply_wind_lane)
        _served, stamp, touched = fsw.lane_applied(wind_product(vt, RUN), lane_b)
        assert touched == 0 and b[vt][1]["wind_lane"] == stamp
    for vt in (IN_A, IN_B):                                               # rebuilt with lane B from the stored product
        _served, stamp, _t = fsw.lane_applied(wind_product(vt, RUN), lane_b)
        assert b[vt][1]["wind_lane"] == stamp and b[vt][0]["source"]["wind_lane"] == LANE_B_KEY
    assert b[IN_A][0]["path"] != a[IN_A][0]["path"]                       # HRRR moved there
    ptr = json.loads(sink.read(fsw.LANE_POINTER))
    assert ptr["key"] == LANE_B_KEY and ptr["frames"]["index"] == report["index"] and ptr["frames"]["run"] == index_a["run"]
    assert ptr["frames"]["lane"] == LANE_B_KEY
    assert (out / fs.LATEST).read_bytes() == latest_before                # latest.json is the pilots lane's alone
    assert fswr.pointer_keep_paths(sink) == fs.referenced_paths(index_b)  # the pilots' retention keeps every object it names


def test_the_rebuild_does_nothing_when_it_has_nothing_to_do(tmp_path, monkeypatch):
    store, out, index_a, lane_a, lane_b = _published(tmp_path)
    assert _rebuild(store, out, lane_a)["status"] == "current"            # the published index already carries this lane
    assert _rebuild(store, out, None)["status"] == "no_lane"
    monkeypatch.setenv("WIND_LANE_FRAMES_REBUILD", "0")
    assert _rebuild(store, out, lane_b)["status"] == "killed"
    monkeypatch.delenv("WIND_LANE_FRAMES_REBUILD")
    assert _rebuild(store, out, lane_b)["status"] == "published"
    fetched = []
    assert _rebuild(store, out, lane_b, fetched)["status"] == "already_rebuilt" and fetched == []


def test_a_pointer_naming_another_lane_is_left_alone(tmp_path):
    store, out, index_a, lane_a, lane_b = _published(tmp_path)
    sink = pub.LocalSink(out)
    other = dict(json.loads(sink.read(fsw.LANE_POINTER)), key="wind_lane/hrrr-2026102406.json")
    sink.write(fsw.LANE_POINTER, json.dumps(other).encode(), fs.JSON_TYPE, fs.REVALIDATE)
    report = _rebuild(store, out, lane_b)
    assert report["status"] == "published_unnamed"
    assert json.loads(sink.read(fsw.LANE_POINTER)) == other               # the client never serves these frames against it


def test_a_product_of_another_run_is_never_mixed_in(tmp_path):
    store, out, index_a, lane_a, lane_b = _published(tmp_path)
    name = f"gfs_wind_wind_global_mid_{IN_A.replace('-', '').replace(':', '')}.json"
    (store / name).write_text(json.dumps(wind_product(IN_A, "2026-10-22T18:00:00Z")))   # the pilots wrote the next run
    report = _rebuild(store, out, lane_b)
    # 1 of 4 frames refused as stale is under the coverage floor: nothing is published and the pointer names no rebuild, so
    # the client keeps the published index (and /grid for the new lane's window) until the pilots publish the next run.
    assert report["status"] == "not_published" and report["stats"]["stale_local"] == 1
    assert "frames" not in json.loads(pub.LocalSink(out).read(fsw.LANE_POINTER))


@pytest.mark.parametrize("vt,reason", [(BEFORE, "before_hrrr_cycle"), (BEYOND, "beyond_hrrr_horizon")])
def test_restamp_names_the_new_lane_with_the_reason_grid_gives(tmp_path, vt, reason):
    store, out, index_a, lane_a, lane_b = _published(tmp_path)
    frame = next(f for f in index_a["frames"] if f["valid_time"] == vt)
    stamp = fswr.restamp(index_a, frame, lane_b)
    assert stamp["reason"] == reason and stamp["hrrr_cycle"] == lane_b.identity()["cycle"] and stamp["lane"] == "gfs"
