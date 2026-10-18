"""Subprocess refusal controls; never changes deployed flags or tracked bundles."""
import argparse
import json
import os
from pathlib import Path
import subprocess
import sys

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]


def environment():
    values = {k: os.environ[k] for k in ('SystemRoot', 'PATH', 'TEMP', 'TMP') if k in os.environ}
    pin = json.loads((HERE / 'bundle-pin.json').read_text())
    values.update(ESTIMATE_COHERENT_TRENDS='0', L2_WRITER='0', L2_WRITER_GATE='1',
        DISABLE_FORECAST_SCHEDULER='1', NODE_ENV='development', TESTING='0', LOCAL_TEST_FIXTURE='false',
        REPLAY_BUNDLE_SHA256=pin['sha256'], PYTHONDONTWRITEBYTECODE='1', RENDER_GIT_COMMIT='local-verification')
    return values


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--output', required=True)
    args = parser.parse_args()
    results = []
    controls = [('guard_enabled', {'ESTIMATE_COHERENT_TRENDS': '1'}, None, 'isolation controls'),
                ('guard_missing', {}, 'ESTIMATE_COHERENT_TRENDS', 'isolation controls'),
                ('writer_enabled', {'L2_WRITER': '1'}, None, 'isolation controls'),
                ('database_connected', {'DATABASE_URL': 'forbidden-test-control'}, None, 'connected credentials'),
                ('storage_connected', {'SUPABASE_URL': 'forbidden-test-control'}, None, 'connected credentials'),
                ('wrong_bundle_pin', {'REPLAY_BUNDLE_SHA256': '0' * 64}, None, 'deployment pin')]
    for name, override, remove, reason in controls:
        env = environment()
        env.update(override)
        if remove:
            env.pop(remove)
        result = subprocess.run([sys.executable, '-c', 'import canary.pr378_real.app'],
            cwd=ROOT, env=env, capture_output=True, text=True, timeout=30)
        passed = result.returncode != 0 and reason in result.stderr
        results.append({'control': name, 'passed': passed, 'exit_code': result.returncode})
        if not passed:
            raise RuntimeError('Startup refusal control failed: ' + name + '\n' + result.stderr)
    code = ('import json; from canary.pr378_real.app import identity, receipt; '
            'i=identity(); assert i["guard"]=="0" and i["network_attempts"]==0; '
            'assert i["products"]==128 and not i["database_imported"] and not i["server_imported"]; '
            'print(json.dumps(i))')
    result = subprocess.run([sys.executable, '-c', code], cwd=ROOT, env=environment(),
                            capture_output=True, text=True, timeout=30)
    if result.returncode:
        raise RuntimeError('Positive real-grid startup failed:\n' + result.stderr)
    identity = json.loads(result.stdout.splitlines()[-1])
    output = {'controls': results, 'positive_actual_grid_startup': True, 'identity': identity}
    Path(args.output).write_text(json.dumps(output, indent=2) + '\n')
    print(json.dumps({'startup_refusals': len(results), 'passed': len(results), 'positive_real_startup': True,
                      'products': identity['products'], 'guard': identity['guard']}))


if __name__ == '__main__':
    main()
