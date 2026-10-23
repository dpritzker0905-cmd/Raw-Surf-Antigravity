"""Raster static frames from free NOAA GRIB (2026-10-23, raster phase 1: GFS mean-sea-level pressure; the lead's plan).

WHY. The pressure layer is drawn from Open-Meteo raster tiles today (LayerRegistry `pressure`: OM_PRESSURE), whose free API is
non-commercial. The owner wants free GRIB data (2026-10-22 21:35 EDT: "we want free grib data"). NOAA GFS on AWS Open Data
(NODD, "open to the public and can be used as desired") carries PRMSL in every pgrb2 file, and a .idx byte range fetches just
that one message (~0.9 MB at 0.25 deg). This module turns one GFS cycle into RSWF frames on the public frames bucket; the
client half (raster-instant session) draws them, dark until the owner's side-by-side A/B.

WHAT A FRAME HOLDS. One scalar field, 6 `pressure_hpa` (u16, 0.1 hPa, code 0 = no data; frame_binary.encode_plane), on a
720 x 361 world grid: lat -90..90, lon -180..179.5, every 0.5 deg, row 0 = SOUTH, column 0 = WEST, bounds = the outer cell
centres, no wrap column. The values are NCEP's pgrb2.0p25 PRMSL at every second point (no interpolation of ours): the SAME
file the box's own GFS pressure product reads (noaa_gfs_pressure_fetcher, global_coarse), so at any shared node the frame
equals that product's value to the 0.05 hPa quantisation. NCEP's own pgrb2.0p50 file was measured differing from 0p25[::2, ::2]
by up to 0.01 hPa (0% of points equal at f000, cycle 2026-10-23 00Z), so it is not used.

TIME. f000-f336 every 3 h (113 frames, the 14-day contract), from the newest COMPLETE cycle (f336's .idx present). An hour with
no frame is listed unbuilt; a cycle is published only when FRAME_MIN_COVERAGE (default 0.9) of its hours built.

PUBLISH. Frames (immutable, content-addressed), then the run index, then latest.json (no-cache) LAST, then retention (current
+ previous index). A cycle latest.json already lists uploads nothing. Credits ride in the index. Kill: FRAME_RASTER_PRESSURE=0.
"""
from __future__ import annotations

import json
import os
import threading
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from services import frame_binary as fb
from services import frame_set as fs

TARGET = {"model": "GFS", "domain": "weather", "layer": "pressure", "region_id": "global_0p5"}
KEY = fs.set_key(TARGET)
PREFIX = fs.set_prefix(TARGET)
F_HOURS = tuple(range(0, 337, 3))
COLS, ROWS = 720, 361
BOUNDS = (-180.0, -90.0, 179.5, 90.0)          # west, south, east, north: the outer cell centres
VALID_HPA = (800.0, 1100.0)                    # noaa_gfs_pressure_fetcher._sanitize_pressure_hpa's physical range
S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GRID_FILE = "pgrb2.0p25"
CREDIT = "Contains modified NOAA GFS data, via NOAA Open Data Dissemination (NODD)"
LICENSE = "NOAA open data (NODD): no restrictions on use; attribution requested; no NOAA endorsement implied"
SOURCE_URL = "https://registry.opendata.aws/noaa-gfs-bdp-pds/"
# ecCodes (under pygrib) is not thread-safe: six threads decoding at once crashed its definitions parser (measured
# 2026-10-23 with eccodes 2.50). Downloads run in parallel; every decode takes this lock.
DECODE_LOCK = threading.Lock()


def enabled():
    return os.environ.get("FRAME_RASTER_PRESSURE", "1") != "0"


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_frame_plane(a25):
    """(721, 1440) hPa, row 0 = 90N, column 0 = 0E (GRIB order) -> (361, 720), row 0 = 90S, column 0 = 180W, every second
    point; values outside the physical range become NaN (no data)."""
    import numpy as np
    a = np.asarray(a25, dtype=float)
    if a.shape != (721, 1440):
        raise ValueError(f"expected a 0.25-deg world grid (721, 1440), got {a.shape}")
    half = a[::2, ::2][::-1]                                   # (361, 720), south row first
    half = np.concatenate([half[:, 360:], half[:, :360]], axis=1)   # column 0 = 180W
    return np.where((half >= VALID_HPA[0]) & (half <= VALID_HPA[1]), half, np.nan)


def node_lat_lon(r, c):
    return BOUNDS[1] + r * 0.5, BOUNDS[0] + c * 0.5


class GfsPrmslSource:
    """NOAA GFS PRMSL by .idx byte range from AWS Open Data (the box's pressure fetcher's range-integrity checks)."""

    def __init__(self, session=None):
        if session is None:
            try:
                from services._fetch_common import http_session
            except ImportError:  # pragma: no cover
                from _fetch_common import http_session
            session = http_session()
        self.http = session

    def _prefix(self, cycle):
        hh = cycle.strftime("%H")
        return f"{S3_BASE}/gfs.{cycle.strftime('%Y%m%d')}/{hh}/atmos/gfs.t{hh}z.{GRID_FILE}."

    def complete_cycle(self, now):
        """The newest cycle whose f000 and f336 .idx both exist, or None."""
        floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
        for back in range(7):
            cyc = floor6 - timedelta(hours=6 * back)
            p = self._prefix(cyc)
            try:
                if all(self.http.head(f"{p}f{f:03d}.idx", timeout=60).status_code == 200 for f in (F_HOURS[0], F_HOURS[-1])):
                    return cyc
            except Exception:
                continue
        return None

    def url(self, cycle, f):
        return f"{self._prefix(cycle)}f{f:03d}"

    def fetch(self, cycle, f):
        """(721, 1440) hPa for one forecast hour. Raises on a missing message, a wrong-length range or a bad decode."""
        import numpy as np
        import pygrib
        from services.noaa_gfs_pressure_fetcher import _fetch_message_bytes, _parse_idx, _select_range
        url = self.url(cycle, f)
        rng = _select_range(_parse_idx(self.http.get(url + ".idx", timeout=60).text))
        if rng is None:
            raise RuntimeError("idx has no PRMSL message")
        data = _fetch_message_bytes(self.http, url, rng[0], rng[1])
        with DECODE_LOCK:
            msg = pygrib.fromstring(data)
            lat0, lon0 = msg["latitudeOfFirstGridPointInDegrees"], msg["longitudeOfFirstGridPointInDegrees"]
            values = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan)
        if (round(lat0, 3), round(lon0, 3)) != (90.0, 0.0):
            raise RuntimeError(f"unexpected grid origin {lat0}, {lon0}")
        return values / 100.0   # Pa -> hPa


def build_frame(plane, valid, run):
    """(raw frame, gzip, parity dict) for one (361, 720) hPa plane; parity decodes the frame and compares every node."""
    import numpy as np
    raw = fb.encode_plane(plane, BOUNDS, iso(valid), iso(run), fb.PRESSURE_HPA)
    gz = fb.gzip_frame(raw)
    _head, fields = fb.decode_plane(gz)
    got = fields[fb.PRESSURE_HPA]
    src_ok, got_ok = np.isfinite(plane), np.isfinite(got)
    missing_mismatch = int(np.sum(src_ok != got_ok))
    both = src_ok & got_ok
    err = float(np.max(np.abs(got[both] - plane[both]))) if both.any() else 0.0
    bad = missing_mismatch + int(np.sum(np.abs(got[both] - plane[both]) > fb.TOLERANCE[fb.PRESSURE_HPA]))
    return raw, gz, {"nodes": int(plane.size), "bad": bad, "missing_mismatch": missing_mismatch, "max_abs_err": round(err, 6),
                     "missing": int(np.sum(~src_ok))}


def build_set(source, cycle, log=print, workers=6, deadline=None, clock=time.monotonic):
    """(frames, uploads, stats) for one cycle. Fetch + encode + parity per hour on a small pool; an hour that fails, or is
    not started before `deadline`, is listed unbuilt (path None + reason)."""
    stats = {"entries": len(F_HOURS), "built": 0, "failed": 0, "refused": 0, "skipped_budget": 0, "bytes": 0,
             "parity_max_abs_err": 0.0, "missing_nodes": 0}
    run_stamp = fs.stamp(iso(cycle))

    def one(f):
        valid = cycle + timedelta(hours=f)
        entry = {"valid_time": iso(valid), "is_estimated": False, "source": {"cycle": iso(cycle), "forecast_hour": f,
                                                                             "url": source.url(cycle, f)}}
        if deadline is not None and clock() > deadline:
            return dict(entry, path=None, unbuilt="skipped_budget"), None
        try:
            plane = to_frame_plane(source.fetch(cycle, f))
            raw, gz, check = build_frame(plane, valid, cycle)
        except Exception as e:
            log(f"[raster] f{f:03d}: {type(e).__name__}: {e}")
            return dict(entry, path=None, unbuilt="failed"), None
        if check["bad"]:
            log(f"[raster] f{f:03d}: parity refused: {check}")
            return dict(entry, path=None, unbuilt="refused"), None
        sha = fb.sha256_hex(raw)
        path = f"{PREFIX}/{run_stamp}/{fs.stamp(iso(valid))}-{sha[:12]}.bin"
        return dict(entry, path=path, sha256=sha, bytes=len(gz), raw_bytes=len(raw),
                    meta={"forecast_hour": f}, _check=check), (path, gz, fs.FRAME_TYPE, fs.IMMUTABLE)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        results = list(pool.map(one, F_HOURS))
    frames, uploads = [], []
    for frame, job in results:
        check = frame.pop("_check", None)
        if job:
            uploads.append(job)
            stats["built"] += 1
            stats["bytes"] += frame["bytes"]
            stats["parity_max_abs_err"] = max(stats["parity_max_abs_err"], check["max_abs_err"])
            stats["missing_nodes"] += check["missing"]
        else:
            stats[frame["unbuilt"]] += 1
        frames.append(frame)
    return frames, uploads, stats


def make_index(cycle, frames, stats):
    built = [f for f in frames if f.get("path")]
    index = {
        "version": fs.INDEX_VERSION, "encoding_version": fb.ENCODING_VERSION, "transform_version": fb.TRANSFORM_VERSION,
        "set": KEY, **TARGET, "run": iso(cycle), "cycle": iso(cycle), "runs": [iso(cycle)], "run_time": iso(cycle),
        "grid": {"cols": COLS, "rows": ROWS, "bounds": dict(zip(("west", "south", "east", "north"), BOUNDS)),
                 "row0": "south", "col0": "west", "wrap_column": False},
        "coverage": round(len(built) / len(frames), 4) if frames else 0.0,
        "coverage_authoritative": round(len(built) / len(frames), 4) if frames else 0.0,
        "selection": "the frame whose valid_time equals the hour; none within 3 h -> no frame (no time interpolation)",
        "quantisation": {fb.FIELD_NAMES[fb.PRESSURE_HPA]: {"tolerance": fb.TOLERANCE[fb.PRESSURE_HPA]}},
        "parity_max_abs_err": {fb.FIELD_NAMES[fb.PRESSURE_HPA]: stats["parity_max_abs_err"]},
        "common_meta": {"model": "GFS", "layer": "pressure", "value_kind": "pressure_msl", "value_unit": "hPa",
                        "model_run_time": iso(cycle), "source_dataset": "gfs.pgrb2.0p25 PRMSL, every second point",
                        "upstream_provider": "noaa"},
        "credit": CREDIT, "license": LICENSE, "source_url": SOURCE_URL,
        "frames": frames,
    }
    body = json.dumps(index, sort_keys=True, separators=(",", ":")).encode("utf-8")
    index["path"] = f"{PREFIX}/index/{fs.stamp(iso(cycle))}-{fb.sha256_hex(body)[:12]}.json"
    return index


def publish(source, sink, uploader, log=print, budget_s=None, now=None, clock=time.monotonic, coverage_floor=None):
    """One raster publish. Returns a report dict; never raises for a missing cycle or a coverage refusal."""
    budget = float(os.environ.get("FRAME_RASTER_BUDGET_S", "420")) if budget_s is None else budget_s
    floor = fs.min_coverage() if coverage_floor is None else coverage_floor
    started = clock()
    cycle = source.complete_cycle(now or datetime.now(timezone.utc))
    if cycle is None:
        log("[raster] no complete GFS cycle on AWS; the published set stays")
        return {"status": "no_cycle"}
    raw_latest = sink.read(fs.LATEST)
    latest = json.loads(raw_latest) if raw_latest else {"version": 1, "sets": {}}
    entry = latest.get("sets", {}).get(KEY)
    if entry and entry.get("run") == iso(cycle):
        log(f"[raster] {KEY}: cycle {iso(cycle)} already published")
        return {"status": "unchanged", "run": iso(cycle), "index": entry.get("index")}
    frames, uploads, stats = build_set(source, cycle, log=log, deadline=started + budget, clock=clock)
    stats["seconds_build"] = round(clock() - started, 1)
    coverage = stats["built"] / len(F_HOURS)
    if coverage < floor:
        log(f"[raster] {KEY}: only {stats['built']}/{len(F_HOURS)} hours built (< {floor}); nothing uploaded")
        return {"status": "coverage_refused", "run": iso(cycle), **stats}
    index = make_index(cycle, frames, stats)
    uploader(uploads)
    sink.write(index["path"], fs.index_bytes(index), fs.JSON_TYPE, fs.IMMUTABLE)
    prev_index = None
    if entry and entry.get("index"):
        prev_raw = sink.read(entry["index"])
        prev_index = json.loads(prev_raw) if prev_raw else None
    now_s = iso(datetime.now(timezone.utc))
    writer = f"gh-run-{os.environ['GITHUB_RUN_ID']}" if os.environ.get("GITHUB_RUN_ID") else "local"
    raw_latest = sink.read(fs.LATEST)                  # re-read: change only this set's record
    latest = json.loads(raw_latest) if raw_latest else {"version": 1, "sets": {}}
    rec = fs.latest_record(index, entry, now_s, writer)
    rec["cycle"] = index["cycle"]
    latest.setdefault("sets", {})[KEY] = rec
    latest.update(version=1, written_at=now_s, writer=writer)
    sink.write(fs.LATEST, json.dumps(latest, indent=1, sort_keys=True).encode("utf-8"), fs.JSON_TYPE, fs.REVALIDATE)
    deleted = 0
    if prev_index is not None:                         # retention only when the previous index was actually read
        gone = fs.retention_deletes(sink.list(PREFIX), TARGET, fs.referenced_paths(index) | fs.referenced_paths(prev_index))
        if gone:
            sink.delete(gone)
        deleted = len(gone)
    return {"status": "published", "run": iso(cycle), "index": index["path"], "uploaded": len(uploads), "deleted": deleted,
            "seconds": round(clock() - started, 1), **stats}
