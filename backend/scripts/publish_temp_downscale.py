"""Publish the air-temperature downscale's elevation-difference asset (services/raster_downscale.py) to the public frames bucket.

One static asset, built from NOAA ETOPO 2022 (via ERDDAP, one binary request) and GFS's own terrain (HGT surface, f000 of the
newest complete cycle, one NOAA .idx byte range). It is published once and rebuilt only on --force or when the stride
changes: the model terrain is static between GFS versions. Opt-in: FRAME_RASTER_TEMP_DZ=1 (the client is dark either way).

  python scripts/publish_temp_downscale.py                       # CI: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY
  python scripts/publish_temp_downscale.py --out-dir DIR         # offline: write the objects under DIR
  python scripts/publish_temp_downscale.py --stride 32 --force   # 2/15 deg, one tile (0.48 MB) instead of 1/15 (two tiles)
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import publish_frame_images as pub  # noqa: E402
from services import frame_set as fs  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402
from services import raster_downscale as rd  # noqa: E402

TERRAIN_SPEC = {"idx": ("HGT", "surface"), "convert": lambda a: a}
VALID_M = (-500.0, 9000.0)
DESCRIPTOR_CACHE = "no-cache"                        # a fixed, versioned path: re-read on every load (as latest.json)


def fetch_dem(stride, session=None):
    import requests
    http = session or requests
    resp = http.get(rd.DEM_URL.format(s=stride), timeout=900)
    resp.raise_for_status()
    return rd.parse_dods_grid(resp.content)


def fetch_terrain(source=None, now=None):
    """(the 0.5-deg terrain plane (361, 720), its cycle) from the newest complete GFS cycle, f000."""
    import numpy as np
    src = source or fsr.GfsGribSource(TERRAIN_SPEC)
    cycle = src.complete_cycle(now or datetime.now(timezone.utc))
    if cycle is None:
        raise RuntimeError("no complete GFS cycle")
    plane = fsr.to_frame_plane(src.fetch(cycle, 0), VALID_M)
    return np.nan_to_num(plane, nan=0.0), cycle


def up_to_date(sink, stride):
    raw = sink.read(rd.DESCRIPTOR_PATH)
    if not raw:
        return False
    try:
        d = json.loads(raw)
    except ValueError:
        return False
    return d.get("version") == 1 and d.get("stride") == stride


def publish(sink, stride=rd.STRIDE, force=False, dem=None, terrain=None, log=print):
    if not force and up_to_date(sink, stride):
        log(f"[temp-dz] {rd.DESCRIPTOR_PATH} is current (stride {stride}); nothing to do")
        return {"status": "current"}
    vals, lat, lon = dem or fetch_dem(stride)
    zs, cycle = terrain or fetch_terrain()
    built_at = datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")
    source = f"gfs.pgrb2.0p25 HGT surface, cycle {cycle:%Y-%m-%dT%HZ} f000, every second point, bilinear"
    descriptor, files = rd.build(vals, lat, lon, zs, built_at, source)
    descriptor["stride"] = stride
    for path, gz in files:                                     # tiles first, the descriptor last (a reader never sees a
        sink.write(path, gz, fs.FRAME_TYPE, fs.IMMUTABLE)       # descriptor naming a tile that is not there)
    sink.write(rd.DESCRIPTOR_PATH, rd.descriptor_bytes(descriptor), fs.JSON_TYPE, DESCRIPTOR_CACHE)
    report = {"status": "published", "tiles": [{k: t[k] for k in ("path", "cols", "rows", "bytes")} for t in descriptor["tiles"]],
              "bytes": sum(len(gz) for _p, gz in files), "lattice": descriptor["lattice"], "stats": descriptor["stats"]}
    log(json.dumps(report, indent=1))
    return report


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", help="offline: write the public objects here instead of the bucket")
    ap.add_argument("--stride", type=int, default=rd.STRIDE, help="every Nth ETOPO 2022 15-arc-second point (16 = 1/15 deg)")
    ap.add_argument("--force", action="store_true", help="rebuild even when the published descriptor is current")
    args = ap.parse_args(argv)
    if os.environ.get("FRAME_RASTER_TEMP_DZ") != "1" and not args.out_dir:
        print("[temp-dz] off (FRAME_RASTER_TEMP_DZ); skipped")
        return 0
    sink = pub.LocalSink(args.out_dir) if args.out_dir else pub.SupabaseSink()
    sink.ensure_bucket()
    publish(sink, args.stride, args.force)
    return 0


if __name__ == "__main__":
    sys.exit(main())
