"""Summarize local receipts without storing raw pytest provider output in Git."""
import ast
import json
from pathlib import Path
import subprocess
import xml.etree.ElementTree as ET

root = Path(__file__).resolve().parents[2]
folder = Path(__file__).resolve().parent
path = folder / 'results.json'
data = json.loads(path.read_text(encoding='utf-8'))
receipts = {}
for name in ('targeted-after-1', 'targeted-after-2', 'targeted-final-1', 'targeted-final-2',
             'broad-probe', 'guards', 'chain', 'estate', 'estate-final'):
    xml_path = folder / (name + '.xml')
    if not xml_path.exists():
        continue
    suites = ET.parse(xml_path).getroot().findall('testsuite')
    receipts[name] = {
        key: sum(int(s.get(key, 0)) for s in suites)
        for key in ('tests', 'failures', 'errors', 'skipped')
    }
    receipts[name]['passed'] = receipts[name]['tests'] - sum(
        receipts[name][key] for key in ('failures', 'errors', 'skipped'))
    receipts[name]['time_seconds'] = sum(float(s.get('time', 0)) for s in suites)
    receipts[name]['expected_failures'] = sum(
        1 for suite in suites for case in suite.findall('testcase')
        if case.find('skipped') is not None and case.find('skipped').get('type') == 'pytest.xfail')
    receipts[name]['failing_tests'] = [
        f"{case.get('classname')}::{case.get('name')}"
        for suite in suites for case in suite.findall('testcase')
        if case.find('failure') is not None or case.find('error') is not None
    ]
data['final_receipts'] = receipts
if not any(item['item'] == 'Validation: native Windows crypt availability' for item in data['items']):
    data['items'].append({
        'item': 'Validation: native Windows crypt availability',
        'before': [{'run': run, 'exit_code': 1, 'summary': '1 failed, 9 passed'}
                   for run in ('492bc6', '328fb9')],
        'after': [{'run': run, 'exit_code': 0, 'summary': '10 passed'}
                  for run in ('1f4d6b', '74d714')],
        'primary_reference': 'https://docs.python.org/3.12/library/crypt.html',
        'scope': 'Test platform expectation only; no production hashing change, skip or new test',
    })
data['ci_projection'] = {
    'base_run': 37048650086,
    'observed_base_passes': {'guards': 2248, 'chain': 1777, 'estate': 582},
    'executed_additions': {'guards': 0, 'chain': 13, 'estate': 56},
    'projected_hosted_passes': {'guards': 2248, 'chain': 1790, 'estate': 638},
    'hosted_confirmation': 'pending',
}
data['environment'] = {'python': '3.12', 'matched_pins': '44/46',
                       'absent': ['pygrib', 'uvloop'], 'in_virtualenv': False}

# Parse credential bindings, asserting only empty defaults; never emit their values.
tree = ast.parse((root / 'backend/routes/strava.py').read_text(encoding='utf-8'))
found = []
for node in tree.body:
    if not isinstance(node, ast.Assign):
        continue
    for target in node.targets:
        if isinstance(target, ast.Name) and target.id in ('STRAVA_CLIENT_ID', 'STRAVA_CLIENT_SECRET'):
            assert isinstance(node.value, ast.Call)
            assert len(node.value.args) == 2
            assert isinstance(node.value.args[1], ast.Constant) and node.value.args[1].value == ''
            found.append(target.id)
assert len(found) == 2
data['credential_binding_check'] = 'PASS: both Strava defaults empty; values not emitted'

# Exact baseline test/server identities prove the DCL probe did not touch this implementation.
unchanged = []
for item in ('backend/tests/test_debug_consciousness.py', 'backend/event_bus_mcp_server.py',
             'backend/debug_consciousness_mcp_server.py', 'backend/scripts/ci_test_lanes.py'):
    baseline = subprocess.run(['git', 'show', data['base_ref'] + ':' + item], cwd=root,
                              stdout=subprocess.PIPE, check=True).stdout
    assert baseline.replace(b'\r\n', b'\n') == (root / item).read_bytes().replace(b'\r\n', b'\n')
    unchanged.append(item)
data['dcl_unchanged_from_base'] = unchanged
path.write_text(json.dumps(data, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'receipts': receipts, 'credential_binding_check': 'PASS',
                  'unchanged_dcl_files': len(unchanged)}, indent=2))
