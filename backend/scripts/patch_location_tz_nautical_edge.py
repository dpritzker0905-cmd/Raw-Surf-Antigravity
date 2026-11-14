"""Apply the NAUTICAL EDGE rule (O2 / LT-8) to the COMMITTED location_time grid, without the OSM rebuild.

WHY A PATCH: the full build needs the OSM land polygons and timezone-boundary-builder data (hours, GBs). The edge rule
reads only the grid's own classes and their UTC offsets, so it is applied here to the committed grid with the SAME
function the build now runs (`build_location_tz_grid.mark_nautical_edges`): a later full rebuild reproduces this output.
Every manifest field is kept; `nautical_edge` and `patched_utc` are added. Offline only, never imported by the server.

Usage (from backend/):  python scripts/patch_location_tz_nautical_edge.py --out <fresh dir>   (~6 min), then copy the
five grid files over data/location_time (Windows cannot overwrite a memory-mapped input in place).
"""
import argparse
import os
import sys
from datetime import datetime, timezone

import numpy as np

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
for p in (BACKEND, HERE):
    if p not in sys.path:
        sys.path.insert(0, p)

from build_location_tz_grid import EDGE_MIN_H, mark_nautical_edges  # noqa: E402
from services.weather_pipeline import location_time as lt  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--grid", default=lt.DATA_DIR)
    ap.add_argument("--out", default=None, help="output dir (default: overwrite --grid)")
    args = ap.parse_args(argv)
    grid, manifest = lt._read_grid(args.grid)
    if "nautical_edge" in manifest:
        print("already patched:", manifest["nautical_edge"])
        return 0
    rp, st, ids = grid["row_ptr"], np.asarray(grid["starts"]).astype(np.int64), np.asarray(grid["ids"])
    nlat, nlon = grid["nlat"], grid["nlon"]

    def get_row(i):
        s0, s1 = int(rp[i]), int(rp[i + 1])
        return np.repeat(ids[s0:s1], np.diff(np.append(st[s0:s1], nlon)))

    classes = [(grid["iana"][c], grid["source"][c], grid["near_border"][c], grid["alt"][c], grid["band"][c])
               for c in range(grid["ncls"])]
    row_ptr, starts, new_ids, classes, n_edge = mark_nautical_edges(get_row, nlat, classes)
    extra = {k: v for k, v in manifest.items() if k not in ("schema", "res_deg", "files", "grid_sha256")}
    extra.update({"runs": int(len(starts)), "classes": len(classes),
                  "nautical_edge": {"min_h": EDGE_MIN_H, "cells": int(n_edge),
                                    "applied_by": "scripts/patch_location_tz_nautical_edge.py",
                                    "base_grid_sha256": manifest["grid_sha256"]},
                  "patched_utc": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")})
    out = args.out or args.grid
    lt.reset_for_tests()   # NB Windows: get_row still maps the input, so write to a fresh --out and copy it over
    import gc
    gc.collect()
    m = lt.write_grid_dir(out, row_ptr, starts, new_ids, classes, manifest["res_deg"], extra)
    print(f"nautical edge: {n_edge} cells marked; {m['classes']} classes, {m['runs']} runs; sha {m['grid_sha256'][:16]}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
