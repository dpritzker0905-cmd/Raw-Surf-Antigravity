"""GFS at 0.117 deg from NOAA's surface flux files: air temperature, water temperature and rain (2026-11-18, the Open-Meteo exit).

WHY. Three GFS layers are drawn from Open-Meteo's `ncep_gfs013` copy: temperature_2m, surface_temperature (water temperature)
and precipitation. The owner's rule (2026-11-18 ~23:00Z): agency data only, no Open-Meteo in user data. ncep_gfs013 IS NCEP's
surface flux file (`gfs.tHHz.sfluxgrbfFFF.grib2`, AWS `noaa-gfs-bdp-pds`, NODD open data) on its T1534 Gaussian grid. Our
0.25-degree sets are coarser than that, so the client could not move to them without a downgrade (the resolution rule).

ONE FETCH, THREE SETS. Each forecast hour's file is read ONCE by .idx byte ranges (three messages, about 2.5 MB each, of a ~300 MB
file), and the hour's three frames are built from it. PRATE is an average since the start of its 6-hour bucket (`0-5 hour ave`,
`120-126 hour ave`), so the rate over the step before an hour needs the previous hour's average: the hours of one bucket run in
order on one worker, which keeps that average in memory (no second read of any file).

THE GRID. The native points, no interpolation: 3072 columns (lon 0 .. 359.883, every 0.1171875 deg, turned to start at 180W)
x 1536 Gaussian rows (+-89.9103 deg), written south row first on a lattice with UNIFORM rows between the outer latitudes. The
Gaussian rows are within 0.0017 deg (~190 m, 1.4 % of a row) of that lattice everywhere (measured 2026-11-18 from the N768
Gauss-Legendre roots). Open-Meteo's gfs013 stores the same points on a uniform lattice (bbox +-89.912125, read 2026-11-18).

WHAT EACH SET MEANS.
- temperature_0p117: TMP:2 m above ground, instantaneous, K -> degC (field 7, 0.05 degC steps).
- water_temp_0p117: TMP:surface (skin temperature; SST over the ocean), the same as the 0.25-degree `water_temp` set. Land is
  land skin; the client ocean-fills land cells at draw time, as it does for that set today (waterTempLandFill.js).
- precipitation_0p117: PRATE de-averaged to the MEAN rate over the step before the frame's hour, mm/h (hourly to f120, then
  the 3-hour step): the meaning of the 0.25-degree `precipitation` set. No f000. The amount over each step is rounded to
  0.1 mm (round_rain: the storage line, and what .om draws today).

Hours: f000-f120 hourly, then 3-hourly to f384: NCEP's own steps, 209 (208 for rain), Open-Meteo's gfs013 times exactly.
Kills (each set): FRAME_RASTER_TEMPERATURE_0P117 / FRAME_RASTER_WATER_TEMP_0P117 / FRAME_RASTER_PRECIP_0P117 = 0.
Gate and costs: docs/weather-program/log/2026-11-18-opus-gfs-sflux-frames.md.
"""
from __future__ import annotations

import json
import os
import time
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timedelta, timezone

from services import frame_binary as fb

NLON, NLAT = 3072, 1536
GAUSS_N = 89.910325                                    # the outermost N768 Gaussian latitude (89.91032453), to 1e-6
GRID = {"cols": NLON, "rows": NLAT, "bounds": (-180.0, -GAUSS_N, 180.0 - 360.0 / NLON, GAUSS_N), "stride": 1}
HOURS = tuple(range(0, 121)) + tuple(range(123, 385, 3))                       # 209
RAIN_HOURS = HOURS[1:]
S3_BASE = "https://noaa-gfs-bdp-pds.s3.amazonaws.com"
CREDIT = "Contains modified NOAA GFS data, via NOAA Open Data Dissemination (NODD)"
LICENSE = "NOAA open data (NODD): no restrictions on use; attribution requested; no NOAA endorsement implied"
SOURCE_URL = "https://registry.opendata.aws/noaa-gfs-bdp-pds/"
DATASET = "gfs.sfluxgrbf (T1534 Gaussian grid, 3072 x 1536, native points, no interpolation)"
KG_M2_S_TO_MM_H = 3600.0                               # 1 kg/m2 of water = 1 mm
RAIN_STEP_MM = 0.1                                     # the amount over each step is stored to 0.1 mm (round_rain)


def _spec(layer, field, idx, convert, valid, env, hours, value_kind, unit, what):
    return {"target": {"model": "GFS", "domain": "weather", "layer": layer, "region_id": "global_0p117"},
            "field": field, "idx": idx, "convert": convert, "grid": "0p117", "valid": valid, "clip": None, "env": env,
            "default_on": True, "frame_plane": True, "bundle": "sflux", "value_kind": value_kind, "value_unit": unit,
            "source_dataset": f"{DATASET}: {what}", "hours": hours, "source": "gfs_sflux", "upstream_provider": "noaa",
            "credit": CREDIT, "license": LICENSE, "source_url": SOURCE_URL}


SPECS = {
    "temperature_0p117": _spec("temperature", fb.TEMP_C, ("TMP", "2 m above ground"), lambda a: a - 273.15, (-95.0, 65.0),
                               "FRAME_RASTER_TEMPERATURE_0P117", HOURS, "temperature_2m", "degC",
                               "TMP 2 m above ground (instantaneous), K -> degC"),
    "water_temp_0p117": _spec("water_temp", fb.TEMP_C, ("TMP", "surface"), lambda a: a - 273.15, (-95.0, 90.0),
                              "FRAME_RASTER_WATER_TEMP_0P117", HOURS, "skin_temperature", "degC",
                              "TMP surface (skin temperature; SST over the ocean), K -> degC"),
    "precipitation_0p117": _spec("precipitation", fb.PRECIP_MM_H, ("PRATE", "surface"), lambda a: a, (0.0, 500.0),
                                 "FRAME_RASTER_PRECIP_0P117", RAIN_HOURS, "precipitation_rate", "mm/h",
                                 "PRATE surface (bucket averages de-averaged to the mean rate over the step before the hour; "
                                 "the amount over the step rounded to 0.1 mm)"),
}


def register(specs, grids):
    """Add this module's sets and lattice to frame_set_raster's tables (called once, at the end of that module)."""
    grids.setdefault("0p117", GRID)
    for name, sp in SPECS.items():
        specs.setdefault(name, sp)


def rain_step(f):
    """(bucket start, previous hour) of hour f: frame_set_raster.precip_step's rule (PRATE's buckets are APCP's)."""
    if f < 1:
        raise ValueError("no rain step before f001")
    return 6 * ((f - 1) // 6), (f - 1 if f <= 120 else f - 3)


def groups(hours=HOURS):
    """The hours as runs that share a PRATE bucket, each in order (f000 alone): one worker per run keeps the previous average."""
    out = {}
    for f in hours:
        out.setdefault(-1 if f == 0 else rain_step(f)[0], []).append(f)
    return [sorted(v) for _k, v in sorted(out.items())]


def rate_from_averages(avg_f, f, avg_prev, prev, bucket):
    """mm/h over (prev, f] from PRATE averages since `bucket` (kg/m2/s): (avg_f (f - b) - avg_prev (prev - b)) / (f - prev).
    avg_prev is not needed (None) when prev == bucket. A small negative from packing noise becomes 0."""
    import numpy as np
    total = np.asarray(avg_f, dtype=np.float64) * (f - bucket)
    if prev > bucket:
        total = total - np.asarray(avg_prev, dtype=np.float64) * (prev - bucket)
    rate = total / float(f - prev) * KG_M2_S_TO_MM_H
    return np.where(np.isfinite(rate), np.maximum(rate, 0.0), np.nan)


def round_rain(rate, step, q=None):
    """mm/h whose AMOUNT over the step is rounded to `q` mm (RAIN_STEP_MM, 0.1: Open-Meteo's own step; arm R2 of the gate).
    At 0.01 mm/h the set was 4.5-6.9x the 0.25-degree rain bytes, over the 4.5x line, and its drizzle under 0.05 mm (36 % of
    nodes, 4 % of the mass) is what .om rounds away; rounded to 0.1 mm per step, the frame equals today's .om map."""
    import numpy as np
    q = RAIN_STEP_MM if q is None else q
    return np.round(np.asarray(rate, dtype=np.float64) * step / q) * q / float(step)


def to_lattice(a):
    """(1536, 3072) GRIB order (row 0 = the north row, column 0 = 0E) -> row 0 = south, column 0 = 180W. No interpolation."""
    import numpy as np
    a = np.asarray(a)
    if a.shape != (NLAT, NLON):
        raise ValueError(f"expected the T1534 Gaussian grid {(NLAT, NLON)}, got {a.shape}")
    return np.roll(a[::-1], -(NLON // 2), axis=1)


GRID_KEYS = ("gridType", "Ni", "Nj", "latitudeOfFirstGridPointInDegrees", "longitudeOfFirstGridPointInDegrees", "jScansPositively")


def decode(data):
    """(values (1536, 3072) north row first, column 0 = 0E; float64, NaN = missing) from one GRIB2 message, refusing any other
    grid. pygrib as every raster source (CI); eccodes directly where pygrib has no wheel (an offline Windows gate run)."""
    import numpy as np
    from services.frame_set_raster import DECODE_LOCK
    with DECODE_LOCK:
        try:
            import pygrib
            msg = pygrib.fromstring(data)
            keys = {k: msg[k] for k in GRID_KEYS}
            vals = np.ma.filled(np.ma.asarray(msg.values, dtype=float), np.nan)
        except ImportError:
            import eccodes
            h = eccodes.codes_new_from_message(data)
            try:
                keys = {k: eccodes.codes_get(h, k) for k in GRID_KEYS}
                miss = eccodes.codes_get(h, "missingValue")
                vals = np.asarray(eccodes.codes_get_values(h), dtype=float)
                if eccodes.codes_get(h, "bitmapPresent"):
                    vals[vals == miss] = np.nan
            finally:
                eccodes.codes_release(h)
            vals = vals.reshape(int(keys["Nj"]), int(keys["Ni"]))
    want = {"gridType": "regular_gg", "Ni": NLON, "Nj": NLAT, "jScansPositively": 0}
    bad = {k: keys[k] for k in want if keys[k] != want[k]}
    if bad or abs(keys["latitudeOfFirstGridPointInDegrees"] - GAUSS_N) > 1e-3 or keys["longitudeOfFirstGridPointInDegrees"] != 0:
        raise RuntimeError(f"not the T1534 Gaussian grid: {keys}")
    return np.asarray(vals, dtype=float).reshape(NLAT, NLON)


class SfluxSource:
    """One forecast hour's sflux messages by .idx byte range (the pressure fetcher's range-integrity check)."""

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
        return f"{S3_BASE}/gfs.{cycle.strftime('%Y%m%d')}/{hh}/atmos/gfs.t{hh}z.sfluxgrbf"

    def url(self, cycle, f):
        return f"{self._prefix(cycle)}{f:03d}.grib2"

    def complete_cycle(self, now):
        """The newest cycle whose f000 and f384 .idx both exist, or None."""
        floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
        for back in range(7):
            cyc = floor6 - timedelta(hours=6 * back)
            try:
                if all(self.http.head(self.url(cyc, f) + ".idx", timeout=60).status_code == 200 for f in (HOURS[0], HOURS[-1])):
                    return cyc
            except Exception:
                continue
        return None

    def fetch(self, cycle, f, names):
        """{set name: raw GRIB values (north row first)} for the sets `names` at hour f; rain is the bucket AVERAGE (kg/m2/s)
        and is taken only where the .idx row is this hour's average since its bucket. Raises on any missing message."""
        from services.frame_set_raster import idx_rows, select_message, select_timed
        from services.noaa_gfs_pressure_fetcher import _fetch_message_bytes
        url = self.url(cycle, f)
        rows = idx_rows(self.http.get(url + ".idx", timeout=60).text)
        out = {}
        for name in names:
            sp = SPECS[name]
            if sp["field"] == fb.PRECIP_MM_H:
                rng = select_timed(rows, sp["idx"], f"{rain_step(f)[0]}-{f} hour ave fcst")
            else:
                rng = select_message(rows, sp["idx"])
            if rng is None:
                raise RuntimeError(f"f{f:03d}: idx has no {':'.join(sp['idx'])} message")
            out[name] = decode(_fetch_message_bytes(self.http, url, rng[0], rng[1]))
        return out


def build_bundle(source, cycle, names, log=print, workers=4, deadline=None, clock=time.monotonic):
    """{set name: (frames, uploads, stats)}, frame_set_raster.build_set's shapes, every set from ONE read of each hour's file.
    An hour that fails, or whose bucket run is not started before `deadline`, is listed unbuilt for every set it feeds."""
    import numpy as np
    from services import frame_set as fs
    from services.frame_set_raster import build_frame, iso
    run_stamp = fs.stamp(iso(cycle))
    res = {n: {} for n in names}
    rain = [n for n in names if SPECS[n]["field"] == fb.PRECIP_MM_H]

    def entry(name, f):
        return {"valid_time": iso(cycle + timedelta(hours=f)), "is_estimated": False,
                "source": {"cycle": iso(cycle), "forecast_hour": f, "url": source.url(cycle, f)}}

    def frame(name, f, plane):
        sp = SPECS[name]
        valid = cycle + timedelta(hours=f)
        plane = np.where((plane >= sp["valid"][0]) & (plane <= sp["valid"][1]), plane, np.nan)
        raw, gz, check = build_frame(plane, valid, cycle, sp["field"], GRID["bounds"])
        if check["bad"]:
            log(f"[sflux] {name} f{f:03d}: parity refused: {check}")
            return dict(entry(name, f), path=None, unbuilt="refused"), None, None
        sha = fb.sha256_hex(raw)
        path = f"{fs.set_prefix(sp['target'])}/{run_stamp}/{fs.stamp(iso(valid))}-{sha[:12]}.bin"
        return (dict(entry(name, f), path=path, sha256=sha, bytes=len(gz), raw_bytes=len(raw), meta={"forecast_hour": f}),
                (path, gz, fs.FRAME_TYPE, fs.IMMUTABLE), check)

    def run(hours):
        prev_avg = None
        for f in hours:
            want = [n for n in names if f in SPECS[n]["hours"]]
            if deadline is not None and clock() > deadline:
                for n in want:
                    res[n][f] = (dict(entry(n, f), path=None, unbuilt="skipped_budget"), None, None)
                prev_avg = None
                continue
            try:
                got = source.fetch(cycle, f, want)
            except Exception as e:
                log(f"[sflux] f{f:03d}: {type(e).__name__}: {e}")
                for n in want:
                    res[n][f] = (dict(entry(n, f), path=None, unbuilt="failed"), None, None)
                prev_avg = None
                continue
            for n in want:
                try:
                    if n in rain:
                        bucket, prev = rain_step(f)
                        if prev > bucket and prev_avg is None:      # the previous hour failed: re-read its average alone
                            prev_avg = source.fetch(cycle, prev, [n])[n]
                        plane = to_lattice(round_rain(rate_from_averages(got[n], f, prev_avg, prev, bucket), f - prev))
                        prev_avg = got[n]
                    else:
                        plane = to_lattice(SPECS[n]["convert"](got[n]))
                    res[n][f] = frame(n, f, plane)
                except Exception as e:
                    log(f"[sflux] {n} f{f:03d}: {type(e).__name__}: {e}")
                    res[n][f] = (dict(entry(n, f), path=None, unbuilt="failed"), None, None)
                    if n in rain:
                        prev_avg = None

    with ThreadPoolExecutor(max_workers=max(1, workers)) as pool:
        list(pool.map(run, groups(sorted({f for n in names for f in SPECS[n]["hours"]}))))
    out = {}
    for n in names:
        hours = SPECS[n]["hours"]
        stats = {"entries": len(hours), "built": 0, "failed": 0, "refused": 0, "skipped_budget": 0, "bytes": 0,
                 "parity_max_abs_err": 0.0, "missing_nodes": 0, "saturated_cells": 0}
        frames, uploads = [], []
        for f in hours:
            fr, job, check = res[n].get(f) or (dict(entry(n, f), path=None, unbuilt="failed"), None, None)
            if job:
                uploads.append(job)
                stats["built"] += 1
                stats["bytes"] += fr["bytes"]
                stats["parity_max_abs_err"] = max(stats["parity_max_abs_err"], check["max_abs_err"])
                stats["missing_nodes"] += check["missing"]
            else:
                stats[fr["unbuilt"]] += 1
            frames.append(fr)
        out[n] = (frames, uploads, stats)
    return out


class _FixedCycle:
    """frame_set_raster.publish's source for a set already built: the cycle it was built from."""

    def __init__(self, cycle):
        self.cycle = cycle

    def complete_cycle(self, _now):
        return self.cycle


def publish_bundle(source, sink, uploader, names=None, log=print, budget_s=None, now=None, clock=time.monotonic):
    """Build every switched-on, not-yet-published sflux set of the newest complete cycle from one read per hour, then publish
    each through frame_set_raster.publish (its coverage floor, index, latest.json and retention rules). {set name: report}."""
    from services import frame_latest_guard as flg
    from services import frame_set as fs
    from services import frame_set_raster as fsr
    names = [n for n in (names or SPECS) if fsr.enabled(n)]
    if not names:
        log("[sflux] every set is off; skipped")
        return {}
    budget = float(os.environ.get("FRAME_RASTER_BUDGET_S", "420")) if budget_s is None else budget_s
    started = clock()
    cycle = source.complete_cycle(now or datetime.now(timezone.utc))
    if cycle is None:
        log("[sflux] no complete GFS cycle on AWS; the published sets stay")
        return {n: {"status": "no_cycle"} for n in names}
    try:
        latest, _state = flg.read_latest(sink, log)
    except flg.LatestUnknown as e:
        log(f"[sflux] {e}; nothing published (the published sets stay)")
        return {n: {"status": "latest_unknown", "reason": str(e)} for n in names}
    sets = latest.get("sets", {})
    todo = [n for n in names if (sets.get(fs.set_key(SPECS[n]["target"])) or {}).get("run") != fsr.iso(cycle)]
    reports = {n: {"status": "unchanged", "run": fsr.iso(cycle)} for n in names if n not in todo}
    if not todo:
        log(f"[sflux] cycle {fsr.iso(cycle)} already published for every set")
        return reports
    built = build_bundle(source, cycle, todo, log=log, deadline=started + budget, clock=clock)
    secs = round(clock() - started, 1)
    for n in todo:
        frames, uploads, stats = built.pop(n)
        stats["seconds_build"] = secs
        reports[n] = fsr.publish(_FixedCycle(cycle), sink, uploader, log=log, budget_s=budget, clock=clock,
                                 spec=fsr.spec_for(n), built=(frames, uploads, stats))
        del frames, uploads                                 # free each set's frame bytes once it is up
        log(f"[sflux] {n}: {json.dumps({k: reports[n].get(k) for k in ('status', 'built', 'bytes', 'uploaded')})}")
    return reports
