"""SCOREBOARD S11: far-zoom series completeness from the STORED field. Replays the CLIENT'S exact world-scale grid_series page against a
serve API and reports, per page, how many of the requested forecast hours came back and how long it took.

WHY (commitment 228, 2026-09-30): the owner saw no swell at far zoom on forecast hours until zooming in. A monitor
that asked for 6 hours always got 6 back, so it never saw the defect: the client asks for 48 three-hourly offsets
per page and grid_series' 20 s deadline cut the tail (30/48 alone, 16/48 beside its sibling page). Probe with the
consumer's request shape, not a convenient one (LESSONS L-P19).

The request is built as frontend/src/components/map/marineGridSeries.js builds it at a >15 deg viewport:
  bbox    = GLOBAL_REQUEST_BBOX (-180,-80,180,85)             (marineBboxGeometry.normalizeRequestBbox)
  hours   = page*144 - phase .. page*144 + 141 - phase, step 3  (buildPageHours, PAGE_SPAN_HOURS 144, cap 336)
  phase   = anchor hour % 3                                     (seriesAnchor.seriesGridPhase)
  anchor  = the hour-ROUNDED clock, sent as base_time           (seriesAnchor.seriesAnchorParam)
Mode `par2` runs pages 0 and 1 at once, as the client's two series slots do (marineSeriesLimiter).

Read-only GETs; no credentials. Usage:
  python scripts/series_page_probe.py [--mode seq|par2] [--layer waves] [--model GFS] [--out rows.jsonl]
Base URL: RAW_SURF_BASE_URL (default the Render dev backend).
"""
import argparse
import json
import os
import threading
import time
import urllib.parse
import urllib.request
from datetime import datetime, timedelta, timezone

BASE = os.environ.get("RAW_SURF_BASE_URL", "https://raw-surf-antigravity.onrender.com")
# A frame from the STORED field names its direct-pipeline origin; the live Open-Meteo lane names open-meteo
# (series_source_policy._STORED_UPSTREAMS is the server side of the same list).
STORED_UPSTREAMS = ("noaa", "dwd", "ecmwf", "copernicus")
GLOBAL_REQUEST_BBOX = "-180.0000,-80.0000,180.0000,85.0000"
PAGE_SPAN_HOURS, MAX_HOURS, CADENCE = 144, 336, 3


def client_anchor(now=None):
    now = now or datetime.now(timezone.utc)
    return (now + timedelta(minutes=30)).replace(minute=0, second=0, microsecond=0)   # the browser ROUNDS


def page_hours(page, anchor):
    phase = int(anchor.timestamp() // 3600) % CADENCE
    start = page * PAGE_SPAN_HOURS - phase
    end = min(page * PAGE_SPAN_HOURS + PAGE_SPAN_HOURS - CADENCE - phase, MAX_HOURS)
    return list(range(start, end + 1, CADENCE))


def probe_page(page, anchor, model, layer, timeout=60):
    hours = page_hours(page, anchor)
    q = urllib.parse.urlencode({"model": model, "domain": "marine", "layer": layer, "bbox": GLOBAL_REQUEST_BBOX,
                                "hours": ",".join(map(str, hours)),
                                "base_time": anchor.strftime("%Y-%m-%dT%H:%M:%S.000Z")})
    row = {"page": page, "requested": len(hours), "model": model, "layer": layer,
           "at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")}
    t0 = time.time()
    body = b""
    try:
        req = urllib.request.Request(f"{BASE}/api/weather/grid_series?{q}", headers={"User-Agent": "series-page-probe"})
        with urllib.request.urlopen(req, timeout=timeout) as r:
            body, row["status"] = r.read(), r.status
    except Exception as e:  # a probe reports, it never raises
        row["status"] = f"ERR {type(e).__name__}"
    row["secs"] = round(time.time() - t0, 2)
    if body:
        d = json.loads(body)
        got = {f.get("hour_offset") for f in d.get("frames") or [] if f.get("vectors")}
        row["frames"] = len(got)
        row["stored"] = sum(1 for f in d.get("frames") or []
                            if f.get("vectors") and f.get("upstream_provider") in STORED_UPSTREAMS)
        row["missing"] = [h for h in hours if h not in got]
        frames = d.get("frames") or []
        row["region"] = frames[0].get("region_id") if frames else None
        row["grid"] = [frames[0].get("cols"), frames[0].get("rows")] if frames else None
        row["bytes"] = len(body)
    return row


def run(mode="seq", model="GFS", layer="waves"):
    anchor = client_anchor()
    rows = []
    if mode == "par2":
        out = {}
        threads = [threading.Thread(target=lambda p=p: out.__setitem__(p, probe_page(p, anchor, model, layer)))
                   for p in (0, 1)]
        [t.start() for t in threads]
        [t.join() for t in threads]
        rows += [out[0], out[1], probe_page(2, anchor, model, layer)]
    else:
        rows += [probe_page(p, anchor, model, layer) for p in (0, 1, 2)]
    for r in rows:
        r["mode"] = mode
    return rows


def main():
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--mode", choices=("seq", "par2"), default="seq")
    ap.add_argument("--model", default="GFS")
    ap.add_argument("--layer", default="waves")
    ap.add_argument("--out", default=None, help="append one JSON line per page")
    a = ap.parse_args()
    rows = run(a.mode, a.model, a.layer)
    for r in rows:
        print(f"{r['mode']} {r['model']} {r['layer']} page {r['page']}: {r.get('status')} {r['secs']} s, "
              f"{r.get('frames')}/{r['requested']} frames ({r.get('stored')} stored, grid {r.get('grid')}), "
              f"first missing {(r.get('missing') or [])[:6]}")
    done = sum(r.get("frames") or 0 for r in rows)
    stored = sum(r.get("stored") or 0 for r in rows)
    asked = sum(r["requested"] for r in rows)
    # S11 is the STORED share: a page can return every hour and still serve the 15-deg live grid (00:13Z 10-01).
    print(f"returned {done}/{asked} = {done / asked:.1%}; S11 served from the stored field {stored}/{asked} = {stored / asked:.1%}")
    if a.out:
        with open(a.out, "a", encoding="utf-8") as fh:
            for r in rows:
                fh.write(json.dumps(r) + "\n")


if __name__ == "__main__":
    main()
