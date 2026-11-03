#!/usr/bin/env python3
"""build_spectral_k_tables.py — OFFLINE builder of the SURF_SPECTRAL_K tables (California, CDIP MOP ray K).

Fetches, from CDIP's public THREDDS (`cdip/model/R_CA_coefficients`, OPeNDAP `.ascii`), the published per-point
transfer coefficients for every California catalogue spot (`data/mop_spot_cells.json`: cells + uncovered) and every
California nearshore buoy in an evaluation station list, and writes two committed files:

  backend/data/spectral_k_ca.json   index: per entry the MOP label, coordinates, depth, shore normal, shoreFlag,
                                    distance, and the row it occupies in the arrays
  backend/data/spectral_k_ca.npz    swl_et [N, 10, 72] and sea_et [N, 17, 72] as float16 (3,888 B per entry) plus
                                    the two frequency axes (float32)

SELECTION (pre-registered 2026-11-03): the NEAREST MOP point with shoreFlag == 1 (planar natural coast, the points
CDIP marks fit for surf modelling) within 1.0 km of a spot, or 3.0 km of a buoy. Candidates are tried nearest first,
their shoreFlag read first by a tiny `.ascii?shoreFlag` request; a target with none keeps the bulk chain (it gets no
entry, and the index lists it).

POLITENESS: one catalog GET (or --catalog-file), then one small GET per candidate point, sequential, paused, cached
in --cache-dir (never inside the repository). No credentials; never the app or its backend.

    python scripts/build_spectral_k_tables.py --cache-dir C:/t/ssk-kcache \
        --stations scripts/eval_harness_stations_ca.json
"""
import argparse
import json
import math
import os
import re
import sys
import time
import urllib.request
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
THREDDS = "https://thredds.cdip.ucsd.edu/thredds"
CATALOG = THREDDS + "/catalog/cdip/model/R_CA_coefficients/catalog.xml"
DODS = THREDDS + "/dodsC/"
VARS = "latitude,longitude,depth,shoreNormal,shoreFlag,swellFrequency,seaFrequency,direction,label,swl_et,sea_et"
SPOT_MAX_KM, STATION_MAX_KM, MAX_CANDIDATES = 1.0, 3.0, 60
OUT_JSON = os.path.join(BACKEND, "data", "spectral_k_ca.json")
OUT_NPZ = os.path.join(BACKEND, "data", "spectral_k_ca.npz")
_PT = re.compile(r"(cdip/model/R_CA_coefficients/([A-Z]+\d+)_([\d.]+)(-[\d.]+)_ref\.nc)")


def km(lat1, lng1, lat2, lng2):
    p1, p2 = math.radians(lat1), math.radians(lat2)
    a = (math.sin((p2 - p1) / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(math.radians(lng2 - lng1) / 2) ** 2)
    return 2 * 6371.0 * math.asin(math.sqrt(a))


def parse_catalog(text: str) -> list:
    """[(path, label, lat, lng)] from catalog.xml or a list of dataset paths. PURE."""
    seen, out = set(), []
    for m in _PT.finditer(text):
        if m.group(1) not in seen:
            seen.add(m.group(1))
            out.append((m.group(1), m.group(2), float(m.group(3)), float(m.group(4))))
    return out


def parse_ascii(text: str) -> dict:
    """OPeNDAP .ascii -> {name: float | str | ndarray}. Grid arrays keep their shape; map copies are ignored. PURE."""
    body = text.split("---------------------------------------------", 1)[-1]
    out, cur, rows = {}, None, []

    def flush():
        nonlocal cur, rows
        if cur is not None:
            name, shape = cur
            vals = []
            for r in rows:
                if r.startswith("["):
                    r = r.split("],", 1)[1] if "]," in r else r.split("]", 1)[1]
                vals += [float(x) for x in r.split(",") if x.strip()]
            a = np.array(vals, dtype=float)
            if shape and int(np.prod(shape)) == a.size:
                a = a.reshape(shape)
            if name not in out:
                out[name] = a
        cur, rows = None, []

    for ln in body.strip("\n").split("\n"):
        s = ln.strip()
        if not s:
            flush()
            continue
        m = re.match(r"^([A-Za-z_][\w.]*)((\[\d+\])+)$", s)
        if m:
            flush()
            cur = (m.group(1).split(".")[-1], tuple(int(x) for x in re.findall(r"\[(\d+)\]", m.group(2))))
            continue
        m2 = re.match(r"^([A-Za-z_][\w.]*), (.*)$", ln)
        if m2 and cur is None:
            v = m2.group(2).strip()
            try:
                out[m2.group(1).split(".")[-1]] = float(v)
            except ValueError:
                out[m2.group(1).split(".")[-1]] = v.strip('"')
            continue
        if cur is not None:
            rows.append(s)
    flush()
    return out


def fetch(url: str, cache_path: str, pause_s: float) -> str:
    if os.path.exists(cache_path):
        with open(cache_path, encoding="utf-8") as f:
            return f.read()
    if not url.startswith(THREDDS + "/"):
        raise ValueError(f"refusing a non-CDIP URL: {url}")
    req = urllib.request.Request(url, headers={"User-Agent": "raw-surf spectral-k table builder (offline, public data)"})
    with urllib.request.urlopen(req, timeout=120) as r:
        txt = r.read().decode("utf-8", "replace")
    os.makedirs(os.path.dirname(cache_path), exist_ok=True)
    with open(cache_path, "w", encoding="utf-8", newline="\n") as f:
        f.write(txt)
    time.sleep(pause_s)
    return txt


def targets(stations_path):
    with open(os.path.join(BACKEND, "data", "mop_spot_cells.json"), encoding="utf-8") as f:
        cells = json.load(f)
    out = [{"kind": "spot", "key": f"spot:{c['spot_id']}", "name": c["name"], "lat": float(c["lat"]),
            "lng": float(c["lng"]), "max_km": SPOT_MAX_KM}
           for c in (cells.get("cells") or []) + (cells.get("uncovered") or [])]
    if stations_path:
        with open(stations_path, encoding="utf-8") as f:
            for s in json.load(f).get("stations", []):
                if s.get("role") == "nearshore":
                    out.append({"kind": "station", "key": f"station:{s['id']}", "name": s["id"], "lat": float(s["lat"]),
                                "lng": float(s["lng"]), "max_km": STATION_MAX_KM, "station_depth_m": s.get("depth_m")})
    return out


def choose(target, points, load, flag_of):
    """The nearest shoreFlag-1 point within the target's radius (at most MAX_CANDIDATES tried), or None."""
    near = sorted(((km(target["lat"], target["lng"], la, lo), p, lab, la, lo) for p, lab, la, lo in points
                   if abs(la - target["lat"]) < 0.05 and abs(lo - target["lng"]) < 0.06), key=lambda x: x[0])
    tried = []
    for d, path, lab, la, lo in near[:MAX_CANDIDATES]:
        if d > target["max_km"]:
            break
        flag = flag_of(path, lab)
        tried.append({"label": lab, "km": round(d, 3), "shoreFlag": flag})
        if flag == 1:
            return load(path, lab), d, tried
    return None, None, tried[:8]


def main(argv=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--stations", default=os.path.join(HERE, "eval_harness_stations_ca.json"))
    ap.add_argument("--catalog-file", default=None, help="a saved catalog.xml (or a list of dataset paths)")
    ap.add_argument("--pause-s", type=float, default=0.5)
    a = ap.parse_args(argv)
    cat = (open(a.catalog_file, encoding="utf-8").read() if a.catalog_file
           else fetch(CATALOG, os.path.join(a.cache_dir, "catalog.xml"), a.pause_s))
    points = parse_catalog(cat)
    if len(points) < 1000:
        print(f"catalog parsed {len(points)} points; expected ~11,594")
        return 2

    def load(path, label):
        return parse_ascii(fetch(f"{DODS}{path}.ascii?{VARS}", os.path.join(a.cache_dir, "coef", f"{label}.ascii"),
                                 a.pause_s))

    def flag_of(path, label):
        c = os.path.join(a.cache_dir, "coef", f"{label}.ascii")
        if os.path.exists(c):
            return int(parse_ascii(open(c, encoding="utf-8").read()).get("shoreFlag", 0))
        return int(parse_ascii(fetch(f"{DODS}{path}.ascii?shoreFlag", os.path.join(a.cache_dir, "flag", f"{label}.ascii"),
                                     a.pause_s)).get("shoreFlag", 0))

    entries, swl, sea, missing, axes = [], [], [], [], None
    for t in targets(a.stations):
        rec, d, tried = choose(t, points, load, flag_of)
        if rec is None:
            missing.append({"key": t["key"], "name": t["name"], "lat": t["lat"], "lng": t["lng"], "tried": tried})
            continue
        sw, se = np.asarray(rec["swl_et"], float), np.asarray(rec["sea_et"], float)
        if sw.shape != (10, 72) or se.shape != (17, 72) or not np.allclose(rec["direction"], np.arange(5, 361, 5)):
            missing.append({"key": t["key"], "name": t["name"], "reason": f"shape {sw.shape}/{se.shape}"})
            continue
        ax = (tuple(np.round(rec["swellFrequency"], 4)), tuple(np.round(rec["seaFrequency"], 4)))
        if axes is None:
            axes = ax
        elif ax != axes:
            missing.append({"key": t["key"], "name": t["name"], "reason": "frequency axes differ"})
            continue
        entries.append({"key": t["key"], "kind": t["kind"], "name": t["name"], "lat": t["lat"], "lng": t["lng"],
                        "row": len(swl), "label": rec.get("label"), "mop_lat": round(float(rec["latitude"]), 5),
                        "mop_lng": round(float(rec["longitude"]), 5), "km": round(d, 3),
                        "depth_m": round(float(rec["depth"]), 3), "shore_normal": float(rec["shoreNormal"]),
                        "shore_flag": int(rec["shoreFlag"]),
                        **({"station_depth_m": t["station_depth_m"]} if t.get("station_depth_m") else {})})
        swl.append(sw)
        sea.append(se)
    np.savez_compressed(OUT_NPZ, swl_et=np.array(swl, dtype=np.float16), sea_et=np.array(sea, dtype=np.float16),
                        swell_freq=np.array(axes[0], dtype=np.float32), sea_freq=np.array(axes[1], dtype=np.float32))
    idx = {"version": 1, "generated_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
           "source": DODS + "cdip/model/R_CA_coefficients (CDIP MOP ray coefficients, public)",
           "generator": "backend/scripts/build_spectral_k_tables.py",
           "criteria": {"shore_flag": 1, "spot_max_km": SPOT_MAX_KM, "station_max_km": STATION_MAX_KM,
                        "max_candidates": MAX_CANDIDATES},
           "storage": "spectral_k_ca.npz: swl_et [N,10,72], sea_et [N,17,72] float16 (3,888 B per entry)",
           "n_entries": len(entries), "entries": entries, "missing": missing}
    with open(OUT_JSON, "w", encoding="utf-8", newline="\n") as f:
        json.dump(idx, f, indent=1)
        f.write("\n")
    print(f"{len(entries)} entries ({sum(e['kind'] == 'spot' for e in entries)} spots, "
          f"{sum(e['kind'] == 'station' for e in entries)} stations), {len(missing)} without a shoreFlag-1 point; "
          f"npz {os.path.getsize(OUT_NPZ)} B")
    return 0


if __name__ == "__main__":
    sys.exit(main())
