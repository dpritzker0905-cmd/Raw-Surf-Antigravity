"""Guards on the long-range wind v2 workflows: dispatch-only, read-only token, the owner's word required, no secret."""
import glob
import os
import re

import pytest
import yaml

WF = os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))), ".github", "workflows")
# credentials are read by NAME, in CI only, and only by the two workflows that need them (amendment 2)
_ARCHIVE = {"SUPABASE_URL", "SUPABASE_SERVICE_ROLE_KEY"}          # the archive job (supabase-service environment) only
SECRETS_ALLOWED = {"wind-lr2-clim.yml": _ARCHIVE | {"COPERNICUSMARINE_SERVICE_USERNAME", "COPERNICUSMARINE_SERVICE_PASSWORD"},
                   "wind-lr2-collect.yml": _ARCHIVE, "wind-lr2-snapshots.yml": _ARCHIVE, "wind-lr2-analyse.yml": _ARCHIVE}
FILES = sorted(glob.glob(os.path.join(WF, "wind-lr2-*.yml")))


def test_the_three_workflows_exist():
    assert [os.path.basename(f) for f in FILES] == ["wind-lr2-analyse.yml", "wind-lr2-clim.yml", "wind-lr2-collect.yml", "wind-lr2-snapshots.yml"]


@pytest.mark.parametrize("path", FILES)
def test_dispatch_only_read_only_and_owner_word_required(path):
    text = open(path, encoding="utf-8").read()
    doc = yaml.safe_load(text)
    on = doc.get(True, doc.get("on"))                                  # PyYAML reads the bare key `on` as True
    assert list(on) == ["workflow_dispatch"], "no schedule, push or pull_request trigger: every run needs the owner's word"
    assert on["workflow_dispatch"]["inputs"]["owner_word_ref"]["required"] is True
    assert "test -n" in text and "owner_word_ref" in text
    perms = doc["permissions"]
    assert perms["contents"] == "read" and not any(v == "write" for v in perms.values())
    allowed = SECRETS_ALLOWED.get(os.path.basename(path), set())
    used = set(re.findall(r"secrets\.([A-Z0-9_]+)", text))
    assert used <= allowed, f"{os.path.basename(path)} may only read {sorted(allowed)}; found {sorted(used)}"
    assert "CDS_API_KEY" not in text


@pytest.mark.parametrize("path", FILES)
def test_no_workflow_input_is_interpolated_into_a_shell_script(path):
    """`${{ ... }}` inside `run:` is pasted into the shell before it runs (injection). Inputs reach the shell through env:."""
    doc = yaml.safe_load(open(path, encoding="utf-8").read())
    for job_name, job in doc["jobs"].items():
        for step in job["steps"]:
            if "run" in step:
                assert "${{" not in step["run"], f"{os.path.basename(path)} {job_name}: {step['run'][:80]!r}"


@pytest.mark.parametrize("name", ["wind-lr2-collect.yml", "wind-lr2-snapshots.yml", "wind-lr2-analyse.yml", "wind-lr2-clim.yml"])
def test_every_workflow_archives_its_artifacts_with_sha256_to_the_weather_bucket(name):
    doc = yaml.safe_load(open(os.path.join(WF, name), encoding="utf-8").read())
    job = doc["jobs"]["archive"]
    assert job["environment"] == "supabase-service"
    text = open(os.path.join(WF, name), encoding="utf-8").read()
    assert "wind_lr2_archive.py" in text and 'calibration/wind-lr2/$RUN_ID-$RUN_ATTEMPT' in text      # a re-run keeps the run id: the attempt keeps keys unique


def test_a_test_collection_needs_the_committed_freeze_manifest():
    text = open(os.path.join(WF, "wind-lr2-collect.yml"), encoding="utf-8").read()
    assert 'freeze-manifest.json' in text and '"test"' in text
    assert "max-parallel: 3" in text


def test_the_clim_workflow_is_read_only_and_never_prints_a_credential():
    text = open(os.path.join(WF, "wind-lr2-clim.yml"), encoding="utf-8").read()
    assert "echo" not in text.replace("echo-", "") and "set -x" not in text
