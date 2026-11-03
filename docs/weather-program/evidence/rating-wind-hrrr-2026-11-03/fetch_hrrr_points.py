"""Diagnostic for the RATING_WIND_HRRR evidence: the SAME NOAA HRRR messages as fetch_hrrr.py, but sampled at each
anemometer spot on the NATIVE 3 km grid (bilinear and nearest on the Lambert grid, after the grid->earth rotation),
instead of the 0.25-deg lattice area mean the lane stores. Tells whether a native-point HRRR product would carry the
gain L6 measured with Open-Meteo's (point-sampled) gfs_hrrr. Output: data/hrrr_points.json. Public data only.
Usage: python -I fetch_hrrr_points.py <backend-dir> <out-json> <start> <end>"""
import json, os, sys, time
from datetime import datetime, timedelta, timezone
BACKEND, OUT, START, END = sys.argv[1:5]
sys.path.insert(0, BACKEND); sys.path.insert(0, os.path.join(BACKEND, "services"))
import numpy as np, requests, eccodes  # noqa: E401
import noaa_hrrr_wind_fetcher as F  # noqa: E402
import _hrrr_grid as hg  # noqa: E402
SPOTS = {"duck": (36.18, -75.75), "cocoa": (28.40, -80.59), "obsf": (37.755, -122.511), "torrey": (32.867, -117.257),
         "galveston": (29.28, -94.79), "wrightsville": (34.21, -77.79), "mavericks": (37.49, -122.50)}
def dec(msg):
    h = eccodes.codes_new_from_message(msg)
    try:
        return np.asarray(eccodes.codes_get_values(h), dtype=float)
    finally:
        eccodes.codes_release(h)
ij = {s: hg.grid_ij(*p) for s, p in SPOTS.items()}
out = json.load(open(OUT)) if os.path.exists(OUT) else {}
s = datetime.strptime(START, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
e = datetime.strptime(END, "%Y-%m-%dT%H").replace(tzinfo=timezone.utc)
_, lon_all = F.cell_index(F.LATTICE)
ses = requests.Session()
cyc = s
while cyc <= e:
    for f in range(1, 7):
        vt = (cyc + timedelta(hours=f)).strftime("%Y-%m-%dT%H:00")
        if vt in out:
            continue
        url = f"{F._prefix(cyc)}{f:02d}.grib2"
        for attempt in range(3):
            try:
                rng = F.wind_ranges(ses.get(url + ".idx", timeout=60).text)
                comp = {}
                for var, a, b in rng:
                    msg = F._get_range(ses, url, a, b)
                    comp[var] = (dec(msg), F.check_grid(msg))
                (u, ru), (v, _) = comp["UGRD"], comp["VGRD"]
                if ru:
                    u, v = hg.rotate_to_earth(u, v, lon_all)
                U, V = u.reshape(hg.NY, hg.NX), v.reshape(hg.NY, hg.NX)
                row = {}
                for sp, (i, j) in ij.items():
                    i0, j0 = int(np.floor(i)), int(np.floor(j)); ti, tj = i - i0, j - j0
                    bu = (U[j0, i0] * (1 - ti) * (1 - tj) + U[j0, i0 + 1] * ti * (1 - tj) + U[j0 + 1, i0] * (1 - ti) * tj + U[j0 + 1, i0 + 1] * ti * tj)
                    bv = (V[j0, i0] * (1 - ti) * (1 - tj) + V[j0, i0 + 1] * ti * (1 - tj) + V[j0 + 1, i0] * (1 - ti) * tj + V[j0 + 1, i0 + 1] * ti * tj)
                    ni, nj = int(round(i)), int(round(j))
                    row[sp] = {"bil": [round(float(bu), 3), round(float(bv), 3)], "near": [round(float(U[nj, ni]), 3), round(float(V[nj, ni]), 3)]}
                out[vt] = row
                break
            except Exception as ex:
                if attempt == 2:
                    sys.stderr.write(f"{vt} failed {ex}\n")
                time.sleep(2)
    json.dump(out, open(OUT, "w"))
    print(cyc.isoformat(), len(out), flush=True)
    cyc += timedelta(hours=6)
