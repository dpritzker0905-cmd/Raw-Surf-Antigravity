"""Ordinary offline CLI validation/output contracts using only synthetic files."""
import contextlib
import copy
import hashlib
import importlib.util
import io
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[4]
CLI = ROOT / 'backend/scripts/reconcile_photo_subscription_balances.py'
EXAMPLE = Path(__file__).with_name('synthetic-export.json')
ENV = {key: os.environ[key] for key in ('SYSTEMROOT', 'WINDIR', 'TEMP', 'TMP', 'PATH') if key in os.environ}
CASES = []
def test(name, callback):
    CASES.append((name, callback))

def run(*args):
    return subprocess.run([sys.executable, '-I', '-B', str(CLI), *map(str, args)],
                          capture_output=True, text=True, encoding='utf-8', env=ENV, cwd=ROOT)

def require(condition, message):
    if not condition:
        raise AssertionError(message)

with tempfile.TemporaryDirectory(prefix='photo-sub-cli-fixture-') as folder:
    temp = Path(folder)
    payload = json.loads(EXAMPLE.read_text(encoding='utf-8'))
    source = temp / 'synthetic-input.json'
    original = json.dumps(payload, indent=2).encode('utf-8')
    source.write_bytes(original)
    original_digest = hashlib.sha256(original).hexdigest()

    def report():
        result = run('--input', source)
        require(result.returncode == 0, 'Valid held report failed: ' + result.stderr)
        require(not result.stderr, 'Valid report unexpectedly logged an error')
        data = json.loads(result.stdout)
        require(data['input_file_sha256'] == original_digest, 'Raw file hash incorrect')
        require(data['mode'] == 'report_only' and data['apply_ready'] is False and data['money_correction'] is None,
                'Report proposed financial application')
        require(data['cases'], 'Synthetic historical inventory case missing')
        for row in data['cases'] + data['accounts']:
            require(row['apply_ready'] is False and row['money_correction'] is None, 'Row proposed money correction')
    test('valid historical review-hold report exits0 with no correction proposal', report)

    def deterministic():
        first, second = run('--input', source), run('--input', source)
        require(first.returncode == second.returncode == 0 and first.stdout == second.stdout, 'Output is nondeterministic')
    test('identical explicit input produces identical JSON bytes', deterministic)

    def exclusive():
        target = temp / 'new-report.json'
        first = run('--input', source, '--output', target)
        require(first.returncode == 0 and first.stdout == '', 'File output also dumped report on stdout')
        before = target.read_bytes()
        second = run('--input', source, '--output', target)
        require(second.returncode == 1 and target.read_bytes() == before, 'Existing output was overwritten')
    test('output is exclusively created and existing report is preserved', exclusive)

    def same_file():
        result = run('--input', source, '--output', source)
        require(result.returncode == 1 and source.read_bytes() == original, 'Input file was modified')
    test('input path used as output is refused without changing input', same_file)

    def provenance():
        compact = temp / 'compact-input.json'
        compact.write_text(json.dumps(payload, separators=(',', ':')), encoding='utf-8')
        a, b = json.loads(run('--input', source).stdout), json.loads(run('--input', compact).stdout)
        require(a['input_digest'] == b['input_digest'], 'Canonical input digest depends on whitespace')
        require(a['input_file_sha256'] != b['input_file_sha256'], 'Raw source hash did not retain format provenance')
    test('canonical digest and raw input file digest remain distinct', provenance)

    def invalid_bytes(name, raw, expected=2):
        path = temp / (name + '.json')
        path.write_bytes(raw)
        result = run('--input', path)
        require(result.returncode == expected and not result.stdout, 'Invalid input produced a successful report')
        require('DO_NOT_ECHO_FIXTURE_VALUE' not in result.stderr, 'Input contents appeared in errors')
    test('duplicate top-level object key rejected', lambda: invalid_bytes('duplicate', b'{"schema_version":1,"schema_version":1}'))
    test('duplicate nested object key rejected', lambda: invalid_bytes('duplicate-nested', b'{"snapshot":{"id":1,"id":2}}'))
    for literal in ('NaN', 'Infinity', '-Infinity', '1e999'):
        test('non-finite JSON number ' + literal + ' rejected',
             lambda literal=literal: invalid_bytes('nonfinite-' + literal.replace('-', 'minus'), ('{"value":' + literal + '}').encode()))
    test('malformed JSON error omits input contents', lambda: invalid_bytes('malformed', b'{"private_fixture":"DO_NOT_ECHO_FIXTURE_VALUE",'))
    test('non-UTF8 input rejected', lambda: invalid_bytes('encoding', bytes([255, 254, 250])))
    test('explicit input argument required', lambda: require(run().returncode == 2, 'Input became implicit'))
    test('missing input file reports nonzero', lambda: require(run('--input', temp/'missing.json').returncode == 2, 'Missing input accepted'))

    def invalid_schema():
        changed = copy.deepcopy(payload)
        changed['schema_version'] = 2
        invalid_bytes('schema', json.dumps(changed).encode())
    test('unsupported export schema rejected', invalid_schema)
    test('financial apply flag is not available', lambda: require(run('--input', source, '--apply').returncode == 2, 'Apply flag accepted'))
    test('help documents report-only mode', lambda: require('no financial corrections' in ' '.join(run('--help').stdout.split()), 'Help omits phase boundary'))

    def missing_tables():
        changed = {'schema_version': 1, 'snapshot': payload['snapshot']}
        path = temp/'missing-tables.json'
        path.write_text(json.dumps(changed), encoding='utf-8')
        result = run('--input', path)
        require(result.returncode == 0, 'Incomplete coverage was treated as invalid financial evidence')
        data = json.loads(result.stdout)
        require(data['apply_ready'] is False and data['money_correction'] is None and data['findings'],
                'Missing tables were silently treated as complete')
    test('missing financial tables remain valid held inventory', missing_tables)

    def no_application_import():
        spec = importlib.util.spec_from_file_location('offline_cli_fixture', CLI)
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        output = io.StringIO()
        with contextlib.redirect_stdout(output):
            status = module.main(['--input', str(source)])
        require(status == 0, 'In-process standalone execution failed')
        require(not any(name in sys.modules for name in ('database', 'dotenv', 'stripe', 'models', 'sqlalchemy', 'utils')),
                'CLI imported application/database/provider packages')
    test('standalone import path avoids application database and provider packages', no_application_import)
    test('missing output parent produces nonzero without changing input',
         lambda: require(run('--input', source, '--output', temp/'absent'/'report.json').returncode == 1,
                         'Unavailable output destination accepted'))
    failures = []
    for name, callback in CASES:
        try:
            callback()
            require(source.read_bytes() == original, 'Synthetic input changed')
            print('PASS', name)
        except Exception as error:
            failures.append(name)
            print('FAIL', name, type(error).__name__, str(error))
    print(f'{len(CASES)-len(failures)}/{len(CASES)} standalone historical CLI cases passed')
    raise SystemExit(bool(failures))
