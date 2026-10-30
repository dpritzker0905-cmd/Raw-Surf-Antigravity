"""Isolate support API/outbox regressions from application import/startup and other ORM registries."""
import json
import os
import subprocess
import sys
from pathlib import Path


def test_owner_support_delivery_and_original_origin_sla(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / "docs/audits/evidence/2026-10-29-support-delivery/verify-delivery.py"
    env = dict(os.environ, RAW_SUPPORT_FIXTURE_OUTPUT_DIR=str(tmp_path), PYTHONDONTWRITEBYTECODE="1")
    run = subprocess.run([sys.executable, "-B", str(script)], cwd=root, env=env,
                         capture_output=True, text=True, encoding="utf-8", timeout=90)
    assert run.returncode == 0, run.stdout + run.stderr
    evidence = json.loads((tmp_path / "delivery-results.json").read_text())
    assert evidence["passed"] == evidence["total"] >= 36
    assert evidence["mountedFixtureApi"] and evidence["sender"] == "in-memory fake only"
