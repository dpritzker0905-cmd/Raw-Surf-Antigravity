"""Run normal competition readback checks without importing backend startup or shared ORM registries."""
import json
import os
import subprocess
import sys
from pathlib import Path


def test_preconfirmed_guardian_competition_readback(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / 'docs/audits/evidence/2026-10-30-guardian-competition-readback/verify-readback.py'
    env = dict(os.environ, RAW_GUARDIAN_READBACK_OUTPUT=str(tmp_path), PYTHONDONTWRITEBYTECODE='1')
    run = subprocess.run([sys.executable, '-B', str(script)], cwd=root, env=env,
                         capture_output=True, text=True, encoding='utf-8', timeout=60)
    assert run.returncode == 0, run.stdout + run.stderr
    result = json.loads((tmp_path / 'readback-results.json').read_text())
    assert result['passed'] == result['total'] == 8
    assert result['selected_actual_handlers'] and result['normal_preconfirmed_family_only']
    assert result['live_requests'] == result['security_scenarios'] == 0
