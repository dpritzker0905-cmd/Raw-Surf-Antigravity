"""Static frames for GFS WIND (2026-10-22, the wind instant scrub): services/frame_set_wind.py + frame_binary's wind fields.

What is pinned, offline (a synthetic HRRR lane built the way noaa_hrrr_wind_fetcher builds one):
  * a wind frame carries speed past height's 65.5 cap (0.01 kn steps) and every node passes the parity gate;
  * each frame is the stored product WITH THE HRRR LANE APPLIED by the same apply_wind_lane /grid runs: decoded values equal
    /grid's (the wind tolerances), the stamp is /grid's, and the lane_weight plane marks exactly the nodes the blend uses
    (wind_lane.lane_use, the one function both call);
  * with no lane the frame is the stored GFS field, as /grid with none;
  * the index names the lane, every frame's source identity carries its key, an unchanged lane republishes nothing and a new
    lane rebuilds the set, keeping the path (bytes) of frames the lane does not touch;
  * a flipped byte fails parity (the positive control); the lane pointer keeps its first `written_at` for the same lane.
"""
import json
import math
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np
import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
import publish_frame_images as pub  # noqa: E402
from services import _hrrr_grid as hg  # noqa: E402
from services import frame_binary as fb  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_wind as fsw  # noqa: E402
from services import noaa_hrrr_wind_fetcher as fetcher  # noqa: E402
from services.weather_pipeline import wind_lane as WL  # noqa: E402
from services.weather_pipeline.schemas import NormalizedProduct  # noqa: E402

CYCLE = datetime(2026, 10, 22, 18, tzinfo=timezone.utc)
WIND = fsw.WIND_TARGET
ISO = "%Y-%m-%dT%H:%M:%SZ"


def lane_obj(ms=15.45, cycle=CYCLE):
    """An HRRR lane: `ms` m/s from 090 wherever HRRR's domain has cells, 49 hourly fields from `cycle`."""
    la = dict(fetcher.LATTICE)
    hours = [cycle + timedelta(hours=k) for k in range(49)]
    lat = la["lat0"] + la["res"] * np.arange(la["nlat"])
    lon = la["lon0"] + la["res"] * np.arange(la["nlon"])
    LA, LO = np.meshgrid(lat, lon, indexing="ij")
    inside = hg.edge_km_np(LA, LO) > 0.0
    U = np.repeat(np.where(inside, -ms, np.nan)[None], len(hours), 0)
    V = np.repeat(np.where(inside, 0.0, np.nan)[None], len(hours), 0)
    return {"format": fetcher.FORMAT, "cycle": cycle.strftime(ISO), "horizon": hours[-1].strftime(ISO),
            "hours": [h.strftime(ISO) for h in hours], "lattice": la, "u": fetcher.encode(U), "v": fetcher.encode(V),
            "steps_ok": len(hours), "steps_failed": 0}


def publish_lane(ms=15.45, cycle=CYCLE, key=None):
    key = key or f"wind_lane/hrrr-{cycle:%Y%m%d%H}.json"
    return fsw.PublishLane(WL.Lane(lane_obj(ms, cycle), key=key), key)


def wind_product(valid, run="2026-10-22T12:00:00Z", fast=False):
    """A regular 2-deg GFS wind box over CONUS and the Gulf (16 x 12 nodes, lat 20-42, lng -130 .. -100 step 2), normalizer
    rounding (speed 4 dp, direction 2 dp, u / v from the unrounded values at 4 dp); `fast` puts 120 kn on one node."""
    vecs = []
    cols, rows = 16, 12
    for r in range(rows):
        for c in range(cols):
            lat, lng = 20.0 + 2 * r, -130.0 + 2 * c
            s = 8.0 + 0.37 * r + 0.11 * c + (112.123456 if fast and (r, c) == (3, 4) else 0.0)
            d = (31.7 * c + 13.3 * r + 0.123456) % 360.0
            rad = math.radians(d)
            vecs.append({"lat": lat, "lng": lng, "speed": round(s, 4), "direction": round(d, 2), "u": round(-s * math.sin(rad), 4),
                         "v": round(-s * math.cos(rad), 4), "period": 0.0, "gust": None, "value": None, "is_valid": True,
                         "dir_confidence": None})
    vecs[5]["is_valid"] = False
    vecs[5].update(speed=0.0, direction=0.0, u=0.0, v=0.0)
    return {"model": "GFS", "provider": "open-meteo", "domain": "wind", "layer": "wind", "run_time": run, "model_run_time": run,
            "model_run_time_status": "known", "ingested_at": run, "valid_time": valid, "is_forecast_authoritative": True,
            "is_estimated": False, "estimate_basis": None, "value_kind": "wind_speed", "value_unit": "kn", "display_unit_hint": "kn",
            "coverage": {"west": -130.0, "south": 20.0, "east": -100.0, "north": 42.0}, "source_variables": ["wind_speed_10m"],
            "freshness_sec": 1800, "region_id": "global_mid", "coverage_mode": "global_tile",
            "grid": {"cols": cols, "rows": rows, "bounds": {"west": -130.0, "south": 20.0, "east": -100.0, "north": 42.0},
                     "vectors": vecs, "diagnostics": {"gridMode": "rectangular"}}}


@pytest.fixture(autouse=True)
def _lane_env(monkeypatch):
    for k in ("WIND_HRRR_LANE", "WIND_HRRR_FEATHER_KM", "WIND_HRRR_TAPER_HOURS", "FRAME_WIND_LANE_FILE", "FRAME_WIND_LANE_KEY"):
        monkeypatch.delenv(k, raising=False)
    WL.install(None)
    yield
    WL.install(None)


def test_a_wind_frame_carries_fast_wind_and_passes_parity():
    p = wind_product("2026-10-25T00:00:00Z", fast=True)
    raw, check = fs.build_frame(p, {}, fs.fields_for(WIND))
    assert check["bad"] == 0 and check["missing_mismatch"] == 0
    dec = fb.decode_frame(raw)
    assert set(dec["fields"]) == {fb.DIRECTION, fb.SPEED_KT} and dec["uv_convention"] == 0
    speeds = dec["fields"][fb.SPEED_KT]
    assert speeds[5] is None                                              # the invalid node stays no-data
    i = 3 * 16 + 4
    assert abs(speeds[i] - p["grid"]["vectors"][i]["speed"]) <= 0.005 and speeds[i] > 100   # past height's 65.5 cap
    assert check["max_abs_err"]["speed_kt"] <= 0.005 and check["max_abs_err"]["direction_deg"] == 0.0


def test_a_lane_window_frame_is_what_grid_serves_and_marks_the_blended_nodes():
    lane = publish_lane()
    valid = "2026-10-23T03:00:00Z"                                        # inside [cycle, horizon]
    served, stamp, touched = fsw.lane_applied(wind_product(valid), lane)
    grid = WL.apply_wind_lane(NormalizedProduct.model_validate(wind_product(valid)), "GFS", "wind", "wind", lane=lane.lane)
    assert stamp == grid.wind_lane and stamp["lane"] == "hrrr+gfs" and touched == stamp["hrrr_cells"] > 0
    raw, check = fs.build_frame(served, {}, fs.fields_for(WIND, touched > 0))
    assert check["bad"] == 0
    dec = fb.decode_frame(raw)
    weights = dec["fields"][fb.LANE_WEIGHT]
    found = WL.lane_use(grid.grid.vectors, lane.lane, WL._data_time(grid), lane.lane.time_weight(WL._data_time(grid)))
    used = {int(i) for k, i in enumerate(found[0]) if bool(found[4][k])}
    assert {i for i, w in enumerate(weights) if w} == used                # exactly the nodes the blend uses
    for i, g in enumerate(grid.grid.vectors):                             # the decoded field IS /grid's, node by node
        s = dec["fields"][fb.SPEED_KT][i]
        if not g.is_valid:
            assert s is None
            continue
        assert abs(s - g.speed) <= 0.005 + 1e-9
        d = abs(dec["fields"][fb.DIRECTION][i] - g.direction) % 360.0
        assert min(d, 360.0 - d) <= 0.005 + 1e-9
    moved = sum(1 for a, b in zip(wind_product(valid)["grid"]["vectors"], grid.grid.vectors) if abs(a["speed"] - b.speed) > 0.01)
    assert moved > 0                                                      # the lane really changed values here


def test_outside_the_window_and_without_a_lane_the_frame_is_the_stored_field():
    lane = publish_lane()
    beyond = wind_product("2026-10-28T00:00:00Z")
    served, stamp, touched = fsw.lane_applied(beyond, lane)
    assert stamp["lane"] == "gfs" and stamp["reason"] == "beyond_hrrr_horizon" and touched == 0
    assert served["grid"]["vectors"] == beyond["grid"]["vectors"]
    served2, stamp2, touched2 = fsw.lane_applied(beyond, None)
    assert stamp2 is None and touched2 == 0 and served2 is beyond


def _write_wind_store(store, valids, run="2026-10-22T12:00:00Z"):
    store.mkdir(parents=True, exist_ok=True)
    entries = []
    for vt in valids:
        name = f"gfs_wind_wind_global_mid_{vt.replace('-', '').replace(':', '')}.json"
        (store / name).write_text(json.dumps(wind_product(vt, run)))
        entries.append({"model": "GFS", "domain": "wind", "layer": "wind", "region_id": "global_mid", "filename": name,
                        "valid_time_start": vt, "model_run_time": run, "run_time": run, "ingested_at": run, "is_estimated": False})
    (store / "manifest.json").write_text(json.dumps({"products": entries}))


def _publish_wind(store, out, lane):
    return fs.publish_set(pub.LocalCache(store), pub.LocalSink(out), WIND, None, lambda jobs: [pub.LocalSink(out).write(*j) for j in jobs],
                          log=lambda *_: None, wind_lane=lane)


def test_the_index_names_the_lane_and_a_new_lane_rebuilds_only_what_it_touches(tmp_path):
    store, out = tmp_path / "store", tmp_path / "out"
    valids = ["2026-10-23T03:00:00Z", "2026-10-28T00:00:00Z"]           # one inside the lane window, one beyond it
    _write_wind_store(store, valids)
    lane_a = publish_lane(ms=15.45)
    index, stats = _publish_wind(store, out, lane_a)
    assert stats["built"] == 2 and stats["refused"] == 0 and stats["parity_bad"] == 0
    assert index["wind_lane"] == lane_a.identity() and index["path"].startswith("v1/gfs/wind/wind/global_mid/index/")
    frames = {f["valid_time"]: f for f in index["frames"]}
    meta = {vt: {**index["common_meta"], **f["meta"]} for vt, f in frames.items()}
    assert meta[valids[0]]["wind_lane"]["lane"] == "hrrr+gfs" and meta[valids[1]]["wind_lane"]["reason"] == "beyond_hrrr_horizon"
    assert all(f["source"]["wind_lane"] == lane_a.key for f in frames.values())
    assert set(index["quantisation"]) == {"direction_deg", "speed_kt", "lane_weight"}
    # The same lane again: nothing to publish.
    again, _ = fs.publish_set(pub.LocalCache(store), pub.LocalSink(out), WIND, index, lambda jobs: None, log=lambda *_: None,
                              wind_lane=publish_lane(ms=15.45))
    assert again is None
    # A NEW lane (another cycle key, other HRRR values): every frame is rebuilt; the beyond-horizon frame keeps its bytes.
    lane_b = publish_lane(ms=9.0, key="wind_lane/hrrr-2026102300.json")
    index_b, stats_b = fs.publish_set(pub.LocalCache(store), pub.LocalSink(out), WIND, index, lambda jobs: None,
                                      log=lambda *_: None, wind_lane=lane_b)
    frames_b = {f["valid_time"]: f for f in index_b["frames"]}
    assert stats_b["carried"] == 0 and index_b["wind_lane"]["key"] == lane_b.key
    assert frames_b[valids[1]]["path"] == frames[valids[1]]["path"]      # untouched by the lane: same bytes, same path
    assert frames_b[valids[0]]["path"] != frames[valids[0]]["path"]      # the HRRR values moved


def test_a_flipped_byte_fails_the_wind_parity_gate():
    p = wind_product("2026-10-25T00:00:00Z")
    raw = bytearray(fb.encode_frame(p, fb.WIND_FIELDS))
    hb = 72 + 24 * 2                                                      # the planes start after two descriptors
    raw[hb + 3] ^= 0x40                                                   # a direction low byte (byte-shuffled plane)
    assert fb.parity(p, fb.decode_frame(bytes(raw)))["bad"] >= 1


def test_the_publish_run_reads_the_lane_from_a_file_offline_and_none_when_switched_off(tmp_path, monkeypatch):
    path = tmp_path / "lane.json"
    path.write_text(json.dumps(lane_obj()))
    monkeypatch.setenv("FRAME_WIND_LANE_FILE", str(path))
    lane = fsw.load_publish_lane(log=lambda *_: None)
    assert lane is not None and lane.key == "wind_lane/hrrr-2026102218.json" and lane.identity()["cycle"] == "2026-10-22T18:00:00Z"
    monkeypatch.setenv("WIND_HRRR_LANE", "0")
    assert fsw.load_publish_lane(log=lambda *_: None) is None             # /grid serves GFS then; so do the frames


def test_the_lane_pointer_keeps_written_at_while_the_lane_is_the_same():
    idx = {"key": "wind_lane/hrrr-2026102218.json", "cycle": "2026-10-22T18:00:00Z", "horizon": "2026-10-24T18:00:00Z", "hours": 49}
    first = fsw.pointer_record(idx, None)
    first["written_at"] = "2026-10-22T19:00:00Z"
    same = fsw.pointer_record(idx, first)
    assert same["written_at"] == "2026-10-22T19:00:00Z" and same["feather_km"] == 200.0 and same["taper_hours"] == 3
    moved = fsw.pointer_record(dict(idx, key="wind_lane/hrrr-2026102300.json"), first)
    assert moved["written_at"] != "2026-10-22T19:00:00Z" and moved["key"].endswith("2026102300.json")
