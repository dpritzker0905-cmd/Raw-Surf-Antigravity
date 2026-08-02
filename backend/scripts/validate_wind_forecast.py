#!/usr/bin/env python3
"""
validate_wind_forecast.py — score our FORECAST wind against NDBC's OBSERVED wind, and price what
that error costs the served rating.

WHY THIS EXISTS (measured 2026-08-02). Wind is the single highest-sensitivity input to the surf
rating: it is 0.60 of the quality blend AND a multiplicative veto (`wind_gate`). Nothing in this
repo had ever measured our wind error. A 5-buoy spot check found all three models UNDER-reading
(GFS -3.3 kt, EURO -4.5, ICON -6.1 mean bias) with a worst case of 3.4 kt forecast against 17.5 kt
observed. That sample is far too small to act on, and this script is the instrument that replaces it.

Design mirrors `validate_nearshore_transform.py`: read-only, no DB, no writes to a served artifact.
It answers two questions, and the SECOND is the one that decides anything:

  1. SKILL   — per model: signed bias, |error| percentiles, and ANGULAR direction error.
  2. IMPACT  — holding surf height and period FIXED at the model's own values and swapping ONLY the
               wind, how often does the served rating LEVEL move? A wind error that never moves a
               level is a curiosity; one that moves 30% of them is a product defect.

★ Isolating the wind term is deliberate. Feeding the buoy's own WVHT/DPD as well would conflate wave
error with wind error and answer neither question. The Jacobian asks about ONE variable at a time.

⚠️ A buoy is a POINT and offshore; a model cell is an AREA and the rating wants wind AT THE BREAK.
So this measures MODEL SKILL against the best available truth — it is not a claim that the buoy
reading is what the surfer feels. Stations are age-gated by `parse_ndbc_wind` (per-sensor staleness
is real: station 44025 was serving 19-day-old wind beside current waves on 2026-08-02).

USAGE
    python scripts/validate_wind_forecast.py --limit 40
    python scripts/validate_wind_forecast.py --limit 60 --models GFS,EURO --json out.json
"""
import argparse, json, math, os, sys, urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), ".."))

from services.weather_pipeline.buoy_calibration import (          # noqa: E402
    WIND_OBS_MAX_AGE_MIN, compare_wind_to_model, parse_latest_obs_wind,
)
from services.weather_pipeline import surf_rating as SR          # noqa: E402  ATTRIBUTE read
from services.weather_pipeline.surf_rating import (               # noqa: E402
    rating_score, score_to_level,
)

LATEST_OBS = "https://www.ndbc.noaa.gov/data/latest_obs/latest_obs.txt"
DEFAULT_API = os.environ.get("RAW_SURF_API", "https://raw-surf-antigravity.onrender.com")


def _get(url, timeout=45):
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf-wind-validator"})
    with urllib.request.urlopen(req, timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def pct(vals, q):
    if not vals:
        return None
    s = sorted(vals)
    return s[min(len(s) - 1, int(q * len(s)))]


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--limit", type=int, default=40, help="max stations to score")
    ap.add_argument("--models", default="GFS,EURO,ICON")
    ap.add_argument("--api", default=DEFAULT_API)
    ap.add_argument("--max-age-min", type=float, default=None)
    ap.add_argument("--json", default=None, help="write the full row set here")
    args = ap.parse_args()
    models = [m.strip().upper() for m in args.models.split(",") if m.strip()]

    now = datetime.now(timezone.utc)
    vt = now.replace(minute=0, second=0, microsecond=0).strftime("%Y-%m-%dT%H:00:00Z")
    stations = parse_latest_obs_wind(_get(LATEST_OBS), now=now, max_age_min=args.max_age_min)
    print("valid_time            : %s" % vt)
    print("stations with FRESH wind (age gate %.0f min): %d" %
          (args.max_age_min if args.max_age_min is not None else WIND_OBS_MAX_AGE_MIN, len(stations)))
    if not stations:
        print("REFUSING to report: no fresh observations. (Not 'the models are perfect'.)")
        return 1

    # Spread the sample over longitude so one basin cannot carry the result.
    stations.sort(key=lambda s: s["lon"])
    step = max(1, len(stations) // args.limit)
    sample = stations[::step][:args.limit]
    print("scoring               : %d stations x %d models\n" % (len(sample), len(models)))

    err = {m: [] for m in models}
    derr = {m: [] for m in models}
    lvl_moved = {m: 0 for m in models}
    lvl_total = {m: 0 for m in models}
    rows = []

    for st in sample:
        for m in models:
            try:
                d = json.loads(_get("%s/api/weather/point?model=%s&domain=wind&layer=wind"
                                    "&lat=%s&lng=%s&valid_time=%s"
                                    % (args.api, m, st["lat"], st["lon"], vt)))
            except Exception:
                continue
            p = d.get("point") or {}
            fkt, fdir = p.get("speed"), p.get("direction")
            if fkt is None:
                continue
            c = compare_wind_to_model(st, float(fkt), fdir)
            if not c:
                continue
            err[m].append(c["wspd_err_kt"])
            if c["wdir_err_deg"] is not None:
                derr[m].append(c["wdir_err_deg"])

            # IMPACT: same height, same period, same everything — ONLY the wind differs.
            try:
                mar = json.loads(_get("%s/api/weather/point?model=%s&domain=marine&layer=waves"
                                      "&lat=%s&lng=%s&valid_time=%s"
                                      % (args.api, m, st["lat"], st["lon"], vt)))
                mp = mar.get("point") or {}
                h = mp.get("surf_height_m") or mp.get("speed")
                tp = mp.get("period")
            except Exception:
                h = tp = None
            if h and tp:
                sf = rating_score(float(h), float(tp), float(fkt) / SR.MS_TO_KT)      # forecast wind
                so = rating_score(float(h), float(tp), st["wspd_ms"])              # observed wind
                lf, lo = score_to_level(sf), score_to_level(so)
                lvl_total[m] += 1
                if lf != lo:
                    lvl_moved[m] += 1
                c.update({"score_forecast_wind": round(sf, 1), "score_observed_wind": round(so, 1),
                          "level_forecast_wind": lf, "level_observed_wind": lo})
            c.update({"station": st["id"], "lat": st["lat"], "lon": st["lon"], "model": m})
            rows.append(c)

    print("=== 1. SKILL — forecast minus observed wind SPEED (knots) ===")
    for m in models:
        a = err[m]
        if not a:
            print("  %-5s no samples" % m); continue
        ab = [abs(x) for x in a]
        print("  %-5s n=%-4d bias %+6.2f   |err| p50 %5.2f  p90 %5.2f  max %5.2f"
              % (m, len(a), sum(a) / len(a), pct(ab, .5), pct(ab, .9), max(ab)))
    print("\n=== 1b. SKILL — wind DIRECTION, angular error (degrees) ===")
    for m in models:
        a = derr[m]
        if a:
            print("  %-5s n=%-4d p50 %5.1f  p90 %5.1f  max %5.1f" % (m, len(a), pct(a, .5), pct(a, .9), max(a)))

    print("\n=== 2. IMPACT — swap ONLY the wind; does the served LEVEL move? ===")
    for m in models:
        t = lvl_total[m]
        if t:
            print("  %-5s LEVEL changed on %d/%d = %.1f%% of spot-hours" % (m, lvl_moved[m], t, 100.0 * lvl_moved[m] / t))
        else:
            print("  %-5s no paired marine sample" % m)

    print("\nCAVEAT: a buoy is an offshore POINT, a model cell is an AREA, and the rating wants wind")
    print("        AT THE BREAK. This scores MODEL SKILL against the best available truth.")
    if args.json:
        with open(args.json, "w", encoding="utf-8") as fh:
            json.dump({"valid_time": vt, "n_stations": len(sample), "rows": rows}, fh, indent=1)
        print("wrote %s (%d rows)" % (args.json, len(rows)))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
