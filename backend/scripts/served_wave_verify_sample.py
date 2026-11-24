#!/usr/bin/env python3
"""Sample the published wave frames at the frozen buoys (gate served-wave-verify-v1; the `served-wave-verify-sample` job).

DARK. It does nothing unless SERVED_WAVE_VERIFY=1 (repo variable, default 0 until the owner's word): the workflow job is
skipped on that variable, and this script refuses again on its own.

Reads: v1/latest.json, indexes and frames from the PUBLIC `weather-frames` bucket, anonymously (the client's path; the
service-role key is never used to read frames). Writes: the private point-archive bucket only (POINT_ARCHIVE_BUCKET, default
`point-archive`), through the shared writer. Credentials by NAME: SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
Never runs on the Render box; never touches `v1/`.

  python scripts/served_wave_verify_sample.py [--local-out DIR] [--frames-base URL]
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services import buoy_holdout  # noqa: E402
from services.point_archive import buoys as buoylist  # noqa: E402
from services.point_archive import served_sampler as ss  # noqa: E402
from services.point_archive.storage import LocalStore, PublicFrames, SupabaseStore  # noqa: E402
from services.point_archive.writer import ArchiveWriter  # noqa: E402


buoy_holdout.declare_collector(__name__, "archives served frames at EVERY listed buoy, locked included (#1199: locked buoys "
                               "still have records written); reads no truth, scores nothing, prints no station id")


def enabled(env=None):
    return (env if env is not None else os.environ).get("SERVED_WAVE_VERIFY", "0") == "1"


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--local-out", help="write the archive to this folder instead of the private bucket (offline runs)")
    ap.add_argument("--frames-base", help="the project URL for the public frames read (default: SUPABASE_URL)")
    a = ap.parse_args(argv)
    if not enabled():
        print("[swv] SERVED_WAVE_VERIFY is not '1': the sampler is dark; nothing read, nothing written")
        return 0
    doc = buoylist.load()
    problems = buoylist.validate(doc)
    if problems:
        raise SystemExit("buoy list invalid: " + "; ".join(problems))
    if a.local_out:
        store = LocalStore(a.local_out)
    else:
        store = SupabaseStore()
        store.ensure_private_bucket()
    writer = ArchiveWriter(store)
    frames = PublicFrames(a.frames_base)
    sampler = ss.Sampler(doc, frames, writer, euro_swell=os.environ.get("FRAME_EURO_SWELL_SETS", "1") != "0",
                         regional_euro_icon=os.environ.get("FRAME_REGIONAL_BUNDLES_EURO_ICON", "1") != "0")
    now = datetime.now(timezone.utc)
    try:
        latest = json.loads(frames.get("v1/latest.json", bust=True) or b"null")
        if not latest or not latest.get("sets"):
            raise RuntimeError("v1/latest.json missing or has no sets")
        report = sampler.run(latest)
    except Exception as e:
        path = ss.failure_marker(writer, now, "job", f"{type(e).__name__}: {e}")
        print(f"[swv] sampler_fail written: {path}", file=sys.stderr)
        raise
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    lines = ["## Served-wave verify sampler", "", "| model | run | outcome |", "|---|---|---|"]
    for model, items in report.items():
        for it in items:
            lines.append(f"| {model} | {it['run']} | {it.get('path') or 'deferred: ' + it.get('deferred', '')} "
                         f"{'(' + str(it['records']) + ' records)' if 'records' in it else ''} |")
    print("\n".join(lines))
    if summary:
        with open(summary, "a", encoding="utf-8") as f:
            f.write("\n".join(lines) + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
