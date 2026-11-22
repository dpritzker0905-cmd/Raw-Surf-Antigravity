"""Guards on the currents-skill-v1 workflows: dispatch-only with the owner's word, read-only token, inputs reach the shell
through env: only, secrets by NAME only in supabase-service jobs, every artifact archived with sha256."""
import glob
import os
import re

import pytest
import yaml

WF = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".github", "workflows")
FILES = sorted(glob.glob(os.path.join(WF, "currents-skill-*.yml")))
ALLOWED = {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY", "COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD"}


def _doc(path):
    return yaml.safe_load(open(path, encoding="utf-8").read())


def test_the_two_workflows_exist():
    assert [os.path.basename(f) for f in FILES] == ["currents-skill-collect.yml", "currents-skill-score.yml"]
    for f in FILES:
        assert os.path.getsize(f) > 0


@pytest.mark.parametrize("path", FILES)
def test_dispatch_only_owner_word_and_read_only_token(path):
    text = open(path, encoding="utf-8").read()
    doc = _doc(path)
    on = doc.get(True, doc.get("on"))
    assert list(on) == ["workflow_dispatch"], "no schedule, push or pull_request: every run needs the owner's word"
    assert on["workflow_dispatch"]["inputs"]["owner_word_ref"]["required"] is True
    assert 'test -n "$OWNER_WORD_REF"' in text
    assert doc["permissions"] == {"contents": "read"}


@pytest.mark.parametrize("path", FILES)
def test_no_expression_inside_a_shell_script(path):
    for name, job in _doc(path)["jobs"].items():
        for step in job["steps"]:
            if "run" in step:
                assert "${{" not in step["run"], f"{os.path.basename(path)} {name}: {step['run'][:80]!r}"


@pytest.mark.parametrize("path", FILES)
def test_secrets_by_name_only_in_supabase_service_jobs(path):
    for name, job in _doc(path)["jobs"].items():
        used = set(re.findall(r"secrets\.([A-Z0-9_]+)", yaml.safe_dump(job)))
        assert used <= ALLOWED, f"{name}: {sorted(used - ALLOWED)}"
        if used:
            assert job.get("environment") == "supabase-service", f"{name} reads secrets outside supabase-service"
        for step in job["steps"]:
            env = step.get("env", {})
            if "SUPABASE_SERVICE_ROLE_KEY" in env:          # the write key only beside the archive / download scripts
                assert "currents_skill_archive.py" in step["run"]
    assert "set -x" not in open(path, encoding="utf-8").read()


def test_collect_archives_every_artifact_with_sha256_and_never_cancels_a_running_collection():
    doc = _doc(os.path.join(WF, "currents-skill-collect.yml"))
    job = doc["jobs"]["archive"]
    assert job["environment"] == "supabase-service" and "always()" in job["if"]
    run = job["steps"][-1]["run"]
    assert "currents_skill_archive.py" in run and "calibration/currents-skill/$RUN_ID-$RUN_ATTEMPT" in run
    assert doc["concurrency"]["cancel-in-progress"] is False
    assert set(doc["on"if "on" in doc else True]["workflow_dispatch"]["inputs"]["what"]["options"]) == {"daily", "hfr", "drifters"}


def test_score_downloads_verified_archives_and_keeps_its_report_apart():
    text = open(os.path.join(WF, "currents-skill-score.yml"), encoding="utf-8").read()
    assert "--download-to" in text and "currents_skill_score.py" in text
    assert "calibration/currents-skill-report/$RUN_ID-$RUN_ATTEMPT" in text     # never read back as evidence
    assert "freeze_time" in text and "rtofs_absent" in text
