"""Offline receipt for an immutable scored archive; never downloads or modifies it."""
import argparse
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
import hashlib
import json
import math
from pathlib import Path
import subprocess
import sys
import types

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend"))
from services.weather_pipeline import forecast_skill as skill
from scripts.forecast_accuracy_monitor import default_cfg, evaluate_scored_segment


def sha(data):
    return hashlib.sha256(data).hexdigest()


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def quality(rows, as_of):
    counts = Counter()
    keys = defaultdict(list)
    targets, obs_times, error_deltas = [], [], []
    for row in rows:
        source = row.get("source")
        target = skill._parse_iso(row.get("target_time"))
        obs_time = skill._parse_iso(row.get("obs_time"))
        h, obs, err = (row.get(k) for k in ("hs_m", "obs_hs_m", "err_m"))
        counts["invalid_target_time"] += target is None
        counts["invalid_obs_time"] += obs_time is None
        counts["invalid_error"] += not finite(err)
        counts["invalid_height"] += not finite(h) or h < 0
        counts["invalid_observation_height"] += not finite(obs) or obs < 0
        counts["observation_after_as_of"] += obs_time is not None and obs_time > as_of
        if target:
            targets.append(target)
        if obs_time:
            obs_times.append(obs_time)
        if target and obs_time:
            counts["outside_90_minute_join"] += abs((target - obs_time).total_seconds()) > 5400
        if all(finite(v) for v in (h, obs, err)):
            delta = abs((h - obs) - err)
            error_deltas.append(delta)
            counts["stored_error_mismatch_gt_0_000051m"] += delta > 0.000051
        key = (source, row.get("buoy_id"), row.get("target_time"),
               skill._lead_bucket(row.get("lead_h") or 0))
        keys[key].append(row)
    duplicate_groups = [group for group in keys.values() if len(group) > 1]
    counts["duplicate_key_groups"] = len(duplicate_groups)
    counts["duplicate_extra_rows"] = sum(len(group) - 1 for group in duplicate_groups)
    counts["duplicate_conflicting_rows_groups"] = sum(
        len({json.dumps(row, sort_keys=True) for row in group}) > 1
        for group in duplicate_groups)
    return {
        "row_count": len(rows), "unique_source_buoy_target_lead_keys": len(keys),
        "source_counts": dict(sorted(Counter(row.get("source") for row in rows).items())),
        "buoy_count": len({row.get("buoy_id") for row in rows}),
        "target_span": [min(targets).isoformat(), max(targets).isoformat()] if targets else [],
        "observation_span": [min(obs_times).isoformat(), max(obs_times).isoformat()] if obs_times else [],
        "max_stored_error_difference_m": max(error_deltas, default=None),
        "checks": dict(counts),
    }


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("archive", type=Path)
    parser.add_argument("--as-of", required=True)
    parser.add_argument("--output", type=Path, required=True)
    args = parser.parse_args()
    as_of = datetime.fromisoformat(args.as_of.replace("Z", "+00:00"))
    if as_of.tzinfo is None:
        parser.error("--as-of requires an explicit timezone")
    raw = args.archive.read_bytes()
    rows = json.loads(raw)
    if not isinstance(rows, list) or not all(isinstance(row, dict) for row in rows):
        parser.error("archive must contain a list of scored row objects")
    week = [row for row in rows if (target := skill._parse_iso(row.get("target_time")))
            and timedelta(0) <= as_of - target <= timedelta(days=7)]
    diagnostics = {}
    paired = skill.head_to_head(week, diagnostics=diagnostics)
    cfg = default_cfg()
    # This is an explicit existing default policy replay, not an assertion about remote vars.
    cfg["paired_gate"] = True
    code, lines = evaluate_scored_segment(rows, as_of, cfg=cfg)
    baseline_ref = "607af934e74fa87f3b8e58698ef68fdce919ea54"
    baseline_source = subprocess.check_output([
        "git", "show", f"{baseline_ref}:backend/services/weather_pipeline/forecast_skill.py"], cwd=ROOT)
    baseline = types.ModuleType("historical_forecast_skill")
    exec(compile(baseline_source, "historical_forecast_skill.py", "exec"), baseline.__dict__)
    historical_pairs = baseline.head_to_head(week)
    source_files = ["backend/services/weather_pipeline/forecast_skill.py",
                    "backend/scripts/forecast_accuracy_monitor.py"]
    receipt = {
        "captured_at": datetime.now(timezone.utc).isoformat(),
        "snapshot": {"filename": args.archive.name, "bytes": len(raw), "sha256": sha(raw),
                     "storage_object": "weather-products/calibration/skill/scored-2026-09.json",
                     "storage_updated_at": "2026-09-20T15:37:56.791017+00:00",
                     "raw_archive_handling": "Private local directory outside the Git checkout; never published."},
        "evaluation_as_of": as_of.isoformat(),
        "window": "target_time in [as_of - 7 days, as_of] inclusive",
        "evaluator": {"head": subprocess.check_output(["git", "rev-parse", "HEAD"], cwd=ROOT, text=True).strip(),
                      "source_sha256": {name: sha((ROOT / name).read_bytes()) for name in source_files},
                      "python": sys.version},
        "quality_month_snapshot": quality(rows, as_of), "quality_week": quality(week, as_of),
        "common_observation_pairs": paired, "pairing_diagnostics": diagnostics,
        "target_only_baseline": {"commit": baseline_ref, "source_sha256": sha(baseline_source),
                                 "pairs_on_same_snapshot_and_window": historical_pairs},
        "monitor": {"code": code, "verdict": {0: "OK", 1: "RED", 3: "REFUSED"}[code],
                    "scope": "Pure evaluate_scored_segment only; no live report/residual gates or scheduled run.",
                    "config": {key: value.isoformat() if isinstance(value, datetime) else value
                               for key, value in cfg.items()}, "lines": lines},
        "limitations": ["One retained snapshot, not a proof of complete September retention.",
                        "Rows contain no forecast-issue/scoring timestamp; cannot reconstruct a historical as-known cohort.",
                        "Operational paired rule is not a statistical significance test.",
                        "Offshore significant wave height verification does not validate nearshore surf ratings."],
    }
    args.output.write_text(json.dumps(receipt, indent=2, allow_nan=False) + "\n", encoding="utf-8")
    args.output.with_suffix(".txt").write_text("\n".join(lines) + "\n", encoding="utf-8")
    print(json.dumps({"receipt": str(args.output), "archive_rows": len(rows), "week_rows": len(week),
                      "sha256": sha(raw), "verdict": receipt["monitor"]["verdict"],
                      "pairing_diagnostics": diagnostics, "paired": paired}, indent=2))


if __name__ == "__main__":
    main()
