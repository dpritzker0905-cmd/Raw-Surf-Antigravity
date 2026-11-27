"""Check a scoped main promotion against the measured backend on its exact base."""

import json
import os
from pathlib import Path
import re
import subprocess
import sys
from datetime import datetime, timezone

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "backend" / "scripts"))
import ci_floor_staleness as floors  # noqa: E402


WORKFLOW = ".github/workflows/ci.yml"
POLICY_FILES = {
    "frontend/package.json",
    "frontend/package-lock.json",
    ".github/scripts/main_release_floors.py",
    ".github/scripts/test_main_release_floors.py",
    WORKFLOW,
}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT)


def measured_jobs(workflow):
    # The measured jobs and their shared workflow configuration precede the
    # staleness job. Refuse to classify a changed or ambiguous layout as scoped.
    marker = b"\n  backend-floor-staleness:\n"
    if workflow.count(marker) != 1:
        raise floors.Refusal("cannot locate the unique backend-floor-staleness job")
    return workflow.split(marker)[0]


def scoped_base(event_name, event, tested):
    if event_name == "pull_request":
        pr = event["pull_request"]
        if pr["base"]["ref"] != "main" or pr["head"]["ref"] == "dev":
            return None
        base = pr["base"]["sha"]
        if git("rev-parse", f"{tested}^1").decode().strip() != base:
            raise floors.Refusal("candidate merge parent differs from PR base")
    elif event_name == "push" and event["ref"] == "refs/heads/main":
        base = event["before"]
    else:
        return None
    if not re.fullmatch("[0-9a-f]{40}", base) or set(base) == {"0"}:
        raise floors.Refusal("missing main base commit")
    # Compare both ends, including deletions and renames. Only a dependency
    # promotion or maintenance of this gate can use the exact-main baseline.
    files = set(git("diff", "--no-renames", "--name-only", "-z", base, tested)
                .decode().split("\0")) - {""}
    if not files or not files <= POLICY_FILES:
        return None
    if WORKFLOW in files and measured_jobs(git("show", f"{base}:{WORKFLOW}")) != measured_jobs(
        git("show", f"{tested}:{WORKFLOW}")
    ):
        return None
    return base


def fresh_jobs(jobs, now):
    result = {}
    for lane, spec in floors.LANES.items():
        matches = [job for job in jobs if job["name"] == spec["job"]]
        if len(matches) != 1:
            raise floors.Refusal(f"expected one measured job for {lane}")
        job = matches[0]
        if job["conclusion"] != "success" or job["status"] != "completed":
            raise floors.Refusal(f"{lane} has no successful measurement")
        for field in ("started_at", "completed_at"):
            age = floors._age_days({"databaseId": job["id"], "createdAt": job[field]}, now)
            if age > floors.MAX_READING_AGE_DAYS:
                raise floors.Refusal(f"{lane} measurement is {age:.1f} days old")
        result[lane] = job["id"]
    return result


def main_baseline(base):
    repo = os.environ["GITHUB_REPOSITORY"]
    api = f"repos/{repo}/actions"
    query = f"event=push&branch=main&status=success&head_sha={base}&per_page=100"
    runs = json.loads(floors._gh(["api", f"{api}/workflows/ci.yml/runs?{query}"],
                                "finding the successful main push"))["workflow_runs"]
    matches = [r for r in runs if r["event"] == "push" and r["head_branch"] == "main"
               and r["head_sha"] == base and r["conclusion"] == "success"
               and r["head_repository"]["full_name"] == repo]
    if not matches:
        raise floors.Refusal(f"no successful main CI push at {base}")
    run = max(matches, key=lambda r: r["run_number"])
    run_id, attempt = run["id"], run["run_attempt"]
    endpoint = f"{api}/runs/{run_id}/attempts/{attempt}/jobs?per_page=100"
    pages = json.loads(floors._gh(["api", "--paginate", "--slurp", endpoint], "reading measured jobs"))
    jobs = fresh_jobs([j for page in pages for j in page["jobs"]], datetime.now(timezone.utc))
    readings = {}
    for lane, job_id in jobs.items():
        log = floors._gh(["run", "view", str(run_id), "--log", f"--job={job_id}"],
                         f"reading {lane} measurement")
        spec = floors.LANES[lane]
        hits = [m for line in log.splitlines() if "\x1b[36;1m" not in line
                for m in [spec["observed"].search(line)] if m]
        if not hits:
            raise floors.Refusal(f"no measured summary in {lane} job {job_id}")
        values = tuple(map(int, hits[-1].groups()))
        readings[lane] = values if spec["has_files_floor"] else (None, values[0])
        print(f"{lane}: {readings[lane]} from job {job_id}")
    print(f"main baseline {base}, run {run_id}, attempt {attempt}")
    stale = floors.evaluate(floors.read_floors(), readings)
    for lane, kind, floor, observed, lag, budget in stale:
        print(f"::error::{lane} {kind}: floor {floor}, observed {observed}, lag {lag}, budget {budget}")
    return int(bool(stale))


def main():
    event = json.loads(Path(os.environ["GITHUB_EVENT_PATH"]).read_text(encoding="utf-8"))
    base = scoped_base(os.environ["GITHUB_EVENT_NAME"], event, os.environ["GITHUB_SHA"])
    return main_baseline(base) if base else floors.main()


if __name__ == "__main__":
    try:
        sys.exit(main())
    except (floors.Refusal, KeyError, ValueError, subprocess.CalledProcessError) as exc:
        sys.exit(f"::error::floor check refused: {exc}")
