"""EOT20 seasonal-convention check for the tide M1 G2 registration (advisor item 3, 2026-11-16).

OFFLINE, measurement only, public data only (no credentials): runs in .github/workflows/tide-eot20-convention.yml on
branch claude/tide-m1-eot20-check (never the gate's branch). Calendar 2025 (NOT a G2 test window) at four CO-OPS
gauges: Boston 8443970, Galveston 8771510, La Jolla 9410230, Honolulu 1612340.
Question: pyTMD evaluates EOT20's SA with Doodson's argument h - p1 (pyTMD data/doodson.json), while NOAA's SA phases
are for h. Does EOT20-through-pyTMD put the seasonal cycle where NOAA does?
Reports, per station:
  1. the monthly mean of (CO-OPS MSL predictions - arm B as the gate evaluates it) over 2025;
  2. EOT20's SA+SSA alone (pyTMD) vs NOAA's SA+SSA (NOAA convention h / 2h), monthly means;
  3. EOT20's SA (pyTMD) refitted as A cos(h - G) vs NOAA's own SA (A, G): the phase difference in degrees.
     ~ -77 deg (p1 ~ 283 deg) would mean the evaluator's convention does not match the atlas's.
"""
import json
import math
import shutil
import sys
import urllib.request
import zipfile
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

STATIONS = {"8443970": "Boston", "8771510": "Galveston", "9410230": "La Jolla", "1612340": "Honolulu"}
COOPS = "https://api.tidesandcurrents.noaa.gov"
EOT20_URL = "https://www.seanoe.org/data/00683/79489/data/85762.zip"


def log(m):
    print(m, file=sys.stderr, flush=True)


def get(u):
    req = urllib.request.Request(u, headers={"User-Agent": "raw-surf-tide-eot20-check"})
    with urllib.request.urlopen(req, timeout=120) as r:
        return json.loads(r.read().decode())


def preds_2025(sid):
    out = {}
    for m in range(1, 13):
        a = datetime(2025, m, 1)
        b = datetime(2025 + (m == 12), m % 12 + 1, 1) - timedelta(hours=1)
        d = get(f"{COOPS}/api/prod/datagetter?product=predictions&application=raw_surf_tide_eot20_check&station={sid}"
                f"&begin_date={a:%Y%m%d}%20{a:%H:%M}&end_date={b:%Y%m%d}%20{b:%H:%M}&datum=MSL&interval=h&units=metric"
                f"&time_zone=gmt&format=json")
        for p in d.get("predictions", []):
            out[datetime.strptime(p["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)] = float(p["v"])
    return out


def sun_h(t):
    T = (t - datetime(1899, 12, 31, 12, tzinfo=timezone.utc)).total_seconds() / 86400.0 / 36525.0
    return 279.69668 + 36000.76892 * T + 0.0003025 * T * T


def eot20(root):
    dest = root / "EOT20" / "ocean_tides"
    if len(list(dest.glob("*_ocean_eot20.nc"))) >= 17:
        return root
    dest.mkdir(parents=True, exist_ok=True)
    z = root / "eot20.zip"
    req = urllib.request.Request(EOT20_URL, headers={"User-Agent": "raw-surf-tide-eot20-check"})
    with urllib.request.urlopen(req, timeout=900) as r, open(z, "wb") as fh:
        shutil.copyfileobj(r, fh, 1 << 24)
    inner = root / "ocean_tides.zip"
    with zipfile.ZipFile(z) as zz:
        name = [m for m in zz.namelist() if Path(m).name == "ocean_tides.zip"][0]
        with zz.open(name) as s, open(inner, "wb") as d:
            shutil.copyfileobj(s, d, 1 << 24)
    z.unlink()
    with zipfile.ZipFile(inner) as zz:
        for m in zz.namelist():
            if m.endswith("_ocean_eot20.nc") and ".." not in m and not m.startswith("/"):
                with zz.open(m) as s, open(dest / Path(m).name, "wb") as d:
                    shutil.copyfileobj(s, d, 1 << 24)
    inner.unlink()
    log(f"EOT20 files: {sorted(p.name for p in dest.glob('*.nc'))}")
    return root


def arm_b(root, lat, lng, times, constituents=None):
    """Arm B exactly as the gate evaluates it (pyTMD defaults), optionally restricted to some constituents."""
    import pyTMD.compute
    d = np.array([np.datetime64(t.replace(tzinfo=None), "ns") for t in times])
    kw = {"constituents": constituents, "infer_minor": False} if constituents else {}
    v = pyTMD.compute.tide_elevations(np.array([lng]), np.array([lat]), d, directory=str(root), model="EOT20",
                                      type="time series", standard="datetime", crop=True, buffer=1.0,
                                      extrapolate=True, cutoff=10.0, **kw)
    return np.asarray(v, dtype=float).reshape(-1)


def monthly(times, vals):
    m = {}
    for t, v in zip(times, vals):
        m.setdefault(t.month, []).append(v)
    return [round(float(np.mean(m[k])), 3) for k in sorted(m)]


def fit_h(times, vals, k):
    """Fit A cos(k*h - G) + c to a series: returns (A, G deg)."""
    h = np.radians([k * sun_h(t) for t in times])
    X = np.column_stack([np.cos(h), np.sin(h), np.ones_like(h)])
    c, *_ = np.linalg.lstsq(X, np.asarray(vals), rcond=None)
    return float(np.hypot(c[0], c[1])), float(math.degrees(math.atan2(c[1], c[0])) % 360)


def main():
    root = eot20(Path("eot20_check_cache"))
    out = {}
    for sid, label in STATIONS.items():
        meta = get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}.json")["stations"][0]
        lat, lng = meta["lat"], meta["lng"]
        hc = {r["name"]: (float(r["amplitude"]), float(r["phase_GMT"]))
              for r in get(f"{COOPS}/mdapi/prod/webapi/stations/{sid}/harcon.json?units=metric")["HarmonicConstituents"]}
        sa, ssa = hc.get("SA", (0.0, 0.0)), hc.get("SSA", (0.0, 0.0))
        p = preds_2025(sid)
        ts = sorted(p)
        truth = np.array([p[t] for t in ts])
        b = arm_b(root, lat, lng, ts)
        b_lp = arm_b(root, lat, lng, ts, constituents=["sa", "ssa"])
        b_sa = arm_b(root, lat, lng, ts, constituents=["sa"])
        noaa_lp = np.array([sa[0] * math.cos(math.radians(sun_h(t) - sa[1])) + ssa[0] * math.cos(math.radians(2 * sun_h(t) - ssa[1]))
                            for t in ts])
        a_e, g_e = fit_h(ts, b_sa, 1)
        out[sid] = {
            "name": label,
            "rmse_coops_minus_B": round(float(np.sqrt(np.mean((truth - b) ** 2))), 4),
            "monthly_mean_coops_minus_B": monthly(ts, truth - b),
            "monthly_mean_B_sa_ssa": monthly(ts, b_lp),
            "monthly_mean_NOAA_sa_ssa": monthly(ts, noaa_lp),
            "eot20_SA_as_A_cos_h_minus_G": [round(a_e, 4), round(g_e, 1)],
            "noaa_SA_A_G": [sa[0], sa[1]],
            "SA_phase_diff_deg_eot20_minus_noaa": round((g_e - sa[1] + 180) % 360 - 180, 1),
        }
        log(json.dumps({sid: out[sid]}))
    print(json.dumps(out, indent=1))


if __name__ == "__main__":
    main()
