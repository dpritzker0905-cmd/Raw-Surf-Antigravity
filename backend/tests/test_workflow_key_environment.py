"""Every workflow job that reads the Supabase service-role key declares the `supabase-service` environment (PR #1043).

The key lives ONLY in that environment (deployment branches dev and main). Once the repository-level secret is deleted, a
job that names `secrets.SUPABASE_SERVICE_ROLE_KEY` without the environment gets an EMPTY value and fails, or worse
quietly skips its storage work. This scans every workflow so the next one that forgets is caught in CI, not in prod.
Workflows that use the key only inside a reusable workflow call are covered by the called file's own jobs.
"""
import glob
import os

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
ENVIRONMENT = "supabase-service"
KEY = "secrets.SUPABASE_SERVICE_ROLE_KEY"


def _key_jobs():
    out = []
    for path in sorted(glob.glob(os.path.join(ROOT, ".github", "workflows", "*.y*ml"))):
        text = open(path, encoding="utf-8").read()
        if KEY not in text:
            continue
        doc = yaml.safe_load(text) or {}
        workflow_env = yaml.safe_dump(doc.get("env") or {})
        for name, job in (doc.get("jobs") or {}).items():
            if KEY in yaml.safe_dump(job) or KEY in workflow_env:
                out.append((os.path.basename(path), name, job))
    return out


JOBS = _key_jobs()


def test_the_scan_finds_the_key_jobs():
    assert len(JOBS) >= 20, f"only {len(JOBS)} key-reading jobs found: the scan is broken"


@pytest.mark.parametrize("workflow,job_name,job", JOBS, ids=[f"{w}:{j}" for w, j, _ in JOBS])
def test_every_key_reading_job_declares_the_environment(workflow, job_name, job):
    env = job.get("environment")
    name = env.get("name") if isinstance(env, dict) else env
    assert name == ENVIRONMENT, (
        f"{workflow} job '{job_name}' reads {KEY} but declares environment {env!r}: add "
        f"`environment: {ENVIRONMENT}` to the job, or it gets no key once the repository secret is deleted")


def test_no_key_reading_workflow_runs_on_pull_requests():
    """A pull-request run cannot use the dev/main-only environment, so it would run without the key."""
    for workflow in sorted({w for w, _j, _ in JOBS}):
        doc = yaml.safe_load(open(os.path.join(ROOT, ".github", "workflows", workflow), encoding="utf-8"))
        triggers = doc.get(True) or doc.get("on") or {}                  # `on:` loads as True
        names = set(triggers) if isinstance(triggers, (dict, list)) else {triggers}
        assert not names & {"pull_request", "pull_request_target"}, workflow
