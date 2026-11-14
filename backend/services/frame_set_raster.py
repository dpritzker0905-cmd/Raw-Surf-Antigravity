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

TIME. f000-f336 every 3 h (113 frames, the 14-day contract; pressure: hourly to f120, 193 frames, PRESSURE_HOURS), from the newest COMPLETE cycle (f336's .idx present). An hour with
no frame is listed unbuilt; a cycle is published only when FRAME_MIN_COVERAGE (default 0.9) of its hours built.

PUBLISH. Frames (immutable, content-addressed), then the run index, then latest.json (no-cache) LAST, then retention (current
+ previous index). A cycle latest.json already lists uploads nothing. Credits ride in the index. Kill: FRAME_RASTER_PRESSURE=0.

MORE SETS (2026-10-23, raster phase 2, the same contract; SPECS below): GFS 2 m temperature (TMP:2 m above ground, K -> degC,
field 7 temp_c) and total cloud cover (TCDC:entire atmosphere, field 8 cloud_pct). TCDC comes TWICE in every forecast file,
the instantaneous value ("N hour fcst") and the "0-N hour ave" mean: the selector matches the time column too and takes the
instantaneous one, the value AT the hour the frame is labelled with. Pressure's bytes, paths and index are unchanged. The new
sets publish only when switched on (FRAME_RASTER_TEMPERATURE=1, FRAME_RASTER_CLOUD=1): dark until reviewed.
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
# GFS PRESSURE IS HOURLY TO 120 h (2026-11-12, the owner: "focus on the 3 issues that separate it from state of the art"). The
# pgrb2.0p25 files exist every hour to f120 and every 3 h after, so the hourly frames are NCEP's own fields (no interpolation
# of ours): 121 hourly + 72 three-hourly = 193 frames. An hourly scrub then shows its own hour for the first five days
# instead of the nearest 3-hourly frame. The other GFS sets keep F_HOURS.
PRESSURE_HOURS = tuple(range(0, 121)) + tuple(range(123, 337, 3))
# GFS PRECIPITATION (2026-11-12, the owner: "Yes, build it", answering "Build precipitation on our own published frames next,
# as we did for pressure?"). No f000 (nothing has fallen yet at the analysis); hourly to f120, then 3-hourly, as pressure.
PRECIP_HOURS = tuple(range(1, 121)) + tuple(range(123, 337, 3))
VALID_MM_H = (0.0, 500.0)                      # above any hourly world record (305 mm); a larger value is a bad decode
COLS, ROWS = 720, 361
BOUNDS = (-180.0, -90.0, 179.5, 90.0)          # west, south, east, north: the outer cell centres
# The lattices a set can be published on (a spec's `grid`, default '0p5'). '0p25' is NCEP's own 0.25-degree grid, every point
# (stride 1): cloud cover's edges are near 0 / 100 % per cell, so at 0.5 degrees they draw as one-cell steps (the owner's
# resolution call, 2026-10-25). Same orientation for both: row 0 = SOUTH, column 0 = 180W, no wrap column.
GRIDS = {
    "0p5": {"cols": 720, "rows": 361, "bounds": BOUNDS, "stride": 2},
    "0p25": {"cols": 1440, "rows": 721, "bounds": (-180.0, -90.0, 179.75, 90.0), "stride": 1},
}


def grid_of(spec):
    return GRIDS[(spec or {}).get("grid", "0p5")]
VALID_HPA = (800.0, 1100.0)                    # noaa_gfs_pressure_fetcher._sanitize_pressure_hpa's physical range
S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
GRID_FILE = "pgrb2.0p25"
CREDIT = "Contains modified NOAA GFS data, via NOAA Open Data Dissemination (NODD)"
LICENSE = "NOAA open data (NODD): no restrictions on use; attribution requested; no NOAA endorsement implied"
SOURCE_URL = "https://registry.opendata.aws/noaa-gfs-bdp-pds/"
# ecCodes (under pygrib) is not thread-safe: six threads decoding at once crashed its definitions parser (measured
# 2026-10-23 with eccodes 2.50). Downloads run in parallel; every decode takes this lock.
DECODE_LOCK = threading.Lock()

# One entry per raster set. `idx` = the .idx (variable, level); messages whose time column is a mean or an accumulation
# ("ave", "acc") are never taken. `convert` maps the GRIB unit to the frame's; `valid` = the physical range (outside: no data);
# `clip` = a range a valid value is clipped into (cloud: GRIB's float noise at 0 and 100 %).
SPECS = {
    "pressure": {
        "target": TARGET, "field": fb.PRESSURE_HPA, "idx": ("PRMSL", "mean sea level"), "convert": lambda a: a / 100.0,
        "valid": VALID_HPA, "clip": None, "env": "FRAME_RASTER_PRESSURE", "default_on": True,
        "value_kind": "pressure_msl", "value_unit": "hPa", "source_dataset": "gfs.pgrb2.0p25 PRMSL, every second point",
        "hours": PRESSURE_HOURS, "source": "gfs", "upstream_provider": "noaa", "credit": CREDIT, "license": LICENSE,
        "source_url": SOURCE_URL,
    },
    "temperature": {
        "target": {"model": "GFS", "domain": "weather", "layer": "temperature", "region_id": "global_0p5"},
        "field": fb.TEMP_C, "idx": ("TMP", "2 m above ground"), "convert": lambda a: a - 273.15,
        "valid": (-95.0, 65.0), "clip": None, "env": "FRAME_RASTER_TEMPERATURE", "default_on": False,
        "value_kind": "temperature_2m", "value_unit": "degC",
        "source_dataset": "gfs.pgrb2.0p25 TMP 2 m above ground, every second point",
        "hours": F_HOURS, "source": "gfs", "upstream_provider": "noaa", "credit": CREDIT, "license": LICENSE,
        "source_url": SOURCE_URL,
    },
    "cloud_cover": {
        "target": {"model": "GFS", "domain": "weather", "layer": "cloud_cover", "region_id": "global_0p5"},
        "field": fb.CLOUD_PCT, "idx": ("TCDC", "entire atmosphere"), "convert": lambda a: a,
        "valid": (-0.5, 100.5), "clip": (0.0, 100.0), "env": "FRAME_RASTER_CLOUD", "default_on": False,
        "value_kind": "cloud_cover", "value_unit": "%",
        "source_dataset": "gfs.pgrb2.0p25 TCDC entire atmosphere (instantaneous, not the 0-N h mean), every second point",
        "hours": F_HOURS, "source": "gfs", "upstream_provider": "noaa", "credit": CREDIT, "license": LICENSE,
        "source_url": SOURCE_URL,
    },
    # CLOUD COVER AT 0.25 DEG (the owner, 2026-10-25: "Go with your recommendation if that is state of the art"): the SAME
    # instantaneous TCDC, every point of NCEP's 0.25-degree grid (1440 x 721), so cloud edges are not one-cell 0.5-degree steps
    # (side-session-notes raster-resolution-2026-10-24). The 0.5-degree set stays publishable (FRAME_RASTER_CLOUD).
    "cloud_cover_0p25": {
        "target": {"model": "GFS", "domain": "weather", "layer": "cloud_cover", "region_id": "global_0p25"},
        "field": fb.CLOUD_PCT, "idx": ("TCDC", "entire atmosphere"), "convert": lambda a: a, "grid": "0p25",
        "valid": (-0.5, 100.5), "clip": (0.0, 100.0), "env": "FRAME_RASTER_CLOUD_0P25", "default_on": False,
        "value_kind": "cloud_cover", "value_unit": "%",
        "source_dataset": "gfs.pgrb2.0p25 TCDC entire atmosphere (instantaneous, not the 0-N h mean), every point",
        "hours": F_HOURS, "source": "gfs", "upstream_provider": "noaa", "credit": CREDIT, "license": LICENSE,
        "source_url": SOURCE_URL,
    },
    # PER-MODEL PRESSURE (2026-10-23; the owner, 20:13 EDT: "Yes start it", answering "start the per-model pressure route?"
    # after "We want each models pressure showing"). EURO = ECMWF IFS open data (CC BY 4.0, attribution required): msl at
    # 0.25 deg (lon from 180W), every second point onto the SAME 0.5-degree lattice as GFS, so one client path draws all.
    # Its native steps: 3-hourly to 144 h, then 6-hourly to 240 h (00/12Z runs; 06/18Z stop at 144 h, so only 00/12Z
    # cycles are published). Past 240 h the client follows the wave layers' labelled extension policy.
    "pressure_euro": {
        "target": {"model": "EURO", "domain": "weather", "layer": "pressure", "region_id": "global_0p5"},
        "field": fb.PRESSURE_HPA, "idx": ("msl", "sfc"), "convert": lambda a: a / 100.0,
        "valid": VALID_HPA, "clip": None, "env": "FRAME_RASTER_PRESSURE_EURO", "default_on": False,
        "value_kind": "pressure_msl", "value_unit": "hPa",
        "source_dataset": "ECMWF IFS open data, oper fc 0p25 msl, every second point",
        "hours": tuple(range(0, 145, 3)) + tuple(range(150, 241, 6)), "source": "ecmwf", "upstream_provider": "ecmwf",
        "credit": "Copyright ECMWF; ECMWF open data, CC BY 4.0; modified (regridded to 0.5 deg, quantised to 0.1 hPa)",
        "license": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution to ECMWF required",
        "source_url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    },
    # ICON = DWD ICON global pmsl (the same files the box's dwd_icon_pressure_fetcher reads), icosahedral cells box-averaged
    # onto the lattice (frame_set_raster_sources: the method and its measured error). 00/12Z runs reach 180 h (06/18Z: 120 h).
    "pressure_icon": {
        "target": {"model": "ICON", "domain": "weather", "layer": "pressure", "region_id": "global_0p5"},
        "field": fb.PRESSURE_HPA, "idx": ("pmsl", ("PMSL", "MSL")), "convert": lambda a: a / 100.0,
        "valid": VALID_HPA, "clip": None, "env": "FRAME_RASTER_PRESSURE_ICON", "default_on": False, "frame_plane": True,
        "value_kind": "pressure_msl", "value_unit": "hPa",
        "source_dataset": "DWD ICON global (icosahedral R3B7) pmsl, box mean onto 0.5 deg",
        "hours": tuple(range(0, 181, 3)), "source": "icon", "upstream_provider": "dwd",
        "credit": "Source: Deutscher Wetterdienst (DWD), ICON global; modified (box-averaged to 0.5 deg, quantised to 0.1 hPa)",
        "license": "DWD open data, free use with source attribution (GeoNutzV)",
        "source_url": "https://opendata.dwd.de/weather/nwp/icon/grib/",
    },
    # PRECIPITATION: the amount that fell in the hour BEFORE the frame's time, in mm/h (past f120: the mean over the 3 h
    # before it), the same meaning as the Open-Meteo `precipitation` field the layer drew. From NCEP's own APCP totals
    # (GfsPrecipSource below); every point of the 0.25-degree grid, as cloud cover (rain edges are sharp per cell).
    "precipitation": {
        "target": {"model": "GFS", "domain": "weather", "layer": "precipitation", "region_id": "global_0p25"},
        "field": fb.PRECIP_MM_H, "idx": ("APCP", "surface"), "convert": lambda a: a, "grid": "0p25",
        "valid": VALID_MM_H, "clip": None, "env": "FRAME_RASTER_PRECIP", "default_on": False,
        "value_kind": "precipitation_rate", "value_unit": "mm/h",
        "source_dataset": "gfs.pgrb2.0p25 APCP surface, bucket totals differenced to the preceding step, every point",
        "hours": PRECIP_HOURS, "source": "gfs_precip", "upstream_provider": "noaa", "credit": CREDIT, "license": LICENSE,
        "source_url": SOURCE_URL,
    },
    # EURO PRECIPITATION (2026-11-12, the owner: "Yes, add ICON and EURO precipitation after the blend"). ECMWF IFS open data
    # `tp` (CC BY 4.0, attribution required), the total since the run began, differenced to the step before each hour
    # (frame_set_raster_sources.EcmwfPrecipSource): the MEAN rate over a 3-hour step to 144 h and a 6-hour step to 240 h (ECMWF's
    # open data has no hourly steps). Every point of its 0.25-degree grid, as the GFS set. 00/12Z cycles (06/18Z stop at 144 h).
    "precipitation_euro": {
        "target": {"model": "EURO", "domain": "weather", "layer": "precipitation", "region_id": "global_0p25"},
        "field": fb.PRECIP_MM_H, "idx": ("tp", "sfc"), "convert": lambda a: a * 1000.0, "grid": "0p25",
        "valid": VALID_MM_H, "clip": None, "env": "FRAME_RASTER_PRECIP_EURO", "default_on": False,
        "value_kind": "precipitation_rate", "value_unit": "mm/h",
        "source_dataset": "ECMWF IFS open data, oper fc 0p25 tp, totals differenced to the preceding step, every point",
        "hours": tuple(range(3, 145, 3)) + tuple(range(150, 241, 6)), "source": "ecmwf_precip", "upstream_provider": "ecmwf",
        "credit": "Copyright ECMWF; ECMWF open data, CC BY 4.0; modified (totals differenced to a rate, quantised to 0.01 mm/h)",
        "license": "CC BY 4.0 (https://creativecommons.org/licenses/by/4.0/); attribution to ECMWF required",
        "source_url": "https://www.ecmwf.int/en/forecasts/datasets/open-data",
    },
    # ICON PRECIPITATION (2026-11-13, the same word of the owner). DWD ICON global TOT_PREC, the total since the run began,
    # differenced per native cell to the step before each hour and box-AVERAGED onto the 0.25-degree grid
    # (frame_set_raster_sources.IconPrecipSource: why a mean and not the pressure set's nearest cell). Hourly to 78 h, then the
    # MEAN rate over each 3-hour step to 180 h (DWD's own steps). 00/12Z runs (06/18Z stop at 120 h).
    "precipitation_icon": {
        "target": {"model": "ICON", "domain": "weather", "layer": "precipitation", "region_id": "global_0p25"},
        "field": fb.PRECIP_MM_H, "idx": ("tot_prec", ("TOT_PREC",)), "convert": lambda a: a, "grid": "0p25",
        "valid": VALID_MM_H, "clip": None, "env": "FRAME_RASTER_PRECIP_ICON", "default_on": False, "frame_plane": True,
        "value_kind": "precipitation_rate", "value_unit": "mm/h",
        "source_dataset": "DWD ICON global (icosahedral R3B7) TOT_PREC, totals differenced to the preceding step, "
                          "box mean onto 0.25 deg",
        "hours": tuple(range(1, 79)) + tuple(range(81, 181, 3)), "source": "icon_precip", "upstream_provider": "dwd",
        "credit": "Source: Deutscher Wetterdienst (DWD), ICON global; modified (totals differenced to a rate, "
                  "box-averaged to 0.25 deg, quantised to 0.01 mm/h)",
        "license": "DWD open data, free use with source attribution (GeoNutzV)",
        "source_url": "https://opendata.dwd.de/weather/nwp/icon/grib/",
    },
}


def precip_step(f):
    """(bucket start, previous hour) for forecast hour f. NCEP's APCP totals restart every 6 h (f007 carries "6-7 hour acc",
    f012 "6-12 hour acc"); the previous hour is one back to f120 and three back after it."""
    if f < 1:
        raise ValueError("no precipitation step before f001")
    return 6 * ((f - 1) // 6), (f - 1 if f <= 120 else f - 3)


def make_source(spec, session=None):
    """The source object a spec names: 'gfs' (NOAA AWS byte ranges, below), 'ecmwf' (frame_set_raster_sources)."""
    kind = spec.get("source", "gfs")
    if kind == "gfs":
        return GfsGribSource(spec, session)
    if kind == "gfs_precip":
        return GfsPrecipSource(spec, session)
    try:
        from services import frame_set_raster_sources as srcs
    except ImportError:  # pragma: no cover
        import frame_set_raster_sources as srcs
    return srcs.SOURCES[kind](spec, session)


def spec_for(layer="pressure"):
    if layer not in SPECS:
        raise ValueError(f"no raster set {layer!r} (known: {', '.join(SPECS)})")
    return SPECS[layer]


def enabled(layer="pressure"):
    sp = spec_for(layer)
    v = os.environ.get(sp["env"])
    return (v != "0") if sp["default_on"] else (v == "1")


def iso(dt):
    return dt.strftime("%Y-%m-%dT%H:%M:%SZ")


def to_frame_plane(a25, valid=VALID_HPA, clip=None, stride=2):
    """(721, 1440) values, row 0 = 90N, column 0 = 0E (GRIB order) -> row 0 = 90S, column 0 = 180W, every `stride`-th point
    ((361, 720) at the default 2; (721, 1440) at 1); values outside the physical range `valid` become NaN (no data); `clip`
    then bounds the rest."""
    import numpy as np
    a = np.asarray(a25, dtype=float)
    if a.shape != (721, 1440):
        raise ValueError(f"expected a 0.25-deg world grid (721, 1440), got {a.shape}")
    half = a[::stride, ::stride][::-1]                          # south row first
    n = half.shape[1] // 2
    half = np.concatenate([half[:, n:], half[:, :n]], axis=1)   # column 0 = 180W
    out = np.where((half >= valid[0]) & (half <= valid[1]), half, np.nan)
    return np.clip(out, clip[0], clip[1]) if clip else out


def node_lat_lon(r, c):
    return BOUNDS[1] + r * 0.5, BOUNDS[0] + c * 0.5


def idx_rows(text):
    """[(start, end, variable, level, time)] from a GRIB .idx (end = the next message's start - 1; the last one open)."""
    rows = []
    for line in text.strip().splitlines():
        parts = line.split(":")
        if len(parts) < 6:
            continue
        try:
            rows.append([int(parts[1]), None, parts[3], parts[4], parts[5]])
        except ValueError:
            continue
    for i in range(len(rows) - 1):
        rows[i][1] = rows[i + 1][0] - 1
    return [tuple(r) for r in rows]


def select_timed(rows, var_level, when):
    """(start, end) of the message with this (variable, level) and exactly this time column (e.g. "6-7 hour acc fcst"), or None."""
    for start, end, var, lvl, t in rows:
        if (var, lvl) == tuple(var_level) and t == when:
            return start, end
    return None


def select_message(rows, var_level):
    """(start, end) of the first message with this (variable, level) that is not a mean or an accumulation, or None."""
    for start, end, var, lvl, when in rows:
        if (var, lvl) == tuple(var_level) and " ave" not in f" {when}" and " acc" not in f" {when}":
            return start, end
    return None


class GfsGribSource:
    """One NOAA GFS field by .idx byte range from AWS Open Data (the box's pressure fetcher's range-integrity checks)."""

    def __init__(self, spec=None, session=None):
        self.spec = spec or SPECS["pressure"]
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
        """The newest cycle whose first and last hour's .idx both exist (the set's own hours: f000 and f336), or None."""
        hours = self.spec.get("hours", F_HOURS)
        floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
        for back in range(7):
            cyc = floor6 - timedelta(hours=6 * back)
            p = self._prefix(cyc)
            try:
                if all(self.http.head(f"{p}f{f:03d}.idx", timeout=60).status_code == 200 for f in (hours[0], hours[-1])):
                    return cyc
            except Exception:
                continue
        return None

    def url(self, cycle, f):
        return f"{self._prefix(cycle)}f{f:03d}"

    def fetch(self, cycle, f):
        """(721, 1440) hPa for one forecast hour. Raises on a missing message, a wrong-length range or a bad decode."""
        return self._message(cycle, f, lambda rows: select_message(rows, self.spec["idx"]))

    def _message(self, cycle, f, pick):
        """One message of forecast hour f's file, picked from its .idx rows by `pick`, decoded and converted."""
        import numpy as np
        import pygrib
        from services.noaa_gfs_pressure_fetcher import _fetch_message_bytes
        url = self.url(cycle, f)
        rng = pick(idx_rows(self.http.get(url + ".idx", timeout=60).text))
        if rng is None:
            raise RuntimeError(f"idx has no {':'.join(self.spec['idx'])} message")
        data = _fetch_message_bytes(self.http, url, rng[0], rng[1])
        with DECODE_LOCK:
            msg = pygrib.fromstring(data)
            lat0, lon0 = msg["latitudeOfFirstGridPointInDegrees"], msg["longitudeOfFirstGridPointInDegrees"]
            values = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan)
        if (round(lat0, 3), round(lon0, 3)) != (90.0, 0.0):
            raise RuntimeError(f"unexpected grid origin {lat0}, {lon0}")
        return self.spec["convert"](values)   # the GRIB unit -> the frame's (Pa -> hPa, K -> degC)


class GfsPrecipSource(GfsGribSource):
    """GFS precipitation in the step before a forecast hour, mm/h. APCP is a running total inside a 6-hour bucket, so the
    step's amount is this hour's bucket total minus the previous hour's (nothing to subtract on a bucket's first step):
    two byte ranges at most, both NCEP's own fields. A difference below zero is GRIB packing noise and becomes 0."""

    def __init__(self, spec=None, session=None):
        super().__init__(spec or SPECS["precipitation"], session)

    def _total(self, cycle, f, bucket):
        when = f"{bucket}-{f} hour acc fcst"
        return self._message(cycle, f, lambda rows: select_timed(rows, self.spec["idx"], when))

    def fetch(self, cycle, f):
        import numpy as np
        bucket, prev = precip_step(f)
        amount = self._total(cycle, f, bucket)                   # kg/m2 = mm since the bucket began
        if prev > bucket:
            amount = amount - self._total(cycle, prev, bucket)
        return np.where(np.isfinite(amount), np.maximum(amount, 0.0) / float(f - prev), np.nan)


class GfsPrmslSource(GfsGribSource):
    """GFS PRMSL (the first raster set)."""

    def __init__(self, session=None):
        super().__init__(SPECS["pressure"], session)


def build_frame(plane, valid, run, fid=fb.PRESSURE_HPA, bounds=BOUNDS):
    """(raw frame, gzip, parity dict) for one plane (361 x 720 by default); parity decodes the frame and compares every node."""
    import numpy as np
    raw = fb.encode_plane(plane, bounds, iso(valid), iso(run), fid)
    gz = fb.gzip_frame(raw)
    _head, fields = fb.decode_plane(gz)
    got = fields[fid]
    src_ok, got_ok = np.isfinite(plane), np.isfinite(got)
    missing_mismatch = int(np.sum(src_ok != got_ok))
    both = src_ok & got_ok
    err = float(np.max(np.abs(got[both] - plane[both]))) if both.any() else 0.0
    bad = missing_mismatch + int(np.sum(np.abs(got[both] - plane[both]) > fb.TOLERANCE[fid]))
    return raw, gz, {"nodes": int(plane.size), "bad": bad, "missing_mismatch": missing_mismatch, "max_abs_err": round(err, 6),
                     "missing": int(np.sum(~src_ok))}


def build_set(source, cycle, log=print, workers=6, deadline=None, clock=time.monotonic, spec=None):
    """(frames, uploads, stats) for one cycle. Fetch + encode + parity per hour on a small pool; an hour that fails, or is
    not started before `deadline`, is listed unbuilt (path None + reason)."""
    sp = spec or SPECS["pressure"]
    prefix = fs.set_prefix(sp["target"])
    hours = sp.get("hours", F_HOURS)
    stats = {"entries": len(hours), "built": 0, "failed": 0, "refused": 0, "skipped_budget": 0, "bytes": 0,
             "parity_max_abs_err": 0.0, "missing_nodes": 0}
    run_stamp = fs.stamp(iso(cycle))

    def one(f):
        valid = cycle + timedelta(hours=f)
        entry = {"valid_time": iso(valid), "is_estimated": False, "source": {"cycle": iso(cycle), "forecast_hour": f,
                                                                             "url": source.url(cycle, f)}}
        if deadline is not None and clock() > deadline:
            return dict(entry, path=None, unbuilt="skipped_budget"), None
        try:
            got = source.fetch(cycle, f)
            if sp.get("frame_plane"):                      # already on the lattice (ICON's regrid): range checks only
                import numpy as np
                got = np.where((got >= sp["valid"][0]) & (got <= sp["valid"][1]), got, np.nan)
                plane = np.clip(got, *sp["clip"]) if sp["clip"] else got
            else:
                plane = to_frame_plane(got, sp["valid"], sp["clip"], grid_of(sp)["stride"])
            raw, gz, check = build_frame(plane, valid, cycle, sp["field"], grid_of(sp)["bounds"])
        except Exception as e:
            log(f"[raster] f{f:03d}: {type(e).__name__}: {e}")
            return dict(entry, path=None, unbuilt="failed"), None
        if check["bad"]:
            log(f"[raster] f{f:03d}: parity refused: {check}")
            return dict(entry, path=None, unbuilt="refused"), None
        sha = fb.sha256_hex(raw)
        path = f"{prefix}/{run_stamp}/{fs.stamp(iso(valid))}-{sha[:12]}.bin"
        return dict(entry, path=path, sha256=sha, bytes=len(gz), raw_bytes=len(raw),
                    meta={"forecast_hour": f}, _check=check), (path, gz, fs.FRAME_TYPE, fs.IMMUTABLE)

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        results = list(pool.map(one, hours))
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


def make_index(cycle, frames, stats, spec=None):
    sp = spec or SPECS["pressure"]
    fname = fb.FIELD_NAMES[sp["field"]]
    built = [f for f in frames if f.get("path")]
    index = {
        "version": fs.INDEX_VERSION, "encoding_version": fb.ENCODING_VERSION, "transform_version": fb.TRANSFORM_VERSION,
        "set": fs.set_key(sp["target"]), **sp["target"], "run": iso(cycle), "cycle": iso(cycle), "runs": [iso(cycle)], "run_time": iso(cycle),
        "grid": {"cols": grid_of(sp)["cols"], "rows": grid_of(sp)["rows"],
                 "bounds": dict(zip(("west", "south", "east", "north"), grid_of(sp)["bounds"])),
                 "row0": "south", "col0": "west", "wrap_column": False},
        "coverage": round(len(built) / len(frames), 4) if frames else 0.0,
        "coverage_authoritative": round(len(built) / len(frames), 4) if frames else 0.0,
        "selection": "the frame whose valid_time equals the hour; none within 3 h -> no frame (no time interpolation)",
        "quantisation": {fname: {"tolerance": fb.TOLERANCE[sp["field"]]}},
        "parity_max_abs_err": {fname: stats["parity_max_abs_err"]},
        "common_meta": {"model": sp["target"]["model"], "layer": sp["target"]["layer"], "value_kind": sp["value_kind"],
                        "value_unit": sp["value_unit"], "model_run_time": iso(cycle), "source_dataset": sp["source_dataset"],
                        "upstream_provider": sp.get("upstream_provider", "noaa")},
        "credit": sp.get("credit", CREDIT), "license": sp.get("license", LICENSE), "source_url": sp.get("source_url", SOURCE_URL),
        "frames": frames,
    }
    body = json.dumps(index, sort_keys=True, separators=(",", ":")).encode("utf-8")
    index["path"] = f"{fs.set_prefix(sp['target'])}/index/{fs.stamp(iso(cycle))}-{fb.sha256_hex(body)[:12]}.json"
    return index


def publish(source, sink, uploader, log=print, budget_s=None, now=None, clock=time.monotonic, coverage_floor=None, spec=None):
    """One raster set's publish. Returns a report dict; never raises for a missing cycle or a coverage refusal."""
    sp = spec or SPECS["pressure"]
    key, prefix = fs.set_key(sp["target"]), fs.set_prefix(sp["target"])
    budget = float(os.environ.get("FRAME_RASTER_BUDGET_S", "420")) if budget_s is None else budget_s
    floor = fs.min_coverage() if coverage_floor is None else coverage_floor
    started = clock()
    cycle = source.complete_cycle(now or datetime.now(timezone.utc))
    if cycle is None:
        log("[raster] no complete GFS cycle on AWS; the published set stays")
        return {"status": "no_cycle"}
    raw_latest = sink.read(fs.LATEST)
    latest = json.loads(raw_latest) if raw_latest else {"version": 1, "sets": {}}
    entry = latest.get("sets", {}).get(key)
    if entry and entry.get("run") == iso(cycle):
        log(f"[raster] {key}: cycle {iso(cycle)} already published")
        return {"status": "unchanged", "run": iso(cycle), "index": entry.get("index")}
    frames, uploads, stats = build_set(source, cycle, log=log, deadline=started + budget, clock=clock, spec=sp)
    stats["seconds_build"] = round(clock() - started, 1)
    hours = sp.get("hours", F_HOURS)
    coverage = stats["built"] / len(hours)
    if coverage < floor:
        log(f"[raster] {key}: only {stats['built']}/{len(hours)} hours built (< {floor}); nothing uploaded")
        return {"status": "coverage_refused", "run": iso(cycle), **stats}
    index = make_index(cycle, frames, stats, sp)
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
    latest.setdefault("sets", {})[key] = rec
    latest.update(version=1, written_at=now_s, writer=writer)
    sink.write(fs.LATEST, json.dumps(latest, indent=1, sort_keys=True).encode("utf-8"), fs.JSON_TYPE, fs.REVALIDATE)
    deleted = 0
    if prev_index is not None:                         # retention only when the previous index was actually read
        gone = fs.retention_deletes(sink.list(prefix), sp["target"], fs.referenced_paths(index) | fs.referenced_paths(prev_index))
        if gone:
            sink.delete(gone)
        deleted = len(gone)
    return {"status": "published", "run": iso(cycle), "index": index["path"], "uploaded": len(uploads), "deleted": deleted,
            "seconds": round(clock() - started, 1), **stats}
