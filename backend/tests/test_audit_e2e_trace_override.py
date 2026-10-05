"""Execute the actual workflow argument builder offline, with a recording npx stub."""
import os
from pathlib import Path
import shutil
import subprocess

import pytest
import yaml

ROOT = Path(__file__).resolve().parents[2]


@pytest.mark.parametrize('diagnostic', ['true', 'false'])
@pytest.mark.parametrize('filtered', [True, False])
def test_workflow_never_overrides_credential_context_trace_off(tmp_path, diagnostic, filtered):
    workflow = yaml.safe_load((ROOT / '.github/workflows/e2e-tests.yml').read_text(encoding='utf-8'))
    steps = [step for job in workflow['jobs'].values() for step in job['steps']]
    command = next(step['run'] for step in steps if 'npx playwright test "${args[@]}"' in step.get('run', ''))
    script = tmp_path / 'workflow.sh'
    script.write_text('npx() { printf "%s\\n" "$@"; }\n' + command, encoding='utf-8')
    bash = shutil.which('bash') if os.name != 'nt' else 'C:/Program Files/Git/bin/bash.exe'
    env = {**os.environ, 'E2E_DIAGNOSTIC_NO_RETRY': diagnostic,
           'E2E_TEST_GREP': 'fixture; $(exit 33)' if filtered else '',
           'E2E_PROJECT': 'Desktop Chrome' if filtered else ''}
    result = subprocess.run([bash, str(script)], env=env, text=True, capture_output=True, timeout=15)
    assert result.returncode == 0, result.stderr
    args = result.stdout.splitlines()
    assert args[:2] == ['playwright', 'test']
    assert '--trace=on' not in args and '--trace=off' in args
    assert ('--retries=0' in args) is (diagnostic == 'true')
    if filtered:
        assert args[args.index('--grep') + 1] == env['E2E_TEST_GREP']
        assert args[args.index('--project') + 1] == env['E2E_PROJECT']
