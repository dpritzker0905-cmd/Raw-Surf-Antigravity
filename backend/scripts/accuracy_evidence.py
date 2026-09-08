"""Credential-free snapshots and offline replay of the accuracy monitor's inputs."""
import hashlib
import json
import os
import math
from collections import Counter, defaultdict
from datetime import datetime
from pathlib import Path


def quality_counts(scored):
    """Aggregate integrity checks; no raw observations, forecasts or station IDs."""
    from services.weather_pipeline.forecast_skill import dedupe_key, SOURCE_OURS
    groups = defaultdict(list)
    nonfinite = 0
    for row in scored or []:
        groups[dedupe_key(row)].append(row)
        error = row.get("err_m")
        nonfinite += not isinstance(error, (int, float)) or not math.isfinite(error)
    comparisons = Counter()
    for key, rows in groups.items():
        if key[0] != SOURCE_OURS or len(rows) != 1:
            continue
        other = groups.get(("persistence", *key[1:]))
        if not other or len(other) != 1:
            continue
        ours, theirs = rows[0], other[0]
        comparisons["unique_pairs"] += 1
        for field in ("obs_time", "obs_hs_m", "lead_h"):
            if ours.get(field) is None or theirs.get(field) is None:
                comparisons[field + "_missing"] += 1
            elif ours[field] != theirs[field]:
                comparisons[field + "_different"] += 1
    return {"archive_loaded": scored is not None, "rows": len(scored or []),
            "duplicate_keys": sum(len(rows) > 1 for rows in groups.values()),
            "nonfinite_or_missing_errors": nonfinite,
            "primary_persistence": dict(comparisons)}


def write_evidence(directory, *, now, cfg, report, residuals, scored, has_creds,
                   verdict, health):
    root = Path(directory)
    root.mkdir(parents=True, exist_ok=True)
    payload = {"as_of": now.isoformat(), "config": cfg, "report": report,
               "residuals": residuals, "scored": scored,
               "archives_enabled": has_creds, "verdict": verdict}
    raw = json.dumps(payload, default=lambda x: x.isoformat(), allow_nan=False,
                     sort_keys=True, indent=2).encode("utf-8")
    (root / "inputs.json").write_bytes(raw)
    manifest = {"schema_version": 1, "inputs_sha256": hashlib.sha256(raw).hexdigest(),
                "workflow_sha": os.environ.get("GITHUB_SHA"),
                "workflow_run_id": os.environ.get("GITHUB_RUN_ID"),
                "backend_version": health.get("version") if isinstance(health, dict) else None,
                "identity_note": "Backend version sampled after inputs; no atomic snapshot implied."}
    (root / "manifest.json").write_text(json.dumps(manifest, indent=2), encoding="utf-8")
    (root / "quality.json").write_text(json.dumps(quality_counts(scored), indent=2), encoding="utf-8")


def replay(directory):
    from scripts.forecast_accuracy_monitor import (
        combine, evaluate_report, evaluate_residual_history, evaluate_scored_segment)
    root = Path(directory)
    raw = (root / "inputs.json").read_bytes()
    manifest = json.loads((root / "manifest.json").read_text(encoding="utf-8"))
    if manifest.get("schema_version") != 1:
        raise ValueError("Unsupported accuracy evidence schema")
    if hashlib.sha256(raw).hexdigest() != manifest["inputs_sha256"]:
        raise ValueError("Accuracy evidence hash mismatch")
    data = json.loads(raw)
    now = datetime.fromisoformat(data["as_of"])
    cfg = data["config"]
    for key in ("ops_grace", "scored_grace", "paired_grace"):
        cfg[key] = datetime.fromisoformat(cfg[key])
    code, lines = evaluate_report(data["report"], now, cfg)
    if data["archives_enabled"]:
        rc, rl = evaluate_residual_history(data["residuals"], now)
        sc, sl = evaluate_scored_segment(data["scored"], now, cfg=cfg)
        code = combine(combine(code, rc), sc)
        lines += rl + sl
    if code != data["verdict"]:
        raise ValueError("Replay verdict differs from captured verdict")
    return code, lines


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("directory")
    code, lines = replay(parser.parse_args().directory)
    print("\n".join(lines))
    print("REPLAY VERIFIED: captured verdict %s reproduced; not a live measurement." % code)
