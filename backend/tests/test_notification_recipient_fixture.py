"""Run the notification ownership fixture without importing application/weather startup."""
import json
import os
from pathlib import Path
import subprocess
import sys


def test_notification_list_and_count_require_recipient_identity(tmp_path):
    root = Path(__file__).resolve().parents[2]
    output = tmp_path / 'notification-recipient.json'
    script = root / 'docs/audits/evidence/2026-10-30-combined-integration/verify-notification-recipient.py'
    run = subprocess.run([sys.executable, '-B', str(script), '--source-root', str(root), '--output', str(output)],
                         cwd=root, capture_output=True, text=True, encoding='utf-8', timeout=45,
                         env=dict(os.environ, PYTHONDONTWRITEBYTECODE='1'))
    assert run.returncode == 0, run.stdout + run.stderr
    result = json.loads(output.read_text(encoding='utf-8'))
    assert result['passed'] == result['total'] >= 29
