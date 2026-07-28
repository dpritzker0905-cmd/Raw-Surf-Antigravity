"""validate_nearshore_transform.py — measure the surf transform against INDEPENDENT observations.

WHY THIS EXISTS
---------------
Every accuracy loop in this repo validates the model's INPUT: `buoy_calibration.py` scores the
offshore Hs field against NDBC. Nothing has ever scored the transform's OUTPUT — what actually
happens to a wave between deep water and the surf zone. That gap is why the missing refraction
coefficient survived: the only evidence for it was a hand calculation, and the first attempt to
verify it fed Komar the same raw Hs the model uses, i.e. checked the formula against itself.

This tool cannot make that mistake. Neither side of its comparison is our model:

    measured_ratio = Hs(nearshore buoy) / Hs(deep buoy)          <- CDIP instruments, QC-flagged
    model_Ks       = shoaling_coefficient(Tp, nearshore depth)   <- our transform
    implied_Kr     = measured_ratio / model_Ks                   <- what the model is MISSING

The model assumes Kr = 1.0 everywhere. Anything else is measured error.

WHAT IT FOUND (2026-07-29, 385,651 QC-good swell hours, 10 independent California sites)
----------------------------------------------------------------------------------------
  * Kr median 0.797, range 0.612-1.031  => the transform over-predicts nearshore height by ~25%
    at the median site, and UNDER-predicts at one (Kr > 1 is real focusing).
  * Snell refraction over straight parallel contours does NOT explain it: predicted Kr spans only
    0.907-0.993 across the same sites and is ANTI-correlated with the measurement (r = -0.565).
    A site with near-normal incidence (theta 11.8 deg, Snell 0.993) measures 0.677.
  * Binned by incoming swell direction, Kr swings up to 1.75x AT A FIXED SITE -- larger than
    Snell's entire between-site range. One site focuses (1.30) from 150 deg and blocks (0.75)
    from 270 deg.
  => The deficit is DIRECTIONAL and SITE-SPECIFIC: island blocking + 2D bathymetric focusing,
     plus a smaller direction-independent loss (~15%) visible where the swing is flat.
  => A scalar Kr, and a Snell-law Kr, are both the wrong shape. The right shape is a directional
     transfer function Kr(site, direction) -- which is what CDIP's own MOP system computes.

USAGE
-----
    python backend/scripts/validate_nearshore_transform.py --discover     # find buoy pairs
    python backend/scripts/validate_nearshore_transform.py --measure      # implied Kr per site
    python backend/scripts/validate_nearshore_transform.py --directional  # Kr vs swell direction

Read-only: it fetches public CDIP data and writes only into --out (default: a scratch dir).
Station numbers are DISCOVERED from the catalogue, never recalled -- coordinates from memory have
been wrong repeatedly in this repo.

DATA SOURCE
-----------
CDIP (Coastal Data Information Program, Scripps/UCSD) THREDDS NetCDF Subset Service.
Public, no key. `waveFlagPrimary == 1` is CDIP's "good" QC flag; everything else is discarded.
"""
import argparse
import concurrent.futures as cf
import csv
import io
import json
import math
import os
import re
import statistics
import sys
import urllib.parse
import urllib.request

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

# A Windows console defaults to cp1252, which cannot encode the arrows and box characters this
# tool prints — and a crash on the FINAL summary line after a 20-minute fetch throws the run away.
try:                                                    # pragma: no cover - console-dependent
    sys.stdout.reconfigure(encoding="utf-8", errors="replace")
except (AttributeError, ValueError):
    pass

from services.weather_pipeline.surf_transform import shoaling_coefficient, wavenumber  # noqa: E402

THREDDS = "https://thredds.cdip.ucsd.edu/thredds"
NCSS = f"{THREDDS}/ncss/point/cdip/archive"
DODS = f"{THREDDS}/dodsC/cdip/archive"
CATALOG = f"{THREDDS}/catalog/cdip/archive/catalog.html"
UA = {"User-Agent": "raw-surf-nearshore-validation"}
G = 9.80665

# Pair-discovery bounds.
DEEP_MIN_M = 80.0        # deep enough that Hs ~= the offshore field the model consumes
SHALLOW_MAX_M = 30.0     # shallow enough that shoaling + refraction have visibly acted
MAX_SEP_KM = 40.0        # close enough to share a wave climate
# Sample filters.
MIN_TP_SWELL = 12.0      # swell-dominated: a coherent train that genuinely refracted
MIN_HS_M = 0.3           # ignore near-flat noise
MIN_SAMPLES = 200


def _get(url, timeout=300):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def list_stations():
    """Every archived CDIP station id, from the catalogue itself."""
    return sorted(set(re.findall(r"\d{3}p1", _get(CATALOG, timeout=180))))


def station_meta(stn):
    """{depth_m, lat, lng} from the newest deployment, via OPeNDAP's ascii interface (no netCDF lib)."""
    try:
        txt = _get(f"{DODS}/{stn}/{stn}_historic.nc.ascii"
                   "?metaWaterDepth,metaDeployLatitude,metaDeployLongitude", timeout=60)
    except Exception:
        return None

    def newest(name):
        m = re.search(rf"{name}\[\d+\]\s*\n([^\n]+)", txt)
        if not m:
            return None
        for v in reversed([v.strip() for v in m.group(1).split(",") if v.strip()]):
            try:
                f = float(v)
                if f == f:                      # reject NaN
                    return f
            except ValueError:
                continue
        return None

    d, la, lo = newest("metaWaterDepth"), newest("metaDeployLatitude"), newest("metaDeployLongitude")
    return None if None in (d, la, lo) else {"depth_m": d, "lat": la, "lng": lo}


def station_span(stn):
    """(first, last) ISO timestamps of a station's archive.

    ⚠️ Each buoy was deployed and retired on its own schedule, and querying outside that window is a
    hard HTTP 400 rather than an empty result (043p1's archive ends 2019-07)."""
    try:
        ts = sorted(set(re.findall(r"\d{4}-\d{2}-\d{2}T[\d:]+Z",
                                   _get(f"{NCSS}/{stn}/{stn}_historic.nc/dataset.html", timeout=90))))
    except Exception:
        return None, None
    return (ts[0], ts[-1]) if len(ts) >= 2 else (None, None)


def parse_csv(txt):
    """{iso_time: (hs, tp, dp)} for QC-good rows.

    ⚠️ THE STATION NAME CONTAINS AN UNQUOTED COMMA -- "TORREY PINES OUTER, CA BUOY - 100p1" -- so
    every data row carries one MORE field than the header and every column after `station` is shifted
    right by one. Indexing by header position silently reads waveDp as the QC flag and discards 100%
    of rows while reporting success. The TRAILING columns are fixed, so index from the RIGHT."""
    out = {}
    rd = csv.reader(io.StringIO(txt))
    next(rd, None)                                     # header
    for row in rd:
        if len(row) < 8:
            continue
        try:
            if int(float(row[-1])) != 1:               # waveFlagPrimary: 1 = good
                continue
            out[row[0]] = (float(row[-4]), float(row[-3]), float(row[-2]))    # hs, tp, dp
        except (ValueError, IndexError):
            continue
    return out


def series(stn, t0, t1):
    qs = urllib.parse.urlencode({"var": "waveHs", "time_start": t0, "time_end": t1, "accept": "csv"})
    qs += "&var=waveTp&var=waveDp&var=waveFlagPrimary"
    return parse_csv(_get(f"{NCSS}/{stn}/{stn}_historic.nc?{qs}", timeout=600))


def haversine_km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = math.radians(lat2 - lat1), math.radians(lng2 - lng1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * 6371.0 * math.asin(math.sqrt(h))


def find_pairs(meta):
    """Nearshore stations matched to their nearest deep station. Pure -> unit-testable."""
    deep = {k: v for k, v in meta.items() if v["depth_m"] >= DEEP_MIN_M}
    shallow = {k: v for k, v in meta.items() if 0 < v["depth_m"] <= SHALLOW_MAX_M}
    pairs = []
    for s, sv in shallow.items():
        best, best_km = None, None
        for d, dv in deep.items():
            km = haversine_km(sv["lat"], sv["lng"], dv["lat"], dv["lng"])
            if best_km is None or km < best_km:
                best, best_km = d, km
        if best and best_km <= MAX_SEP_KM:
            pairs.append({"near": s, "near_depth_m": sv["depth_m"], "near_lat": sv["lat"],
                          "near_lng": sv["lng"], "deep": best, "deep_depth_m": deep[best]["depth_m"],
                          "deep_lat": deep[best]["lat"], "deep_lng": deep[best]["lng"],
                          "sep_km": round(best_km, 2)})
    return sorted(pairs, key=lambda p: p["sep_km"])


def snell_kr(theta0_deg, period_s, depth_m):
    """Refraction coefficient over straight parallel contours: Kr = sqrt(cos t0 / cos tb),
    sin(tb)/C_b = sin(t0)/C_0. Always <= 1 -- it can never focus, which is one reason it cannot
    explain the measurements (see the module docstring). None when undefined."""
    if period_s is None or depth_m is None or period_s <= 0 or depth_m <= 0:
        return None
    th0 = math.radians(min(abs(theta0_deg), 89.0))
    k = wavenumber(period_s, depth_m)
    if not k or k <= 0:
        return None
    c_b = (2.0 * math.pi / k) / period_s
    c_0 = G * period_s / (2.0 * math.pi)
    s = (c_b / c_0) * math.sin(th0)
    if not -1.0 < s < 1.0:
        return None
    cos_b = math.cos(math.asin(s))
    if cos_b <= 0:
        return None
    return math.sqrt(math.cos(th0) / cos_b)


def implied_kr_samples(near_series, deep_series, near_depth_m):
    """[(kr, swell_dir_deg, tp)] over hours both buoys report QC-good, swell-dominated data.
    Pure -> unit-testable."""
    out = []
    for t in set(near_series) & set(deep_series):
        hn = near_series[t][0]
        hd, td, dpd = deep_series[t]
        if hd < MIN_HS_M or hn <= 0 or td < MIN_TP_SWELL:
            continue
        ks = shoaling_coefficient(td, near_depth_m)
        if not ks or ks <= 0:
            continue
        out.append(((hn / hd) / ks, dpd, td))
    return out


def _pair_series(pair):
    an0, an1 = station_span(pair["near"])
    ad0, ad1 = station_span(pair["deep"])
    if not an0 or not ad0:
        raise RuntimeError("no archive span")
    t0, t1 = max(an0, ad0), min(an1, ad1)              # the OVERLAP of both deployments
    if t0 >= t1:
        raise RuntimeError(f"no overlap ({an0[:7]}..{an1[:7]} vs {ad0[:7]}..{ad1[:7]})")
    return series(pair["near"], t0, t1), series(pair["deep"], t0, t1)


def measure(pair):
    try:
        sn, sd = _pair_series(pair)
    except Exception as e:
        return {"pair": f"{pair['deep']}->{pair['near']}", "error": str(e)[:70]}
    samples = implied_kr_samples(sn, sd, pair["near_depth_m"])
    if len(samples) < MIN_SAMPLES:
        return {"pair": f"{pair['deep']}->{pair['near']}", "error": f"only {len(samples)} samples"}
    krs = [s[0] for s in samples]
    q = statistics.quantiles(krs, n=4)
    return {"pair": f"{pair['deep']}->{pair['near']}", "near": pair["near"], "deep": pair["deep"],
            "near_depth_m": pair["near_depth_m"], "sep_km": pair["sep_km"], "n": len(krs),
            "kr_median": round(statistics.median(krs), 4),
            "kr_p25": round(q[0], 4), "kr_p75": round(q[2], 4)}


def directional(pair, bin_deg=15, min_bin=150):
    """Median implied Kr per incoming-swell-direction bin, and the swing across bins."""
    try:
        sn, sd = _pair_series(pair)
    except Exception as e:
        return {"pair": f"{pair['deep']}->{pair['near']}", "error": str(e)[:70]}
    bins = {}
    for kr, dp, _tp in implied_kr_samples(sn, sd, pair["near_depth_m"]):
        bins.setdefault(int(dp // bin_deg) * bin_deg, []).append(kr)
    meds = {d: round(statistics.median(v), 3) for d, v in sorted(bins.items()) if len(v) >= min_bin}
    if len(meds) < 3:
        return {"pair": f"{pair['deep']}->{pair['near']}", "error": "too few populated bins"}
    lo = min(meds, key=meds.get)
    hi = max(meds, key=meds.get)
    return {"pair": f"{pair['deep']}->{pair['near']}", "near": pair["near"], "bins": meds,
            "n": sum(len(v) for v in bins.values()),
            "kr_min": meds[lo], "dir_min": lo, "kr_max": meds[hi], "dir_max": hi,
            "swing": round(meds[hi] / meds[lo], 3) if meds[lo] else None}


# ── HORIZON BLOCKING ────────────────────────────────────────────────────────────────────────────
# Tested against the measurements above: this reproduces the DIRECTIONAL SHAPE of Kr well at sites
# with large obstructions (r = -0.87 to -0.90 at 153p1 / 215p1 / 103p1, including the full 1.75x
# swing at the focusing site) and fails where the obstruction is small (155p1, r = +0.10 — the
# Coronado Islands are ~2 km across and a 0.25 deg cell is ~28 km).
#
# ⚠️ FITTING Kr = A_site * (1 - B * shadow) over those sites gives A in 0.743..1.250 (median 0.852)
# and B in -0.031..0.343 (median 0.135). THE SITE OFFSET `A` IS THE DOMINANT TERM AND THE HORIZON
# CANNOT SUPPLY IT. A ray-cast alone therefore buys the directional ~13% (median), NOT the bulk of
# the error — which is the opposite of what the roadmap assumed before this was measured.
SHADOW_SPREAD_DEG = 25.0     # real swell arrives over a directional spread, not as a single ray
SHADOW_SUBRAYS = 11
SHADOW_START_KM = 15.0       # skip the buoy's own shoreline cell
SHADOW_MAX_KM = 300.0
SHADOW_STEP_KM = 10.0


def _bathy_grid():
    """(grid, meta) for the bundled 0.25 deg ETOPO depth asset. meta: '0 == land/no-depth'."""
    import numpy as np
    d = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                     "services", "weather_pipeline", "data")
    return np.load(os.path.join(d, "etopo_depth_0p25.npy")), \
        json.load(open(os.path.join(d, "etopo_depth_0p25.meta.json")))


def is_land(grid, meta, lat, lng):
    lng = ((lng + 180.0) % 360.0) - 180.0
    r = int(round((lat - meta["lat0"]) / meta["dlat"]))
    c = int(round((lng - meta["lon0"]) / meta["dlon"]))
    if r < 0 or r >= meta["nlat"] or c < 0 or c >= meta["nlon"]:
        return False
    return int(grid[r, c]) == 0


def blocked_along(grid, meta, lat, lng, bearing_deg,
                  start_km=SHADOW_START_KM, max_km=SHADOW_MAX_KM, step_km=SHADOW_STEP_KM):
    """Is land hit looking TOWARD `bearing_deg` — the direction the swell arrives FROM?"""
    b = math.radians(bearing_deg)
    coslat = max(0.15, math.cos(math.radians(lat)))
    d = start_km
    while d <= max_km:
        la = lat + (d / 111.0) * math.cos(b)
        lo = lng + (d / (111.0 * coslat)) * math.sin(b)
        if abs(la) <= 90.0 and is_land(grid, meta, la, lo):
            return True
        d += step_km
    return False


def shadow_fraction(grid, meta, lat, lng, bearing_deg,
                    spread_deg=SHADOW_SPREAD_DEG, n_sub=SHADOW_SUBRAYS, **kw):
    """Fraction of a +/-spread directional window blocked by land. 0 = wide open, 1 = fully shadowed."""
    hits = 0
    for i in range(n_sub):
        off = -spread_deg + 2.0 * spread_deg * i / (n_sub - 1)
        if blocked_along(grid, meta, lat, lng, (bearing_deg + off) % 360.0, **kw):
            hits += 1
    return hits / n_sub


def fit_shadow_model(bins, lat, lng, grid, meta):
    """Least-squares fit of Kr ~ A * (1 - B * shadow) over a site's direction bins.
    Returns {A, B, r, n} — A is the open-water offset, B the blocking sensitivity. Pure given a grid."""
    pts = [(shadow_fraction(grid, meta, lat, lng, float(d) + 7.5), kr) for d, kr in bins.items()]
    if len(pts) < 4:
        return None
    xs = [p[0] for p in pts]
    ys = [p[1] for p in pts]
    mx, my = statistics.mean(xs), statistics.mean(ys)
    sxx = sum((a - mx) ** 2 for a in xs)
    if sxx <= 0:
        return {"A": round(my, 4), "B": 0.0, "r": None, "n": len(pts), "note": "shadow constant"}
    sxy = sum((a - mx) * (b - my) for a, b in zip(xs, ys))
    slope = sxy / sxx
    icpt = my - slope * mx
    syy = sum((b - my) ** 2 for b in ys)
    r = sxy / math.sqrt(sxx * syy) if syy > 0 else None
    return {"A": round(icpt, 4), "B": round(-slope / icpt, 4) if icpt else None,
            "r": round(r, 4) if r is not None else None, "n": len(pts)}


def _load_or_discover(out_dir, workers):
    path = os.path.join(out_dir, "cdip_pairs.json")
    if os.path.exists(path):
        return json.load(open(path))
    stations = list_stations()
    print(f"probing {len(stations)} CDIP stations for depth + position ...")
    meta = {}
    with cf.ThreadPoolExecutor(max_workers=workers) as ex:
        for stn, m in zip(stations, ex.map(station_meta, stations)):
            if m:
                meta[stn] = m
    pairs = find_pairs(meta)
    os.makedirs(out_dir, exist_ok=True)
    json.dump(pairs, open(path, "w"), indent=1)
    print(f"  resolved {len(meta)} stations -> {len(pairs)} offshore/nearshore pairs -> {path}")
    return pairs


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--discover", action="store_true", help="find offshore/nearshore buoy pairs")
    ap.add_argument("--measure", action="store_true", help="implied Kr per site")
    ap.add_argument("--directional", action="store_true", help="Kr binned by swell direction")
    ap.add_argument("--shadow", action="store_true",
                    help="fit Kr ~ A*(1 - B*shadow) — does horizon blocking explain the direction?")
    ap.add_argument("--out", default=os.path.join(os.path.dirname(os.path.abspath(__file__)),
                                                  "..", "..", ".nearshore-validation"))
    ap.add_argument("--workers", type=int, default=5)
    ap.add_argument("--limit", type=int, default=0, help="only the N closest pairs")
    a = ap.parse_args(argv)
    if not (a.discover or a.measure or a.directional or a.shadow):
        ap.error("choose --discover, --measure, --directional and/or --shadow")

    out_dir = os.path.abspath(a.out)
    pairs = _load_or_discover(out_dir, a.workers)
    if a.limit:
        pairs = pairs[:a.limit]
    if a.discover:
        print(f"\n{'near':>8} {'depth':>7} | {'deep':>8} {'depth':>8} | {'sep km':>7}")
        for p in pairs:
            print(f"{p['near']:>8} {p['near_depth_m']:7.1f} | {p['deep']:>8} "
                  f"{p['deep_depth_m']:8.1f} | {p['sep_km']:7.1f}")

    if a.measure:
        print(f"\n{'=' * 92}\nIMPLIED Kr = measured_ratio / model_Ks  (the model assumes Kr = 1.000)\n{'=' * 92}")
        rows = []
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for r in ex.map(measure, pairs):
                if "error" in r:
                    print(f"  {r['pair']:<16} SKIP  {r['error']}")
                else:
                    rows.append(r)
        print(f"\n{'pair':<16} {'depth':>7} {'sep km':>7} {'n':>8} | {'Kr p25':>7} {'Kr MED':>7} {'Kr p75':>7}")
        for r in sorted(rows, key=lambda x: x["kr_median"]):
            print(f"{r['pair']:<16} {r['near_depth_m']:7.1f} {r['sep_km']:7.1f} {r['n']:8d} | "
                  f"{r['kr_p25']:7.3f} {r['kr_median']:7.3f} {r['kr_p75']:7.3f}")
        if rows:
            meds = [r["kr_median"] for r in rows]
            print(f"\n  {len(rows)} sites, {sum(r['n'] for r in rows):,} swell hours")
            print(f"  Kr  min {min(meds):.3f}  median {statistics.median(meds):.3f}  max {max(meds):.3f}"
                  f"   ({sum(1 for m in meds if m > 1)} site(s) FOCUS above 1.0)")
        json.dump(rows, open(os.path.join(out_dir, "kr_measured.json"), "w"), indent=1)

    if a.directional:
        print(f"\n{'=' * 92}\nKr BY INCOMING SWELL DIRECTION -- blocking swings, friction does not\n{'=' * 92}")
        rows = []
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for r in ex.map(directional, pairs):
                if "error" not in r:
                    rows.append(r)
        for r in sorted(rows, key=lambda x: -(x["swing"] or 0)):
            print(f"\n-- {r['pair']}  ({r['n']:,} swell hours) --")
            print("   " + "  ".join(f"{d}deg:{m:.2f}" for d, m in r["bins"].items()))
            print(f"   SWING {r['kr_min']:.3f} @ {r['dir_min']}deg -> {r['kr_max']:.3f} "
                  f"@ {r['dir_max']}deg = {r['swing']}x")
        if rows:
            sw = [r["swing"] for r in rows if r["swing"]]
            print(f"\n  median directional swing {statistics.median(sw):.2f}x across {len(sw)} sites")
        json.dump(rows, open(os.path.join(out_dir, "kr_directional.json"), "w"), indent=1)

    if a.shadow:
        print(f"\n{'=' * 92}\nDOES HORIZON BLOCKING EXPLAIN THE DIRECTION?  Kr ~ A * (1 - B * shadow)"
              f"\n{'=' * 92}")
        grid, meta = _bathy_grid()
        by_near = {p["near"]: p for p in pairs}
        rows = []
        with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
            for r in ex.map(directional, pairs):
                if "error" in r:
                    continue
                p = by_near.get(r["near"])
                fit = fit_shadow_model(r["bins"], p["near_lat"], p["near_lng"], grid, meta)
                if fit:
                    rows.append({**fit, "pair": r["pair"], "near": r["near"]})
        print(f"\n{'site':<9} {'dirs':>5} {'A (open-water Kr)':>19} {'B (blocking gain)':>19} {'r':>8}")
        for r in sorted(rows, key=lambda x: x["A"]):
            rr = f"{r['r']:+.3f}" if r["r"] is not None else "   -  "
            bb = f"{r['B']:.3f}" if r["B"] is not None else "   -  "
            print(f"{r['near']:<9} {r['n']:5d} {r['A']:19.3f} {bb:>19} {rr:>8}")
        if rows:
            As = [r["A"] for r in rows]
            Bs = [r["B"] for r in rows if r["B"] is not None]
            print(f"\n  A (site offset)   min {min(As):.3f}  median {statistics.median(As):.3f}  "
                  f"max {max(As):.3f}   <- NOT obtainable from the horizon")
            print(f"  B (blocking gain) min {min(Bs):.3f}  median {statistics.median(Bs):.3f}  "
                  f"max {max(Bs):.3f}   <- computable globally")
            print("\n  => the SITE OFFSET dominates. A ray-cast alone buys the directional term only.")
        json.dump(rows, open(os.path.join(out_dir, "kr_shadow_fit.json"), "w"), indent=1)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
