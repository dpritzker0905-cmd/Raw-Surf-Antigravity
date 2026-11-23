"""Publish raster static frames (GFS mean-sea-level pressure from NOAA GRIB) to the public frames bucket.

Runs as its own step in forecast-ingest-pilots.yml, after the marine/wind frames step (steps run one after another, so
latest.json has one writer at a time), with its own budget (FRAME_RASTER_BUDGET_S, default 420 s) and timeout. The GRIB comes
from NOAA's AWS Open Data bucket by byte range; nothing is read from weather-products and the serve box is never called.
See services/frame_set_raster.py for the frame contract. Kill: FRAME_RASTER_PRESSURE=0.
`--set` picks the set (pressure, the default; temperature; cloud_cover; pressure_euro; pressure_icon; fog; water_temp;
temperature_euro; temperature_icon; water_temp_euro; ...): each runs as its own workflow step with its own budget,
and the new sets publish only when switched on (FRAME_RASTER_TEMPERATURE=1, FRAME_RASTER_CLOUD=1,
FRAME_RASTER_PRESSURE_EURO=1, FRAME_RASTER_PRESSURE_ICON=1).

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
from services import frame_entitlement as fe  # noqa: E402
from services import frame_set_raster as fsr  # noqa: E402


# Statuses where nothing new was published although the set is on ('no_cycle' is upstream not ready yet: not a failure).
FAILED = ("latest_unknown", "latest_refused", "coverage_refused")


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--out-dir", help="offline: write the public objects here instead of the bucket")
    ap.add_argument("--set", default="pressure", choices=sorted(fsr.SPECS), help="which raster set (default: pressure)")
    ap.add_argument("--bundle", choices=("sflux", "currents_native"), help="publish every set of a bundle from one read of each "
                    "hour (sflux: GFS 0.117 deg temperature, water temperature and rain, services/frame_set_raster_sflux.py; "
                    "currents_native: Copernicus currents at 1/12 deg on every surf box, services/frame_set_raster_currents_native.py)")
    ap.add_argument("--offset", action="store_true", help="publish the gap fill's MODEL - GFS offset sets (services/"
                    "frame_set_offset.py), read back from the frames just published; off unless FRAME_OFFSET_PRODUCT=1")
    args = ap.parse_args(argv)
    if args.offset:
        return _offset(args)
    if args.bundle or fsr.spec_for(args.set).get("bundle"):
        return _bundle(args)
    spec = fsr.spec_for(args.set)
    if not fsr.enabled(args.set):
        print(f"[raster] {args.set}: off ({spec['env']}); skipped")
        return 0
    sink = _sink(args)
    source = fsr.make_source(spec)
    report = fsr.publish(source, sink, pub._uploader(sink), log=print, spec=spec)
    if hasattr(source, "bytes_pulled"):            # a source that counts its reads states the run's size (GIOPS, 2026-11-22)
        report["bytes_pulled"] = source.bytes_pulled
        print(f"::notice title=Raster set {args.set} size::pulled {source.bytes_pulled / 1e6:.1f} MB, "
              f"kept {report.get('bytes', 0) / 1e6:.1f} MB ({report.get('status')})")
    print(json.dumps(report, indent=1, sort_keys=True))
    return _status(args.set, report, strict=spec.get("strict", False))


def _bundle(args):
    """The sflux bundle (--bundle sflux, or --set naming one of its sets): one read of each hour feeds every set switched on."""
    if (args.bundle or fsr.spec_for(args.set).get("bundle")) == "currents_native":
        return _native(args)
    from services import frame_set_raster_sflux as sflux
    names = [args.set] if not args.bundle else list(sflux.SPECS)
    on = [n for n in names if fsr.enabled(n)]
    for n in sorted(set(names) - set(on)):
        print(f"[raster] {n}: off ({fsr.spec_for(n)['env']}); skipped")
    if not on:
        return 0
    sink = _sink(args)
    reports = sflux.publish_bundle(sflux.SfluxSource(), sink, pub._uploader(sink), names=on, log=print)
    print(json.dumps(reports, indent=1, sort_keys=True))
    return max([_status(n, r) for n, r in reports.items()] or [0])


def _native(args):
    """The native 1/12-degree currents sets (--bundle currents_native, or --set naming one box): one read of each hour, every box."""
    from services import frame_set_raster_currents_native as native
    names = [args.set] if not args.bundle else native.names()
    on = [n for n in names if fsr.enabled(n)]
    if not on:
        print(f"[raster] currents_native: off ({native.ENV}); skipped")
        return 0
    sink = _sink(args)
    reports, pulled = native.publish_all(sink, pub._uploader(sink), on, log=print)
    kept = sum(r.get("bytes", 0) or 0 for r in reports.values())
    print(f"::notice title=Raster set currents_native size::pulled {pulled / 1e6:.1f} MB, kept {kept / 1e6:.1f} MB "
          f"({len(on)} boxes; {', '.join(sorted({str(r.get('status')) for r in reports.values()}))})")
    print(json.dumps(reports, indent=1, sort_keys=True))
    return max([_status(n, r) for n, r in reports.items()] or [0])


def _offset(args):
    """The offset sets (--offset): one update per new model run, DARK behind FRAME_OFFSET_PRODUCT (default '0')."""
    from services import frame_set_offset as fso
    if not fso.enabled():
        print(f"[raster] offset sets: off ({fso.FLAG}); skipped")
        return 0
    sink = _sink(args)
    reports, pulled = fso.publish_all(sink, pub._uploader(sink), log=print)
    kept = sum(r.get("bytes", 0) or 0 for r in reports.values())
    states = ", ".join(f"{n}: {r.get('status')}, updates per phase {r.get('updates')}, restarted {r.get('restarted_phases') or 'none'}"
                       for n, r in reports.items())
    print(f"::notice title=Gap-fill offset sets size::read {pulled / 1e6:.1f} MB, kept {kept / 1e6:.2f} MB ({states})")
    print(json.dumps(reports, indent=1, sort_keys=True, default=str))
    return max([_status(n, r) for n, r in reports.items()] or [0])


def _sink(args):
    sink = pub.LocalSink(args.out_dir) if args.out_dir else pub.SupabaseSink()
    if fe.enabled():
        # O6 (held OFF, accounts only): raster frames are forecast data too; the same private bucket and path-free index.
        private = pub.LocalSink(Path(args.out_dir) / "_private") if args.out_dir else pub.SupabaseSink(bucket=fe.PRIVATE_BUCKET, public=False)
        sink = fe.EntitledSink(sink, private)
    sink.ensure_bucket()
    return sink


def _status(name, report, strict=False):
    status = report.get("status")
    if strict and status not in FAILED and (report.get("failed") or status == "no_cycle"):
        # A strict set (spec "strict": GIOPS, the advisor's condition) turns the run red on ANY failed frame, and when no
        # complete run is found over its whole look-back (a moved or renamed upstream), not only on a refused index. The
        # frames that did build are still published.
        print(f"::error title=Raster set {name} incomplete::status {status}, {report.get('failed', 0)} frame(s) failed")
        return 1
    if status in FAILED:
        # A failed publish KEEPS the published index (the map draws the last good run), so say so where it is seen: an error
        # annotation on the step (continue-on-error keeps the cycle going) and a non-zero exit; raster_set_freshness.py on the
        # data-health monitor pages if the set then goes stale (2026-11-16, the director).
        print(f"::error title=Raster set {name} not published::status {status}; the published index stays. "
              f"{report.get('reason') or ''}".strip())
        return 1
    return 0


if __name__ == "__main__":
    sys.exit(main())
