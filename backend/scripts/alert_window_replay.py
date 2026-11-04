"""Offline replay: forecast-window alerts (ALERTS_FORECAST_WINDOWS) vs today's current-height alerts.

NEVER touches the backend or sends anything. Inputs are public observation files you download yourself into
--data (NDBC realtime2 `<station>.txt`, NOAA CO-OPS hourly tide predictions `tide_<station>.json`):

    for s in 41113 TRDF1 46254 LJPC1 44100 DUKN7; do curl -s -o $s.txt https://www.ndbc.noaa.gov/data/realtime2/$s.txt; done
    curl -s -o tide_8721604.json "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?product=predictions&interval=h&begin_date=YYYYMMDD&end_date=YYYYMMDD&datum=MLLW&station=8721604&time_zone=gmt&units=metric&format=json"
    (and 9410230, 8651370)

REALISED conditions per hour: the served chain applied to the OBSERVED sea and wind (buoy Hs/DPD/MWD,
pier anemometer, predicted tide): `surf_point.estimate_surf_at` for the breaking height, then
`surf_rating.compute_surf_rating`, at the spot's own geometry, so truth and forecast share ONE composition and
differ only by forecast error. ⚠️ The buoys are nearshore (10-26 m): their Hs is not the offshore Hs the chain is
written for, so absolute heights run high; both policies are judged against the same truth, which is what the
comparison needs.

FORECASTS are the realised inputs plus lead-dependent, hour-correlated errors (AR(1), rho 0.95/h, fresh per
issue every 4 h, frames every 3 h to +72 h, as the producer writes them): Hs MAE 0.24 / 0.30 / 0.33 / 0.39 m at
6 / 24 / 48 / 72 h (SCOREBOARD row 2026-09-29, served GFS all-sea, and the 2026-09-30 NDBC row), wind speed
sigma 1.8 m/s + 0.4 m/s per day and direction sigma 25 deg + 10 deg per day (ASSUMED: no measured wind lead
skill exists in the repo yet). `--sigma 0` is the perfect-forecast control.

POLICIES, run hourly over the record:
  today  fires when the lead-0 forecast height is inside [min, max] (claim_alert_delivery), 1 h cooldown,
         ignoring time windows, tides, conditions and darkness (what scheduler/surf_alerts.py does).
  new    `surf_alert_windows.decide` on the latest issued horizon, with every window already sent de-duplicated.
SCORING against the realised windows (daylight, every saved preference, the same level floor):
  precision  today: fraction of fires at an hour that was realised-qualifying ("it is good now" was true);
             new: fraction of announced windows that overlap a realised window by >= 1 h.
  recall     fraction of realised windows (>= the minimum length) announced before they ended
             (new: by a window overlapping it; today: by a fire inside it).
"""
import argparse
import json
import math
import os
import random
import sys
import types
from datetime import datetime, timedelta, timezone

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import surf_alert_windows as W  # noqa: E402
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry  # noqa: E402
from services.weather_pipeline.surf_rating import compute_surf_rating  # noqa: E402
from services.weather_pipeline.tide import tide_state_at  # noqa: E402

SPOTS = [
    {"name": "Cocoa Beach FL", "lat": 28.32, "lng": -80.605, "buoy": "41113", "wind": "TRDF1", "tide": "8721604"},
    {"name": "Scripps Pier CA", "lat": 32.867, "lng": -117.257, "buoy": "46254", "wind": "LJPC1", "tide": "9410230"},
    {"name": "Duck Pier NC", "lat": 36.183, "lng": -75.748, "buoy": "44100", "wind": "DUKN7", "tide": "8651370"},
]
ALERTS = {
    "size_only_2_6ft": dict(min_wave_height=2.0, max_wave_height=6.0),
    "morning_afternoon_offshore_light": dict(min_wave_height=2.0, max_wave_height=8.0,
                                             time_windows=["morning", "afternoon"],
                                             preferred_conditions=["offshore", "light-wind"]),
    "dawn_morning_clean_mid_high_tide": dict(min_wave_height=1.5, time_windows=["dawn", "morning"],
                                             preferred_conditions=["clean"], tide_states=["mid", "high"]),
}
HS_MAE = [(0, 0.20), (6, 0.24), (24, 0.30), (48, 0.33), (72, 0.39)]


def _mm(v):
    return None if v in ("MM", "999", "99.0", "999.0", "9999.0") else float(v)


def read_ndbc(path, cols):
    out = {}
    with open(path, encoding="utf-8", errors="replace") as fh:
        head = fh.readline().lstrip("#").split()
        fh.readline()
        for line in fh:
            p = line.split()
            if len(p) < len(head):
                continue
            row = dict(zip(head, p))
            t = datetime(int(row["YY"]), int(row["MM"]), int(row["DD"]), int(row["hh"]), int(row["mm"]),
                         tzinfo=timezone.utc)
            hour = (t + timedelta(minutes=30)).replace(minute=0)
            vals = {c: _mm(row.get(c, "MM")) for c in cols}
            if all(v is not None for v in vals.values()):
                prev = out.get(hour)
                if prev is None or abs((t - hour).total_seconds()) < prev[0]:
                    out[hour] = (abs((t - hour).total_seconds()), vals)
    return {h: v for h, (_d, v) in out.items()}


def read_tide(path):
    with open(path, encoding="utf-8") as fh:
        rows = json.load(fh)["predictions"]
    times = [r["t"].replace(" ", "T") + ":00Z" for r in rows]      # tide.tide_state_at reads ISO strings
    return times, [float(r["v"]) for r in rows]


def sigma_hs(lead_h):
    for (a, ma), (b, mb) in zip(HS_MAE, HS_MAE[1:]):
        if lead_h <= b:
            mae = ma + (mb - ma) * (lead_h - a) / (b - a)
            break
    else:
        mae = HS_MAE[-1][1]
    return mae * math.sqrt(math.pi / 2)


def rate(spot, geo, hs, tp, mwd, wspd, wdir, tide):
    h, _ = estimate_surf_at(spot["lat"], spot["lng"], hs, tp, swell_from_deg=mwd, geometry=geo)
    score, level = compute_surf_rating(h, tp, wspd, wind_from_deg=wdir, shore_normal_deg=geo.shore_normal_deg,
                                       swell_from_deg=mwd, tide_norm=(tide or {}).get("norm"),
                                       break_depth_m=geo.break_depth_m)
    return {"spot_id": spot["name"], "score": score, "level": level, "surf_height_m": h, "period_s": tp,
            "tide": tide, "inputs": {"wind_ms": wspd, "wind_from_deg": wdir, "shore_normal_deg": geo.shore_normal_deg}}


def build(spot, data_dir):
    sea = read_ndbc(os.path.join(data_dir, f"{spot['buoy']}.txt"), ("WVHT", "DPD", "MWD"))
    wind = read_ndbc(os.path.join(data_dir, f"{spot['wind']}.txt"), ("WDIR", "WSPD"))
    times, levels = read_tide(os.path.join(data_dir, f"tide_{spot['tide']}.json"))
    obs = {}
    for hour in sorted(set(sea) & set(wind)):
        tide = tide_state_at(times, levels, hour)
        obs[hour] = {**sea[hour], **wind[hour], "tide": tide}
    return obs


def realised(spot, geo, obs):
    return {h: rate(spot, geo, o["WVHT"], o["DPD"], o["MWD"], o["WSPD"], o["WDIR"], o["tide"]) for h, o in obs.items()}


def issue(spot, geo, obs, at, sig, rng, step=3):
    """One forecast run issued at `at`: frames every `step` h to +72 h, AR(1) errors growing with lead."""
    frames, e_hs, e_ws, e_wd = [], 0.0, 0.0, 0.0
    rho = 0.95
    for lead in range(0, 73):
        z = math.sqrt(1 - rho * rho)
        e_hs = rho * e_hs + z * rng.gauss(0, 1)
        e_ws = rho * e_ws + z * rng.gauss(0, 1)
        e_wd = rho * e_wd + z * rng.gauss(0, 1)
        if lead % step:
            continue
        o = obs.get(at + timedelta(hours=lead))
        if o is None:
            continue
        hs = max(0.05, o["WVHT"] + sig * sigma_hs(lead) * e_hs)
        ws = max(0.0, o["WSPD"] + sig * (1.8 + 0.4 * lead / 24) * e_ws)
        wd = (o["WDIR"] + sig * (25 + 10 * lead / 24) * e_wd) % 360
        vt = (at + timedelta(hours=lead)).strftime("%Y-%m-%dT%H:00:00Z")
        frames.append({"model": "GFS", "valid_time": vt, "spots": [rate(spot, geo, hs, o["DPD"], o["MWD"], ws, wd,
                                                                          o["tide"])]})
    return {"kind": "alert_horizon", "generated_at": (at + timedelta(hours=1)).isoformat(), "frames": frames,
            "models": ["GFS"], "default_model": "GFS", "step_h": step}


def truth_windows(alert, spot_ns, truth):
    series = sorted(truth.items())
    start, end = series[0][0], series[-1][0]
    hours = int((end - start).total_seconds() // 3600) + 1
    found = W.find_windows(alert, spot_ns, series, start, hours, step_h=1.0)["windows"]
    return [(W.parse_time(w["start"]), W.parse_time(w["end"])) for w in found]


def qualifying_hours(windows):
    out = set()
    for a, b in windows:
        t = a
        while t < b:
            out.add(t)
            t += timedelta(hours=1)
    return out


def replay(spot, geo, obs, truth, alert_kw, sig, seed, step=3):
    rng = random.Random(seed)
    spot_ns = types.SimpleNamespace(name=spot["name"], latitude=spot["lat"], longitude=spot["lng"])
    alert = types.SimpleNamespace(id="a", spot_id=spot["name"], min_wave_height=None, max_wave_height=None,
                                  time_windows=None, tide_states=None, preferred_conditions=None)
    for k, v in alert_kw.items():
        setattr(alert, k, v)
    real = truth_windows(alert, spot_ns, truth)
    good_hours = qualifying_hours(real)
    hours = sorted(obs)
    first, last = hours[0], hours[-1] - timedelta(hours=72)
    issues, t = {}, first.replace(hour=(first.hour // 4) * 4)
    while t <= last:
        issues[t] = issue(spot, geo, obs, t, sig, rng, step)
        t += timedelta(hours=4)
    new_fires, sent, legacy_fires = [], [], []
    run = first + timedelta(hours=1)
    while run <= last:
        cur = max((i for i in issues if i + timedelta(hours=1) <= run), default=None)
        if cur is not None:
            hz = issues[cur]
            d = W.decide(alert, spot_ns, hz, run, notified=sent, subscription_tier="premium")
            if d["fire"]:
                w = d["window"]
                new_fires.append((run, W.parse_time(w["start"]), W.parse_time(w["end"])))
                sent.append((W.parse_time(w["start"]), W.parse_time(w["end"])))
            lead0 = W.nearest(W.spot_series(hz, "GFS", spot["name"]), run, 5400)
            if lead0 and W.size_ok(lead0, alert.min_wave_height, alert.max_wave_height):
                legacy_fires.append(run)
        run += timedelta(hours=1)
    days = (last - first).total_seconds() / 86400
    new_hits = sum(1 for _r, a, b in new_fires if len(qualifying_hours([(a, b)]) & good_hours) >= 1)
    new_rec = sum(1 for a, b in real if any(r < b and fa < b and a < fb for r, fa, fb in new_fires))
    new_rec_6h = sum(1 for a, b in real if any(r <= a - timedelta(hours=6) and fa < b and a < fb
                                               for r, fa, fb in new_fires))
    leg_hits = sum(1 for r in legacy_fires if r in good_hours)
    leg_rec = sum(1 for a, b in real if any(a <= r < b for r in legacy_fires))
    in_window_real = [(a, b) for a, b in real if a >= first + timedelta(hours=1) and b <= last]
    by_lead = {}
    for r, a, b in new_fires:
        lead = (a - r).total_seconds() / 3600
        bucket = "<12h" if lead < 12 else "12-24h" if lead < 24 else "24-48h" if lead < 48 else "48-72h"
        hit = len(qualifying_hours([(a, b)]) & good_hours) >= 1
        n, h = by_lead.get(bucket, (0, 0))
        by_lead[bucket] = (n + 1, h + int(hit))
    return {"real_windows": len(real), "days": round(days, 1), "new_by_lead": by_lead,
            "new": {"fires": len(new_fires), "hits": new_hits, "recall_hits": new_rec, "recall_6h": new_rec_6h},
            "today": {"fires": len(legacy_fires), "hits": leg_hits, "recall_hits": leg_rec},
            "scored_windows": len(in_window_real)}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--sigma", type=float, nargs="+", default=[0.0, 1.0, 2.0])
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--step", type=int, default=3, help="forecast frame spacing, h (the producer's ALERTS_HORIZON_STEP_H)")
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    results = []
    for spot in SPOTS:
        geo = resolve_surf_geometry(spot["lat"], spot["lng"])
        obs = build(spot, args.data)
        truth = realised(spot, geo, obs)
        for name, kw in ALERTS.items():
            for sig in args.sigma:
                for seed in range(args.seeds if sig else 1):
                    r = replay(spot, geo, obs, truth, kw, sig, seed, args.step)
                    r.update({"spot": spot["name"], "alert": name, "sigma": sig, "seed": seed})
                    results.append(r)
    summary = {}
    for r in results:
        k = (r["alert"], r["sigma"])
        s = summary.setdefault(k, {"real": 0, "days": 0.0, "nf": 0, "nh": 0, "nr": 0, "nr6": 0, "lf": 0, "lh": 0,
                                   "lr": 0})
        reps = 1 if not r["sigma"] else args.seeds
        s["real"] += r["real_windows"] / reps
        s["days"] += r["days"] / reps
        s["nf"] += r["new"]["fires"] / reps
        s["nh"] += r["new"]["hits"] / reps
        s["nr"] += r["new"]["recall_hits"] / reps
        s["nr6"] += r["new"]["recall_6h"] / reps
        s["lf"] += r["today"]["fires"] / reps
        s["lh"] += r["today"]["hits"] / reps
        s["lr"] += r["today"]["recall_hits"] / reps
    print("alert | sigma | realised windows | NEW fires/wk, precision, recall (>=6 h ahead) | TODAY fires/wk, "
          "precision, recall")
    rows = []
    for (alert, sig), s in sorted(summary.items()):
        wk = s["days"] / 7 or 1
        row = {"alert": alert, "sigma": sig, "realised_windows": round(s["real"], 1),
               "new_fires_per_week": round(s["nf"] / wk, 2), "new_precision": round(s["nh"] / s["nf"], 3) if s["nf"] else None,
               "new_recall": round(s["nr"] / s["real"], 3) if s["real"] else None,
               "new_recall_6h": round(s["nr6"] / s["real"], 3) if s["real"] else None,
               "today_fires_per_week": round(s["lf"] / wk, 2),
               "today_precision": round(s["lh"] / s["lf"], 3) if s["lf"] else None,
               "today_recall": round(s["lr"] / s["real"], 3) if s["real"] else None}
        rows.append(row)
        print(f"{alert} | {sig} | {row['realised_windows']} | {row['new_fires_per_week']}, {row['new_precision']}, "
              f"{row['new_recall']} ({row['new_recall_6h']}) | {row['today_fires_per_week']}, "
              f"{row['today_precision']}, {row['today_recall']}")
    leads = {}
    for r in results:
        for bucket, (n, h) in r["new_by_lead"].items():
            tot = leads.setdefault((r["sigma"], bucket), [0, 0])
            tot[0] += n
            tot[1] += h
    print("NEW precision by lead (window start - send time), all alerts and spots:")
    for (sig, bucket), (n, h) in sorted(leads.items()):
        print(f"  sigma {sig} {bucket}: {h}/{n} = {h / n:.3f}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"summary": rows, "runs": results}, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
