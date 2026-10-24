"""Publish raster static frames (GFS mean-sea-level pressure from NOAA GRIB) to the public frames bucket.

Runs as its own step in forecast-ingest-pilots.yml, after the marine/wind frames step (steps run one after another, so
latest.json has one writer at a time), with its own budget (FRAME_RASTER_BUDGET_S, default 420 s) and timeout. The GRIB comes
from NOAA's AWS Open Data bucket by byte range; nothing is read from weather-products and the serve box is never called.
See services/frame_set_raster.py for the frame contract. Kill: FRAME_RASTER_PRESSURE=0.
`--set` picks the set (pressure, the default; temperature; cloud_cover): each runs as its own workflow step with its own budget,
and the new sets publish only when switched on (FRAME_RASTER_TEMPERATURE=1, FRAME_RASTER_CLOUD=1).

  python scripts/publish_raster_frames.py                 # CI: SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY, the public bucket
  python scripts/publish_raster_frames.py --out-dir DIR   # offline: write the objects under DIR (still fetches NOAA GRIB)
  python scripts/publish_raster_frames.py --set temperature --out-dir DIR
"""
from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
sys.path.insert(0, str(Path(__file__).resolve().parent))

import publish_frame_images as pub  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", help="offline: write the public objects here instead of the bucket")
    ap.add_argument("--set", default="pressure", choices=sorted(fsr.SPECS), help="which raster set (default: pressure)")
    args = ap.parse_args(argv)
    spec = fsr.spec_for(args.set)
    if not fsr.enabled(args.set):
        print(f"[raster] {args.set}: off ({spec['env']}); skipped")
        return 0
    sink = pub.LocalSink(args.out_dir) if args.out_dir else pub.SupabaseSink()
    sink.ensure_bucket()
    report = fsr.publish(fsr.GfsGribSource(spec), sink, pub._uploader(sink), log=print, spec=spec)
    print(json.dumps(report, indent=1, sort_keys=True))
    return 0


if __name__ == "__main__":
    sys.exit(main())
