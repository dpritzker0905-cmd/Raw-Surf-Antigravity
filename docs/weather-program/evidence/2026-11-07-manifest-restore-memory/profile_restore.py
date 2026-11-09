"""Offline 18,002-entry changed-manifest restore profile. No live data/network."""
import ast
import gc
import hashlib
import json
import logging
import os
from pathlib import Path
import socket
import subprocess
import sys
import tempfile
import time
import tracemalloc

for name in list(os.environ):
    if name.startswith(('SUPABASE_', 'DATABASE_', 'REACT_APP_')):
        os.environ.pop(name, None)
os.environ.update(ENV='development', TESTING='1', PRODUCT_RUN_KEYED_NAMES='0')
sys.path.insert(0, sys.argv[1])

def refuse(*args, **kwargs):
    raise AssertionError('offline benchmark attempted network')
socket.socket.connect = refuse
import requests
requests.sessions.Session.request = refuse
from services.weather_pipeline import store as sm, store_helpers as sh, manifest_pointer as mp
import psutil

# Optional exact baseline function, evaluated with the same unchanged module globals.
# This does not rewrite the checkout, and git is forbidden from lazy-fetching missing blobs.
if len(sys.argv) > 3:
    source = subprocess.check_output(
        ['git', 'show', sys.argv[3] + ':backend/services/weather_pipeline/store_helpers.py'],
        cwd=Path(sys.argv[1]).parent, env=dict(os.environ, GIT_NO_LAZY_FETCH='1')).decode('utf-8')
    node = next(n for n in ast.parse(source).body
                if isinstance(n, ast.FunctionDef) and n.name == '_restore_from_supabase_inner')
    exec(compile(ast.Module(body=[node], type_ignores=[]), '<baseline-restore>', 'exec'), sh.__dict__)

COUNT = int(sys.argv[2]) if len(sys.argv) > 2 else 18002
prototype = dict(model='GFS', provider='NOAA', domain='marine', layer='waves',
    run_time='2026-11-07T00:00:00Z', model_run_time='2026-11-07T00:00:00Z',
    model_run_time_status='verified', ingested_at='2026-11-07T02:10:00Z',
    valid_time_start='2026-11-09T12:00:00Z', valid_time_end='2026-11-09T12:00:00Z',
    resolution=0.25, freshness_sec=3600, is_forecast_authoritative=True,
    coverage=dict(west=-180,south=-80,east=180,north=80), is_test_fixture=False,
    is_estimated=False, estimate_basis=None, source_dataset='gfs-wave',
    upstream_provider='NOAA', upstream_model='GFS', region_id='global_mid',
    coverage_mode='global_tile', tile_id='global_mid')
products = [dict(prototype, filename=f'gfs_marine_waves_global_mid_{i:06d}.json',
    product_id=f'gfs_marine_waves_global_mid_{i:06d}.json', is_estimated=(i % 5 == 0)) for i in range(COUNT)]
wire = json.dumps(dict(last_manifest_update='2026-11-07T12:00:00Z', products=products,
    written_by='designated:offline-benchmark'), indent=2).encode()
del products, prototype
sm._get_supabase_storage = lambda: object()
mp.fetch_pointed_manifest = lambda: wire
sh.is_test_environment = lambda: True
proc = psutil.Process()
logging.getLogger().setLevel(logging.CRITICAL)
with tempfile.TemporaryDirectory(prefix='raw-surf-memory-') as directory:
    instance = sm.ProductStore(Path(directory))
    assert instance.restore_from_supabase() == (COUNT, [])
    gc.collect()
    baseline_rss = proc.memory_info().rss
    tracemalloc.start()
    rows = []
    for index in range(1, 4):
        wire = wire.replace(f'T12:0{index-1}:00Z'.encode(), f'T12:0{index}:00Z'.encode())
        gc.collect()
        current, _ = tracemalloc.get_traced_memory()
        tracemalloc.reset_peak()
        start = time.perf_counter()
        count, errors = instance.restore_from_supabase()
        held, peak = tracemalloc.get_traced_memory()
        disk_bytes = instance.manifest_path.read_bytes()
        disk_digest = hashlib.sha256(disk_bytes).hexdigest()
        out = json.loads(disk_bytes)
        del disk_bytes
        assert len(out['products']) == COUNT and not errors
        digest = hashlib.sha256(json.dumps(out, sort_keys=True).encode()).hexdigest()
        del out
        rows.append(dict(cycle=index, restored=count, additional_python_peak_mib=round((peak-current)/2**20,2),
            traced_end_mib=round(held/2**20,2), rss_mib=round(proc.memory_info().rss/2**20,2),
            seconds=round(time.perf_counter()-start,3), content_sha256=digest, disk_bytes_sha256=disk_digest))
    print(json.dumps(dict(entries=COUNT, wire_mib=round(len(wire)/2**20,2), baseline_rss_mib=round(baseline_rss/2**20,2),
        python=sys.version, pydantic=__import__('pydantic').__version__, cycles=rows), indent=2))
