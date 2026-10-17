"""nearshore_gate_ci.py -- run the SURF-ZONE GATE on the nearshore judge's report (WS-CAN-0076 follow-up).

The 'Nearshore Validation' workflow runs scripts/run_nearshore_validation.py, which writes nearshore_report.json and
exits 0 GRADED / 1 REFUSED / 2 INFRA. This is the step after it: it reads that report and grades it with
services.weather_pipeline.nearshore_gate (the rules, thresholds and their measured basis live there).

  exit 0  OK or WARN   (a WARN is a ::warning:: annotation and a line in the step summary; the run stays green)
  exit 1  RED or REFUSE (an ::error:: annotation; RED only after the grace date, REFUSE when the gate is blind)

Kill switch: NEARSHORE_GATE=0 prints nothing, writes nothing and exits 0 (today's behaviour exactly).
The workflow runs this step only after the runner step SUCCEEDED, so an INFRA or REFUSED run, which already failed
the job, is not reported a second time.

  python scripts/nearshore_gate_ci.py --report nearshore_report.json [--as-of YYYY-MM-DD]
ASCII output only (cp1252 Windows consoles).
"""
import argparse
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.nearshore_gate import REFUSE, Finding, clean, grade_nearshore_gate   # noqa: E402


def load_report(path: str):
    """The parsed report, or None when the file is missing or is not JSON (the gate then REFUSES: blind, not green)."""
    try:
        with open(path, encoding="utf-8") as f:
            return json.load(f)
    except (OSError, ValueError):
        return None


def main(argv=None, env=None) -> int:
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--report", default="nearshore_report.json")
    ap.add_argument("--as-of", default=None, help="grade as if this ISO date were today (replay/dry-run only)")
    args = ap.parse_args(argv)
    env = os.environ if env is None else env
    try:
        gate = grade_nearshore_gate(load_report(args.report), env=env, today=args.as_of)
    except Exception as e:                                            # noqa: BLE001 -- a gate bug must be named, never silent
        finding = Finding(REFUSE, "internal", "BLIND (the gate itself crashed: %s: %s). Set the repo variable "
                          "NEARSHORE_GATE=0 to switch the gate off while it is fixed." % (type(e).__name__, clean(e, 160)))
        print(finding.line)
        print("::error::" + finding.line)
        return 1
    if args.as_of and gate.enabled:
        print("GATE note replay mode: grading as of %s, not today. Not a live verdict." % args.as_of)
    for line in gate.lines:
        print(line)
    for annotation in gate.annotations:
        print(annotation)
    path = env.get("GITHUB_STEP_SUMMARY")
    if gate.summary_markdown and path:
        with open(path, "a", encoding="utf-8") as f:
            f.write(gate.summary_markdown)
    return gate.exit_code


if __name__ == "__main__":
    sys.exit(main())
