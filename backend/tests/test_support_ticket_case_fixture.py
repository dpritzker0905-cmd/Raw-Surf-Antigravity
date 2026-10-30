"""Case-variant public support IDs retain ownership, canonical storage and retry semantics."""
import json
import os
from pathlib import Path
import subprocess
import sys


def test_support_ticket_uuid_case_variants(tmp_path):
    root = Path(__file__).resolve().parents[2]
    script = root / 'docs/audits/evidence/2026-10-30-support-uppercase/verify-api.py'
    output = tmp_path / 'case-result.json'
    run = subprocess.run([sys.executable, '-B', str(script), '--output', str(output)], cwd=root,
                         capture_output=True, text=True, encoding='utf-8', timeout=45,
                         env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    assert run.returncode == 0, run.stdout + run.stderr
    result = json.loads(output.read_text(encoding='utf-8'))
    assert result['passed'] == result['total'] == 21
