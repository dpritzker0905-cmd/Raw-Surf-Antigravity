"""Isolate the SERVED tide event finder (services/weather_pipeline/tide.tide_extrema) from the tide model.

Feed the finder NOAA's OWN prediction curve, sampled as we serve (hourly) and at 6 min, and compare its High/Low events
with NOAA's own published hilo times. Any timing error here is the finder's, because the curve is NOAA's; whatever the
parity run (45093427404) saw beyond this is the tide model A (FES2022b phase), not the finder.

Read-only CO-OPS predictions (interval=h, 6 and hilo; MLLW, metric, GMT). No FES, no bucket, no live backend.

    python scripts/tide_datum/finder_check.py --start 2026-11-23 --days 7 --json out.json
    python scripts/tide_datum/finder_check.py --start <day0> --all26 --json out.json   # gates/tide-datum-parity-v1 s9

HEIGHTS (2026-11-23, gates/tide-datum-parity-v1.md amendment 2): each matched event also gets its HEIGHT error (ours -
NOAA, m) on NOAA's own curve; `--all26` scores all 26 parity gauges (own_rules.G3T_M). The datum gate's finder VOID
control: median |h| <= 0.01 m at every MEASURED gauge.
"""
import argparse
import json
import statistics as st
import sys
import time
import urllib.request
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent.parent))
from services.weather_pipeline import tide as T  # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
GAUGES = {"8729840": "Pensacola", "8720030": "Fernandina Beach", "8723214": "Virginia Key", "8531680": "Sandy Hook",
          "9755371": "San Juan", "1611400": "Nawiliwili", "9410230": "La Jolla (control)", "8771510": "Galveston (control)"}
MATCH_H = 3.0


def predictions(sid, begin, end, interval):
    q = (f"{COOPS}?product=predictions&application=raw_surf_finder_check&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum=MLLW&units=metric&time_zone=gmt"
         f"&interval={interval}&format=json").replace(" ", "%20")
    for attempt in range(3):
        try:
            req = urllib.request.Request(q, headers={"User-Agent": "raw-surf-research/1.0"})
            with urllib.request.urlopen(req, timeout=60) as r:
                return json.loads(r.read().decode("utf-8")).get("predictions", [])
        except Exception:
            if attempt == 2:
                raise
            time.sleep(3 + 3 * attempt)


def _t(s):
    return datetime.strptime(s, "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc)


def compare(noaa, ours):
    """Per NOAA event: signed time error ours - NOAA (min) for the nearest same-type event within MATCH_H, or None."""
    out = []
    for t0, kind, _v in noaa:
        best = None
        for e in ours:
            if e["type"] == kind:
                dt = (e["time"] - t0).total_seconds() / 60.0
                if abs(dt) <= MATCH_H * 60 and (best is None or abs(dt) < abs(best)):
                    best = dt
        out.append(best)
    return out


def compare_heights(noaa, ours):
    """Per NOAA event: signed HEIGHT error ours - NOAA (m) of the nearest same-type event within MATCH_H, or None."""
    out = []
    for t0, kind, v in noaa:
        best = None
        for e in ours:
            if e["type"] == kind:
                dt = (e["time"] - t0).total_seconds() / 60.0
                if abs(dt) <= MATCH_H * 60 and (best is None or abs(dt) < best[0]):
                    best = (abs(dt), e["level_m"] - v)
        out.append(None if best is None else best[1])
    return out


def summary(errs, n_ours):
    m = [abs(e) for e in errs if e is not None]
    return {"noaa_events": len(errs), "our_events": n_ours, "unmatched": sum(e is None for e in errs),
            "median_abs_min": round(st.median(m), 1) if m else None, "max_abs_min": round(max(m), 1) if m else None}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json")
    ap.add_argument("--all26", action="store_true", help="all 26 parity gauges (own_rules.G3T_M)")
    ap.add_argument("--stations", help="tide-datum-parity-v2: the frozen held-out JSON (deciding + 5 reserves)")
    a = ap.parse_args(argv)
    gauges = GAUGES
    if a.all26:
        sys.path.insert(0, str(HERE.parent / "tide_own"))
        from own_rules import G3T_M
        gauges = {sid: sid for sid in G3T_M}
    if a.stations:
        held = json.loads(Path(a.stations).read_text(encoding="utf-8"))
        gauges = {}
        for k, s in held["strata"].items():
            for sid in s["deciding"] + s["reserve"][:5]:
                gauges[sid] = f"{sid} ({k})"
    day0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    stop = day0 + timedelta(days=a.days)
    lo, hi = day0 - timedelta(hours=6), stop + timedelta(hours=6)
    out = {"window": [a.start, a.days], "gauges": {}}
    for sid, name in gauges.items():
        hilo = [(_t(r["t"]), "High" if r["type"] == "H" else "Low", float(r["v"]))
                for r in predictions(sid, day0, stop, "hilo") if r.get("type") in ("H", "L")]
        hilo = [e for e in hilo if day0 <= e[0] < stop]
        row = {"name": name, "noaa_hilo": [[e[0].strftime("%m-%dT%H:%M"), e[1], e[2]] for e in hilo]}
        for label, interval in (("hourly", "h"), ("6min", "6")):
            pr = predictions(sid, lo, hi, interval)
            ev = T.tide_extrema([p["t"].replace(" ", "T") for p in pr], [float(p["v"]) for p in pr])
            errs = compare(hilo, ev)
            row[label] = summary(errs, sum(1 for e in ev if day0 <= e["time"] < stop))
            row[label + "_errors_min"] = [None if e is None else round(e, 1) for e in errs]
            hs = compare_heights(hilo, ev)
            hm = [abs(h) for h in hs if h is not None]
            row[label]["median_abs_h_m"] = round(st.median(hm), 4) if hm else None
            row[label]["max_abs_h_m"] = round(max(hm), 4) if hm else None
            row[label + "_height_errors_m"] = [None if h is None else round(h, 4) for h in hs]
            row[label + "_events"] = [[e["time"].strftime("%m-%dT%H:%M"), e["type"], round(e["level_m"], 3)]
                                      for e in ev if day0 <= e["time"] < stop]
        out["gauges"][sid] = row
        print(f"{sid} {name:22s} hourly {row['hourly']}  6min {row['6min']}")
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
