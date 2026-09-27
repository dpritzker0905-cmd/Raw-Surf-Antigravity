"""build_mop_spot_cells.py — which CDIP MOP cell stands for each California catalogue spot (stage 4).

Roadmap stage 4 serves CDIP's MOP nearshore forecast as the input to the breaking step where it exists
(#124 measured MOP at 0.101 m MAE against our chain's 0.246 m at the same buoys and hours). This builds the
spot -> cell table that step reads, the way build_nearshore_pairs.py builds the validation pairs: the
regional SEA+SWELL grids, their geometry and depth, and the catalogue are all DISCOVERED (CDIP's THREDDS
catalogue and files, the production /api/surf-spots), never recalled, and the committed artifact carries
`generated_at` so a consumer can refuse a stale one. See mop_nearshore.py for why sea+swell and regional.

Usage:
    python backend/scripts/build_mop_spot_cells.py          # writes backend/data/mop_spot_cells.json
Read-only against CDIP + the production API; writes ONLY the artifact.
"""
import argparse
import json
import os
import re
import sys
import urllib.request
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from scripts.build_nearshore_pairs import fetch_spots  # noqa: E402
from services.weather_pipeline.mop_nearshore import (  # noqa: E402
    CELL_MAX_DEPTH_M, CELL_MAX_KM, CELL_MIN_DEPTH_M, MOP_GRIDS_CATALOG, MOP_GRIDS_URL, PREFERRED_BAND_M,
    PREFERRED_DEPTH_M,
    SEASWELL_SUFFIX, grid_index, grids_containing, nearest_cell, search_window, station_cell)

OUT_DEFAULT = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))),
                           "data", "mop_spot_cells.json")
UA = {"User-Agent": "raw-surf-mop-spot-cells"}


def _get(url, timeout=180):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def parse_depth_grid(txt: str) -> list:
    """Rows of an OPeNDAP ascii `metaWaterDepth[a:b][c:d]` array, in order. The map vectors that follow
    the array carry no `[n], ` prefix, so they are never read as rows. PURE."""
    rows = {}
    for m in re.finditer(r"^\[(\d+)\], ([^\n]+)$", txt, re.M):
        rows[int(m.group(1))] = [float(v) for v in m.group(2).split(",")]
    return [rows[i] for i in sorted(rows)]


def parse_grid_geometry(dds: str, lat_head: list, lng_head: list, name: str) -> dict:
    """{file, lat0, lng0, step, nlat, nlng} from a file's .dds sizes and its first two lat/lng values. PURE."""
    nlat = int(re.search(r"metaLatitude\[metaLatitude = (\d+)\]", dds).group(1))
    nlng = int(re.search(r"metaLongitude\[metaLongitude = (\d+)\]", dds).group(1))
    step = round(lat_head[1] - lat_head[0], 4)
    return {"file": name, "lat0": round(lat_head[0], 5), "lng0": round(lng_head[0], 5), "step": step,
            "nlat": nlat, "nlng": nlng}


def discover_grids() -> list:
    names = sorted(set(re.findall(r"MOP_grids/([A-Za-z]+_[\d.]+" + re.escape(SEASWELL_SUFFIX) + ")",
                                  _get(MOP_GRIDS_CATALOG))))
    grids = []
    for name in names:
        url = f"{MOP_GRIDS_URL}/{name}"
        head = _get(f"{url}.ascii?metaLatitude[0:1:1],metaLongitude[0:1:1]")
        nums = lambda v: [float(x) for x in re.search(rf"^{v}\[2\]\n([^\n]+)", head, re.M).group(1).split(",")]  # noqa: E731
        grids.append(parse_grid_geometry(_get(f"{url}.dds"), nums("metaLatitude"), nums("metaLongitude"), name))
    return grids


PAIRS = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data",
                     "nearshore_validation_pairs.json")


def cell_for_spot(grids, spot, choose=None):
    """The finest regional grid that yields a qualifying cell, with the cell; (None, None) otherwise.
    `choose(grid, depth_at, lat, lng)` picks the cell (default: a spot's `nearest_cell`)."""
    choose = choose or nearest_cell
    for g in grids_containing(grids, spot["lat"], spot["lng"]):
        ci, cj = grid_index(g, spot["lat"], spot["lng"])
        di, dj = search_window(g, spot["lat"])
        i0, i1 = max(0, ci - di), min(g["nlat"] - 1, ci + di)
        j0, j1 = max(0, cj - dj), min(g["nlng"] - 1, cj + dj)
        rows = parse_depth_grid(_get(f"{MOP_GRIDS_URL}/{g['file']}.ascii?metaWaterDepth[{i0}:1:{i1}][{j0}:1:{j1}]"))

        def depth_at(i, j, rows=rows, i0=i0, j0=j0):
            r, c = i - i0, j - j0
            return rows[r][c] if 0 <= r < len(rows) and 0 <= c < len(rows[r]) else None

        cell = choose(g, depth_at, spot["lat"], spot["lng"])
        if cell:
            return g, cell
    return None, None


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default=OUT_DEFAULT)
    args = ap.parse_args()

    grids = discover_grids()
    if not grids:
        print(f"REFUSED: no {SEASWELL_SUFFIX} grids in the MOP_grids catalogue")
        return 2
    spots = [s for s in fetch_spots() if grids_containing(grids, s["lat"], s["lng"])]
    cells, uncovered = [], []
    for s in sorted(spots, key=lambda s: (-float(s["lat"]), s["id"])):
        g, cell = cell_for_spot(grids, s)
        row = {"spot_id": s["id"], "name": s.get("name"), "lat": s["lat"], "lng": s["lng"]}
        (cells if cell else uncovered).append({**row, "grid": g["file"], "cell": cell} if cell else row)

    # The CDIP buoys too, at a cell of the BUOY's depth, so archived MOP runs can be graded at the
    # instruments the nearshore judge already reads (data/nearshore_validation_pairs.json).
    stations = []
    try:
        with open(PAIRS, encoding="utf-8") as f:
            pairs = json.load(f).get("pairs", [])
    except (OSError, ValueError):
        pairs = []
    for p in pairs:
        st = {"lat": p.get("station_lat"), "lng": p.get("station_lng")}
        depth = float(p.get("station_depth_m") or 0)
        if st["lat"] is None or st["lng"] is None or depth <= 0 or not grids_containing(grids, st["lat"], st["lng"]):
            continue
        g, cell = cell_for_spot(grids, st, lambda gg, da, la, lo, d=depth: station_cell(gg, da, la, lo, d))
        if cell:
            stations.append({"station": p["station"], "lat": st["lat"], "lng": st["lng"],
                             "depth_m": depth, "grid": g["file"], "cell": cell})

    out = {
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": f"{MOP_GRIDS_URL} (*{SEASWELL_SUFFIX}: sea + swell); spots from the production /api/surf-spots",
        "grids": grids,
        "criteria": {"min_depth_m": CELL_MIN_DEPTH_M, "max_depth_m": CELL_MAX_DEPTH_M,
                     "max_km": CELL_MAX_KM, "preferred_band_m": list(PREFERRED_BAND_M),
                     "preferred_depth_m": PREFERRED_DEPTH_M},
        "n_spots_in_grids": len(spots), "cells": cells, "uncovered": uncovered, "stations": stations,
    }
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(out, f, indent=1, ensure_ascii=False)
        f.write("\n")
    kms = sorted(c["cell"]["km"] for c in cells)
    print(f"{len(grids)} regional sea+swell grids; {len(spots)} catalogue spots inside them: {len(cells)} matched, "
          f"{len(uncovered)} uncovered; {len(stations)} CDIP buoys mapped" + (f"; cell distance median {kms[len(kms) // 2]} km, max {kms[-1]} km" if kms else ""))
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
