"""publish_outcome_gate.py - end an ingest run RED when a continue-on-error step failed (no fail-green).

The ingest jobs' publish steps run with continue-on-error, so one failing set never stops the rest. But a run whose
publish failed then ended GREEN and nobody looked. Measured 2026-11-24 (error annotations on green runs): 5 of 60
green pilots runs since 2026-11-10 and 1 of 60 green core runs since 2026-11-15 had a step exit non-zero. One was
2026-11-20 05:02Z: the wind-lane rebuild published nothing during the credential outage, and the run stayed green.

The workflow passes `toJSON(steps)` (each id'd step's outcome and conclusion; these jobs write no step outputs) as
STEPS_JSON. A step whose OUTCOME is failure but whose CONCLUSION is success failed and was masked by
continue-on-error. This names each one as an ::error and exits 1. REPORT_ONLY=1 (repo variable
PUBLISH_FAIL_GREEN_OK) prints them as ::warning and exits 0.
"""
import json
import os
import sys


def masked_failures(steps: dict) -> list:
    """Step ids whose outcome is failure while their conclusion is success (continue-on-error masked it). PURE."""
    return sorted(k for k, v in (steps or {}).items()
                  if isinstance(v, dict) and v.get("outcome") == "failure" and v.get("conclusion") == "success")


def main(env=None) -> int:
    env = os.environ if env is None else env
    try:
        steps = json.loads(env.get("STEPS_JSON") or "{}")
    except ValueError:
        print("::warning title=No fail-green::STEPS_JSON unreadable; masked publish failures not checked")
        return 0
    bad = masked_failures(steps)
    if not bad:
        print(f"No masked failures among {len(steps)} id'd steps.")
        return 0
    level = "warning" if env.get("REPORT_ONLY") == "1" else "error"
    for k in bad:
        print(f"::{level} title=Masked publish failure::step '{k}' failed (continue-on-error kept the run going); "
              f"its set kept the previous published index, so the map shows an older run for it")
    return 0 if level == "warning" else 1


if __name__ == "__main__":
    sys.exit(main())
