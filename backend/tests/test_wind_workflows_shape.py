"""GitHub's workflow schema for the long-range wind and EMOS workflows. yaml.safe_load accepts a stray key that GitHub
refuses at dispatch time: run 2026-11-17 (#1003) left PYTHONUNBUFFERED under `concurrency:` and every dispatch got
HTTP 422 "Unexpected value 'PYTHONUNBUFFERED'". This pins the top-level shape."""
import os

import pytest
import yaml

ROOT = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
FILES = [".github/workflows/wind-lr-hindcast.yml", ".github/workflows/wind-emos-collect.yml"]
TOP = {"name", "on", True, "permissions", "env", "concurrency", "jobs", "defaults", "run-name"}  # `on` loads as True


@pytest.mark.parametrize("rel", FILES)
def test_workflow_top_level_shape(rel):
    d = yaml.safe_load(open(os.path.join(ROOT, rel), encoding="utf-8"))
    assert set(d) <= TOP, set(d) - TOP
    assert set(d.get("concurrency", {})) <= {"group", "cancel-in-progress"}
    assert all(isinstance(v, str) for v in (d.get("env") or {}).values())
    for name, job in d["jobs"].items():
        assert "runs-on" in job and "steps" in job, name
        assert set(job.get("strategy", {})) <= {"fail-fast", "max-parallel", "matrix"}, name
