"""dominant_swell_fetch_fields.py -- pull the 12 GFS-Wave fields for a few forecast hours into one .npz.

WHY: the WAVES_ANIM_DOMINANT_SWELL census (dominant_swell_flag_census.py) needs the RAW wave fields, because the
stored products carry only the direction that was stamped at ingest (flag on since 2026-07-13) and the weather-products
bucket is private. NOAA publishes the same GFS-Wave GRIB2 files the ingest reads, free and unauthenticated, on AWS
Open Data. This is a one-off research download (about 7 MB per forecast hour, byte-range reads of the 12 wave messages,
exactly the selection services/noaa_gfs_wave_fetcher.py makes). It talks to NOAA's bucket only, never to the Raw Surf
backend or to Supabase.

NEEDS: numpy, requests, eccodes (pip install eccodes; not in requirements.txt on purpose: this is not a CI path).
RUN:   python dominant_swell_fetch_fields.py --out fields.npz [--hours 0 24 48 72 120] [--cycle YYYYMMDDHH]

Output arrays (float32, NaN where the model has no value, shape (n_hours, 721, 1440), lon 0..359.75):
  one per name in OM_ORDER (wave_height, wave_period, wave_direction, wind_wave_height, swell_wave_height,
  secondary_swell_wave_height, wind_wave_period, swell_wave_period, secondary_swell_wave_period, wind_wave_direction,
  swell_wave_direction, secondary_swell_wave_direction), plus `lats` (721,), `lons` (1440,), `hours` and `cycle`.
"""
import argparse
import os
import sys
import tempfile
from datetime import datetime, timedelta, timezone

import numpy as np
import requests

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "services"))
import noaa_gfs_wave_fetcher as F  # noqa: E402  (stdlib-only at import time; pygrib is imported inside fetch_global_coarse)


def pick_cycle(now, hours):
    last = max(hours)
    floor6 = now.replace(minute=0, second=0, microsecond=0, hour=(now.hour // 6) * 6)
    for back in range(0, 8):
        cyc = floor6 - timedelta(hours=6 * back)
        ymd, hh = cyc.strftime("%Y%m%d"), cyc.strftime("%H")
        prefix = f"{F.S3_BASE}/gfs.{ymd}/{hh}/wave/gridded/gfswave.t{hh}z.{F.GRID}."
        ok = all(requests.head(f"{prefix}f{h:03d}.grib2.idx", timeout=60).status_code == 200 for h in (0, last))
        if ok:
            return cyc, prefix
    raise SystemExit("no complete GFS-Wave cycle found")


def decode_messages(blob):
    import eccodes
    out, lats, lons = [], None, None
    pos = 0
    while True:
        i = blob.find(b"GRIB", pos)
        if i < 0:
            break
        h = eccodes.codes_new_from_message(blob[i:])
        try:
            ni, nj = eccodes.codes_get(h, "Ni"), eccodes.codes_get(h, "Nj")
            eccodes.codes_set(h, "missingValue", 9.999e20)
            v = eccodes.codes_get_values(h).reshape(nj, ni).astype("float64")
            v[v > 1e19] = np.nan
            if lats is None:
                la0 = eccodes.codes_get(h, "latitudeOfFirstGridPointInDegrees")
                la1 = eccodes.codes_get(h, "latitudeOfLastGridPointInDegrees")
                lo0 = eccodes.codes_get(h, "longitudeOfFirstGridPointInDegrees")
                lats = np.linspace(la0, la1, nj)
                lons = (lo0 + np.arange(ni) * eccodes.codes_get(h, "iDirectionIncrementInDegrees")) % 360.0
            out.append(v)
        finally:
            eccodes.codes_release(h)
        pos = i + 4
    return out, lats, lons


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", required=True)
    ap.add_argument("--hours", type=int, nargs="+", default=[0, 24, 48, 72, 120])
    ap.add_argument("--cycle", default=None, help="YYYYMMDDHH; default: newest complete cycle")
    a = ap.parse_args()
    now = datetime.now(timezone.utc) if not a.cycle else datetime.strptime(a.cycle, "%Y%m%d%H").replace(tzinfo=timezone.utc)
    cyc, prefix = pick_cycle(now, a.hours)
    print("cycle", cyc.isoformat(), flush=True)
    stacks = {om: [] for om in F.OM_ORDER}
    lats = lons = None
    for h in a.hours:
        url = f"{prefix}f{h:03d}.grib2"
        idx = requests.get(url + ".idx", timeout=60).text
        selected = F._select_ranges(F._parse_idx(idx))
        if len(selected) != len(F.OM_ORDER):
            raise SystemExit(f"f{h:03d}: selected {len(selected)} messages, expected {len(F.OM_ORDER)}")
        blob = b"".join(F._fetch_message_bytes(requests, url, s, e) for _om, (s, e) in selected)
        msgs, la, lo = decode_messages(blob)
        if len(msgs) != len(F.OM_ORDER):
            raise SystemExit(f"f{h:03d}: decoded {len(msgs)} messages, expected {len(F.OM_ORDER)}")
        for om, m in zip(F.OM_ORDER, msgs):
            stacks[om].append(m.astype("float32"))
        lats, lons = la, lo
        print(f"f{h:03d} ok  {len(blob)/1e6:.1f} MB", flush=True)
    arrays = {om: np.stack(v) for om, v in stacks.items()}
    np.savez_compressed(a.out, lats=lats, lons=lons, hours=np.array(a.hours), cycle=np.array(cyc.isoformat()), **arrays)
    print("wrote", a.out)


if __name__ == "__main__":
    main()
