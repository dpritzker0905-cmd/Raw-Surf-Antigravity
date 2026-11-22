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
part: the display removes it, as NOAA's predictions carry no sea-level change since the epoch.

Reads: the CO-OPS datagetter (predictions only). Writes: --json and the step summary. No bucket, no live backend.
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


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--fes-cache", default="fes_cache")
    ap.add_argument("--work", default="parity_work")
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json", default="tide_mllw_parity.json")
    ap.add_argument("--summary", default=os.environ.get("GITHUB_STEP_SUMMARY"))
    a = ap.parse_args(argv)
    import arms                                                   # noqa: E402 - pyfes, CI only
    import sources as S                                           # noqa: E402
    from fes_gate import FES_CONSTITUENTS                         # noqa: E402
    sys.path.insert(0, str(HERE.parent / "tide_own"))
    import build_series as BS                                     # noqa: E402 (subset_wrapped)

    stations = {s["id"]: s for s in TD._load_stations()}
    gauges = {sid: (stations[sid]["lat"], stations[sid]["lng"]) for sid in OR.G3T_M if sid in stations}
    work = Path(a.work)
    boxes, scratch = work / "boxes", work / "scratch"
    scratch.mkdir(parents=True, exist_ok=True)
    files = S.download_fes(FES_CONSTITUENTS, Path(a.fes_cache))
    for name, path in files.items():
        BS.subset_wrapped(path, name, gauges, boxes, scratch)

    day0 = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    start, end = day0 - timedelta(hours=6), day0 + timedelta(days=a.days, hours=6)
    hours = [start + timedelta(hours=i) for i in range(int((end - start).total_seconds() // 3600) + 1)]
    ntde = np.arange(np.datetime64("1983-01-01T00:00", "us"), np.datetime64("2002-01-01T00:00", "us"),
                     np.timedelta64(OR.NTDE_STEP_MIN, "m"))
    per, allrows = {}, {"model": [], "sheet": []}
    for sid, (la, lo) in gauges.items():
        d = boxes / OR.safe_dir(sid)
        if not d.exists():
            per[sid] = {"error": "no FES box"}
            continue
        a_h = arms.fes_eval(d, la, lo, arms.to_np(hours))
        a_n = arms.fes_eval(d, la, lo, ntde)
        if a_h is None or a_n is None:
            per[sid] = {"error": "FES undefined"}
            continue
        d_model = OR.d_ntde(a_n, OR.NTDE_STEP_MIN / 60.0)
        d_sheet = stations[sid]["d"]
        try:
            stop = day0 + timedelta(days=a.days)
            noaa = [e for e in noaa_hilo_mllw(sid, day0, stop) if day0 <= e[0] < stop]
        except Exception as e:                                    # noqa: BLE001 - one gauge's failure is reported
            per[sid] = {"error": f"CO-OPS {type(e).__name__}"}
            continue
        iso = [t.strftime("%Y-%m-%dT%H:00") for t in hours]
        row = {"name": stations[sid]["name"], "d_model": d_model, "d_sheet": round(d_sheet, 4)}
        for tag, dval in (("model", d_model), ("sheet", d_sheet)):
            if dval is None:
                continue
            lv = [round(float(x) + dval, 3) for x in a_h]          # the hourly display series, metres above MLLW
            ours = T.tide_extrema(iso, lv)
            m = match(noaa, ours)
            allrows[tag] += m
            row[tag] = summarize(m)
        per[sid] = row
    out = {"generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"), "days": a.days,
           "gauges": len(gauges), "all": {k: summarize(v) for k, v in allrows.items()}, "per_gauge": per}
    print(json.dumps(out["all"], indent=1))
    with open(a.json, "w", encoding="utf-8") as fh:
        json.dump(out, fh, indent=1)
    if a.summary:
        lines = [f"### US tide above MLLW vs NOAA CO-OPS MLLW predictions ({a.days} days, {len(gauges)} gauges)", "",
                 "| D source | events | unmatched | median abs height err (m) | max (m) | median time err (min) | max (min) |",
                 "|---|---|---|---|---|---|---|"]
        for k, v in out["all"].items():
            lines.append(f"| {k} | {v['n']} | {v['unmatched']} | {v['height_median_abs_m']} | {v['height_max_abs_m']} | "
                         f"{v['time_median_min']} | {v['time_max_min']} |")
        bad = {k: v.get("error") for k, v in per.items() if "error" in v}
        if bad:
            lines.append(f"\nGauges not scored: {bad}")
        with open(a.summary, "a", encoding="utf-8") as fh:
            fh.write("\n".join(lines) + "\n")


if __name__ == "__main__":
    main()
