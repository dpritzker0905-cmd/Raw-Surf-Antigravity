"""End of an owning-lane run for the #675 rollout (rollout_675.py): canary, read-back, sampled audit, scoped GC, bounds,
status object and step summary. Called once by scripts/ingest_forecast_ci.py after the cycle-end duplicate sweep.
Never raises: every step's failure is recorded in the status, and the ones that matter fail CLOSED for the next run
(an unreadable read-back counts as entries lost)."""
import json
import logging
import os
import statistics
from datetime import datetime, timezone

from services.weather_pipeline import rollout_675 as r
from services.weather_pipeline.rollout_675_io import (
    flush_manifest_publish, prune_snapshots, scoped_gc_sweep, write_status)

logger = logging.getLogger(__name__)
CANARY_VALID_TIME = "2099-01-01T00:00:00Z"   # FIXED: the reader's revision refresh refuses a replacement whose frame moves


def canary_documents(revision):
    """(product JSON bytes, manifest entry dict) for the canary. Only run_time / ingested_at change between runs, which is
    exactly what product_revision_refresh treats as a newer registration of the same frame."""
    from services.weather_pipeline.schemas import ManifestProduct, NormalizedProduct
    bounds = {"west": 0.0, "south": 0.0, "east": 1.0, "north": 1.0}
    common = {"model": "OPS", "provider": "raw_surf", "domain": "ops", "layer": "rollout_canary", "run_time": revision,
              "ingested_at": revision, "model_run_time_status": "missing", "is_forecast_authoritative": False,
              "is_estimated": False, "coverage": bounds, "freshness_sec": 0, "region_id": "ops_canary",
              "coverage_mode": "regional_tile", "source_dataset": "rollout_675_canary", "product_id": r.CANARY_FILENAME}
    product = NormalizedProduct.model_validate(dict(
        common, valid_time=CANARY_VALID_TIME, value_kind="canary", value_unit="1", display_unit_hint="1",
        source_variables=["canary"],
        grid={"bounds": bounds, "cols": 1, "rows": 1, "vectors": [{"lat": 0.5, "lng": 0.5, "speed": 1.0, "is_valid": True}]}))
    entry = ManifestProduct.model_validate(dict(
        common, valid_time_start=CANARY_VALID_TIME, valid_time_end=CANARY_VALID_TIME, resolution=1.0,
        filename=r.CANARY_FILENAME))
    return product.model_dump_json().encode("utf-8"), entry


def write_canary(store, io, now, publish=None) -> str:
    """Rewrite the canary under the SAME key, register it, publish. Returns its revision (the run_time ISO)."""
    revision = r.iso(now)
    data, entry = canary_documents(revision)
    io.upload(r.CANARY_FILENAME, data)
    manifest = store.get_manifest()
    manifest.products = [p for p in manifest.products if p.filename != r.CANARY_FILENAME] + [entry]
    manifest.last_manifest_update = now
    store._save_manifest(manifest)
    if publish is None:
        from services.weather_pipeline.manifest_publish_step import submit_manifest_publish
        submit_manifest_publish(store, manifest)
    else:
        publish(store, manifest)
    return revision


def _sample(names, n):
    if len(names) <= n:
        return list(names)
    step = len(names) / float(n)
    return [names[int(i * step)] for i in range(n)]


def _bounds(run, end_count, duration_min):
    baseline = list(run.prev.get("baseline") or [])
    obs = {"cycle_id": run.cycle_id, "manifest_count": end_count, "duration_min": round(duration_min, 1),
           "growth": round(end_count / run.begin_head_count, 4) if run.begin_head_count else None}
    breach = []
    if len(baseline) >= r.BASELINE_CYCLES:
        mode = "enforced"
        counts = [b["manifest_count"] for b in baseline if b.get("manifest_count")]
        durations = [b["duration_min"] for b in baseline if b.get("duration_min") is not None]
        if counts and end_count > r.GROWTH_LIMIT * statistics.median(counts):
            breach.append(f"manifest {end_count} > {r.GROWTH_LIMIT} x baseline median {statistics.median(counts)}")
        if durations and duration_min > statistics.median(durations) + r.DURATION_LIMIT_MIN:
            breach.append(f"lane {duration_min:.1f} min > baseline median {statistics.median(durations):.1f} + {r.DURATION_LIMIT_MIN}")
    else:
        mode = f"observe-only ({len(baseline) + 1}/{r.BASELINE_CYCLES}, never blocks while baselining)"
    if run.state in (r.SAFE, r.PROMOTED):
        baseline = (baseline + [obs])[-r.BASELINE_KEEP:]
    return {"mode": mode, "observation": obs, "breach": breach}, baseline, breach


def summary_lines(run, lane_status):
    lines = [f"### #675 rollout: **{lane_status.get('state', run.state)}** ({run.lane} lane, cycle `{run.cycle_id}`)", ""]
    for reason in lane_status.get("reasons") or run.reasons:
        lines.append(f"- {reason}")
    if run.gate:
        lines.append(f"- reader gate: {'OPEN' if run.gate.get('open') else 'closed'} ({run.gate.get('reason')})")
    for key, value in sorted((lane_status.get("counters") or run.counters).items()):
        lines.append(f"- {key}: {value}")
    audit = lane_status.get("audit") or []
    if audit:
        lines += ["", "| sampled key | expected revision | ok |", "|---|---|---|"]
        for a in audit:
            lines.append(f"| `{a['key']}` | {a.get('expected_run_time') or a.get('expected_revision') or a.get('expected')}"
                         f"{' / ' + a['sha256'][:12] if a.get('sha256') else ''} | {'yes' if a.get('ok') else 'NO'} |")
    return lines


def _write_summary(lines, path=None):
    path = path or os.environ.get("GITHUB_STEP_SUMMARY")
    text = "\n".join(lines) + "\n"
    logger.info("[Rollout 675] summary:\n%s", text)
    if path:
        try:
            with open(path, "a", encoding="utf-8") as fh:
                fh.write(text)
        except Exception as exc:
            logger.warning("[Rollout 675] step summary not written: %s", type(exc).__name__)


def finish_run(store, now=None, summary_path=None, publish=None, flush=flush_manifest_publish):
    run = r.current()
    if run is None or run.state == r.OFF:
        return None
    if run.state == r.READ_ONLY:
        _write_summary([f"### #675 rollout: READ_ONLY ({run.lane} lane)", "",
                        f"- the {r.OWNER_LANE} lane owns the #675 paths; this lane ran none of them",
                        f"- read-only merges of owned entries: {run.counters.get('read_only_merges', 0)}"], summary_path)
        return {"state": r.READ_ONLY}
    now = now or datetime.now(timezone.utc)
    io, notes = run.io, []
    canary = None
    if run.state in (r.SAFE, r.PROMOTED):
        try:
            canary = write_canary(store, io, now, publish=publish)
        except Exception as exc:
            notes.append(f"canary write failed: {type(exc).__name__}")
    if not flush():
        notes.append("manifest publish flush did not finish")
    try:
        head = io.head_products()
    except Exception:
        head = None
    lost, ghosts, by_name = [], [], {}
    if head is None:
        lost.append("<published head unreadable at read-back>")
    else:
        for raw in head:
            if isinstance(raw, dict):
                by_name.setdefault(raw.get("filename"), []).append(r.iso(raw.get("run_time")))
        for filename, rec in sorted(run.touched.items()):
            want = rec.get("written_run_time")
            if want and not any(x and x >= want for x in by_name.get(filename, [])):
                lost.append(filename)
        if canary and canary not in by_name.get(r.CANARY_FILENAME, []):
            lost.append(r.CANARY_FILENAME)
        ghosts = sorted(f for f in run.marks if f in by_name)
    written = sorted(f for f, rec in run.touched.items() if rec.get("written_run_time"))
    for filename in written[:800]:
        try:
            data = io.download(filename)
        except Exception:
            data = None
        run.touched[filename]["written_sha256"] = r.sha256(data) if data else None
    audit = [{"key": f, "expected_run_time": run.touched[f]["written_run_time"], "sha256": run.touched[f].get("written_sha256"),
              "ok": f not in lost and bool(run.touched[f].get("written_sha256"))} for f in _sample(written, r.AUDIT_SAMPLE)]
    if not written:
        audit += [{"key": f, "expected": "marked delete (GC after grace)", "ok": True}
                  for f in _sample(sorted(run.marks), r.AUDIT_SAMPLE)]
    if canary:      # always audited, with the sha256 of the bytes in storage (Reflection 2026-11-02)
        try:
            cdata = io.download(r.CANARY_FILENAME)
        except Exception:
            cdata = None
        audit.append({"key": r.CANARY_FILENAME, "expected_revision": canary, "sha256": r.sha256(cdata) if cdata else None,
                      "ok": r.CANARY_FILENAME not in lost and r._bytes_run_time(cdata or b"") == canary})
    audit_ok = bool(canary) and run.state != r.BLOCKED and not lost and all(a["ok"] for a in audit)
    if run.touched:
        try:
            r.write_index(run)
        except Exception as exc:
            notes.append(f"final snapshot index not written: {type(exc).__name__}")
    gc = {"skipped": "run BLOCKED"} if run.state == r.BLOCKED else {"skipped": "head unreadable"}
    if run.state != r.BLOCKED and head is not None:
        try:
            referenced = set(by_name) | {p.filename for p in store.get_manifest().products}
            referenced.discard(None)
            gc = scoped_gc_sweep(io, run.marks, referenced, now.timestamp())
        except Exception as exc:
            gc = {"skipped": type(exc).__name__}
    duration = (now - run.started_at).total_seconds() / 60.0
    bounds, baseline, breach = _bounds(run, len(head) if head is not None else 0, duration) if head is not None \
        else ({"mode": "head unreadable"}, list(run.prev.get("baseline") or []), [])
    snaps = {}
    try:
        snaps = prune_snapshots(io, run.lane, r.SNAPSHOT_KEEP)
    except Exception as exc:
        notes.append(f"snapshot retention skipped: {type(exc).__name__}")
    lane_status = {
        "state": run.state, "reasons": run.reasons + notes, "cycle_id": run.cycle_id, "started_at": r.iso(run.started_at),
        "finished_at": r.iso(now), "flags": run.flags, "gate": run.gate,
        "effective": {f: run.effective(f) for f in r.FLAGS},
        "counters": dict(run.counters, touched=len(run.touched), marked=len(run.marks), ghosts=len(ghosts)),
        "observations": run.observations[:50], "canary_revision": canary, "audit": audit, "audit_ok": audit_ok,
        "entries_lost": lost, "gc": gc, "bounds": bounds, "bounds_breach": breach, "baseline": baseline,
        "snapshots": snaps.get("kept", []),
    }
    doc = dict(run.status_doc or {})
    doc.setdefault("lanes", {})
    doc["lanes"] = dict(doc["lanes"], **{run.lane: lane_status})
    doc.update(version=1, updated_at=r.iso(now))
    try:
        write_status(io, doc)
    except Exception as exc:
        lane_status["reasons"].append(f"status object not written: {type(exc).__name__}")
    _write_summary(summary_lines(run, lane_status), summary_path)
    return lane_status


def status_json(lane_status) -> str:
    return json.dumps(lane_status, sort_keys=True, indent=1)
