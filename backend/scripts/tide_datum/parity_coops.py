"""PARITY: our displayed US tide above MLLW vs NOAA CO-OPS's own MLLW tide predictions (the SCOREBOARD instrument for
SURF_TIDE_MLLW_US; the advisor's condition 1, 2026-11-22). CI only: PyFES is GPL and runs only in a workflow.

At each of the 26 G3t US gauges (own_rules.G3T_M, the gauges whose FES tide the tide gates already measured), for the
coming DAYS days:
  ours   the SERVED display, built exactly as served: the hourly harmonic tide A (FES2022b + long-period equilibrium,
         arms.fes_eval) + D, with High/Low events from the SERVED event finder (services/weather_pipeline/tide
         .tide_extrema on the hourly series, parabolic refinement). D two ways:
           model  our own 19-year NTDE computation at the gauge (own_rules.d_ntde; the served FIRST source)
           sheet  the gauge's CO-OPS datum sheet MSL - MLLW (the committed table; the served gauge source)
  NOAA   CO-OPS `predictions`, interval=hilo, datum=MLLW (read-only GET): the numbers in a NOAA tide table.
Each NOAA High/Low is matched to our nearest event of the same type within 3 h. Reported, per D variant: median and
max |height error| (m) and |time error| (min) over all events, the per-gauge medians, and unmatched events. M plays no
part: the parity compares A + D, the frame of NOAA's predictions.

v2 (2026-11-23, the director's follow-up to run 45093427404, which could not be scored on p90 or seasonal-removed):
  * every event is written as a signed row (NOAA time, type, NOAA height, our height, height error = ours - NOAA,
    time error = ours - NOAA in minutes), and each summary adds the signed median and the p90 of |height| and |time|;
  * a TIDAL-BAND variant ("<D>_tb") removes each side's own seasonal constituents: NOAA's SA/SSA (CO-OPS harcon, NOAA's
    convention, tide_fes.metrics.noaa_long_period) from each NOAA event height, and FES2022b's Sa/Ssa from our A
    (arms.fes_eval exclude=("Sa", "Ssa")) before our events are found. NOAA's predictions carry the seasonal sea-level
    cycle (SA 0.05-0.12 m at these gauges) and FES2022b carries almost none (G2: ~0.0003 m), so the raw variants differ
    by the season, not by the tide or the datum. S_g (the window mean of NOAA's SA/SSA) is written per gauge.
The raw variants and their keys are unchanged, so a bar written against v1's fields can still be scored.

Reads: the CO-OPS datagetter (predictions only) and mdapi harcon.json (SA/SSA). Writes: --json and the step summary.
No bucket, no live backend.
Usage (CI, from the repo root):  python backend/scripts/tide_datum/parity_coops.py --fes-cache fes_cache --work pw
"""
import argparse
import json
import os
import statistics as st
import sys
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

import numpy as np

HERE = Path(__file__).resolve().parent
BACKEND = HERE.parent.parent
for sub in ("tide_own", "tide_g3t", "tide_g3", "tide_fes"):
    sys.path.insert(0, str(HERE.parent / sub))
sys.path.insert(0, str(BACKEND))
import own_rules as OR                                            # noqa: E402
from services.weather_pipeline import tide as T                  # noqa: E402  (stdlib only: the served event finder)
from services.weather_pipeline import tide_datum as TD           # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
HARCON = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{}/harcon.json?units=metric"
MATCH_H = 3.0


def noaa_hilo_mllw(sid, begin, end):
    """[(aware time, 'High'|'Low', metres above MLLW)] from CO-OPS predictions (hilo, MLLW, GMT)."""
    q = (f"{COOPS}?product=predictions&application=raw_surf_tide_mllw_parity&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum=MLLW&units=metric&time_zone=gmt"
         f"&interval=hilo&format=json").replace(" ", "%20")
    req = urllib.request.Request(q, headers={"User-Agent": "raw-surf-tide-parity/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        rows = json.loads(r.read().decode("utf-8")).get("predictions", [])
    out = []
    for r in rows:
        if r.get("type") in ("H", "L") and r.get("v") not in (None, ""):
            t = datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)
            out.append((t, "High" if r["type"] == "H" else "Low", float(r["v"])))
    return out


def noaa_seasonal_harcon(sid):
    """[(number, name, amplitude m, phase_GMT deg, speed deg/h)] for SA and SSA from CO-OPS harcon (read-only GET)."""
    req = urllib.request.Request(HARCON.format(sid), headers={"User-Agent": "raw-surf-tide-parity/1"})
    with urllib.request.urlopen(req, timeout=60) as r:
        d = json.loads(r.read().decode("utf-8"))
    return [(c.get("number"), c["name"], float(c["amplitude"]), float(c["phase_GMT"]), float(c["speed"]))
            for c in d.get("HarmonicConstituents", []) if c.get("name") in ("SA", "SSA")]


def remove_seasonal(noaa, seasonal_m):
    """PURE: NOAA events with their own seasonal term removed; seasonal_m[i] is NOAA's SA+SSA at noaa[i]'s time."""
    return [(t, kind, round(v - s, 4)) for (t, kind, v), s in zip(noaa, seasonal_m)]


def match_events(noaa, ours):
    """PURE: one signed row per NOAA event: {time, type, noaa_m, ours_m, height_err_m, time_err_min}; ours_m and the
    errors are None when no event of the same type lies within MATCH_H. Errors are ours - NOAA."""
    rows = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] != kind:
                continue
            dt = (e["time"] - t0).total_seconds() / 60.0
            if abs(dt) <= MATCH_H * 60 and (best is None or abs(dt) < abs(best[1])):
                best = (e, dt)
        row = {"time": t0.strftime("%Y-%m-%dT%H:%MZ"), "type": kind, "noaa_m": v, "ours_m": None,
               "height_err_m": None, "time_err_min": None}
        if best:
            row.update(ours_m=round(best[0]["level_m"], 4), height_err_m=round(best[0]["level_m"] - v, 4),
                       time_err_min=round(best[1], 1))
        rows.append(row)
    return rows


def p90(values):
    """PURE: the nearest-rank 90th percentile, or None for no values."""
    v = sorted(values)
    return v[max(0, -(-9 * len(v) // 10) - 1)] if v else None


DONOR_KM = 2.0          # gates/tide-datum-parity-v2.md: a NOAA sheet within 2 km, else our 19-year D
PLACEBO_M = 0.10        # the placebo control: D_hybrid + 0.10 m must FAIL the signed leg


def _km(lat1, lng1, lat2, lng2):
    import math
    p1, p2 = math.radians(lat1), math.radians(lat2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def choose_donor(sid, lat, lng, sheets, exclude_ids, km=DONOR_KM):
    """PURE (tide-datum-parity-v2, leave-one-out): the NEAREST other dated sheet within `km` of (lat, lng), never the
    station itself (its own sheet is the truth's datum) and never one in `exclude_ids` (the held-out set: a donor never
    decides). Returns {id, d, km} or None. `sheets`: [{id, lat, lng, d}]."""
    best = None
    for o in sheets:
        if o["id"] == sid or o["id"] in exclude_ids or o.get("d") is None:
            continue
        k = _km(lat, lng, o["lat"], o["lng"])
        if k <= km and (best is None or k < best["km"]):
            best = {"id": o["id"], "d": float(o["d"]), "km": round(k, 3)}
    return best


def v2_datums(d_model, donor):
    """PURE: the D variants scored in v2 mode. There is NO own-sheet variant (leave-one-out). `nsheet` only when a
    donor exists; `hybrid` = the donor's sheet, else our 19-year D; `placebo` = hybrid + PLACEBO_M."""
    out = {}
    if d_model is not None:
        out["model"] = float(d_model)
    if donor is not None:
        out["nsheet"] = donor["d"]
    hyb = donor["d"] if donor is not None else (float(d_model) if d_model is not None else None)
    if hyb is not None:
        out["hybrid"] = hyb
        out["placebo"] = hyb + PLACEBO_M
    return out


def v2_station_list(heldout, n_reserve):
    """PURE: [(id, stratum)] the v2 run scores: every deciding station, then the first `n_reserve` reserves of each
    stratum (the frozen replacement order, cap 5 in the gate)."""
    out = []
    for k, st_ in heldout["strata"].items():
        out += [(i, k) for i in st_["deciding"]] + [(i, k) for i in st_["reserve"][:n_reserve]]
    return out


def match(noaa, ours):
    """PURE: [(height error m, time error min)] per NOAA event (None, None when unmatched within MATCH_H)."""
    res = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] != kind:
                continue
            dt = abs((e["time"] - t0).total_seconds()) / 60.0
            if dt <= MATCH_H * 60 and (best is None or dt < best[1]):
                best = (e["level_m"] - v, dt)
        res.append(best if best else (None, None))
    return res


def summarize(rows):
    """PURE: {n, unmatched, height_median_abs_m, height_max_abs_m, time_median_min, time_max_min} over all events."""
    h = [abs(a) for a, _ in rows if a is not None]
    t = [b for _, b in rows if b is not None]
    return {"n": len(rows), "unmatched": sum(1 for a, _ in rows if a is None),
            "height_median_abs_m": round(st.median(h), 4) if h else None,
            "height_max_abs_m": round(max(h), 4) if h else None,
            "time_median_min": round(st.median(t), 1) if t else None,
            "time_max_min": round(max(t), 1) if t else None}


def summarize_events(rows):
    """PURE: summarize()'s fields over signed event rows, plus the signed height median and the p90 of |height| and
    |time|."""
    pairs = [(r["height_err_m"], None if r["time_err_min"] is None else abs(r["time_err_min"])) for r in rows]
    out = summarize(pairs)
    h = [r["height_err_m"] for r in rows if r["height_err_m"] is not None]
    t = [abs(r["time_err_min"]) for r in rows if r["time_err_min"] is not None]
    hp, tp = p90([abs(x) for x in h]), p90(t)
    out.update(height_median_signed_m=round(st.median(h), 4) if h else None,
               height_p90_abs_m=round(hp, 4) if hp is not None else None,
               time_p90_min=round(tp, 1) if tp is not None else None)
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="parity_work")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json", default="tide_mllw_parity.json")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    ap.add_argument("--stations", help="v2: the frozen held-out JSON (gates/tide-datum-parity-v2.md); leave-one-out")
    ap.add_argument("--start", help="v2: the fixed window start, YYYY-MM-DD (UTC); default today")
    ap.add_argument("--reserve", type=int, default=5, help="v2: reserves scored per stratum (the gate's cap)")
    a = ap.parse_args(argv)
    import arms                                                   # noqa: E402 - pyfes, CI only
    import sources as S                                           # noqa: E402
    from fes_gate import FES_CONSTITUENTS                         # noqa: E402
    sys.path.insert(0, str(HERE.parent / "tide_own"))
    import build_series as BS                                     # noqa: E402 (subset_wrapped)

    stations = {s["id"]: s for s in TD._load_stations()}
    v2 = None
    if a.stations:
        heldout = json.loads(Path(a.stations).read_text(encoding="utf-8"))
        v2 = dict(v2_station_list(heldout, a.reserve))
        scored = set(v2)
        sheets = [{"id": k, "lat": v["lat"], "lng": v["lng"], "d": v["d"]} for k, v in stations.items()]
        gauges = {sid: (stations[sid]["lat"], stations[sid]["lng"]) for sid in v2 if sid in stations}
    else:
        gauges = {sid: (stations[sid]["lat"], stations[sid]["lng"]) for sid in OR.G3T_M if sid in stations}
    work = Path(a.work)
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    files = S.download_fes(FES_CONSTITUENTS, Path(a.fes_cache))
    for name, path in files.items():
        BS.subset_wrapped(path, name, gauges, boxes, scratch)

    day0 = (datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc) if a.start
            else datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0))
    start, end = day0 - timedelta(hours=6), day0 + timedelta(days=a.days, hours=6)
    hours = [start + timedelta(hours=i) for i in range(int((end - start).total_seconds() // 3600) + 1)]
    ntde = np.arange(np.datetime64("1983-01-01T00:00", "us"), np.datetime64("2002-01-01T00:00", "us"),
                     np.timedelta64(OR.NTDE_STEP_MIN, "m"))
    from metrics import noaa_long_period                         # noqa: E402 (stdlib only)
    per, allrows = {}, {}
    for sid, (la, lo) in gauges.items():
        d = boxes / OR.safe_dir(sid)
        if not d.exists():
            per[sid] = {"error": "no FES box"}
            continue
        a_h = arms.fes_eval(d, la, lo, arms.to_np(hours))
        a_n = arms.fes_eval(d, la, lo, ntde)
        a_tb = arms.fes_eval(d, la, lo, arms.to_np(hours), exclude=("Sa", "Ssa"))
        if a_h is None or a_n is None:
            per[sid] = {"error": "FES undefined"}
            continue
        d_model = OR.d_ntde(a_n, OR.NTDE_STEP_MIN / 60.0)
        if v2 is not None:      # LEAVE-ONE-OUT: the station's own sheet is never a D here
            donor = choose_donor(sid, la, lo, sheets, scored)
            datums = v2_datums(d_model, donor)
        else:
            donor = None
            datums = {"model": d_model, "sheet": stations[sid]["d"]}
        try:
            stop = day0 + timedelta(days=a.days)
            noaa = [e for e in noaa_hilo_mllw(sid, day0, stop) if day0 <= e[0] < stop]
        except Exception as e:                                    # noqa: BLE001 - one gauge's failure is reported
            per[sid] = {"error": f"CO-OPS {type(e).__name__}"}
            continue
        iso = [t.strftime("%Y-%m-%dT%H:00") for t in hours]
        row = {"name": stations[sid]["name"], "d_model": d_model}
        if v2 is not None:
            row.update(stratum=v2[sid], donor=donor, d=datums)
        else:
            row["d_sheet"] = round(stations[sid]["d"], 4)
        try:
            hc = noaa_seasonal_harcon(sid)
        except Exception as e:                                    # noqa: BLE001 - the raw variants still score
            hc, row["harcon_error"] = None, type(e).__name__
        noaa_tb = remove_seasonal(noaa, noaa_long_period(hc, [e[0] for e in noaa])) if hc else None
        if hc:
            row["S_g_m"] = round(st.fmean(noaa_long_period(hc, [h for h in hours if day0 <= h < stop])), 4)
        for tag, dval in datums.items():
            if dval is None:
                continue
            variants = [(tag, a_h, noaa)]
            if noaa_tb is not None and a_tb is not None:
                variants.append((tag + "_tb", a_tb, noaa_tb))
            for name, series, truth in variants:
                lv = [float(x) + dval for x in series]   # the hourly display series, metres above MLLW. UNROUNDED: a
                # constant D must move no event (gates/tide-datum-parity-v1.md amendment 3; run 45102683907 was VOID
                # because 1 mm rounding after adding D moved the finder's vertex by up to minutes)
                ev = match_events(truth, T.tide_extrema(iso, lv))
                allrows.setdefault(name, []).extend(ev)
                row[name] = summarize_events(ev)
                row[name + "_events"] = ev
        per[sid] = row
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": a.days,
           "window_start": day0.strftime("%Y-%m-%d"), "mode": "v2-heldout-loo" if v2 is not None else "v1-gauges",
           "gauges": len(gauges), "all": {k: summarize_events(v) for k, v in allrows.items()}, "per_gauge": per,
           "version": 2}
    print(json.dumps(out["all"], indent=1))
    with open(a.json, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    if a.summary:
        lines = [f"### US tide above MLLW vs NOAA CO-OPS MLLW predictions ({a.days} days, {len(gauges)} gauges)", "",
                 "| D source | events | unmatched | median abs height err (m) | signed median (m) | p90 (m) | max (m) | "
                 "median time err (min) | p90 (min) | max (min) |",
                 "|---|---|---|---|---|---|---|---|---|---|"]
        for k, v in out["all"].items():
            lines.append(f"| {k} | {v['n']} | {v['unmatched']} | {v['height_median_abs_m']} | {v['height_median_signed_m']} | "
                         f"{v['height_p90_abs_m']} | {v['height_max_abs_m']} | {v['time_median_min']} | {v['time_p90_min']} | "
                         f"{v['time_max_min']} |")
        lines.append("\n`_tb` = tidal band: NOAA's SA/SSA removed from NOAA, FES Sa/Ssa removed from ours.")
        bad = {k: v.get("error") for k, v in per.items() if "error" in v}
        if bad:
            lines.append(f"\nGauges not scored: {bad}")
        with open(a.summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
