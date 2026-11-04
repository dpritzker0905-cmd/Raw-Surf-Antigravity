"""r7_run.py - round 7: every Hs-moving fix ON through the evaluation harness on HISTORICAL windows (scratch).
Chain = C:/t/r7c (dev 8a401da41 + #706 7bad5ab74 + #707 6a5258515, local only). Run-time patches only:
 (1) truth: eval_reference.fetch_station reads CDIP archive `_historic.nc` hyperslabs (+ realtime where it covers)
     and NDBC historical stdmet (99/999 sentinels -> MM) for windows older than the realtime files;
 (2) SURF_BIGHT_HS_CONSENSUS: the bhc/r5_arms.py input substitution (production compose on each GFS crop, EURO WAM
     0.25 swh same cycle/step; no 06/18 EURO wave before 2026 -> the previous 00/12 run at step+6, the latest-run
     pick production makes); 'bhc@w' = EURO weight w, emulated by feeding E' = G + 2w(E - G) (>= 0) to the 0.5 compose.
Usage: python r7_run.py OUT START END CACHE "arm;arm;..." """
import gzip
import json
import os
import sys
from datetime import datetime, timedelta, timezone

BACKEND = r"C:\t\r7c\backend"
sys.path.insert(0, BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
R4 = (r"C:\Users\David\AppData\Local\Temp\claude\C--Users-David-App-raw-surf\3285d99c-2bfe-40f6-8698-6474419931cc"
      r"\scratchpad\research\round4")
sys.path.insert(0, R4)
import numpy as np  # noqa: E402
import eccodes  # noqa: E402
import eval_harness as eh  # noqa: E402
from services.weather_pipeline import eval_reference as rf  # noqa: E402
from services.weather_pipeline import bight_hs_consensus as B  # noqa: E402
from services.weather_pipeline import eval_replay as rp  # noqa: E402
from services.weather_pipeline.schemas import GridVector  # noqa: E402
import fetch_arms as fa  # noqa: E402

HERE = os.path.dirname(os.path.abspath(__file__))
INV = json.load(open(os.path.join(HERE, "cdip_inventory.json")))
COUNT = {}


def bump(k, n=1):
    COUNT[k] = COUNT.get(k, 0) + n


def iso(s):
    return datetime.strptime(s, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


# ---------------- truth ----------------
CDIP_H = "https://thredds.cdip.ucsd.edu/thredds/dodsC/cdip/archive/{id}/{id}_historic.nc.ascii"
NDBC_H = "https://www.ndbc.noaa.gov/data/historical/stdmet/{id}h{y}.txt.gz"
_orig_fetch = rf.fetch_station
SENT = {"WDIR": ("999",), "MWD": ("999",), "WSPD": ("99.0",), "GST": ("99.0",), "WVHT": ("99.00", "99.0"),
        "DPD": ("99.00", "99.0"), "APD": ("99.00", "99.0"), "PRES": ("9999.0",), "ATMP": ("999.0",),
        "WTMP": ("999.0",), "DEWP": ("999.0",), "VIS": ("99.0",), "TIDE": ("99.00",)}


def ndbc_clean(txt):
    out, cols = [], None
    for ln in txt.splitlines():
        if ln.startswith("#"):
            if cols is None:
                cols = ln.lstrip("#").split()
            out.append(ln)
            continue
        p = ln.split()
        if cols and len(p) == len(cols):
            p = ["MM" if c in SENT and v in SENT[c] else v for c, v in zip(cols, p)]
        out.append(" ".join(p))
    return "\n".join(out)


def fetch_station(cache, station, window, ndbc_meta=None, with_spectra=True):
    sid, (t_lo, t_hi) = station["id"], window
    if station["source"] == "cdip":
        inv = INV.get(sid, {})
        rt = (inv.get("rt") or {}).get("start")
        obs, recs = [], []
        if rt is None or t_lo < iso(rt):
            if inv.get("hist"):
                tb, r0 = cache.fetch(f"cdip/{sid}/hist_time.ascii", CDIP_H.format(id=sid) + "?waveTime",
                                     source="cdip_archive_time", parser="eval_reference._ascii_series",
                                     time_standard=rf.CDIP_TIME)
                tt = rf._ascii_series(tb.decode("utf-8", "replace"), "waveTime")
                lo, hi = t_lo.timestamp(), t_hi.timestamp()
                idx = [i for i, x in enumerate(tt) if lo <= x <= hi]
                if idx:
                    a, b = idx[0], idx[-1]
                    q = ",".join(f"{v}[{a}:1:{b}]" for v in ("waveTime", "waveHs", "waveTp", "waveDp",
                                                             "waveFlagPrimary"))
                    body, r2 = cache.fetch(f"cdip/{sid}/hist_{a}_{b}.ascii", CDIP_H.format(id=sid) + "?" + q,
                                           source="cdip_archive", parser="eval_reference.parse_cdip_ascii",
                                           time_standard=rf.CDIP_TIME, qc_policy="waveFlagPrimary 1 only")
                    obs += rf.parse_cdip_ascii(body.decode("utf-8", "replace"))
                    recs += [r0, r2]
                    bump("cdip_hist_" + sid)
        if rt is not None and t_hi >= iso(rt):
            try:
                got = _orig_fetch(cache, station, window, ndbc_meta, with_spectra=False)
                obs += got["obs"]
                recs += got["records"]
                bump("cdip_rt_" + sid)
            except Exception:  # noqa: BLE001 - counted
                bump("cdip_rt_fail_" + sid)
        obs.sort(key=lambda o: o["time"])
        return {"obs": obs, "meta": {"version": f"cdip:{sid}:r7", "depth_m": station.get("depth_m")},
                "extra": {"failed": []}, "records": recs}
    if t_hi >= datetime.now(timezone.utc) - timedelta(days=45):    # recent window: realtime2 (climatology span partial)
        return _orig_fetch(cache, station, window, ndbc_meta, with_spectra=False)
    obs, recs = [], []
    for y in range(t_lo.year, t_hi.year + 1):
        try:
            raw, r = cache.fetch(f"ndbc/{sid}/h{y}.txt.gz", NDBC_H.format(id=sid.lower(), y=y),
                                 source="ndbc_historical_stdmet", parser="eval_reference.parse_ndbc_stdmet",
                                 time_standard=rf.NDBC_TIME, qc_policy="NDBC historical QC; 99/999 -> missing")
            obs += rf.parse_ndbc_stdmet(ndbc_clean(gzip.decompress(raw).decode("utf-8", "replace")))
            recs.append(r)
            bump("ndbc_hist_ok")
        except Exception:  # noqa: BLE001 - counted
            bump("ndbc_hist_fail_" + sid)
    obs.sort(key=lambda o: o["time"])
    return {"obs": obs, "meta": {"version": f"ndbc:{sid}:hist"}, "extra": {"failed": []}, "records": recs}


rf.fetch_station = fetch_station

# ---------------- EURO input substitution (bhc/r5_arms.py) ----------------
fa.DEU = os.environ.get("R7_EURO_DIR", os.path.join(HERE, "euro"))
os.makedirs(fa.DEU, exist_ok=True)
_g = {}


def read_swh(path):
    if path in _g:
        return _g[path]
    out = None
    if os.path.exists(path):
        with open(path, "rb") as f:
            while True:
                h = eccodes.codes_grib_new_from_file(f)
                if h is None:
                    break
                if eccodes.codes_get(h, "shortName") == "swh":
                    def g(k):
                        return eccodes.codes_get(h, k)
                    ni, nj = g("Ni"), g("Nj")
                    la0, la1 = g("latitudeOfFirstGridPointInDegrees"), g("latitudeOfLastGridPointInDegrees")
                    v = eccodes.codes_get_values(h).reshape(nj, ni).astype(float)
                    if g("bitmapPresent"):
                        v[v == g("missingValue")] = np.nan
                    v[v > 9000] = np.nan
                    if la0 > la1:
                        v, la0 = v[::-1, :].copy(), la1
                    out = (v, dict(ni=ni, nj=nj, lat_south=la0, lon_west=g("longitudeOfFirstGridPointInDegrees") % 360.0,
                                   dlat=g("jDirectionIncrementInDegrees"), dlon=g("iDirectionIncrementInDegrees")))
                eccodes.codes_release(h)
    if len(_g) > 40:
        _g.pop(next(iter(_g)))
    _g[path] = out
    return out


def euro_field(c, fh):
    for cc, ff in ((c, fh), (c - timedelta(hours=6), fh + 6)):
        p = os.path.join(fa.DEU, f"{cc:%Y%m%d%H}_f{ff:03d}.grib2")
        if not os.path.exists(p) and os.environ.get("R7_OFFLINE") != "1" and cc.hour in (0, 12):
            try:
                fa.euro(cc, ff)
            except Exception:  # noqa: BLE001
                bump("euro_fetch_err")
        f = read_swh(p)
        if f is not None:
            bump("euro_same_cycle" if cc == c else "euro_prev_cycle")
            return f
    return None


def node(field, lat, lng):
    v, m = field
    i = int(round((lat - m["lat_south"]) / m["dlat"]))
    j = int(round(((lng % 360.0) - m["lon_west"]) / m["dlon"])) % m["ni"]
    if not (0 <= i < m["nj"]):
        return None
    x = v[i, j]
    return float(x) if np.isfinite(x) else None


def euro_product(m25, field, w):
    vs = []
    for g in m25.grid.vectors:
        e = node(field, g.lat, g.lng)
        if e is None:
            vs.append(GridVector(lat=g.lat, lng=g.lng, speed=0.0, direction=0.0, u=0.0, v=0.0, period=0.0,
                                 is_valid=False))
            continue
        if g.is_valid and g.speed is not None and w != 0.5:
            e = max(0.0, g.speed + 2 * w * (e - g.speed))
        k = e / g.speed if g.is_valid and g.speed > 0 else 0.0
        vs.append(GridVector(lat=g.lat, lng=g.lng, speed=round(e, 4), direction=g.direction, u=round(g.u * k, 4),
                             v=round(g.v * k, 4), period=g.period or 10.0, is_valid=True))
    grid = m25.grid.model_copy(update={"vectors": vs})
    return m25.model_copy(update={"model": "EURO", "provider": "ecmwf_open_data", "grid": grid,
                                  "product_id": "euro-open-data"})


def arm_marine(a, j, m25):
    if a.split("@")[0] != "bhc":
        return m25
    w = float(a.split("@")[1]) if "@" in a else 0.5
    field = euro_field(j["cycle"], j["fh"])
    if field is None:
        bump("no_euro")
        return m25
    out = B.compose(m25, lambda la, lo, p=euro_product(m25, field, w): p)
    if out is None:
        bump("jobs_unchanged")
        return m25
    bump("jobs_composed")
    return out


ARM_JOBS, ARMS = {}, []
_orig_stage, _orig_replay = eh.stage_forecast, rp.replay_arm


def stage_forecast(*a, **k):
    jobs, fc = _orig_stage(*a, **k)
    for arm in ARMS:
        ARM_JOBS[arm] = [dict(j, products=dict(j["products"], marine=arm_marine(arm, j, j["products"]["marine"])))
                         for j in jobs]
    return jobs, fc


def replay_arm(arm, env, scrub, jobs, tides, stations):
    key = env.get("R5_ARM")
    return _orig_replay(arm, env, scrub, ARM_JOBS[key] if key else jobs, tides, stations)


eh.stage_forecast, rp.replay_arm = stage_forecast, replay_arm


def main(out, start, end, cache, arms):
    for x in arms:
        for kv in x.split(","):
            if kv.startswith("R5_ARM="):
                ARMS.append(kv.split("=", 1)[1])
    ARMS[:] = sorted(set(ARMS))
    argv = ["run", "--stations", os.path.join(HERE, os.environ.get("R7_STATIONS", "stations_r7.json")),
            "--start", start, "--end", end, "--cache-dir", cache, "--out", out, "--decoder", "eccodes",
            "--exit-zero", "--pause-s", "0.1"]
    if os.environ.get("R7_OFFLINE") == "1":
        argv.append("--offline")
    for x in arms:
        argv += ["--arm", x]
    rc = eh.main(argv)
    os.makedirs(out, exist_ok=True)
    json.dump(COUNT, open(os.path.join(out, "r7_counts.json"), "w"), indent=1)
    print("COUNT", COUNT)
    return rc


if __name__ == "__main__":
    sys.exit(main(sys.argv[1], sys.argv[2], sys.argv[3], sys.argv[4], sys.argv[5].split(";")))
