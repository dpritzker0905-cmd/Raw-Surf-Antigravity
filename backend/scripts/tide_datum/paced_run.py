"""Run one CO-OPS-reading step of tide-a-harcon-v1 under the paced, fail-closed guard (coops_pacing; amendment 3).

    python backend/scripts/tide_datum/paced_run.py --budget-s 3300 --outcome outcome.json <target.py> [target args...]

The target runs as __main__ with sys.argv = [target, *args] and its own directory first on sys.path. If a CO-OPS
request cannot be completed (CoopsUnavailable), or the request audit finds a request that bypassed the wrapper, the
runner writes `--outcome` as {"status": "no_run_infra", "step", "station", "attempts", "why"} and exits 3 (R2): no later
step runs, so no score exists, and the run is "no run" under the gate's rule (amendment 3, R1) only if no
outcome-bearing quantity was printed or uploaded either (pinned by tests/test_coops_pacing.py).
"""
import argparse
import json
import os
import runpy
import sys
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import coops_pacing as CP  # noqa: E402


def write_outcome(path, doc):
    tmp = path + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(doc, fh, indent=1)
    os.replace(tmp, path)


def main(argv=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--budget-s", type=float, required=True, help="the step's timeout minus a margin, seconds")
    ap.add_argument("--outcome", default="outcome.json")
    ap.add_argument("target")
    ap.add_argument("args", nargs=argparse.REMAINDER)
    a = ap.parse_args(argv)
    CP.install()
    CP.set_budget(a.budget_s)
    saved = list(sys.argv)
    sys.argv = [a.target] + list(a.args)
    sys.path.insert(0, str(Path(a.target).resolve().parent))
    try:
        runpy.run_path(a.target, run_name="__main__")
        CP.audit()
    except CP.CoopsUnavailable as e:
        write_outcome(a.outcome, {"status": "no_run_infra", "step": Path(a.target).name, "station": e.station,
                                  "attempts": e.attempts, "why": str(e)[:300]})
        print(f"NO RUN (infra): {e}", flush=True)
        sys.exit(3)
    finally:
        sys.argv = saved


if __name__ == "__main__":
    main()
