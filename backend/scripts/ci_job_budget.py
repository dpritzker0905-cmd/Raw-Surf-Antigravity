"""Job time-left gate for forecast-ingest-pilots.yml (2026-11-23).

The pilots job has a 300-minute timeout and a long tail of optional raster publishers after the core ingest and
frame publishes. Measured 2026-11-20..23: the job ran 140-238 min; the ingest step 112-163 min and the frame publishers
55-65 min, so the raster block starts with 70-130 min left. Each raster step has its own timeout, but their worst
cases sum past the job's, and a job timeout kills whatever step is running (possibly mid latest.json write).
This script is run once, right before the raster block. It sets the step output `go`: 'false' when less than
--reserve-min minutes are left, so each raster step can skip cleanly instead of starting work it cannot finish.
Nothing published changes while the job has time. Kill: repository variable JOB_BUDGET_GATE = '0' (always go).

Usage: python backend/scripts/ci_job_budget.py --t0 <epoch seconds> [--limit-min 300] [--reserve-min 45]
Writes go=<true|false>, elapsed_min and remaining_min to $GITHUB_OUTPUT and a line to $GITHUB_STEP_SUMMARY.
Always exits 0: a gate must never fail the job it protects.
"""
import argparse
import os
import sys
import time


def decide(t0, now, limit_min, reserve_min, enabled=True):
    """Return (go, elapsed_min, remaining_min). A bad t0 or a disabled gate means go (never block on a guess)."""
    try:
        elapsed_min = (float(now) - float(t0)) / 60.0
    except (TypeError, ValueError):
        return True, None, None
    if elapsed_min < 0:
        return True, None, None
    remaining = float(limit_min) - elapsed_min
    return (True if not enabled else remaining >= float(reserve_min)), round(elapsed_min, 1), round(remaining, 1)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--t0", default=os.environ.get("JOB_T0", ""))
    ap.add_argument("--limit-min", type=float, default=300.0)
    ap.add_argument("--reserve-min", type=float, default=45.0)
    a = ap.parse_args(argv)
    enabled = os.environ.get("JOB_BUDGET_GATE", "1") != "0"
    go, elapsed, remaining = decide(a.t0, time.time(), a.limit_min, a.reserve_min, enabled)
    line = f"job budget gate: go={str(go).lower()} elapsed={elapsed} min remaining={remaining} min (reserve {a.reserve_min:g}, gate {'on' if enabled else 'OFF'})"
    print(line)
    if not go:
        print(f"::warning title=Raster publishers skipped::{line}. The core ingest and frame publishes already completed; the raster sets keep their published indexes until the next run.")
    for env, text in (("GITHUB_OUTPUT", f"go={str(go).lower()}\nelapsed_min={elapsed}\nremaining_min={remaining}\n"),
                      ("GITHUB_STEP_SUMMARY", line + "\n")):
        path = os.environ.get(env)
        if path:
            try:
                with open(path, "a", encoding="utf-8") as fh:
                    fh.write(text)
            except OSError:
                pass
    return 0


if __name__ == "__main__":
    sys.exit(main())
