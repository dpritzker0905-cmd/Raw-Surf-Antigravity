"""C1 for tide-a-harcon-v1 (amendment 2): the VERBATIM finder_check.py, run ONE STATION AT A TIME under the paced
CO-OPS opener (coops_pacing), so a station whose requests fail after the bounded backoff is RECORDED and skipped instead
of crashing the step blind (v1-1). The merged JSON has finder_check's own row for every station that completed; a
missing row at a scored station is C1 VOID in the scorer (a_harcon_score), never a FAIL.

Stations: the same set finder_check --stations scores (each stratum's deciding, then its first 5 reserves).

    python backend/scripts/tide_datum/paced_finder.py --start 2027-02-01 --days 14 --stations <json> --json <out>
"""
import argparse
import json
import os
import runpy
import sys
import tempfile
from pathlib import Path

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE))
import coops_pacing as CP  # noqa: E402

FINDER = HERE / "finder_check.py"


def stations(doc, reserve=5):
    return [(sid, k) for k, s in doc["strata"].items() for sid in s["deciding"] + s["reserve"][:reserve]]


def run_one(sid, stratum, start, days, workdir, runner=None):
    """finder_check's row for one station, or raises HarnessFailure. runner(argv) runs the verbatim script."""
    one = Path(workdir) / f"st_{sid}.json"
    out = Path(workdir) / f"out_{sid}.json"
    one.write_text(json.dumps({"strata": {stratum: {"deciding": [sid], "reserve": []}}}), encoding="utf-8")
    argv = [str(FINDER), "--start", start, "--days", str(days), "--stations", str(one), "--json", str(out)]
    (runner or _runpy)(argv)
    return json.loads(out.read_text(encoding="utf-8"))["gauges"][sid]


def _runpy(argv):
    saved = sys.argv
    sys.argv = list(argv)
    try:
        runpy.run_path(argv[0], run_name="__main__")
    finally:
        sys.argv = saved


def main(argv=None, runner=None):
    ap = argparse.ArgumentParser()
    ap.add_argument("--start", required=True)
    ap.add_argument("--days", type=int, default=14)
    ap.add_argument("--stations", required=True)
    ap.add_argument("--json", required=True)
    a = ap.parse_args(argv)
    CP.install()
    doc = json.loads(Path(a.stations).read_text(encoding="utf-8"))
    merged = {"window": [a.start, a.days], "gauges": {}, "harness_failures": [], "paced": True}
    with tempfile.TemporaryDirectory() as wd:
        for sid, k in stations(doc):
            try:
                merged["gauges"][sid] = run_one(sid, k, a.start, a.days, wd, runner)
            except CP.HarnessFailure as e:
                merged["harness_failures"].append({"station": sid, "stratum": k, "why": str(e)[:300]})
                print(f"HARNESS FAILURE {sid}: {e}", flush=True)
    tmp = a.json + ".tmp"
    with open(tmp, "w", encoding="utf-8", newline="\n") as fh:
        json.dump(merged, fh, indent=1)
    os.replace(tmp, a.json)
    print(f"C1 rows {len(merged['gauges'])}, harness failures {len(merged['harness_failures'])}")


if __name__ == "__main__":
    main()
