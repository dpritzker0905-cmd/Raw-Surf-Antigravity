"""Fixture-only #378 canary. Never import the full server or real ProductStore."""
import ast
import contextvars
import gzip
import hashlib
import json
import os
from pathlib import Path
import socket
import sys
import types
from datetime import datetime

HERE = Path(__file__).resolve().parent
ROOT = HERE.parents[1]
BASE = '6fbf439ac2bb2da5337f9a45864ffd3af8be8423'
CONTROLS = {'ESTIMATE_COHERENT_TRENDS': '0', 'TESTING': '1', 'NODE_ENV': 'test',
            'L2_WRITER': '0', 'L2_WRITER_GATE': '1', 'DISABLE_FORECAST_SCHEDULER': '1'}
if any(os.environ.get(k) != v for k, v in CONTROLS.items()):
    raise RuntimeError('Canary requires its explicit fixture-only environment and guard=0')
FORBIDDEN = ('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
             'SUPABASE_SERVICE_KEY', 'SECRET_KEY', 'JWT_SECRET', 'OPENAI_API_KEY',
             'GEMINI_API_KEY', 'STRIPE_SECRET_KEY', 'LOGFIRE_TOKEN', 'RESEND_API_KEY')
if any(os.environ.get(k) for k in FORBIDDEN):
    raise RuntimeError('Canary refuses connected data/integration credentials')

network_attempts = 0
def deny_network(*args, **kwargs):
    global network_attempts
    network_attempts += 1
    raise RuntimeError('Outbound network forbidden in fixture canary')
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network
socket.getaddrinfo = deny_network
try:
    socket.create_connection(('example.invalid', 443))
except RuntimeError:
    pass
if network_attempts != 1:
    raise RuntimeError('Network tripwire positive control failed')
network_attempts = 0

pins = json.loads((HERE / 'pins.json').read_text())
for name, expected in pins['source_sha256_lf'].items():
    raw = (ROOT / name).read_bytes().replace(b'\r\n', b'\n')
    if hashlib.sha256(raw).hexdigest() != expected:
        raise RuntimeError('Pinned backend source mismatch')
fixture_bytes = gzip.decompress((HERE / 'capture.json.gz').read_bytes())
if hashlib.sha256(fixture_bytes).hexdigest() != pins['fixture_sha256']:
    raise RuntimeError('Captured fixture hash mismatch')
cases_bytes = (HERE / 'controls.json').read_bytes()
if hashlib.sha256(cases_bytes).hexdigest() != pins['controls_sha256']:
    raise RuntimeError('Control fixture hash mismatch')
sys.dont_write_bytecode = True
sys.path.insert(0, str(ROOT / 'backend'))

from fastapi import FastAPI, HTTPException, Request
from services.weather_pipeline.schemas import PipelineManifest
from services.weather_pipeline import data_health

fixtures = {'capture': {'manifest': PipelineManifest.model_validate_json(fixture_bytes),
                        'as_of': '2026-10-18T13:30:00+00:00'}}
for name, item in json.loads(cases_bytes).items():
    fixtures[name] = {'manifest': PipelineManifest.model_validate(item['manifest']), 'as_of': item['as_of']}
fixture_serializations = {k: v['manifest'].model_dump_json() for k, v in fixtures.items()}
selected = contextvars.ContextVar('fixture_case', default='capture')

class FixtureStore:
    def __init__(self):
        self.case = selected.get()
    def get_manifest(self):
        return fixtures[self.case]['manifest']

# Explicit read-only dependency seam for the actual HTTP handler's ProductStore import.
# No real storage module is loaded or initialized.
storage_seam = types.ModuleType('services.weather_pipeline.store')
storage_seam.ProductStore = FixtureStore
sys.modules[storage_seam.__name__] = storage_seam
actual_compute = data_health.compute_data_health
def compute_fixture(store):
    return actual_compute(store, now=datetime.fromisoformat(fixtures[store.case]['as_of']))
data_health.compute_data_health = compute_fixture

# Reuse the actual #378 handler, removing only its router decorator. Importing the
# parent routes package would load full application/database routes.
tree = ast.parse((ROOT / 'backend/routes/health.py').read_text(encoding='utf-8'))
handler = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'data_freshness_health')
handler.decorator_list = []
namespace = {}
exec(compile(ast.Module(body=[handler], type_ignores=[]), 'pinned-health-handler', 'exec'), namespace)

app = FastAPI(title='PR378 isolated fixture canary', docs_url=None, redoc_url=None, openapi_url=None)

def integrity():
    return (all(os.environ.get(k) == v for k, v in CONTROLS.items()) and network_attempts == 0
            and 'database' not in sys.modules and 'server' not in sys.modules
            and all(fixtures[k]['manifest'].model_dump_json() == v for k, v in fixture_serializations.items()))

@app.get('/healthz')
def healthz():
    if not integrity():
        raise HTTPException(503, 'Canary isolation/integrity assertion failed')
    return {'status': 'ready', 'mode': 'fixture-only', 'guard': os.environ['ESTIMATE_COHERENT_TRENDS']}

@app.get('/identity')
def identity():
    if not integrity():
        raise HTTPException(503, 'Canary isolation/integrity assertion failed')
    return {'base_commit': BASE, 'adapter_commit': os.environ.get('RENDER_GIT_COMMIT'),
            'adapter_sha256': hashlib.sha256(Path(__file__).read_bytes().replace(b'\r\n', b'\n')).hexdigest(),
            'fixture_sha256': pins['fixture_sha256'], 'controls_sha256': pins['controls_sha256'],
            'source_sha256_lf': pins['source_sha256_lf'], 'fixture_as_of': fixtures['capture']['as_of'],
            'captured_products': len(fixtures['capture']['manifest'].products),
            'guard': os.environ['ESTIMATE_COHERENT_TRENDS'], 'mode': 'fixture-only',
            'network_attempts': network_attempts, 'tripwire_positive_control': 'blocked',
            'database_imported': 'database' in sys.modules, 'server_imported': 'server' in sys.modules,
            'storage': 'in-memory-fixtures', 'fixture_unchanged': True,
            'cases': list(fixtures), 'ratings_lane': 'intentionally unconfigured; TESTING=1; no Supabase',
            'limits': 'Diagnostic health semantics only; no live ingestion, full app, E2E, or accuracy acceptance'}

@app.get('/api/health/data')
async def health_data(request: Request):
    case = request.query_params.get('case', 'capture')
    if case not in fixtures:
        raise HTTPException(404, 'Unknown fixture case')
    if not integrity():
        raise HTTPException(503, 'Canary isolation/integrity assertion failed')
    token = selected.set(case)
    try:
        response = await namespace['data_freshness_health']()
        if not integrity():
            raise HTTPException(503, 'Canary isolation/integrity assertion failed')
        response.headers['Cache-Control'] = 'no-store'
        response.headers['X-Canary-Base-Commit'] = BASE
        response.headers['X-Canary-Guard'] = '0'
        response.headers['X-Canary-Fixture-Case'] = case
        return response
    finally:
        selected.reset(token)
