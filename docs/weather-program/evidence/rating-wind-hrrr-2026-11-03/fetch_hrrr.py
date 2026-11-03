"""Fresh-window HRRR lane builder (offline evidence for RATING_WIND_HRRR). Public NOAA AWS Open Data only.

For every 00/06/12/18Z HRRR cycle in [START, END] it fetches f01..f06 10 m UGRD/VGRD (two byte ranges per file),
rotates grid->earth and area-means onto the served lattice with the REPO's own functions
(noaa_hrrr_wind_fetcher.wind_ranges/_get_range/check_grid/area_mean/encode, _hrrr_grid.rotate_to_earth), decoding with
eccodes (pygrib has no Windows wheel; the bytes and the grid check are the fetcher's own). Output: one lane object per
cycle, the SAME format the ingest writes (hrrr-wind-lane/1), in data/hrrr/<cycle>.json. Resumable, one request at a time.
Usage: python -I fetch_hrrr.py <backend-dir> <out-dir> <start YYYY-MM-DDTHH> <end YYYY-MM-DDTHH>
"""
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

BACKEND, OUT, START, END = sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4]
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "services"))
import numpy as np  # noqa: E402
import requests  # noqa: E402
import eccodes  # noqa: E402
import noaa_hrrr_wind_fetcher as F  # noqa: E402
import _hrrr_grid as hg  # noqa: E402


def decode_values(msg):
    h = eccodes.codes_new_from_message(msg)
    try:
        vals = np.asarray(eccodes.codes_get_values(h), dtype=float)
        miss = eccodes.codes_get_double(h, "missingValue")
        bitmap = eccodes.codes_get_long(h, "bitmapPresent")
    finally:
        eccodes.codes_release(h)
    if bitmap:
        vals[vals == miss] = np.nan
    if vals.size != hg.NX * hg.NY:
        raise ValueError(f"decoded {vals.size} values")
    return vals


def main():
    s = datetime.strptime(START, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
    e = datetime.strptime(END, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
    os.makedirs(OUT, exist_ok=True)
    lat = F.LATTICE
    ncells = lat["nlat"] * lat["nlon"]
    idx, lon_all = F.cell_index(lat)
    ses = requests.Session()
    ses.headers["User-Agent"] = "raw-surf-research/0.1 (offline verification study)"
    cyc = s
    while cyc <= e:
        path = os.path.join(OUT, cyc.strftime("%Y%m%d%H") + ".json")
        if os.path.exists(path):
            cyc += timedelta(hours=6)
            continue
        hours, us, vs, failed = [], [], [], 0
        t0 = time.time()
        for f in range(1, 7):
            url = f"{F._prefix(cyc)}{f:02d}.grib2"
            for attempt in range(3):
                try:
                    ranges = F.wind_ranges(ses.get(url + ".idx", timeout=60).text)
                    comp = {}
                    for var, a, b in ranges:
                        msg = F._get_range(ses, url, a, b)
                        rel = F.check_grid(msg)
                        comp[var] = (decode_values(msg), rel)
                    (u, ru), (v, rv) = comp["UGRD"], comp["VGRD"]
                    if ru != rv:
                        raise RuntimeError("U/V relativity differs")
                    if ru:
                        u, v = hg.rotate_to_earth(u, v, lon_all)
                    mu, mv = F.area_mean(u, v, idx, ncells)
                    us.append(mu.reshape(lat["nlat"], lat["nlon"]))
                    vs.append(mv.reshape(lat["nlat"], lat["nlon"]))
                    hours.append((cyc + timedelta(hours=f)).strftime("%Y-%m-%dT%H:%M:%SZ"))
                    break
                except Exception as ex:
                    if attempt == 2:
                        failed += 1
                        sys.stderr.write(f"{cyc:%Y%m%d%H} f{f:02d} failed: {type(ex).__name__}: {ex}\n")
                    time.sleep(2)
        if hours:
            obj = {"format": F.FORMAT, "cycle": cyc.strftime("%Y-%m-%dT%H:%M:%SZ"), "horizon": hours[-1],
                   "hours": hours, "lattice": dict(lat), "u": F.encode(np.stack(us)), "v": F.encode(np.stack(vs)),
                   "steps_ok": len(hours), "steps_failed": failed}
            json.dump(obj, open(path, "w"))
        print(f"{cyc:%Y-%m-%dT%HZ} ok {len(hours)} failed {failed} {time.time() - t0:.1f}s", flush=True)
        cyc += timedelta(hours=6)


main()
