"""The gauge-by-gauge timing attribution table for gates/tide-parity-v2.md (the timing gate (b); LongCat's safeguard).

For each of v1's 26 gauges: NOAA's OWN gauge-vs-open-coast High/Low lag beside our timing error. The comparator is
chosen by RULE, never by hand:
  * an OPEN_COAST gauge (gauge_class.py, the gate's pre-committed rule) is its own coast: lag 0 by definition;
  * any other gauge: the NEAREST NOAA tide-prediction station within 30 km (CO-OPS mdapi type=tidepredictions,
    excluding the gauge) that the SAME rule classifies OPEN_COAST; none within 30 km = "no comparator".
Lag = NOAA hilo time at the gauge minus at the comparator, same-type events within 4 h, median over the window.

Our error: v1's per-gauge median |time| (run 45093427404; UNSIGNED, as v1's artifact holds). The SIGNED column is filled
by v2's run (#1171's instrument). If ours tracks NOAA's own lag at a gauge, the atlas tide reads the open coast there.

Read-only: CO-OPS mdapi and predictions, NOAA CoastWatch ERDDAP (ETOPO). No bucket, no live backend, no water levels.

    python scripts/tide_datum/timing_attribution.py --start 2026-11-23 --classes <gauge_class json> --v1 <v1 json>
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
sys.path.insert(0, str(HERE))
import gauge_class as GC  # noqa: E402

COOPS = "https://api.tidesandcurrents.noaa.gov/api/prod/datagetter"
STATIONS = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations.json?type=tidepredictions"
RADIUS_KM = 30.0
MAX_CANDIDATES = 6


def _get_json(url):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=GC.UA), timeout=90) as r:
                return json.loads(r.read().decode("utf-8"))
        except Exception:
            if attempt == 3:
                raise
            time.sleep(4 + 4 * attempt)


def hilo(sid, begin, end):
    q = (f"{COOPS}?product=predictions&application=raw_surf_attribution&station={sid}"
         f"&begin_date={begin:%Y%m%d %H:%M}&end_date={end:%Y%m%d %H:%M}&datum=MLLW&units=metric&time_zone=gmt"
         f"&interval=hilo&format=json").replace(" ", "%20")
    rows = _get_json(q).get("predictions", [])
    return [(datetime.strptime(r["t"], "%Y-%m-%d %H:%M").replace(tzinfo=timezone.utc), r["type"])
            for r in rows if r.get("type") in ("H", "L")]


def lag_minutes(gauge, coast):
    """PURE: median of (gauge time - nearest same-type coast time within 4 h), minutes; None when nothing pairs."""
    out = []
    for t0, k in gauge:
        c = [(t0 - t).total_seconds() / 60.0 for t, kk in coast if kk == k and abs((t - t0).total_seconds()) <= 4 * 3600]
        if c:
            out.append(min(c, key=abs))
    return (round(st.median(out), 1), len(out)) if out else (None, 0)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--days", type=int, default=7)
    ap.add_argument("--classes", required=True)
    ap.add_argument("--v1", required=True)
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    day0 = datetime.fromisoformat(a.start).replace(tzinfo=timezone.utc)
    stop = day0 + timedelta(days=a.days)
    classes = json.loads(Path(a.classes).read_text(encoding="utf-8"))["gauges"]
    v1 = json.loads(Path(a.v1).read_text(encoding="utf-8"))["per_gauge"]
    tp = _get_json(STATIONS)["stations"]
    out = {"window": [a.start, a.days], "rule": "comparator = self if OPEN_COAST, else nearest OPEN_COAST prediction "
           "station within 30 km (gauge_class rule)", "gauges": {}}
    for sid, c in classes.items():
        row = {"name": c.get("name"), "class": c["class"], "v1_abs_time_median_min": (v1.get(sid) or {}).get("model", {})
               .get("time_median_min"), "our_signed_time_median_min": None}
        if c["class"] == "OPEN_COAST":
            row.update(comparator=sid, comparator_name="itself", lag_min=0.0, paired=None)
        else:
            near = sorted(((GC.km((c["lat"], c["lng"]), (float(s["lat"]), float(s["lng"]))), s) for s in tp
                           if s["id"] != sid), key=lambda x: x[0])
            near = [(d, s) for d, s in near if d <= RADIUS_KM][:MAX_CANDIDATES]
            tried = []
            for d, s in near:
                try:
                    g, la, lo = GC.grid(float(s["lat"]), float(s["lng"]))
                    k = GC.classify(float(s["lat"]), float(s["lng"]), g, la, lo)["class"]
                except Exception as e:                            # noqa: BLE001
                    k = f"error {type(e).__name__}"
                tried.append([s["id"], s["name"], round(d, 1), k])
                if k == "OPEN_COAST":
                    lag, n = lag_minutes(hilo(sid, day0, stop), hilo(s["id"], day0 - timedelta(hours=6), stop + timedelta(hours=6)))
                    row.update(comparator=s["id"], comparator_name=s["name"], comparator_km=round(d, 1), lag_min=lag, paired=n)
                    break
            else:
                row.update(comparator=None, comparator_name="no OPEN_COAST prediction station within 30 km", lag_min=None)
            row["candidates_tried"] = tried
        out["gauges"][sid] = row
        print(sid, row["name"], row["class"], "| v1 |t|", row["v1_abs_time_median_min"], "| NOAA lag", row.get("lag_min"),
              "vs", row.get("comparator_name"), flush=True)
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
