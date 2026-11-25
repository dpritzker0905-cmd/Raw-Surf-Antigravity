"""Does the tidal datum EPOCH move MSL - MLLW (D)? Measured from CO-OPS's own superseded datums (READ-ONLY, datums only).

The US display (services/weather_pipeline/tide_datum.py) uses D as published and REMOVES our mean level M. That rests
on one claim: the epoch moves the MEAN (sea level rises between epochs) but barely moves the RANGE D. This script
measures both at the same stations, on the same station datum, between the superseded epoch (mostly 1960-1978) and
the present one (1983-2001, or a station's modified epoch):
  dMSL = MSL(present) - MSL(superseded)          the mean's move between epochs (what a naive sum carries)
  dD   = D(present)   - D(superseded)            the range's move (what using D as published risks)
Reads: the station list (type=waterlevels, the long-record stations that have superseded datums) and, per station,
  .../stations/{id}/datums.json and .../stations/{id}/supersededdatums.json  (metric). Nothing else.

Usage (from backend/):  python scripts/tide_datum/epoch_check.py [--json out.json] [--pause 0.3]
"""
import argparse
import json
import os
import statistics as st
import sys
import time

sys.path.insert(0, os.path.dirname(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))
from fetch_coops_datums import API, _get, offset_from_datums      # noqa: E402
from services.weather_pipeline.tide_us_region import us_region     # noqa: E402


def msl_of(doc):
    for d in (doc or {}).get("datums") or []:
        if d.get("name") == "MSL" and isinstance(d.get("value"), (int, float)):
            return float(d["value"])
    return None


def pair(cur, sup):
    """PURE: {dD, dMSL, epochs} for one station's present and superseded datum documents, or None."""
    a, b = offset_from_datums(cur), offset_from_datums(sup)
    ma, mb = msl_of(cur), msl_of(sup)
    if a is None or b is None or ma is None or mb is None:
        return None
    return {"dD": round(a[0] - b[0], 4), "dMSL": round(ma - mb, 4), "D": a[0], "epoch": a[1], "superseded_epoch": b[1]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json", default=None)
    ap.add_argument("--pause", type=float, default=0.3)
    a = ap.parse_args(argv)
    stations = _get(f"{API}/stations.json?type=waterlevels")["stations"]
    rows = []
    for s in stations:
        if s.get("greatlakes") or not us_region(s["lat"], s["lng"]):
            continue
        sid = str(s["id"])
        try:
            cur = _get(f"{API}/stations/{sid}/datums.json?units=metric")
            time.sleep(a.pause)
            sup = _get(f"{API}/stations/{sid}/supersededdatums.json?units=metric")
            time.sleep(a.pause)
        except Exception as e:                                   # noqa: BLE001
            print(f"{sid}: {type(e).__name__}", file=sys.stderr)
            continue
        p = pair(cur, sup)
        if p is not None:
            rows.append(dict(p, id=sid, name=s.get("name"), region=us_region(s["lat"], s["lng"])))
    dd = [abs(r["dD"]) for r in rows]
    dm = [r["dMSL"] for r in rows]
    out = {"n": len(rows), "abs_dD_median_m": round(st.median(dd), 4) if dd else None,
           "abs_dD_max_m": round(max(dd), 4) if dd else None,
           "dMSL_median_m": round(st.median(dm), 4) if dm else None, "rows": rows}
    print(json.dumps({k: v for k, v in out.items() if k != "rows"}, indent=1))
    if a.json:
        with open(a.json, "w", encoding="utf-8") as fh:
            json.dump(out, fh, indent=1)


if __name__ == "__main__":
    main()
