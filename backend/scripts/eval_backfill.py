#!/usr/bin/env python3
"""eval_backfill.py - fill the evaluation harness's cache with a PAST window's forecast-of-record inputs, in parallel,
so `eval_harness.py run --cache-dir <same dir>` runs on cache hits. Offline tool: never the app, never storage.
Module and contract: services/weather_pipeline/eval_backfill.py. Docs: docs/weather-program/evaluation-harness.md.

    python scripts/eval_backfill.py prefetch --name winter --start 2024-12-01T00:00Z --end 2024-12-28T18:00Z \
        --cache-dir C:/t/hist-cache --workers 8
    python scripts/eval_backfill.py parity --start 2026-10-20T00:00Z --end 2026-10-21T18:00Z \
        --cache-dir C:/t/parity-new --ref-cache C:/t/eh0-cache

`prefetch` writes/updates <cache-dir>/index.json (one entry per --name: coverage, failures, input fingerprints,
parity breaks against the reference product) as soon as the window completes.
"""
import argparse
import json
import os
import sys
import time
from datetime import datetime, timedelta, timezone

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import eval_backfill as bf  # noqa: E402
from services.weather_pipeline import eval_gfswave as gw  # noqa: E402
from services.weather_pipeline import eval_provenance as pv  # noqa: E402
from services.weather_pipeline import eval_replay as rp  # noqa: E402

INDEX_SCHEMA = "raw-surf.eval-backfill.index.v1"


def _pairs(args):
    targets = gw.targets_between(rp.parse_time(args.start), rp.parse_time(args.end), args.step_h)
    return targets, bf.needed(targets, [int(x) for x in args.leads.split(",")])


def reference_fingerprint(cache_dir: str, when: datetime) -> dict:
    """The fingerprint of a recent cycle (the product production reads today): the parity reference."""
    c = when.replace(hour=0, minute=0, second=0, microsecond=0)
    return bf.prefetch_one(pv.Cache(cache_dir, pause_s=0.0), c, 24)["fingerprint"]


def update_index(path: str, name: str, entry: dict) -> dict:
    idx = {"schema": INDEX_SCHEMA, "windows": {}}
    if os.path.exists(path):
        with open(path, encoding="utf-8") as f:
            idx = json.load(f)
    idx["windows"][name] = entry
    idx["updated_utc"] = pv.utc_now_iso()
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as f:
        json.dump(idx, f, indent=1, sort_keys=True)
    os.replace(tmp, path)
    return idx


def cmd_prefetch(args) -> int:
    targets, pairs = _pairs(args)
    t0, n = time.monotonic(), [0]

    def progress(row):
        n[0] += 1
        if n[0] % 25 == 0 or "error" in row:
            print(f"  {n[0]}/{len(pairs)} {row['cycle']} f{row['fh']:03d} {row.get('error', 'ok')}", flush=True)

    ref = reference_fingerprint(args.cache_dir, datetime.now(timezone.utc) - timedelta(days=args.reference_age_days))
    res = bf.prefetch(args.cache_dir, pairs, workers=args.workers, wind_source=args.wind_source, progress=progress)
    wall = time.monotonic() - t0
    breaks = bf.parity_breaks([r for r in res["rows"] if "error" not in r], ref["id"])
    entry = {"start": args.start, "end": args.end, "step_h": args.step_h, "leads": args.leads,
             "targets": len(targets), "cycle_fh_pairs": len(pairs), "ok": res["ok"], "failed": res["failed"],
             "complete": res["ok"] == len(pairs), "wind_source": args.wind_source,
             "first_cycle": f"{pairs[0][0]:%Y-%m-%dT%HZ}" if pairs else None,
             "downloaded_bytes": res["downloaded_bytes"], "wall_s": round(wall, 1), "workers": args.workers,
             "input_fingerprints": res["fingerprints"], "reference_fingerprint": ref,
             "parity_breaks": len(breaks), "parity_break_rows": breaks[:20],
             "parity": "same cache keys, URLs and idx byte ranges as eval_gfswave.fetch_fields (cache hits); "
                       "input version " + ("MATCHES the reference product" if not breaks else
                                           "DIFFERS from the reference product: a PARITY BREAK, score separately"),
             "written_utc": pv.utc_now_iso()}
    update_index(os.path.join(args.cache_dir, "index.json"), args.name, entry)
    print(json.dumps({k: v for k, v in entry.items() if k not in ("failed", "parity_break_rows")}, indent=1))
    return 0 if entry["complete"] and not breaks else 1


def cmd_parity(args) -> int:
    _, pairs = _pairs(args)
    res = bf.prefetch(args.cache_dir, pairs, workers=args.workers, wind_source=args.wind_source)
    rep = bf.parity_check(args.cache_dir, args.ref_cache, pairs)
    rep["prefetch_failed"] = res["failed"]
    print(json.dumps(rep, indent=1))
    return 0 if rep["byte_identical"] else 1


def parser() -> argparse.ArgumentParser:
    p = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    sub = p.add_subparsers(dest="cmd", required=True)
    for name in ("prefetch", "parity"):
        s = sub.add_parser(name)
        s.add_argument("--start", required=True)
        s.add_argument("--end", required=True)
        s.add_argument("--step-h", type=int, default=6)
        s.add_argument("--leads", default="24,48,72")
        s.add_argument("--cache-dir", required=True)
        s.add_argument("--workers", type=int, default=bf.DEFAULT_WORKERS)
        s.add_argument("--wind-source", default="pgrb2", choices=("pgrb2", "gfswave"))
    sub.choices["prefetch"].add_argument("--name", required=True, help="the index.json entry for this window")
    sub.choices["prefetch"].add_argument("--reference-age-days", type=int, default=3)
    sub.choices["parity"].add_argument("--ref-cache", required=True, help="a cache the sequential harness filled")
    return p


def main(argv=None) -> int:
    args = parser().parse_args(argv)
    try:
        return cmd_prefetch(args) if args.cmd == "prefetch" else cmd_parity(args)
    except (pv.CacheRefused, pv.NetworkRefused, ValueError) as e:
        print(f"REFUSED: {e}")
        return 2


if __name__ == "__main__":
    sys.exit(main())
