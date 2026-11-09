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
issue every 4 h, frames every --step h (1, as the producer writes them) to +72 h): Hs MAE 0.24 / 0.30 / 0.33 / 0.39 m at
6 / 24 / 48 / 72 h (SCOREBOARD row 2026-09-29, served GFS all-sea, and the 2026-09-30 NDBC row), wind speed
sigma 1.8 m/s + 0.4 m/s per day and direction sigma 25 deg + 10 deg per day (ASSUMED: no measured wind lead
skill exists in the repo yet). `--sigma 0` is the perfect-forecast control.

POLICIES, run hourly over the record:
  today  fires when the lead-0 forecast height is inside [min, max] (claim_alert_delivery), 1 h cooldown,
         ignoring time windows, tides, conditions and darkness (what scheduler/surf_alerts.py does).
  new    `surf_alert_windows.decide` on the latest issued horizon, then `surf_alert_windows.admit` (the per-user
         gate the scheduler applies), in two PAIRED arms on the same forecasts: `kill_switch`
         (ALERTS_WINDOW_SUPPRESSION=0, #704 exactly) and `default` (collapse within ALERTS_WINDOW_MERGE_GAP_H,
         same-window suppression, ALERTS_MAX_PER_USER_DAY). `--hysteresis` adds a replay-only arm (a window must
         also be in the previous cycle) that the product does NOT implement.
SCORING against the realised windows (daylight, every saved preference, the same level floor):
  precision  today: fraction of fires at an hour that was realised-qualifying ("it is good now" was true);
             new: fraction of announced windows that overlap a realised window by >= 1 h; hour-precision: the
             share of all announced hours that were realised-qualifying (so a collapsed span cannot hide a gap).
  recall     fraction of realised windows (>= the minimum length) announced before they ended
             (new: by a window overlapping it; today: by a fire inside it).
VOLUME (new): sends per user per local day (nautical zone; one synthetic user = one alert at one spot under one
seed), the histogram over user-days and its maximum; tier: sends whose window ends past send time + the tier's
horizon. Aggregate only: synthetic users, no user row is ever read.
"""
import argparse
import json
import math
import os
import random
import sys
import types
from collections import Counter
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


ARMS = {
    # The kill switch: #704 exactly (per-alert overlap de-dup, no collapse, no cap). The paired "before".
    "kill_switch": {"ALERTS_WINDOW_SUPPRESSION": "0"},
    # The shipped defaults: collapse (ALERTS_WINDOW_MERGE_GAP_H 1) + same-window suppression + cap 2/user-day.
    "default": {},
}
KNOBS = ("ALERTS_WINDOW_SUPPRESSION", "ALERTS_WINDOW_MERGE_GAP_H", "ALERTS_MAX_PER_USER_DAY", "ALERTS_NOTIFY_LEAD_H")


def _with_env(env):
    saved = {k: os.environ.get(k) for k in KNOBS}
    for k in KNOBS:
        os.environ.pop(k, None)
    os.environ.update(env)
    return saved


def _restore(saved):
    for k, v in saved.items():
        if v is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = v


def _seen_last_cycle(window, prev_hz, alert, spot_ns, run, spot_name):
    """HYSTERESIS (replay-only arm, NOT in the product): the window, or a window overlapping it, was also in the
    previous forecast cycle; a window already under way is exempt."""
    if W.parse_time(window["start"]) <= run:
        return True
    if prev_hz is None:
        return False
    series = W.spot_series(prev_hz, "GFS", spot_name)
    prev = W.collapse_windows(W.find_windows(alert, spot_ns, series, run, 72, 1.0)["windows"], W.merge_gap_h())
    return W.overlaps(window, [(W.parse_time(p["start"]), W.parse_time(p["end"])) for p in prev])


def replay(spot, geo, obs, truth, alert_kw, sig, seed, step=1, arm="default", tier="premium", hysteresis=False):
    """One synthetic user (one alert) at one spot under one noise seed. The issues are drawn from Random(seed)
    first, so every arm and tier of a (spot, class, sigma, seed) sees the SAME forecasts: the comparison is paired."""
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
    keys = sorted(issues)
    off = W.local_offset_h(spot["lng"])
    saved = _with_env(ARMS[arm])
    try:
        new_fires, sent, sent_at, legacy_fires, outside, refused = [], [], [], [], 0, Counter()
        run = first + timedelta(hours=1)
        while run <= last:
            cur = max((i for i in keys if i + timedelta(hours=1) <= run), default=None)
            if cur is not None:
                hz = issues[cur]
                prev_hz = issues[keys[keys.index(cur) - 1]] if keys.index(cur) else None
                held = list(sent)
                for _try in range(8):
                    d = W.decide(alert, spot_ns, hz, run, notified=held, subscription_tier=tier)
                    if not d["fire"] or not hysteresis or _seen_last_cycle(d["window"], prev_hz, alert, spot_ns,
                                                                         run, spot["name"]):
                        break
                    held.append((W.parse_time(d["window"]["start"]), W.parse_time(d["window"]["end"])))
                    d = {"fire": False}
                if d["fire"]:
                    ok, why = W.admit(d["window"], sent, sent_at, run)
                    if ok:
                        a, b = W.parse_time(d["window"]["start"]), W.parse_time(d["window"]["end"])
                        new_fires.append((run, a, b))
                        sent.append((a, b))
                        sent_at.append(run)
                        if b > run + timedelta(hours=W.horizon_h(tier, d["model"])):
                            outside += 1
                    else:
                        refused[why] += 1
                lead0 = W.nearest(W.spot_series(hz, "GFS", spot["name"]), run, 5400)
                if lead0 and W.size_ok(lead0, alert.min_wave_height, alert.max_wave_height):
                    legacy_fires.append(run)
            run += timedelta(hours=1)
    finally:
        _restore(saved)
    days = (last - first).total_seconds() / 86400
    new_hits = sum(1 for _r, a, b in new_fires if len(qualifying_hours([(a, b)]) & good_hours) >= 1)
    span_h = sum(len(qualifying_hours([(a, b)])) for _r, a, b in new_fires)
    good_h = sum(len(qualifying_hours([(a, b)]) & good_hours) for _r, a, b in new_fires)
    new_rec = sum(1 for a, b in real if any(r < b and fa < b and a < fb for r, fa, fb in new_fires))
    new_rec_6h = sum(1 for a, b in real if any(r <= a - timedelta(hours=6) and fa < b and a < fb
                                               for r, fa, fb in new_fires))
    leg_hits = sum(1 for r in legacy_fires if r in good_hours)
    leg_rec = sum(1 for a, b in real if any(a <= r < b for r in legacy_fires))
    per_day = Counter((r + timedelta(hours=off)).date() for r, _a, _b in new_fires)
    user_days = int(round(days))
    hist = Counter(per_day.values())
    hist[0] += user_days - sum(hist.values())
    return {"real_windows": len(real), "days": round(days, 1), "arm": arm, "tier": tier, "hysteresis": hysteresis,
            "new": {"fires": len(new_fires), "hits": new_hits, "recall_hits": new_rec, "recall_6h": new_rec_6h,
                    "span_h": span_h, "good_h": good_h, "max_per_day": max(per_day.values()) if per_day else 0,
                    "per_day_hist": dict(hist), "outside_tier": outside, "refused": dict(refused)},
            "today": {"fires": len(legacy_fires), "hits": leg_hits, "recall_hits": leg_rec}}


def _job(args):
    data, si, name, sig, seed, step, arms, tiers, hysteresis = args
    spot = SPOTS[si]
    geo = resolve_surf_geometry(spot["lat"], spot["lng"])
    obs = build(spot, data)
    truth = realised(spot, geo, obs)
    out = []
    for arm in arms:
        for tier in tiers:
            for hy in ((False, True) if hysteresis else (False,)):
                r = replay(spot, geo, obs, truth, ALERTS[name], sig, seed, step, arm, tier, hy)
                r.update({"spot": spot["name"], "alert": name, "sigma": sig, "seed": seed})
                out.append(r)
    return out


def summarize(results, seeds):
    summary = {}
    for r in results:
        k = (r["arm"], r["tier"], r["hysteresis"], r["alert"], r["sigma"])
        s = summary.setdefault(k, Counter())
        reps = 1 if not r["sigma"] else seeds
        s["real"] += r["real_windows"] / reps
        s["days"] += r["days"] / reps
        for key in ("fires", "hits", "recall_hits", "recall_6h", "span_h", "good_h"):
            s["n_" + key] += r["new"][key] / reps
        for key in ("fires", "hits", "recall_hits"):
            s["t_" + key] += r["today"][key] / reps
        s["max_per_day"] = max(s["max_per_day"], r["new"]["max_per_day"])
        s["outside_tier"] += r["new"]["outside_tier"]
        for n, c in r["new"]["per_day_hist"].items():
            s[f"hist_{n}"] += c

    def ratio(a, b):
        return round(a / b, 3) if b else None
    rows = []
    for (arm, tier, hy, alert, sig), s in sorted(summary.items(), key=lambda kv: (kv[0][2], kv[0][1], kv[0][3],
                                                                                    kv[0][4], kv[0][0])):
        wk = s["days"] / 7 or 1
        rows.append({
            "arm": arm, "tier": tier, "hysteresis": hy, "alert": alert, "sigma": sig,
            "realised_windows": round(s["real"], 1), "new_fires_per_week": round(s["n_fires"] / wk, 2),
            "new_precision": ratio(s["n_hits"], s["n_fires"]), "new_hour_precision": ratio(s["n_good_h"], s["n_span_h"]),
            "new_recall": ratio(s["n_recall_hits"], s["real"]), "new_recall_6h": ratio(s["n_recall_6h"], s["real"]),
            "max_per_user_day": int(s["max_per_day"]), "outside_tier_window": int(s["outside_tier"]),
            "per_user_day_hist": {int(k[5:]): int(v) for k, v in sorted(s.items(), key=lambda kv: kv[0])
                                  if k.startswith("hist_")},
            "today_fires_per_week": round(s["t_fires"] / wk, 2), "today_precision": ratio(s["t_hits"], s["t_fires"]),
            "today_recall": ratio(s["t_recall_hits"], s["real"])})
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--data", required=True)
    ap.add_argument("--sigma", type=float, nargs="+", default=[0.0, 1.0, 2.0])
    ap.add_argument("--seeds", type=int, default=5)
    ap.add_argument("--step", type=int, default=1, help="forecast frame spacing, h (the producer's ALERTS_HORIZON_STEP_H, 1)")
    ap.add_argument("--arms", default="kill_switch,default", help=f"comma list of {sorted(ARMS)}")
    ap.add_argument("--tiers", default="premium", help="comma list; free/basic/premium all resolve to 72 h today")
    ap.add_argument("--hysteresis", action="store_true", help="also run the replay-only two-cycle hysteresis arm")
    ap.add_argument("--jobs", type=int, default=1)
    ap.add_argument("--out")
    args = ap.parse_args(argv)
    arms, tiers = args.arms.split(","), args.tiers.split(",")
    jobs = [(args.data, si, name, sig, seed, args.step, arms, tiers, args.hysteresis)
            for si in range(len(SPOTS)) for name in ALERTS for sig in args.sigma
            for seed in range(args.seeds if sig else 1)]
    if args.jobs > 1:
        from multiprocessing import Pool
        with Pool(args.jobs) as pool:
            results = [r for rs in pool.map(_job, jobs) for r in rs]
    else:
        results = [r for j in jobs for r in _job(j)]
    rows = summarize(results, args.seeds)
    print("arm | tier | hyst | alert | sigma | NEW precision, hour-precision, recall (>=6 h), fires/wk, max/user-day,"
          " outside tier | per-user-day histogram | TODAY precision, recall")
    for row in rows:
        print(f"{row['arm']} | {row['tier']} | {int(row['hysteresis'])} | {row['alert']} | {row['sigma']} | "
              f"{row['new_precision']}, {row['new_hour_precision']}, {row['new_recall']} ({row['new_recall_6h']}), "
              f"{row['new_fires_per_week']}, {row['max_per_user_day']}, {row['outside_tier_window']} | "
              f"{row['per_user_day_hist']} | {row['today_precision']}, {row['today_recall']}")
    if args.out:
        with open(args.out, "w", encoding="utf-8") as fh:
            json.dump({"summary": rows, "runs": results}, fh, indent=1, default=str)


if __name__ == "__main__":
    main()
