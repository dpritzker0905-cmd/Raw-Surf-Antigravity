"""Do the parity run's timing failures sit in harbours whose tide lags the open coast? (2026-11-23)

The served event finder is not the cause (finder_check.py: on NOAA's own curve it reproduces NOAA's High/Low times
within a median 1-2 min at every gauge). This compares NOAA's OWN hilo predictions at each failing gauge (inside a bay,
harbour or river mouth) with a nearby NOAA prediction station nearer the open coast, over the parity window. If NOAA
itself puts the gauge tens of minutes to hours behind the coast, a global atlas (FES2022b) that resolves the open coast
and not the bay will read "late/early" against the gauge by about that much, while being right for an open-coast spot.

Read-only CO-OPS predictions (hilo, MLLW, GMT). No FES, no bucket, no live backend.
"""
import argparse
import json
import statistics as st
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
from finder_check import predictions, _t  # noqa: E402

PAIRS = [  # (failing gauge, parity |t| median min, open-coast station, description)
    ("8729840", 163.7, "8729807", "Pensacola (bay) vs Pensacola Beach Pier (Gulf front)"),
    ("8723214", 43.4, "8723178", "Virginia Key (Bear Cut) vs Government Cut, Miami Harbor entrance"),
    ("8720030", 39.8, "8679997", "Fernandina (Amelia River) vs St. Marys Entrance, North Jetty"),
    ("8531680", 25.2, "8531804", "Sandy Hook (Fort Hancock) vs Sea Bright (ocean beach)"),
    ("9755371", 24.1, "9754986", "San Juan (harbour) vs Boca de Cangrejos"),
    ("8722670", 2.4, "8722670", "control: Lake Worth Pier (open coast, passed) vs itself"),
]


def hilo(sid, day0, stop):
    return [(_t(r["t"]), "High" if r["type"] == "H" else "Low", float(r["v"]))
            for r in predictions(sid, day0, stop, "hilo") if r.get("type") in ("H", "L")]


def lags(gauge, coast):
    """Signed minutes gauge - coast for each gauge event with a same-type coast event within 4 h."""
    out = []
    for t0, kind, _ in gauge:
        c = [(t - t0).total_seconds() / 60.0 for t, k, _ in coast if k == kind and abs((t - t0).total_seconds()) <= 4 * 3600]
        if c:
            out.append(-min(c, key=abs))
    return out


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    day0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    stop = day0 + timedelta(days=a.days)
    out = []
    for g, parity, c, desc in PAIRS:
        G, C = hilo(g, day0, stop), hilo(c, day0 - timedelta(hours=6), stop + timedelta(hours=6))
        L = lags(G, C)
        row = {"gauge": g, "coast": c, "what": desc, "parity_abs_time_median_min": parity, "n_gauge": len(G), "n_coast_in_window":
               sum(1 for t, _, _ in C if day0 <= t < stop), "paired": len(L),
               "lag_median_min": round(st.median(L), 1) if L else None,
               "lag_abs_median_min": round(st.median([abs(x) for x in L]), 1) if L else None}
        out.append(row)
        print(row)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
