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
def test_owner_word_and_read_only_token(path):
    text = open(path, encoding="utf-8").read()
    doc = _doc(path)
    on = doc.get(True, doc.get("on"))
    allowed = ["workflow_dispatch", "schedule"] if path.endswith("collect.yml") else ["workflow_dispatch"]
    assert list(on) == allowed, "no push or pull_request; the score is dispatch-only"
    assert on["workflow_dispatch"]["inputs"]["owner_word_ref"]["required"] is True
    assert 'test -n "$OWNER_WORD_REF"' in text
    assert doc["permissions"] == {"contents": "read"}


def test_the_optional_schedule_is_off_by_default_and_needs_the_word_and_an_end_date():
    """Amendment 1 (A11): one owner word may cover the TEST window through repo variables; unset (the default) = skipped."""
    doc = _doc(os.path.join(WF, "currents-skill-collect.yml"))
    guard = doc["jobs"]["guard"]
    assert guard["if"] == "${{ github.event_name == 'workflow_dispatch' || vars.CURRENTS_SKILL_SCHEDULE == '1' }}"
    step = guard["steps"][0]
    assert 'test -n "$SCHEDULE_WORD_REF"' in step["run"] and 'test -n "$UNTIL"' in step["run"] and "what=none" in step["run"]
    assert step["env"]["SCHEDULE_WORD_REF"] == "${{ vars.CURRENTS_SKILL_OWNER_WORD_REF }}"
    assert step["env"]["UNTIL"] == "${{ vars.CURRENTS_SKILL_UNTIL }}"
    assert doc["jobs"]["collect"]["if"] == "${{ needs.guard.outputs.what != 'none' }}"
    gated = [st for st in doc["jobs"]["collect"]["steps"] if "run" in st and "currents_skill_collect.py" in st["run"]]
    assert len(gated) == 3 and all("needs.guard.outputs.what" in st["if"] for st in gated)


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
    assert job["environment"] == "supabase-service" and "always()" in job["if"] and "skipped" not in job["if"]
    run = job["steps"][-1]["run"]
    assert "currents_skill_archive.py" in run and "calibration/currents-skill/$RUN_ID-$RUN_ATTEMPT" in run
    assert doc["concurrency"]["cancel-in-progress"] is False
    assert set(doc.get(True, doc.get("on"))["workflow_dispatch"]["inputs"]["what"]["options"]) == {"daily", "hfr", "drifters"}


def test_score_downloads_verified_archives_and_keeps_its_report_apart():
    text = open(os.path.join(WF, "currents-skill-score.yml"), encoding="utf-8").read()
    assert "--download-to" in text and "currents_skill_score.py" in text
    assert "calibration/currents-skill-report/$RUN_ID-$RUN_ATTEMPT" in text     # never read back as evidence
    assert "freeze_time" in text and "rtofs_absent" in text
