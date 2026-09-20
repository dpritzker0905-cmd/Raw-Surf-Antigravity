"""Independent, aggregate-only verification. Never imports application evaluator code."""
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from decimal import Decimal
import hashlib
import json
import math
from pathlib import Path
import subprocess

OUT = Path(__file__).resolve().parent
REPO = OUT.parent.parent.resolve()
PRIVATE = REPO.parent / "raw-surf-private-evidence/2026-09-20/scored-2026-09.json"
AS_OF = datetime(2026, 9, 20, 16, 29, 23, tzinfo=timezone.utc)
START = AS_OF - timedelta(days=7)


def instant(value):
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
        return parsed.astimezone(timezone.utc) if parsed.tzinfo else None
    except (AttributeError, TypeError, ValueError):
        return None


def finite(value):
    return isinstance(value, (int, float)) and not isinstance(value, bool) and math.isfinite(value)


def quality(rows):
    bad = Counter({k: 0 for k in ["invalid_target_time", "invalid_obs_time", "invalid_error",
        "invalid_height", "invalid_observation_height", "observation_after_as_of",
        "outside_90_minute_join", "stored_error_mismatch_gt_0_000051m", "duplicate_key_groups",
        "duplicate_extra_rows", "duplicate_conflicting_rows_groups"]})
    keys, targets, observations = defaultdict(list), [], []
    max_error_difference = 0.0
    for row in rows:
        target, observed = instant(row.get("target_time")), instant(row.get("obs_time"))
        h, o, e = row.get("hs_m"), row.get("obs_hs_m"), row.get("err_m")
        bad["invalid_target_time"] += target is None
        bad["invalid_obs_time"] += observed is None
        bad["invalid_error"] += not finite(e)
        bad["invalid_height"] += not finite(h) or h < 0
        bad["invalid_observation_height"] += not finite(o) or o < 0
        if target:
            targets.append(target)
        if observed:
            observations.append(observed)
            bad["observation_after_as_of"] += observed > AS_OF
        if target and observed:
            bad["outside_90_minute_join"] += abs((observed - target).total_seconds()) > 90 * 60
        if all(finite(value) for value in [h, o, e]):
            diff = abs((h - o) - e)
            max_error_difference = max(max_error_difference, diff)
            bad["stored_error_mismatch_gt_0_000051m"] += diff > 0.000051
        key = row.get("source"), row.get("buoy_id"), target, row.get("lead_h")
        keys[key].append(row)
    for group in keys.values():
        if len(group) > 1:
            bad["duplicate_key_groups"] += 1
            bad["duplicate_extra_rows"] += len(group) - 1
            bad["duplicate_conflicting_rows_groups"] += len({json.dumps(x, sort_keys=True) for x in group}) > 1
    return {"row_count": len(rows), "unique_source_buoy_target_lead_keys": len(keys),
        "source_counts": dict(sorted(Counter(r["source"] for r in rows).items())),
        "buoy_count": len({r["buoy_id"] for r in rows}),
        "target_span": [min(targets).isoformat(), max(targets).isoformat()],
        "observation_span": [min(observations).isoformat(), max(observations).isoformat()],
        "max_stored_error_difference_m": max_error_difference, "checks": dict(bad)}


raw_bytes = PRIVATE.read_bytes()
rows = json.loads(raw_bytes)
receipt_bytes = (OUT / "scored-replay.json").read_bytes()
receipt = json.loads(receipt_bytes)
sha = hashlib.sha256(raw_bytes).hexdigest()
assert sha == receipt["snapshot"]["sha256"] and len(raw_bytes) == receipt["snapshot"]["bytes"]
assert AS_OF == instant(receipt["evaluation_as_of"])
assert not PRIVATE.resolve().is_relative_to(REPO)
privacy_git = subprocess.run(["git", "-C", str(PRIVATE.parent), "rev-parse", "--show-toplevel"],
                             capture_output=True)
assert privacy_git.returncode != 0, "Private archive unexpectedly lies inside a Git worktree"
assert {r["lead_h"] for r in rows} == {24, 48, 72}, "Unexpected leads require explicit bucket policy"
week = [r for r in rows if (t := instant(r.get("target_time"))) is not None and START <= t <= AS_OF]
quality_all, quality_week = quality(rows), quality(week)
assert quality_all == receipt["quality_month_snapshot"]
assert quality_week == receipt["quality_week"]
assert not any(quality_all["checks"].values())

# Independent keyed join and arithmetic. Raw forecasts minus observations reproduce signed
# errors; decimal arithmetic prevents binary rounding from manufacturing wins out of ties.
by_source = defaultdict(dict)
for row in week:
    key = row["buoy_id"], instant(row["target_time"]), int(row["lead_h"])
    by_source[row["source"]][key] = row
ours = by_source["raw_surf"]
comparisons = []
for source in sorted(set(by_source) - {"raw_surf"}):
    for lead in [24, 48, 72]:
        a = {key: row for key, row in ours.items() if key[2] == lead}
        b = {key: row for key, row in by_source[source].items() if key[2] == lead}
        target_keys = set(a) & set(b)
        common, missing, mismatched = [], 0, 0
        for key in target_keys:
            left, right = a[key], b[key]
            ta, tb = instant(left.get("obs_time")), instant(right.get("obs_time"))
            ha, hb = left.get("obs_hs_m"), right.get("obs_hs_m")
            if ta is None or tb is None or not finite(ha) or not finite(hb):
                missing += 1
            elif ta != tb or ha != hb:
                mismatched += 1
            else:
                common.append(key)
        errors_a = [abs(Decimal(str(a[key]["hs_m"])) - Decimal(str(a[key]["obs_hs_m"]))) for key in common]
        errors_b = [abs(Decimal(str(b[key]["hs_m"])) - Decimal(str(b[key]["obs_hs_m"]))) for key in common]
        n = len(common)
        wins = sum(x < y for x, y in zip(errors_a, errors_b))
        ties = sum(x == y for x, y in zip(errors_a, errors_b))
        mae_a, mae_b = sum(errors_a) / n, sum(errors_b) / n
        row = {"source": source, "lead_h": lead, "n_target_matched": len(target_keys), "n_paired": n,
            "n_observation_mismatch": mismatched, "n_observation_missing": missing,
            "n_ours_total": len(a), "n_theirs_total": len(b),
            "mae_ours_m": round(float(mae_a), 4), "mae_theirs_m": round(float(mae_b), 4),
            "delta_m": round(float(mae_a - mae_b), 4), "win_rate": round(wins / n, 4),
            "we_lose": mae_a > mae_b}
        expected = next(r for r in receipt["common_observation_pairs"] if r["source"] == source and r["lead_h"] == lead)
        assert row == expected, {"comparison": [source, lead], "different_fields":
            {k: [row[k], expected.get(k)] for k in row if row[k] != expected.get(k)}}
        old = next(r for r in receipt["target_only_baseline"]["pairs_on_same_snapshot_and_window"]
                   if r["source"] == source and r["lead_h"] == lead)
        assert all(row[k] == value for k, value in old.items())
        comparisons.append({**row, "wins": wins, "ties": ties, "losses": n - wins - ties,
                            "sum_abs_error_ours_m": str(sum(errors_a)), "sum_abs_error_theirs_m": str(sum(errors_b))})
assert len(comparisons) == len(receipt["common_observation_pairs"]) == 15
result = {"verified_at_utc": datetime.now(timezone.utc).isoformat(),
    "result": "All 15 comparison rows and both quality summaries independently match.",
    "method": "Python standard library only; UTC target window, independent source/buoy/target/lead join, identical observation timestamp and height, absolute error recomputed from forecast minus observation with Decimal; strict wins, ties excluded from numerator.",
    "raw_snapshot": {"filename": PRIVATE.name, "bytes": len(raw_bytes), "sha256": sha,
                     "outside_weather_checkout": True, "outside_any_ancestor_git_worktree": True},
    "reviewed_receipt_sha256": hashlib.sha256(receipt_bytes).hexdigest(),
    "as_of_utc": AS_OF.isoformat(), "target_window_start_inclusive_utc": START.isoformat(),
    "target_window_end_inclusive_utc": AS_OF.isoformat(),
    "quality_month_snapshot": quality_all, "quality_week": quality_week, "comparisons": comparisons,
    "same_snapshot_target_only_equivalent": True,
    "historical_window_equivalence": "NOT ESTABLISHED: this fixed September20 window is not the prior handoff cohort. No issued/scored timestamps exist to reconstruct a historical as-known cohort.",
    "limitations": ["One retained snapshot does not demonstrate complete retention or historical truth.",
                    "Sources have different matched sample counts; do not rank independent unpaired MAEs as a common cohort.",
                    "Rows and lead times are correlated; strict win fractions are descriptive, not independent-trial significance tests.",
                    "This archive verifies offshore significant wave height, not nearshore surf rating or visual correctness."],
    "privacy": "Only aggregate counts and errors emitted. Raw archive read in place; no raw rows copied, printed, or published."}
(OUT / "independent-replay-check.json").write_text(json.dumps(result, indent=2) + "\n", encoding="utf-8")
print(json.dumps({"rows": len(rows), "week_rows": len(week), "comparisons_matched": len(comparisons),
    "quality_issues": sum(quality_all["checks"].values()), "sha256": sha,
    "persistence": [{k: r[k] for k in ["lead_h", "n_paired", "mae_ours_m", "mae_theirs_m", "wins", "ties", "losses"]}
                    for r in comparisons if r["source"] == "persistence"]}))
