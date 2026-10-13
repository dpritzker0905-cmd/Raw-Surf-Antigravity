"""ingest_mop_spot_series.py — archive each CDIP MOP sea+swell run at the spot and buoy cells (stage 4).

Roadmap stage 4 serves MOP as the input to the breaking step for California spots (#124: MOP 0.101 m MAE
against our chain's 0.246 m at the CDIP buoys). The served product is the regional sea+swell grids, which
are ECMWF-driven and hold only FUTURE hours, so nothing can grade them after the fact unless each run is
kept. This keeps it: every cell in data/mop_spot_cells.json (the spots AND the CDIP buoys) gets the grid's
current forecast (16 six-hourly steps), written as one gzipped L2 blob, both as the latest and as a
per-run archive the nearshore judge can later grade at the buoys. Nothing serves from it yet.

Exit contract: 0 written (or --no-upload); 1 PARTIAL (under half the cells answered: still written, says
so); 2 INFRA (no cell answered, or the table is stale/unreadable).

Usage:
    python backend/scripts/ingest_mop_spot_series.py --out mop_spot_series.json [--no-upload]
Reads CDIP only; writes the local --out file and, unless --no-upload, the two L2 keys.
"""
import argparse
import gzip
import json
import os
import re
import sys
import time
import urllib.request
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.mop_nearshore import (  # noqa: E402
    MOP_GRIDS_URL, parse_cell_series, run_stamp, series_blob)

TABLE = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "data", "mop_spot_cells.json")
TABLE_MAX_AGE_DAYS = 180
LATEST_KEY = "point_cache/mop_spot_series.json.gz"
ARCHIVE_PREFIX = "point_cache/mop_runs/"
UA = {"User-Agent": "raw-surf-mop-ingest"}


def _get(url, timeout=120):
    with urllib.request.urlopen(urllib.request.Request(url, headers=UA), timeout=timeout) as r:
        return r.read().decode("utf-8", "replace")


def cell_keys(table: dict) -> list:
    """Every distinct (grid file, i, j) the table needs, spots and buoys together. PURE."""
    keys = {(e["grid"], e["cell"]["i"], e["cell"]["j"])
            for e in (table.get("cells") or []) + (table.get("stations") or [])}
    return sorted(keys)


def archive_key(generated_at: str) -> str:
    """point_cache/mop_runs/<UTC stamp>.json.gz, sortable by ingest time. PURE."""
    stamp = re.sub(r"[^0-9T]", "", generated_at.split("+")[0].split(".")[0])[:13]
    return f"{ARCHIVE_PREFIX}{stamp}Z.json.gz"


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--out", default="mop_spot_series.json")
    ap.add_argument("--no-upload", action="store_true")
    ap.add_argument("--workers", type=int, default=6)
    args = ap.parse_args()
    t0 = time.time()

    try:
        with open(TABLE, encoding="utf-8") as f:
            table = json.load(f)
        age_d = (datetime.now(timezone.utc) - datetime.fromisoformat(table["generated_at"])).days
    except (OSError, ValueError, KeyError) as e:
        print(f"INFRA: spot table unreadable: {e}")
        return 2
    if age_d > TABLE_MAX_AGE_DAYS:
        print(f"INFRA: spot table is {age_d} days old (cap {TABLE_MAX_AGE_DAYS}); rebuild with build_mop_spot_cells.py")
        return 2

    keys = cell_keys(table)
    runs, sizes = {}, {}
    for grid in sorted({k[0] for k in keys}):
        try:
            das = _get(f"{MOP_GRIDS_URL}/{grid}.das")
            created = re.search(r'date_created "([^"]+)"', das)
            runs[grid] = {"run": run_stamp(das), "created": created.group(1) if created else None}
            sizes[grid] = int(re.search(r"waveTime\[waveTime = (\d+)\]", _get(f"{MOP_GRIDS_URL}/{grid}.dds")).group(1))
        except Exception as e:                                         # noqa: BLE001 — one grid, never the run
            print(f"grid {grid} unavailable: {str(e)[:100]}")

    def fetch(key):
        grid, i, j = key
        n = sizes.get(grid)
        if not n:
            return key, None
        rng = f"[0:1:{n - 1}][{i}][{j}]"
        try:
            return key, parse_cell_series(_get(f"{MOP_GRIDS_URL}/{grid}.ascii?waveTime[0:1:{n - 1}],"
                                               f"waveHs{rng},waveTp{rng},waveDp{rng}"))
        except Exception:                                              # noqa: BLE001 — one cell, never the run
            return key, None

    with ThreadPoolExecutor(max_workers=max(1, args.workers)) as ex:
        series = {k: s for k, s in ex.map(fetch, keys) if s and s.get("times")}

    generated_at = datetime.now(timezone.utc).isoformat()
    blob = series_blob(table, series, runs, generated_at)
    blob["ingest"] = {"cells": len(keys), "answered": len(series), "wall_s": round(time.time() - t0, 1)}
    with open(args.out, "w", encoding="utf-8", newline="\n") as f:
        json.dump(blob, f, separators=(",", ":"))
    print(f"MOP runs {sorted({r['run'] for r in runs.values() if r.get('run')})}")
    print(f"CELLS answered {len(series)}/{len(keys)}; spots {blob['coverage']['spots']}, "
          f"buoys {blob['coverage']['stations']}; wall {blob['ingest']['wall_s']} s")
    if not series:
        print("INFRA: no MOP cell answered")
        return 2

    if not args.no_upload:
        from services.weather_pipeline.store import ProductStore
        data = gzip.compress(json.dumps(blob, separators=(",", ":")).encode("utf-8"), compresslevel=6)
        store = ProductStore()
        for key in (LATEST_KEY, archive_key(generated_at)):
            store._upload_to_supabase(key, data, strict=True)
            print(f"WROTE {key} ({len(data)} bytes gzipped)")
    return 1 if len(series) < len(keys) / 2 else 0


if __name__ == "__main__":
    raise SystemExit(main())
