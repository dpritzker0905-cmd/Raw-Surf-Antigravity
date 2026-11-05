#!/usr/bin/env python3
"""rework_window.py - ONE window of a rework scorecard (CI entry point for .github/workflows/rework-score.yml).

Reads a declaration `docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/<slug>.score.json`:
  {"runner": "harness" | "exposure", "stations": "<repo path>", "windows": {TAG: [start, end]},
   "harness_arms": ["FLAG=v[,FLAG=v]", ...], "gate_arms": [...], "quantities": [...]}
then (1) fills the cache in parallel with eval_backfill's prefetch (GFS-Wave + pgrb2 byte ranges, AWS open archive),
(2) runs the window: `harness` = eval_harness.py run with the declared arms (production parity: pygrib + pgrb2 wind);
`exposure` = scripts/rework_exposure_run.py (the harness plus the BHC input substitution and the offline exposure
arms). Public data only; no secret is read; the harness's network guard refuses the app's own hosts.

    python scripts/rework_window.py --decl <path> --win W1 --cache-dir /tmp/c --out /tmp/out_W1
"""
import argparse
import json
import os
import subprocess
import sys

HERE = os.path.dirname(os.path.abspath(__file__))
BACKEND = os.path.dirname(HERE)
REPO = os.path.dirname(BACKEND)


def load(path):
    with open(path, encoding="utf-8") as f:
        d = json.load(f)
    for k in ("runner", "stations", "windows", "gate_arms"):
        if k not in d:
            raise SystemExit(f"{path}: declaration lacks '{k}'")
    if d["runner"] not in ("harness", "exposure"):
        raise SystemExit(f"{path}: unknown runner {d['runner']!r}")
    return d


def commands(d, win, cache, out, workers=8):
    start, end = d["windows"][win]
    stations = os.path.join(REPO, d["stations"])
    pre = [sys.executable, os.path.join(HERE, "eval_backfill.py"), "prefetch", "--name", win, "--start", start,
           "--end", end, "--cache-dir", cache, "--workers", str(workers)]
    if d["runner"] == "harness":
        run = [sys.executable, os.path.abspath(__file__), "--harness", "--", "run", "--stations", stations,
               "--start", start, "--end", end, "--cache-dir", cache, "--out", out, "--decoder", "pygrib",
               "--wind-source", "pgrb2", "--exit-zero", "--pause-s", "0.05"]
        for a in d.get("harness_arms", []):
            run += ["--arm", a]
    else:
        run = [sys.executable, os.path.join(HERE, "rework_exposure_run.py"), "--stations", stations, "--start", start,
               "--end", end, "--cache-dir", cache, "--out", out]
    return pre, run


def harness(hargs):
    """eval_harness.run in-process with the retrying GET (rework_net.retrying_get): CDIP's THREDDS answers
    a transient 403 under load (seen on the first CI run), which the harness's single GET treats as fatal."""
    sys.path[:0] = [BACKEND, HERE]
    import eval_harness as eh
    from rework_net import COUNT, install_resilient_truth, retrying_get
    args = eh.parser().parse_args(hargs)
    install_resilient_truth()
    card = eh.run(args, get=retrying_get)
    print(json.dumps({"controls_ok": card["controls_ok"], "counts": COUNT}, indent=1))
    with open(os.path.join(args.out, "rework_counts.json"), "w", encoding="utf-8") as f:
        json.dump(COUNT, f, indent=1)
    return 0


def main(argv=None):
    argv = sys.argv[1:] if argv is None else argv
    if argv[:2] == ["--harness", "--"]:
        return harness(argv[2:])
    ap = argparse.ArgumentParser()
    ap.add_argument("--decl", required=True)
    ap.add_argument("--win", required=True)
    ap.add_argument("--cache-dir", required=True)
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=8)
    ap.add_argument("--dry-run", action="store_true")
    a = ap.parse_args(argv)
    d = load(a.decl)
    pre, run = commands(d, a.win, a.cache_dir, a.out, a.workers)
    for cmd in (pre, run):
        print("+", " ".join(cmd), flush=True)
        if not a.dry_run:
            rc = subprocess.call(cmd, cwd=BACKEND)
            if rc != 0 and cmd is run:
                return rc
            if rc != 0:
                print(f"prefetch exited {rc}; the run fetches what is missing itself", flush=True)
    return 0


if __name__ == "__main__":
    sys.exit(main())
