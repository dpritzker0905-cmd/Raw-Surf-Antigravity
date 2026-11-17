"""Read one pilots run against the frames-budget gate (docs/weather-program/log/2026-11-16-opus-frames-budget.md).

Read-only. It reads the run's job and step times and its job log from the GitHub API (`gh`, the caller's own login), and the
PUBLIC latest.json (no key). It never calls the Render box.

Skips are counted twice, from two sources that must agree:
- the step's own log lines: `[frames] <key>: skipped, the run is past its <N> s budget`;
- the step's `{"frame_sets": ...}` report: entries with `skipped_budget`.
A report whose keys all end in `_rated` is the rated step's; the other is the frames step's.

The run lag is read from each set's OWN latest.json entry (`run`), never `previous_index` (a walker that read previous_index
reported lag that was not there, 2026-11-16). One line per rated set: rated run, plain sibling run, difference in hours
(negative = the rated set is BEHIND its plain sibling, the gate's failure; positive = newer, not a failure).

    python scripts/frames_budget_gate.py --run <pilots run id> --base <public weather-frames URL>
    python scripts/frames_budget_gate.py --run <id> --latest path/to/latest.json --log path/to/job.log

The public URL is built from SUPABASE_URL by the caller (by name; never written here). Read latest.json right after the run
ends: a later run rewrites it.
"""
import argparse
import json
import re
import subprocess
import sys
import urllib.request
from datetime import datetime
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
from services import frame_set as fs  # noqa: E402

FRAMES_STEP = "Publish static forecast frames"
RATED_STEP = "Publish rated static frames"
SKIP_LINE = re.compile(r"\[frames\] (\S+): skipped, the run is past its (\d+) s budget")
GFS_REGIONAL_WAVES = re.compile(r"^GFS/marine/waves/(?!global)[^/]+$")
LIMITS = {"skips_per_step": 2, "job_minutes": 240}


def _gh(path, *extra):
    out = subprocess.run(["gh", "api", *extra, path], check=True, capture_output=True, text=True, encoding="utf-8").stdout
    return out


def _t(s):
    return datetime.fromisoformat(s.replace("Z", "+00:00")) if s else None


def job_of(run_id):
    jobs = json.loads(_gh(f"repos/{{owner}}/{{repo}}/actions/runs/{run_id}/jobs"))["jobs"]
    job = next(j for j in jobs if j["name"] == "ingest-pilots")
    return job


def step_rows(job):
    rows = {}
    for st in job["steps"]:
        for label, prefix in (("frames", FRAMES_STEP), ("rated", RATED_STEP)):
            if st["name"].startswith(prefix):
                a, b = _t(st.get("started_at")), _t(st.get("completed_at"))
                rows[label] = {"conclusion": st.get("conclusion"), "seconds": (b - a).total_seconds() if a and b else None}
    return rows


def skips_from_log(text):
    """(log-line skips, report skips) per step label, plus the frames step's skipped keys."""
    line_skips = {"frames": set(), "rated": set()}
    report_skips = {"frames": set(), "rated": set()}
    for line in text.splitlines():
        m = SKIP_LINE.search(line)
        if m:
            line_skips["rated" if m.group(1).endswith("_rated") else "frames"].add(m.group(1))
        i = line.find('{"frame_sets"')
        if i >= 0:
            try:
                rep = json.loads(line[i:])["frame_sets"]
            except ValueError:
                continue
            keys = list(rep)
            label = "rated" if keys and all(k.endswith("_rated") for k in keys) else "frames"
            report_skips[label] |= {k for k, v in rep.items() if isinstance(v, dict) and v.get("skipped_budget")}
    return line_skips, report_skips


def lag_rows(latest):
    sets = latest.get("sets", {})
    rows = []
    for key in sorted(sets):
        if not key.endswith("_rated"):
            continue
        plain = sets.get(key[: -len("_rated")])
        r, p = _t(sets[key].get("run")), _t((plain or {}).get("run"))
        diff = (r - p).total_seconds() / 3600 if r and p else None
        rows.append((key, sets[key].get("run"), (plain or {}).get("run"), diff))
    return rows


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--run", required=True, help="the pilots run id")
    ap.add_argument("--base", help="the public weather-frames URL (…/storage/v1/object/public/weather-frames)")
    ap.add_argument("--latest", help="a saved latest.json instead of --base")
    ap.add_argument("--log", help="a saved job log instead of the jobs API")
    a = ap.parse_args(argv)
    if not (a.base or a.latest):
        ap.error("--base or --latest")

    job = job_of(a.run)
    job_min = (_t(job["completed_at"]) - _t(job["started_at"])).total_seconds() / 60 if job.get("completed_at") else None
    steps = step_rows(job)
    log_text = open(a.log, encoding="utf-8", errors="replace").read() if a.log else _gh(
        f"repos/{{owner}}/{{repo}}/actions/jobs/{job['id']}/logs", "--allow-escape-sequences")
    line_skips, report_skips = skips_from_log(log_text)
    if a.latest:
        latest = json.load(open(a.latest, encoding="utf-8"))
    else:
        with urllib.request.urlopen(a.base.rstrip("/") + "/" + fs.LATEST, timeout=30) as r:
            latest = json.load(r)

    print(f"run {a.run}  job {job['conclusion']}  {job_min:.0f} min" if job_min else f"run {a.run}  job not finished")
    for label in ("frames", "rated"):
        st = steps.get(label, {})
        agree = "agree" if line_skips[label] == report_skips[label] else "DISAGREE"
        print(f"{label:6s} step {st.get('conclusion')}  {st.get('seconds') or 0:.0f} s  skips: log {len(line_skips[label])}, "
              f"report {len(report_skips[label])} ({agree})")
    waves_skipped = sorted(k for k in line_skips["frames"] | report_skips["frames"] if GFS_REGIONAL_WAVES.match(k))
    print(f"plain GFS regional waves bundles skipped: {len(waves_skipped)} {waves_skipped if waves_skipped else ''}")

    print("\nrated set | rated run | plain run | rated - plain (h)")
    behind = 0
    for key, r, p, d in lag_rows(latest):
        behind += d is not None and d < 0
        print(f"{key} | {r} | {p} | {'?' if d is None else f'{d:+.0f}'}")

    ok = {
        "1 skips <= 2 per step": all(len(line_skips[x] | report_skips[x]) <= LIMITS["skips_per_step"] for x in line_skips),
        "2 no step timeout, job < 240 min": all(steps.get(x, {}).get("conclusion") == "success" for x in ("frames", "rated"))
        and job_min is not None and job_min < LIMITS["job_minutes"],
        "3 no rated set behind its plain sibling": behind == 0,
        "4 no plain GFS regional waves bundle skipped": not waves_skipped,
    }
    print(f"\nrated sets behind: {behind}")
    for k, v in ok.items():
        print(f"gate {k}: {'PASS' if v else 'FAIL'}")
    print("gate 5 (#975 order: rated GFS waves bundles first): read the rated step's log order by hand")
    return 0 if all(ok.values()) else 1


if __name__ == "__main__":
    sys.exit(main())
