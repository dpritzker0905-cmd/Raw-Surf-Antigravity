"""Record bounded source preservation and executed test evidence, not release proof."""
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[2]
OUT = Path(__file__).resolve().parent
BASE = '524d8c49236bf42848a1dfe10b2bbd2ce59a64cf'
PATHS = [
    'frontend/src/components/map/useMarineDataFetcherCore.js',
    'frontend/src/components/map/useMarineDataFetcherHelpers.js',
    'frontend/src/components/map/marineControllerCache.js',
    'frontend/src/hooks/useMarineRevalidation.js',
    'frontend/src/components/map/backendWeatherServiceClientHelpers.js',
    'frontend/src/components/map/LayerAccessResolver.js',
    'backend/services/weather_pipeline/forecast_skill.py',
]


def digest(data):
    return hashlib.sha256(data).hexdigest()


rows = []
for path in PATHS:
    old = subprocess.check_output(['git', 'show', f'{BASE}:{path}'], cwd=ROOT)
    now = subprocess.check_output(['git', 'show', f'HEAD:{path}'], cwd=ROOT)
    # git bytes avoid CRLF checkout conversion being mistaken for source edits.
    rows.append({'path': path, 'baseline_sha256': digest(old),
                 'head_sha256': digest(now), 'identical_since_audit_baseline': old == now})
tests = json.loads((OUT / 'history-full-frontend.json').read_text(encoding='utf-8-sig'))
selected = []
for suite in tests['testResults']:
    if any(token in suite['name'] for token in ['marineEmptyGridRetry', 'marineOversizedGrid',
                                               'om-metadata-demand', 'debounceHeal', 'dedup.test']):
        selected.append({'path': Path(suite['name']).relative_to(ROOT).as_posix(),
                         'status': suite['status'],
                         'assertions': [{'title': a['fullName'], 'status': a['status']}
                                        for a in suite['assertionResults']]})
result = {'baseline': BASE,
          'head': subprocess.check_output(['git', 'rev-parse', 'HEAD'], cwd=ROOT, text=True).strip(),
          'scope': 'Seven selected files; identical source is preservation evidence, not behavioral or scientific certification.',
          'files': rows, 'selected_executed_tests': selected,
          'frontend_tests': {k: tests[k] for k in ['numPassedTests', 'numFailedTests', 'numPassedTestSuites']}}
(OUT / 'history-preservation.json').write_text(json.dumps(result, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'identical_files': sum(r['identical_since_audit_baseline'] for r in rows),
                  'selected_suites': len(selected), 'tests': result['frontend_tests']}))
