#!/usr/bin/env python3
"""Per-run PHYSICAL-CONSISTENCY report of the published world marine frames (2026-11-23). REPORT-ONLY, ON, kill switch.

Runs in forecast-ingest-pilots.yml AFTER the frames steps: reads v1/latest.json and the world (`global_mid`) marine run indexes
of GFS, ICON and EURO from the PUBLIC frames bucket (anonymous GETs, --public-base; no key), decodes a SAMPLE of their frames (lead 0, then one every
FRAME_PHYSICS_LEAD_STEP_H hours, default 24, to the end of each set) and applies the four rules of services/frame_physics_check.py:
partition <= total, energy closure, no valid zero, one source and one run per model button. Writes the JSON report to --out (the
workflow uploads it as an artifact) and a table to $GITHUB_STEP_SUMMARY.

NEVER BLOCKS A PUBLISH AND NEVER CHANGES A VALUE: it writes nothing to any bucket, it runs after every publish step, and it
exits 0 whatever it finds or whatever fails (an error is written INTO the report). The step is also continue-on-error.
KILL: repository variable FRAME_PHYSICS_CHECK = '0' (env FRAME_PHYSICS_CHECK=0): the script reads nothing and says so.

EGRESS, bounded: a world frame is ~55 KB gzipped; 3 models x 4 layers x 15 sampled times is ~180 frames, ~10 MB a run, capped by
FRAME_PHYSICS_MAX_FRAMES (default 240). The bytes read are in the report. The live API box is never called.

Offline:  python scripts/frame_physics_report.py --frames-dir <a publish_frame_images --out-dir> [--out report.json]
          python scripts/frame_physics_report.py --public-base <SUPABASE_URL>/storage/v1/object/public/weather-frames
"""
from __future__ import annotations

import argparse
import json
import os
import sys
import traceback
from datetime import datetime, timezone
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
from services import frame_binary as fb  # noqa: E402
from services import frame_physics_check as fpc  # noqa: E402

MODELS = ("GFS", "ICON", "EURO")
LATEST = "v1/latest.json"


def enabled():
    return os.environ.get("FRAME_PHYSICS_CHECK", "1") != "0"


def _env_int(name, default):
    try:
        return max(1, int(os.environ.get(name, str(default))))
    except ValueError:
        return default


def set_key(model, layer):
    return f"{model}/marine/{layer}/global_mid"


class Reader:
    """Counts what it reads; `read(path) -> bytes or None` comes from a publish_frame_images sink (Local or Supabase)."""

    def __init__(self, read, max_frames):
        self._read, self.max_frames = read, max_frames
        self.frames_read = self.bytes_read = self.frames_capped = 0

    def json(self, path):
        raw = self._read(path) if path else None
        if raw:
            self.bytes_read += len(raw)
        return json.loads(raw) if raw else None

    def frame(self, path):
        if self.frames_read >= self.max_frames:
            self.frames_capped += 1
            return None
        raw = self._read(path)
        if raw is None:
            return None
        self.frames_read += 1
        self.bytes_read += len(raw)
        return fb.decode_plane(raw)


def _axes(head):
    west, south, east, north = head["bounds"]
    rows, cols = head["rows"], head["cols"]
    lat = [south + r * (north - south) / (rows - 1) for r in range(rows)] if rows > 1 else [south]
    lng = [west + c * (east - west) / (cols - 1) for c in range(cols)] if cols > 1 else [west]
    return lat, lng


def run_check(reader, step_h=24, max_times=15, models=MODELS):
    """The report dict (no I/O beyond `reader`)."""
    latest = reader.json(LATEST) or {}
    sets = latest.get("sets") or {}
    prov_rows, time_rows, indexes_read = [], [], {}
    for model in models:
        indexes = {}
        for layer in fpc.MARINE_LAYERS:
            rec = sets.get(set_key(model, layer)) or {}
            if rec.get("index"):
                indexes[layer] = reader.json(rec["index"])
                indexes_read[set_key(model, layer)] = rec["index"]
        if not indexes:
            continue
        prov_rows.append(fpc.provenance(model, indexes))
        total = indexes.get(fpc.LAYER_TOTAL)
        for vt in fpc.sample_times(total, step_h, max_times):
            planes, axes = {}, None
            for layer, index in indexes.items():
                f = fpc.pick_frame(index, vt)
                if f is None:
                    continue
                got = reader.frame(f["path"])
                if got is None:
                    continue
                head, fields = got
                if fb.HEIGHT not in fields:
                    continue
                meta = fpc.frame_meta(index, f)
                planes[layer] = {"height_m": fields[fb.HEIGHT], "period_s": fields.get(fb.PERIOD),
                                 "class": fpc.frame_class(f, meta), "run": meta.get("model_run_time"),
                                 "source": fpc.source_label(meta)}
                if layer == fpc.LAYER_TOTAL:
                    axes = _axes(head)
            if not planes:
                continue
            row = fpc.check_time(model, vt, planes, *(axes or (None, None)))
            row["lead_h"] = fpc._lead_h(vt, (total or {}).get("run"))
            time_rows.append(row)
    summary = fpc.summarize(prov_rows, time_rows)
    return {"version": 1, "checked_at": datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"),
            "latest_written_at": latest.get("written_at"), "indexes": indexes_read,
            "lead_step_h": step_h, "summary": summary, "verdicts": fpc.verdicts(summary),
            "provenance": prov_rows, "times": time_rows, "frames_read": reader.frames_read,
            "frames_capped": reader.frames_capped, "bytes_read": reader.bytes_read}


def _public_reader(base):
    """Anonymous GETs on the PUBLIC frames bucket (what a browser reads): `base` = <SUPABASE_URL>/storage/v1/object/public/weather-frames.
    The workflow reads this way (advisor, #1264): a read-only check holds no service-role key."""
    import urllib.error
    import urllib.request

    def read(path):
        try:
            with urllib.request.urlopen(f"{base.rstrip('/')}/{path}", timeout=60) as r:
                return r.read()
        except urllib.error.HTTPError as e:
            if e.code in (400, 404):
                return None
            raise
    return read


def _sink_reader(frames_dir, public_base=None):
    if public_base:
        return _public_reader(public_base)
    from scripts import publish_frame_images as pfi    # noqa: PLC0415 (the publisher's own sinks: one read path)
    sink = pfi.LocalSink(frames_dir) if frames_dir else pfi.SupabaseSink()
    return sink.read


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--frames-dir", help="offline: a publish_frame_images --out-dir instead of the frames bucket")
    ap.add_argument("--public-base",
                    help="read the PUBLIC bucket anonymously at this base URL (the workflow's mode) "
                         "(<SUPABASE_URL>/storage/v1/object/public/weather-frames)")
    ap.add_argument("--out", default="frame_physics_report.json", help="where the JSON report is written")
    args = ap.parse_args(argv)
    if not enabled():
        report = {"version": 1, "killed": True}
    else:
        try:
            reader = Reader(_sink_reader(args.frames_dir, args.public_base), _env_int("FRAME_PHYSICS_MAX_FRAMES", 240))
            report = run_check(reader, step_h=_env_int("FRAME_PHYSICS_LEAD_STEP_H", 24),
                               max_times=_env_int("FRAME_PHYSICS_MAX_TIMES", 15))
        except BaseException as e:  # noqa: BLE001 -- report-only: a check failure is reported, never raised
            if isinstance(e, KeyboardInterrupt):
                raise
            report = {"version": 1, "error": f"{type(e).__name__}: {e}"[:500], "trace": traceback.format_exc()[-2000:]}
    try:
        Path(args.out).write_text(json.dumps(report, indent=1, sort_keys=True, default=str), encoding="utf-8")
    except OSError as e:
        print(f"[physics] could not write {args.out}: {e}", file=sys.stderr)
    md = fpc.markdown(report)
    print(md)
    summary = os.environ.get("GITHUB_STEP_SUMMARY")
    if summary:
        with open(summary, "a", encoding="utf-8") as fh:
            fh.write(md + "\n")
    return 0


if __name__ == "__main__":
    sys.exit(main())
