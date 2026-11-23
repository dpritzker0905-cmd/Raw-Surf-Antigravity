"""gates/tide-parity-v2.md section 2: classify each parity gauge as OPEN_COAST or HARBOR_BAY by geometry, fixed in advance.

Data: NOAA NCEI ETOPO 2022 15 arc-second (ETOPO_2022_v1_15s) from NOAA CoastWatch ERDDAP, full resolution (stride 1),
box +-0.20 deg around the gauge's CO-OPS coordinates (CO-OPS mdapi station metadata). WATER: z < 0 m. DEEP: z <= -20 m.
  1. start  = the water cell nearest the gauge.
  2. d_path = shortest 8-connected path through WATER from start to any DEEP cell (km, great-circle steps between cell
     centres); target = that DEEP cell; d_line = great-circle start -> target.
  3. constriction = some path cell more than 1.0 km of path from start lies within 0.5 km of a land cell (z >= 0).
OPEN_COAST iff d_path <= 8.0 km AND d_path <= 1.30 * d_line AND no constriction. Else HARBOR_BAY. A box that cannot be
read, or with no DEEP cell reachable through water, is UNCLASSIFIED. The thresholds are the gate's; do not change them.

Read-only: ERDDAP (ETOPO) and CO-OPS mdapi. No bucket, no live backend, no water levels, no predictions.

    python scripts/tide_datum/gauge_class.py --json gauge_class.json
"""
import argparse
import csv
import heapq
import io
import json
import math
import sys
import time
import urllib.request
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "tide_own"))
from own_rules import G3T_M  # noqa: E402

ERDDAP = "https://coastwatch.pfeg.noaa.gov/erddap/griddap/ETOPO_2022_v1_15s.csv"
MDAPI = "https://api.tidesandcurrents.noaa.gov/mdapi/prod/webapi/stations/{}.json"
UA = {"User-Agent": "raw-surf-research/1.0"}
BOX_DEG, DEEP_M, MAX_PATH_KM, DETOUR, SKIP_KM, NARROW_KM = 0.20, -20.0, 8.0, 1.30, 1.0, 0.5


def km(a, b):
    (la1, lo1), (la2, lo2) = a, b
    p1, p2 = math.radians(la1), math.radians(la2)
    h = math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lo2 - lo1) / 2) ** 2
    return 2 * 6371.0 * math.asin(min(1.0, math.sqrt(h)))


def _get(url, as_json):
    for attempt in range(4):
        try:
            with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=180) as r:
                body = r.read().decode("utf-8")
            return json.loads(body) if as_json else body
        except Exception:
            if attempt == 3:
                raise
            time.sleep(4 + 4 * attempt)


def coords(sid):
    s = _get(MDAPI.format(sid), True)["stations"][0]
    return float(s["lat"]), float(s["lng"]), s["name"]


def grid(lat, lng):
    q = (f"?z%5B({lat - BOX_DEG:.6f}):1:({lat + BOX_DEG:.6f})%5D%5B({lng - BOX_DEG:.6f}):1:({lng + BOX_DEG:.6f})%5D")
    rows = list(csv.reader(io.StringIO(_get(ERDDAP + q, False))))
    g = {}
    for d in rows[2:]:
        try:
            g[(round(float(d[0]), 6), round(float(d[1]), 6))] = float(d[2])
        except (ValueError, IndexError):
            continue
    lats, lons = sorted({k[0] for k in g}), sorted({k[1] for k in g})
    return g, lats, lons


def classify(lat, lng, g, lats, lons):
    """PURE given the grid: the class and the rule's numbers."""
    if not g:
        return {"class": "UNCLASSIFIED", "why": "no ETOPO cells"}
    ia = {v: i for i, v in enumerate(lats)}
    io_ = {v: i for i, v in enumerate(lons)}
    z = {(ia[a], io_[o]): v for (a, o), v in g.items()}
    ny, nx = len(lats), len(lons)
    pos = lambda c: (lats[c[0]], lons[c[1]])  # noqa: E731
    water = [c for c, v in z.items() if v < 0]
    if not water:
        return {"class": "UNCLASSIFIED", "why": "no water in box"}
    start = min(water, key=lambda c: km((lat, lng), pos(c)))
    dist, prev, heap, target = {start: 0.0}, {}, [(0.0, start)], None
    while heap:
        d, c = heapq.heappop(heap)
        if d > dist.get(c, 1e18):
            continue
        if z[c] <= DEEP_M:
            target = c
            break
        if d > 3 * MAX_PATH_KM:
            break
        for dy in (-1, 0, 1):
            for dx in (-1, 0, 1):
                n = (c[0] + dy, c[1] + dx)
                if (dy or dx) and 0 <= n[0] < ny and 0 <= n[1] < nx and z.get(n, 1) < 0:
                    nd = d + km(pos(c), pos(n))
                    if nd < dist.get(n, 1e18):
                        dist[n], prev[n] = nd, c
                        heapq.heappush(heap, (nd, n))
    if target is None:
        return {"class": "UNCLASSIFIED", "why": "no DEEP cell reachable through water within the box",
                "start": pos(start)}
    path, c = [target], target
    while c != start:
        c = prev[c]
        path.append(c)
    path.reverse()
    d_path, d_line = dist[target], km(pos(start), pos(target))
    land = [pos(c) for c, v in z.items() if v >= 0]
    narrow = None
    for c in path:
        if dist[c] <= SKIP_KM:
            continue
        p = pos(c)
        near = [x for x in land if abs(x[0] - p[0]) < 0.006 and abs(x[1] - p[1]) < 0.006 / max(0.2, math.cos(math.radians(p[0])))]
        if any(km(p, x) <= NARROW_KM for x in near):
            narrow = {"at": [round(p[0], 4), round(p[1], 4)], "path_km": round(dist[c], 2)}
            break
    ok = d_path <= MAX_PATH_KM and d_path <= DETOUR * max(d_line, 1e-9) and narrow is None
    return {"class": "OPEN_COAST" if ok else "HARBOR_BAY", "d_path_km": round(d_path, 2), "d_line_km": round(d_line, 2),
            "detour": round(d_path / d_line, 3) if d_line > 0 else None, "constriction": narrow,
            "start": [round(pos(start)[0], 4), round(pos(start)[1], 4)],
            "target": [round(pos(target)[0], 4), round(pos(target)[1], 4)], "target_z_m": z[target],
            "fails": [k for k, bad in (("d_path>8km", d_path > MAX_PATH_KM), ("detour>1.30", d_path > DETOUR * d_line),
                                        ("constriction", narrow is not None)) if bad]}


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--json")
    a = ap.parse_args(argv)
    out = {"schema": "raw-surf/tide-parity-v2-gauge-class/1", "rule": "gates/tide-parity-v2.md section 2",
           "data": "NOAA NCEI ETOPO 2022 15s via CoastWatch ERDDAP; CO-OPS mdapi coordinates", "gauges": {}}
    for sid in G3T_M:
        try:
            lat, lng, name = coords(sid)
            g, lats, lons = grid(lat, lng)
            row = classify(lat, lng, g, lats, lons)
        except Exception as e:                                    # noqa: BLE001 - one gauge's failure is reported
            lat = lng = name = None
            row = {"class": "UNCLASSIFIED", "why": f"{type(e).__name__}"}
        row.update(name=name, lat=lat, lng=lng)
        out["gauges"][sid] = row
        print(sid, name, row["class"], row.get("d_path_km"), row.get("detour"), row.get("fails", row.get("why")))
    if a.json:
        Path(a.json).write_text(json.dumps(out, indent=1) + "\n", encoding="utf-8")


if __name__ == "__main__":
    main()
