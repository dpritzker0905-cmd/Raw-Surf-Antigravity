"""Leave-one-out error of the US display datum's station sources (offline; reads the committed station table only).

For every US CO-OPS station that publishes MSL and MLLW, hide it and predict its MSL - MLLW (D) from the OTHERS with
the served rules (services/weather_pipeline/tide_datum.py):
  gauge-at-distance  the nearest other station within GAUGE_KM / 5 / 10 / 20 km: the error a point that far from a gauge
                     inherits when it takes that gauge's sheet;
  interpolated       tide_datum.interpolate (inverse-distance over <= 4 stations within INTERP_KM, refused when they
                     disagree by more than INTERP_MAX_SPREAD).
Reports n, median and 90th-percentile |error| (m) and the relative error, overall and per region, plus the refusal
rate. This is the measured accuracy behind each source's use; the model source (our 19-year FES computation) was
measured separately by G3t item 4 (0.0135 m median at the gauges).

Usage (from backend/):  python scripts/tide_datum/loo_check.py [--json out.json]
"""
import argparse
import json
import os
import statistics as st
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from services.weather_pipeline import tide_datum as TD          # noqa: E402
from services.weather_pipeline.tide_us_region import us_region   # noqa: E402


def q(xs, p):
    xs = sorted(xs)
    if not xs:
        return None
    i = min(len(xs) - 1, max(0, int(round(p * (len(xs) - 1)))))
    return xs[i]


def summary(errs, rels):
    return {"n": len(errs), "median_abs_m": round(st.median(errs), 4) if errs else None,
            "p90_abs_m": round(q(errs, 0.9), 4) if errs else None,
            "median_rel": round(st.median(rels), 4) if rels else None,
            "p90_rel": round(q(rels, 0.9), 4) if rels else None}


def run(stations):
    rows = {f"gauge<={TD.GAUGE_KM:g}km": ([], []), "gauge<=5km": ([], []), "gauge<=10km": ([], []),
            "gauge<=20km": ([], []), "interpolated": ([], [])}
    by_region, tried, refused = {}, 0, 0
    for s in stations:
        region = us_region(s["lat"], s["lng"])
        for radius, name in ((TD.GAUGE_KM, f"gauge<={TD.GAUGE_KM:g}km"), (5.0, "gauge<=5km"), (10.0, "gauge<=10km"),
                             (20.0, "gauge<=20km")):
            nb = TD.neighbours(s["lat"], s["lng"], radius, stations, exclude_id=s["id"])
            if nb:
                e = abs(nb[0][1]["d"] - s["d"])
                rows[name][0].append(e)
                rows[name][1].append(e / s["d"])
        tried += 1
        got = TD.interpolate(s["lat"], s["lng"], stations, exclude_id=s["id"])
        if got is None:
            refused += 1
            continue
        e = abs(got[0] - s["d"])
        rows["interpolated"][0].append(e)
        rows["interpolated"][1].append(e / s["d"])
        by_region.setdefault(region, ([], []))
        by_region[region][0].append(e)
        by_region[region][1].append(e / s["d"])
    return {"stations": len(stations), **{k: summary(*v) for k, v in rows.items()},
            "interpolated_refused": refused, "interpolated_tried": tried,
            "interpolated_by_region": {k: summary(*v) for k, v in sorted(by_region.items(), key=lambda t: str(t[0]))}}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    a = ap.parse_args(argv)
    stations = TD._load_stations()
    out = run(stations)
    print(json.dumps(out, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
