"""Credential-free, immutable real-grid replay using PR378's actual ProductStore."""
import ast
from datetime import datetime, timezone
import gzip
import hashlib
import json
import os
from pathlib import Path
import socket
import sys

from .bootstrap import BASE, HERE, prepare

CONTROLS = {'ESTIMATE_COHERENT_TRENDS': '0', 'L2_WRITER': '0', 'L2_WRITER_GATE': '1',
            'DISABLE_FORECAST_SCHEDULER': '1', 'NODE_ENV': 'development', 'TESTING': '0',
            'LOCAL_TEST_FIXTURE': 'false'}
FORBIDDEN = ('DATABASE_URL', 'SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY',
             'SUPABASE_SERVICE_KEY', 'SECRET_KEY', 'JWT_SECRET', 'OPENAI_API_KEY',
             'GEMINI_API_KEY', 'STRIPE_SECRET_KEY', 'LOGFIRE_TOKEN', 'RESEND_API_KEY',
             'COPERNICUSMARINE_SERVICE_USERNAME', 'COPERNICUSMARINE_SERVICE_PASSWORD', 'RENDER_API_KEY')
if any(os.environ.get(k) != v for k, v in CONTROLS.items()) or any(os.environ.get(k) for k in FORBIDDEN):
    raise RuntimeError('Real-grid reader refuses missing isolation controls or connected credentials')

backend, source = prepare()
pin = json.loads((HERE / 'bundle-pin.json').read_text())
compressed = (HERE / 'bundle.json.gz').read_bytes()
digest = hashlib.sha256(compressed).hexdigest()
if pin['base_commit'] != BASE or digest != pin['sha256'] or os.environ.get('REPLAY_BUNDLE_SHA256') != digest:
    raise RuntimeError('Real-grid bundle does not match its explicit deployment pin')
payload = json.loads(gzip.decompress(compressed))
if set(payload['files']) != set(payload['sha256']) or len(payload['files']) > 1000:
    raise RuntimeError('Malformed replay bundle index')
directory = backend / 'uploads/weather_products'
directory.mkdir(parents=True, exist_ok=True)
receipt = None
for name, content in payload['files'].items():
    if (Path(name).is_absolute() or '..' in Path(name).parts or
            not (name == 'receipt.json' or (name.startswith('products/') and len(Path(name).parts) == 2))):
        raise RuntimeError('Unsafe replay bundle path')
    raw = content.encode()
    if hashlib.sha256(raw).hexdigest() != payload['sha256'][name]:
        raise RuntimeError('Sealed replay file hash mismatch')
    if name == 'receipt.json':
        receipt = json.loads(content)
    else:
        (directory / Path(name).name).write_bytes(raw)
if (receipt is None or receipt['guard'] != '0' or receipt['base_commit'] != BASE or
        receipt['source_archive_sha256'] != source['archive_sha256']):
    raise RuntimeError('Replay receipt identity mismatch')
allowed = set(receipt['products']) | {'manifest.json'}
if {p.name for p in directory.iterdir()} != allowed:
    raise RuntimeError('Replay cache contains an unexpected file')
file_hashes = {name: payload['sha256']['products/' + name] for name in allowed}
if file_hashes['manifest.json'] != receipt['manifest_sha256']:
    raise RuntimeError('Manifest pin mismatch')
as_of = datetime.fromisoformat(receipt['as_of'])

network_attempts = 0
def deny_network(*args, **kwargs):
    global network_attempts
    network_attempts += 1
    raise RuntimeError('Outbound network forbidden in real-grid replay reader')
socket.socket.connect = deny_network
socket.socket.connect_ex = deny_network
socket.create_connection = deny_network
socket.getaddrinfo = deny_network
try:
    socket.create_connection(('example.invalid', 443))
except RuntimeError:
    pass
if network_attempts != 1:
    raise RuntimeError('Network denial positive control failed')
network_attempts = 0

from fastapi import FastAPI, HTTPException, Query
from fastapi.responses import Response
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.model_cycle_health import summarize_model_cycles

store = ProductStore()  # Actual pinned constructor and its actual default cache path.
manifest = store.get_manifest()
if {p.product_id for p in manifest.products} != set(receipt['products']):
    raise RuntimeError('Actual ProductStore manifest differs from sealed inventory')
manifest_before = manifest.model_dump_json()
for item in manifest.products:
    product = store.load_product(item.filename)
    if (not product or product.is_test_fixture or product.valid_time != item.valid_time_start or
            hashlib.sha256(product.model_dump_json().encode()).hexdigest() != file_hashes[item.filename]):
        raise RuntimeError('Real ProductStore cold load refused or changed a captured grid')

# Importing routes/__init__ would load the unrelated full application. Extract
# only the original handler; all its imports resolve to real pinned modules.
tree = ast.parse((backend / 'routes/health.py').read_text(encoding='utf-8'))
handler = next(n for n in tree.body if isinstance(n, ast.AsyncFunctionDef) and n.name == 'data_freshness_health')
handler.decorator_list = []
namespace = {}
exec(compile(ast.Module(body=[handler], type_ignores=[]), 'pinned-pr378-health-handler', 'exec'), namespace)
app = FastAPI(title='PR378 isolated real-grid replay', docs_url=None, redoc_url=None, openapi_url=None)


def integrity():
    try:
        return (network_attempts == 0 and all(os.environ.get(k) == v for k, v in CONTROLS.items())
                and not any(os.environ.get(k) for k in FORBIDDEN)
                and 'server' not in sys.modules and 'database' not in sys.modules
                and store.get_manifest().model_dump_json() == manifest_before
                and all(hashlib.sha256((directory/name).read_bytes()).hexdigest() == value for name, value in file_hashes.items()))
    except OSError:
        return False


def check():
    if not integrity():
        raise HTTPException(503, 'Real-grid replay isolation/integrity assertion failed')


@app.get('/healthz')
def healthz():
    check()
    return {'status': 'ready', 'guard': '0', 'bundle_sha256': digest, 'real_products': len(receipt['products'])}


@app.get('/identity')
def identity():
    check()
    return {'base_commit': BASE, 'adapter_commit': os.environ.get('RENDER_GIT_COMMIT'),
            'source_archive_sha256': source['archive_sha256'], 'bundle_sha256': digest,
            'guard': os.environ['ESTIMATE_COHERENT_TRENDS'], 'mode': receipt['mode'],
            'replay_as_of': receipt['as_of'], 'served_at': datetime.now(timezone.utc).isoformat(),
            'bbox': receipt['bbox'], 'resolution': receipt['resolution'],
            'products': len(receipt['products']), 'cases': len(receipt['cases']),
            'storage': 'actual ProductStore; sealed local real-grid files; no L2',
            'verified_python_files': len(source['files']), 'network_attempts': network_attempts,
            'tripwire_positive_control': 'blocked', 'database_imported': 'database' in sys.modules,
            'server_imported': 'server' in sys.modules, 'bundle_unchanged': True,
            'limits': receipt['limits']}


@app.get('/evidence')
def evidence():
    check()
    return receipt


@app.get('/products/{filename}')
def product_bytes(filename: str):
    check()
    if filename not in receipt['products']:
        raise HTTPException(404, 'Product not in immutable replay inventory')
    product = store.load_product(filename)
    if not product:
        raise HTTPException(503, 'Actual ProductStore load failed')
    raw = product.model_dump_json().encode()
    if hashlib.sha256(raw).hexdigest() != file_hashes[filename]:
        raise HTTPException(503, 'Loaded grid serialization changed')
    return Response(raw, media_type='application/json', headers={
        'Cache-Control': 'no-store', 'X-Content-SHA256': file_hashes[filename],
        'X-Canary-Guard': '0', 'X-Actual-ProductStore-Loaded': '1'})


@app.get('/evidence/cycles')
def cycles(case: str):
    check()
    if case not in receipt['cases']:
        raise HTTPException(404, 'Unknown replay case')
    selected = receipt['cases'][case]
    products = [p for p in store.get_manifest().products if p.product_id in selected['products']]
    report, verdict, reasons = summarize_model_cycles(products, as_of, selected['model'], 'marine')
    return {'case': case, 'as_of': receipt['as_of'], 'report': report, 'verdict': verdict,
            'reasons': reasons, 'guard': '0', 'clock': 'explicit capture clock'}


@app.get('/replay/grid')
def replay_grid(case: str, valid_time: str = Query(...)):
    check()
    if case not in receipt['cases']:
        raise HTTPException(404, 'Unknown replay case')
    try:
        requested = datetime.fromisoformat(valid_time.replace('Z', '+00:00'))
        if requested.tzinfo is None or requested.utcoffset() is None:
            raise ValueError('A timezone is required')
        requested = requested.astimezone(timezone.utc)
    except (ValueError, OverflowError):
        raise HTTPException(422, 'Qualified UTC valid time required')
    candidates = receipt['cases'][case]['products']
    chosen = next((n for n in candidates if datetime.fromisoformat(receipt['products'][n]['valid_time']) == requested), None)
    if chosen is None:
        raise HTTPException(404, {'requested_valid_time': requested.isoformat(),
                                 'sampled_valid_times': [receipt['products'][n]['valid_time'] for n in candidates],
                                 'reason': 'Requested frame is absent from the sparse replay; no held frame returned'})
    product = store.load_product(chosen)
    if not product or product.valid_time != requested:
        raise HTTPException(503, 'Loaded grid valid time differs from requested frame')
    raw = product.model_dump_json().encode()
    if hashlib.sha256(raw).hexdigest() != file_hashes[chosen]:
        raise HTTPException(503, 'Loaded grid serialization changed')
    return {'requested_valid_time': requested.isoformat(), 'served_valid_time': product.valid_time.isoformat(),
            'frame_offset_hours': 0, 'frame_substituted': False, 'guard': '0',
            'product_id': chosen, 'sha256': file_hashes[chosen],
            'contributor_sha256': receipt['products'][chosen]['contributor_sha256'],
            'grid': json.loads(raw)}


@app.get('/api/health/data')
async def actual_data_health():
    check()
    response = await namespace['data_freshness_health']()
    check()
    response.headers['Cache-Control'] = 'no-store'
    response.headers['X-Canary-Guard'] = '0'
    return response
