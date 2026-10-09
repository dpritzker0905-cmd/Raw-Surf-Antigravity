"""
NOAA HRRR CONUS 10 m wind -> the HRRR wind lane object (2026-10-09; weather_pipeline/wind_lane.py serves it).

WHY NOAA AND NOT OPEN-METEO (measured 2026-10-09, log 2026-10-09-hrrr-wind-lane.md):
  - Open-Meteo's `gfs_hrrr` serves HRRR's GRID-RELATIVE winds as if they were earth-relative: against GFS at the same
    hour its directions carry the -alpha bias of the unrotated field (+12.0 deg west of 97.5W, -19.5 deg east), and
    against 101 NDBC buoys over 5 days the unrotated field scores 0.47-0.69 kn worse vector RMSE than the rotated one.
  - It POINT-samples the 3 km field at the requested node: at 0.25 deg that aliases 5.2 kn (p95) / 20.2 kn (max) of
    sub-cell convective noise into the drawn field. This fetcher takes the AREA mean of each 0.25 deg cell instead.
  - Its free quota (10,000 location-calls a day) cannot carry a 37,760-node domain every cycle; AWS Open Data has no
    quota and names the run.

WHAT IT WRITES: one JSON object for one HRRR cycle (the newest 00/06/12/18Z run with all of f00-f48 published), the
area-mean wind on the lattice `LATTICE` for every hour f00..f48, in knots, as zlib+base64 int16 arrays shaped
(hour, lat, lon), scale 0.1 kn, -32768 where no HRRR cell falls in the lattice cell. ~3-5 MB per cycle.
Each cell: SCALAR-mean speed with the VECTOR-mean direction (LESSONS L-S16: a speed averaged as a vector can only
shrink; a direction is a vector quantity).

SAFETY: the GRIB grid is read from the message's own section 3 (template 3.30) and must equal `_hrrr_grid`'s grid,
or the step is refused; the winds are rotated to earth only when section 3 flags them grid-relative. Both checks read
the raw bytes, so they hold whichever decoder runs (pygrib on CI/Render; gribberish where pygrib has no wheel).

USAGE: subprocess (production): python noaa_hrrr_wind_fetcher.py '<payload-json>' -> writes JSON to
payload["output_path"]; prints a one-line SUMMARY:... to stdout. Standalone: no args -> newest cycle, f00-f03 only.
"""
import base64
import json
import math
import os
import struct
import sys
import time
import zlib
from datetime import datetime, timedelta, timezone

try:
    import _hrrr_grid as hg                       # script-by-path
except ImportError:  # pragma: no cover - package-context fallback
    from services import _hrrr_grid as hg

S3_BASE = "https://noaa-hrrr-bdp-pds.s3.amazonaws.com"
HTTP_TIMEOUT = 60
FORMAT = "hrrr-wind-lane/1"
WIND_VARS = (("UGRD", "10 m above ground"), ("VGRD", "10 m above ground"))
MISSING = -32768
SCALE = 0.1                                       # kn per int16 unit
KN_PER_MS = 1.0 / 0.514444

# The lattice: every 0.25 deg node whose cell can hold an HRRR cell (the domain spans 21.14-52.62N, 134.10-60.92W).
LATTICE = {"lat0": 21.0, "lon0": -134.25, "res": 0.25, "nlat": 128, "nlon": 295}


# ───────────────────────────── GRIB section 3, read from the raw message ─────────────────────────────
def grid_section(msg):
    """(template, nx, ny, la1, lo1, comp_flags, lov, dx_mm, dy_mm, latin1, latin2) from one GRIB2 message's section 3.
    Raises ValueError on anything that is not one GRIB2 message with a section 3."""
    if len(msg) < 16 or msg[:4] != b"GRIB" or msg[7] != 2:
        raise ValueError("not a GRIB2 message")
    total = struct.unpack(">Q", msg[8:16])[0]
    p = 16
    while p + 5 <= min(total, len(msg)) - 4:
        ln = struct.unpack(">I", msg[p:p + 4])[0]
        if ln <= 0:
            break
        if msg[p + 4] == 3:
            s = msg[p:p + ln]
            tmpl = struct.unpack(">H", s[12:14])[0]
            if tmpl != 30:
                return (tmpl,) + (None,) * 10

            def i4(o):
                return struct.unpack(">I", s[o:o + 4])[0]

            def s4(o):                            # GRIB2 sign-magnitude
                v = i4(o)
                return -(v & 0x7FFFFFFF) if v & 0x80000000 else v
            return (tmpl, i4(30), i4(34), s4(38) / 1e6, i4(42) / 1e6, s[46], i4(51) / 1e6,
                    i4(55), i4(59), s4(65) / 1e6, s4(69) / 1e6)
        p += ln
    raise ValueError("GRIB2 message has no section 3")


def check_grid(msg):
    """Refuse a message whose grid is not HRRR CONUS as `_hrrr_grid` defines it. Returns True when its winds are
    grid-relative (resolution and component flags, bit 0x08)."""
    tmpl, nx, ny, la1, lo1, flags, lov, dx, dy, latin1, latin2 = grid_section(msg)
    want = (30, hg.NX, hg.NY)
    if (tmpl, nx, ny) != want:
        raise ValueError(f"grid template/size {(tmpl, nx, ny)} != {want}")
    lo1w = ((lo1 + 180.0) % 360.0) - 180.0
    lovw = ((lov + 180.0) % 360.0) - 180.0
    bad = [name for name, got, ref, tol in (
        ("La1", la1, hg.LA1_DEG, 1e-5), ("Lo1", lo1w, hg.LO1_DEG, 1e-5), ("LoV", lovw, hg.LON_V_DEG, 1e-5),
        ("Dx", dx / 1000.0, hg.DX_M, 1e-3), ("Dy", dy / 1000.0, hg.DX_M, 1e-3),
        ("Latin1", latin1, hg.LAT_STD_DEG, 1e-5), ("Latin2", latin2, hg.LAT_STD_DEG, 1e-5)) if abs(got - ref) > tol]
    if bad:
        raise ValueError(f"HRRR grid changed ({', '.join(bad)}); refusing rather than misplacing every cell")
    return bool(flags & 0x08)


def decode_values(msg):
    """The message's values as a flat float array in scan order (+i fastest, +j), NaN where missing."""
    import numpy as np
    try:
        import pygrib
        g = pygrib.fromstring(msg)
        vals = np.ma.filled(np.ma.asarray(g.values, dtype=float), np.nan)
    except ImportError:                           # no pygrib wheel (Windows dev): the Rust decoder reads the same bytes
        import gribberish
        vals = np.asarray(gribberish.parse_grib_message(msg, 0).data(), dtype=float)
    vals = np.asarray(vals, dtype=float).reshape(-1)
    if vals.size != hg.NX * hg.NY:
        raise ValueError(f"decoded {vals.size} values, expected {hg.NX * hg.NY}")
    return vals


# ───────────────────────────── the regrid: HRRR cell -> lattice cell ─────────────────────────────
def cell_index(lattice=LATTICE):
    """For every HRRR cell (scan order), the flat lattice cell it falls in, or -1. Built from `_hrrr_grid.inverse`."""
    import numpy as np
    ii, jj = np.meshgrid(np.arange(hg.NX, dtype=float), np.arange(hg.NY, dtype=float))
    x = hg._X0 + ii.reshape(-1) * hg.DX_M
    yy = hg._RHO0 - (hg._Y0 + jj.reshape(-1) * hg.DX_M)
    r = np.hypot(x, yy)
    lat = np.degrees(2.0 * np.arctan((hg.R_EARTH_M * hg._F / r) ** (1.0 / hg._N)) - math.pi / 2.0)
    lon = hg.LON_V_DEG + np.degrees(np.arctan2(x, yy) / hg._N)
    lon = ((lon + 180.0) % 360.0) - 180.0
    res = lattice["res"]
    ri = np.round((lat - lattice["lat0"]) / res).astype(int)
    ci = np.round((lon - lattice["lon0"]) / res).astype(int)
    ok = (ri >= 0) & (ri < lattice["nlat"]) & (ci >= 0) & (ci < lattice["nlon"])
    return np.where(ok, ri * lattice["nlon"] + ci, -1), lon


def area_mean(u_e, v_e, idx, ncells):
    """Per lattice cell: scalar-mean speed along the vector-mean direction. Returns (u, v) in the input units, NaN
    where no finite HRRR cell falls in the lattice cell."""
    import numpy as np
    ok = (idx >= 0) & np.isfinite(u_e) & np.isfinite(v_e)
    k = idx[ok]
    u, v = u_e[ok], v_e[ok]
    n = np.bincount(k, minlength=ncells).astype(float)
    s = np.bincount(k, weights=np.hypot(u, v), minlength=ncells)
    su = np.bincount(k, weights=u, minlength=ncells)
    sv = np.bincount(k, weights=v, minlength=ncells)
    with np.errstate(invalid="ignore", divide="ignore"):
        spd = s / n
        norm = np.hypot(su, sv)
        out_u = np.where(norm > 0, spd * su / np.where(norm > 0, norm, 1.0), 0.0)
        out_v = np.where(norm > 0, spd * sv / np.where(norm > 0, norm, 1.0), 0.0)
    out_u[n == 0] = np.nan
    out_v[n == 0] = np.nan
    return out_u, out_v


def encode(arr):
    """float knots -> zlib+base64 int16 (scale 0.1 kn, MISSING where NaN)."""
    import numpy as np
    q = np.where(np.isfinite(arr), np.clip(np.round(arr / SCALE), -32767, 32767), MISSING).astype("<i2")
    return base64.b64encode(zlib.compress(q.tobytes(), 6)).decode("ascii")


def decode_q(b64, shape):
    """`encode`'s raw int16 array (0.1 kn units, MISSING where no HRRR cell): what the serve lane keeps in memory."""
    import numpy as np
    return np.frombuffer(zlib.decompress(base64.b64decode(b64)), dtype="<i2").reshape(shape)


def dequantize(q):
    """int16 (0.1 kn) -> float32 knots, NaN where MISSING."""
    import numpy as np
    out = q.astype(np.float32) * np.float32(SCALE)
    out[q == MISSING] = np.nan
    return out


def decode(b64, shape):
    """Inverse of `encode` -> float32 array in knots, NaN where MISSING (tests, bench fixtures)."""
    import numpy as np
    q = decode_q(b64, shape)
    out = q.astype(np.float32) * np.float32(SCALE)
    out[q == MISSING] = np.nan
    return out


# ───────────────────────────── NOAA AWS Open Data ─────────────────────────────
def _prefix(cyc):
    return f"{S3_BASE}/hrrr.{cyc:%Y%m%d}/conus/hrrr.t{cyc:%H}z.wrfsfcf"


def pick_cycle(requests, now, max_f=48, back=4):
    """Newest 00/06/12/18Z cycle whose f00 AND f{max_f} index files both exist (a complete extended run)."""
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for k in range(back + 1):
        cyc = floor6 - timedelta(hours=6 * k)
        try:
            r0 = requests.head(f"{_prefix(cyc)}00.grib2.idx", timeout=HTTP_TIMEOUT)
            rn = requests.head(f"{_prefix(cyc)}{max_f:02d}.grib2.idx", timeout=HTTP_TIMEOUT)
            if r0.status_code == 200 and rn.status_code == 200:
                return cyc
        except Exception:
            continue
    return None


def wind_ranges(idx_text):
    """[(var, start, end)] for UGRD/VGRD 10 m, in WIND_VARS order, from a .idx; end is inclusive."""
    rows = []
    for line in idx_text.strip().splitlines():
        p = line.split(":")
        if len(p) >= 5:
            try:
                rows.append((int(p[1]), p[3], p[4]))
            except ValueError:
                continue
    found = {}
    for k, (start, var, lvl) in enumerate(rows):
        if (var, lvl) in WIND_VARS and k + 1 < len(rows):
            found[var] = (start, rows[k + 1][0] - 1)
    if len(found) != 2:
        raise RuntimeError(f"idx missing 10 m wind messages ({sorted(found)})")
    return [(var, found[var][0], found[var][1]) for var, _ in WIND_VARS]


def _get_range(requests, url, start, end):
    r = requests.get(url, headers={"Range": f"bytes={start}-{end}"}, timeout=HTTP_TIMEOUT)
    if r.status_code not in (200, 206) or len(r.content) != end - start + 1:
        raise RuntimeError(f"range GET {start}-{end} -> HTTP {r.status_code}, {len(r.content)} bytes")
    return r.content


def build_lane(payload, requests=None, now=None):
    """Fetch one HRRR cycle and return the lane object (dict), or None when no complete cycle is published."""
    import numpy as np
    if requests is None:
        try:
            from _fetch_common import http_session           # script-by-path
        except ImportError:  # pragma: no cover
            from services._fetch_common import http_session
        requests = http_session()
    now = now or datetime.now(timezone.utc)
    max_f = int(payload.get("max_f", 48))
    # `cycle` pins one run (a reproducible measurement or a backfill); otherwise the newest complete extended run.
    cyc = hg.utc(payload["cycle"]) if payload.get("cycle") else pick_cycle(requests, now, max_f=48)
    if cyc is None:
        sys.stderr.write("[noaa_hrrr_wind_fetcher] no complete extended HRRR cycle on AWS Open Data\n")
        return None
    lat = LATTICE
    ncells = lat["nlat"] * lat["nlon"]
    idx, lon_all = cell_index(lat)
    hours, us, vs = [], [], []
    failed = 0
    for f in range(0, max_f + 1):
        url = f"{_prefix(cyc)}{f:02d}.grib2"
        try:
            ranges = wind_ranges(requests.get(url + ".idx", timeout=HTTP_TIMEOUT).text)
            comp = {}
            for var, start, end in ranges:
                msg = _get_range(requests, url, start, end)
                rel = check_grid(msg)
                comp[var] = (decode_values(msg), rel)
            (u, rel_u), (v, rel_v) = comp["UGRD"], comp["VGRD"]
            if rel_u != rel_v:
                raise RuntimeError("U and V disagree on grid- vs earth-relative")
            if rel_u:
                u, v = hg.rotate_to_earth(u, v, lon_all)
            mu, mv = area_mean(u * KN_PER_MS, v * KN_PER_MS, idx, ncells)
            us.append(mu.reshape(lat["nlat"], lat["nlon"]))
            vs.append(mv.reshape(lat["nlat"], lat["nlon"]))
            hours.append((cyc + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
        except Exception as e:
            failed += 1
            sys.stderr.write(f"[noaa_hrrr_wind_fetcher] f{f:02d} failed: {type(e).__name__}: {e}\n")
    if not hours:
        return None
    U, V = np.stack(us), np.stack(vs)
    return {
        "format": FORMAT,
        "source": "NOAA HRRR CONUS wrfsfc UGRD/VGRD 10 m (AWS Open Data), rotated grid->earth",
        "regrid": "area mean over each lattice cell: scalar-mean speed along the vector-mean direction",
        "cycle": cyc.strftime("%Y-%m-%dT%H:%M:%SZ"),
        "horizon": hours[-1],
        "hours": hours,
        "lattice": dict(lat),
        "units": "kn", "scale": SCALE, "missing": MISSING,
        "encoding": "zlib+base64 int16 little-endian, shape (hour, lat, lon)",
        "u": encode(U), "v": encode(V),
        "steps_ok": len(hours), "steps_failed": failed,
    }


def main():
    if len(sys.argv) >= 2:
        payload = json.loads(sys.argv[1])
    else:
        payload = {"max_f": int(os.environ.get("HRRR_LANE_MAX_F", "3")), "output_path": ""}
    t0 = time.time()
    lane = build_lane(payload)
    out_path = payload.get("output_path", "")
    if out_path and lane:
        with open(out_path, "w") as fh:
            json.dump(lane, fh)
    print(f"SUMMARY: cycle={lane and lane['cycle']} steps_ok={lane and lane['steps_ok']} "
          f"steps_failed={lane and lane['steps_failed']} horizon={lane and lane['horizon']} "
          f"bytes={len(json.dumps(lane)) if lane else 0} elapsed={time.time() - t0:.1f}s "
          f"wrote={'yes:' + out_path if (out_path and lane) else 'no'}")


if __name__ == "__main__":
    try:
        main()
    except Exception as e:
        import traceback
        print(f"ERROR: {e}")
        traceback.print_exc()
        sys.exit(1)
