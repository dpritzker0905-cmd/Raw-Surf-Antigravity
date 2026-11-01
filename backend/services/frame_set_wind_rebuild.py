"""Rebuild the lane-window GFS wind frames for a NEW HRRR lane (2026-10-23, the wind instant scrub's PR B).

WHY. Static wind frames carry the HRRR lane they were published with (frame_set_wind.py), and the client serves a frame inside
the lane's window only when the serve box holds that same lane (windStaticFrames.laneVerdict, #474). The core lane publishes a
new HRRR cycle ~4 times a day; the pilots lane republishes the frames 3-4 times a day, on its own clock. In between, every
lane-window hour (the next ~48 h, the hours people look at) went back to /grid: about 40% of the day.

WHAT. Right after the core lane publishes a new lane (forecast-ingest.yml, `publish_frame_images.py --wind-lane-rebuild`):
  - read the published wind index (latest.json -> the GFS wind set);
  - frames OUTSIDE both the old and the new lane's window keep their bytes and path: GFS on both sides. Only their lane stamp
    is renamed to the new lane (`restamp`: what wind_lane.apply_wind_lane stamps on an hour outside the window);
  - frames inside either window are rebuilt from their stored product (an L2 download, the same product the index names:
    publish_set refuses a newer run's product as `stale_local`), with the new lane applied and the parity gate, by
    frame_set.publish_set itself;
  - the new index is uploaded (immutable) and named in the lane pointer (v1/wind_lane.json `frames`: {index, run, lane}).
latest.json is NOT written: the pilots lane writes it concurrently, and a lost update there could revert a marine set to an
older run. The client uses the pointer's index only for the run latest.json names (windStaticFrames.windIndex).
Kill: the env var WIND_LANE_FRAMES_REBUILD set to 0 (the step does nothing). Never raises into the ingest.
"""
from __future__ import annotations

import copy
import json

from services import frame_set as fs
from services import frame_set_wind as fsw

WIND_SET_KEY = fs.set_key(fsw.WIND_TARGET)


def _utc(value):
    from services import _hrrr_grid as hg
    return hg.utc(value)


def _in_window(vt, ident):
    return bool(ident and ident.get("cycle") and ident.get("horizon")) and _utc(ident["cycle"]) <= vt <= _utc(ident["horizon"])


def _merged_meta(index, frame):
    return {**((index or {}).get("common_meta") or {}), **(frame.get("meta") or {})}


def needs_product(index, frame, new_ident):
    """True when the frame's bytes can change with the new lane: its hour is inside the old or the new lane's window, or its
    published stamp says HRRR touched it."""
    meta = _merged_meta(index, frame)
    stamp = meta.get("wind_lane") or {}
    vt = _utc(stamp.get("valid_time") or frame["valid_time"])
    return _in_window(vt, (index or {}).get("wind_lane")) or _in_window(vt, new_ident) or stamp.get("lane") == "hrrr+gfs"


def restamp(index, frame, lane):
    """The stamp /grid puts on a frame OUTSIDE the lane's window (wind_lane.apply_wind_lane: GFS, named after the box's lane)."""
    ident = lane.identity()
    old = _merged_meta(index, frame).get("wind_lane") or {}
    vt = _utc(old.get("valid_time") or frame["valid_time"])
    reason = "beyond_hrrr_horizon" if vt > _utc(ident["horizon"]) else "before_hrrr_cycle"
    return {"lane": "gfs", "feather_km": lane.feather_km, "taper_hours": lane.taper_hours, "hrrr_cycle": ident["cycle"],
            "hrrr_horizon": ident["horizon"], "source": lane.source, "valid_time": fs.iso(vt), "reason": reason}


def prepare(index, lane):
    """The published index as publish_set's `previous_index`, with every frame the new lane cannot change already renamed to
    it (so publish_set carries it as is) and the frames it can change left for a rebuild. Returns (prepared, rebuild filenames)."""
    out = copy.deepcopy(index)
    rebuild, new_ident = set(), lane.identity()
    for f in out.get("frames", []):
        if not f.get("path"):
            continue                      # unbuilt stays unbuilt (/grid serves it)
        if needs_product(index, f, new_ident):
            rebuild.add((f.get("source") or {}).get("filename"))
            continue
        f["source"] = dict(f.get("source") or {}, wind_lane=lane.key)
        f["meta"] = dict(f.get("meta") or {}, wind_lane=restamp(index, f, lane))
    return out, rebuild


class IndexSource:
    """publish_set's `source` for a rebuild: the manifest entries are the published index's own frames (same files, runs and
    times), and product bytes come from `fetch(filename)` only for the frames being rebuilt."""

    def __init__(self, index, rebuild, fetch):
        self.index, self.rebuild, self.fetch = index, rebuild, fetch
        self.downloads = 0

    def manifest(self):
        products = []
        for f in self.index.get("frames", []):
            src = f.get("source") or {}
            if not src.get("filename"):
                continue
            products.append({**fsw.WIND_TARGET, "filename": src["filename"], "valid_time_start": f["valid_time"],
                             "is_estimated": bool(f.get("is_estimated")), "model_run_time": src.get("model_run_time"),
                             "run_time": src.get("run_time"), "ingested_at": src.get("ingested_at")})
        return {"products": products}

    def product_bytes(self, filename):
        if filename not in self.rebuild:
            return None
        self.downloads += 1
        return self.fetch(filename)


def l2_product_fetch(filename):
    """One stored product from L2 (the weather-products bucket, its object endpoint: never a CDN copy), or None."""
    import os
    import time
    import requests
    from services.weather_pipeline.store import WEATHER_BUCKET
    base = os.environ.get("SUPABASE_URL", "").rstrip("/")
    secret = os.environ.get("SUPABASE_SERVICE_ROLE_KEY") or os.environ.get("SUPABASE_KEY", "")
    if not base or not secret:
        return None
    resp = requests.get(f"{base}/storage/v1/object/{WEATHER_BUCKET}/{filename}?cb={int(time.time() * 1000)}",
                        headers={"Authorization": f"Bearer {secret}", "apikey": secret}, timeout=120)
    return resp.content if resp.status_code == 200 else None


def rebuild_for_lane(sink, lane, uploader, fetch=l2_product_fetch, log=print):
    """Rebuild the published wind set for `lane` (a frame_set_wind.PublishLane) and name it in the lane pointer. Returns a
    report dict; never raises."""
    import os
    if os.environ.get("WIND_LANE_FRAMES_REBUILD", "1") == "0":
        return {"status": "killed"}
    if lane is None:
        return {"status": "no_lane"}
    try:
        raw_latest = sink.read(fs.LATEST)
        entry = (json.loads(raw_latest).get("sets") or {}).get(WIND_SET_KEY) if raw_latest else None
        raw_index = sink.read(entry["index"]) if entry and entry.get("index") else None
        if not raw_index:
            return {"status": "no_published_index"}
        index = json.loads(raw_index)
        index["path"] = index.get("path") or entry["index"]
        if (index.get("wind_lane") or {}).get("key") == lane.key:
            return {"status": "current", "index": index["path"]}
        ptr = _read_pointer(sink)
        done = (ptr or {}).get("frames") or {}
        if done.get("lane") == lane.key and done.get("run") == index.get("run"):
            return {"status": "already_rebuilt", "index": done.get("index")}
        prepared, rebuild = prepare(index, lane)
        source = IndexSource(prepared, rebuild, fetch)
        new_index, stats = fs.publish_set(source, sink, fsw.WIND_TARGET, prepared, uploader, log=log, wind_lane=lane)
        stats.update(downloads=source.downloads, rebuild=len(rebuild))
        if new_index is None:
            log(f"[wind-lane frames] nothing published for {lane.key}: {stats}")
            return {"status": "not_published", "stats": stats}
        sink.write(new_index["path"], fs.index_bytes(new_index), fs.JSON_TYPE, fs.IMMUTABLE)
        named = _name_in_pointer(sink, ptr, lane, new_index, log)
        log(f"[wind-lane frames] {lane.key}: {new_index['path']} ({stats['built']} rebuilt, {stats['carried']} carried, "
            f"{source.downloads} downloads); pointer {'names it' if named else 'NOT moved'}")
        return {"status": "published" if named else "published_unnamed", "index": new_index["path"], "stats": stats}
    except Exception as e:  # the lane itself is published; the frames only fall back to /grid for its window
        log(f"[wind-lane frames] rebuild failed: {type(e).__name__}: {e}")
        return {"status": "error", "error": f"{type(e).__name__}: {e}"[:300]}


def _read_pointer(sink):
    raw = sink.read(fsw.LANE_POINTER)
    try:
        return json.loads(raw) if raw else None
    except ValueError:
        return None


def _name_in_pointer(sink, ptr, lane, index, log):
    """Add `frames` to the pointer when it names this lane (its written_at, the client's settle clock, is kept). A pointer that
    names another lane is left alone: the client never serves these frames against it."""
    ptr = _read_pointer(sink) or ptr          # re-read right before the write: the core lane may have moved it meanwhile
    if not ptr or ptr.get("key") != lane.key:
        log(f"[wind-lane frames] pointer names {(ptr or {}).get('key')}, not {lane.key}: left as it is")
        return False
    from datetime import datetime, timezone
    rec = dict(ptr, frames={"index": index["path"], "run": index.get("run"), "lane": lane.key,
                            "written_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    sink.write(fsw.LANE_POINTER, json.dumps(rec, indent=1).encode("utf-8"), fs.JSON_TYPE, fs.REVALIDATE)
    return True


def pointer_keep_paths(sink):
    """Every object the pointer's rebuilt index names (retention must keep them while the pointer names them)."""
    ptr = _read_pointer(sink) or {}
    path = (ptr.get("frames") or {}).get("index")
    if not path:
        return set()
    raw = sink.read(path)
    return fs.referenced_paths(json.loads(raw)) if raw else set()
