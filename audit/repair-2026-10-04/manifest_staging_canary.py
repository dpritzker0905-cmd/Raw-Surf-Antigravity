"""AS06 actual-source canary, restricted to an explicitly selected empty staging project.

Credentials come only from STAGING_SUPABASE_URL and STAGING_SUPABASE_SERVICE_ROLE_KEY.
Default is read-only preflight. --execute creates three tiny synthetic objects and
one pointer row, races actual publication, reads the winner and removes owned data.
No service, schema, bucket, policy or deployment configuration changes are made.
"""
import argparse
from concurrent.futures import ThreadPoolExecutor
import hashlib
import json
import os
from pathlib import Path
import re
import sys
from threading import Barrier, Lock
from urllib.parse import urlparse
from uuid import uuid4


def staging_target(project_ref, environment):
    base = environment.get('STAGING_SUPABASE_URL', '').rstrip('/')
    key = environment.get('STAGING_SUPABASE_SERVICE_ROLE_KEY', '')
    parsed = urlparse(base)
    if not re.fullmatch('[a-z]{20}', project_ref):
        raise ValueError('An explicit verified staging project reference is required')
    if (parsed.scheme != 'https' or parsed.hostname != project_ref + '.supabase.co' or
            parsed.path or parsed.query or parsed.fragment or parsed.username or parsed.port):
        raise ValueError('Staging URL must exactly match the selected project')
    if not key:
        raise ValueError('STAGING_SUPABASE_SERVICE_ROLE_KEY is required; do not put its value in chat or tracked files')
    if base == environment.get('SUPABASE_URL', '').rstrip('/'):
        raise ValueError('Staging and shared application target must differ')
    return base, key


def run(project_ref, execute=False):
    import requests
    base, key = staging_target(project_ref, os.environ)
    headers = {'apikey': key, 'Authorization': 'Bearer ' + key}
    table = 'weather_manifest_pointer'
    bucket = 'weather-products'

    def read(path):
        result = requests.get(base + path, headers=headers, timeout=10)
        if result.status_code != 200:
            raise RuntimeError('Staging read refused, HTTP ' + str(result.status_code))
        return result.json()

    def objects():
        result = requests.post(base + '/storage/v1/object/list/' + bucket, headers=headers,
            json={'prefix': '', 'limit': 100, 'offset': 0}, timeout=10)
        if result.status_code != 200 or not isinstance(result.json(), list):
            raise RuntimeError('Staging bucket inventory refused')
        return result.json()

    def pointers():
        return read('/rest/v1/' + table + '?select=id,generation,manifest_key,run_id')

    info = read('/storage/v1/bucket/' + bucket)
    if info.get('id') != bucket or info.get('public') is not False or objects() or pointers():
        raise RuntimeError('Canary requires the existing private bucket and pointer table to be empty')
    receipt = {'preflight': 'accepted', 'private_bucket': True, 'pointer_rows_before': 0,
               'objects_before': 0, 'executed': execute}
    if not execute:
        return receipt

    # Bind application env before importing any weather code. Never reuse shared credentials.
    os.environ.update(SUPABASE_URL=base, SUPABASE_SERVICE_ROLE_KEY=key, SUPABASE_KEY=key,
        MANIFEST_POINTER='1', MANIFEST_IMMUTABLE_PUBLICATION='1', L2_WRITER='1', L2_WRITER_GATE='1')
    nonce = 'audit-canary-' + uuid4().hex
    os.environ['GITHUB_RUN_ID'] = nonce
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / 'backend'))
    from services.weather_pipeline import manifest_pointer as pointer, store
    # The preflight verified the bucket: suppress redundant bucket-create attempts.
    store._bucket_created_checked = True
    writer = object.__new__(store.ProductStore)
    uploaded = []
    lock = Lock()
    barrier = Barrier(2)
    payloads = [json.dumps({'products': [], 'synthetic_canary': nonce, 'candidate': n},
                          sort_keys=True).encode() for n in range(3)]

    def upload(name, content, *, strict, overwrite):
        assert strict and not overwrite
        # Record attempted keys too: a lost acknowledgment may still have created an object.
        with lock:
            uploaded.append(name)
        acknowledged = writer._upload_to_supabase(name, content, strict=strict, overwrite=overwrite)
        if content != payloads[0]:
            barrier.wait(timeout=45)
        return acknowledged

    try:
        first = pointer.publish_run_keyed(writer, payloads[0], upload, None)
        if not first or pointer.fetch_pointed_manifest() != payloads[0]:
            raise RuntimeError('Initial actual-source publication/read-back failed')
        with ThreadPoolExecutor(max_workers=2) as pool:
            jobs = [pool.submit(pointer.publish_run_keyed, writer, payload, upload, None) for payload in payloads[1:]]
            winners = [job.result(timeout=60) for job in jobs]
        if sum(bool(value) for value in winners) != 1:
            raise RuntimeError('Concurrent same-generation publishers did not produce exactly one winner')
        winner = next(value for value in winners if value)
        winner_payload = payloads[1 + next(i for i, value in enumerate(winners) if value)]
        current = pointer.read_pointer()
        if (not current or current.get('generation') != 2 or current.get('manifest_key') != winner or
                current.get('run_id') != nonce or pointer.fetch_pointed_manifest() != winner_payload):
            raise RuntimeError('CAS winner pointer/object read-back did not match')
        refused = False
        try:
            writer._upload_to_supabase(winner, b'{"replacement":true}', strict=True, overwrite=False)
        except Exception:
            refused = True
        if not refused or pointer.fetch_pointed_manifest() != winner_payload:
            raise RuntimeError('Create-only overwrite refusal did not preserve the winner')
        receipt.update(initial_readback=True, publication_winners=1, publication_losers=1,
            generation=2, unique_candidates=len(set(uploaded)), winner_bytes_unchanged=True,
            winner_sha256=hashlib.sha256(winner_payload).hexdigest())
    finally:
        rows = pointers()
        if any(row.get('run_id') != nonce for row in rows):
            raise RuntimeError('Foreign pointer detected: cleanup refused; owned candidates retained')
        if rows:
            response = requests.delete(base + '/rest/v1/' + table + '?id=eq.1&run_id=eq.' + nonce,
                headers={**headers, 'Prefer': 'return=representation'}, timeout=10)
            if response.status_code != 200 or len(response.json()) != 1:
                raise RuntimeError('Owned pointer cleanup acknowledgment missing: objects retained')
        if pointers():
            raise RuntimeError('New pointer detected during cleanup: objects retained')
        names = list(dict.fromkeys(uploaded))
        if names:
            if len(names) > 3 or any(not re.fullmatch(r'manifests/manifest-g\d{12}-[0-9a-f]{32}\.json', name) for name in names):
                raise RuntimeError('Cleanup scope refused')
            response = requests.delete(base + '/storage/v1/object/' + bucket, headers=headers,
                json={'prefixes': names}, timeout=10)
            if response.status_code not in (200, 204):
                raise RuntimeError('Owned object cleanup acknowledgment missing')
        if objects() or pointers():
            raise RuntimeError('Empty staging state was not restored')
        receipt['cleanup'] = 'empty state restored'
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--project-ref', required=True)
    parser.add_argument('--execute', action='store_true')
    args = parser.parse_args()
    try:
        result = run(args.project_ref, args.execute)
    except Exception as error:
        # No SDK/network exception bodies: these may include credential-bearing config.
        print(json.dumps({'accepted': False, 'error_type': type(error).__name__,
                          'reason': str(error) if isinstance(error, ValueError) else 'Canary refused; inspect target and owned state'}))
        return 1
    print(json.dumps(result, sort_keys=True))
    return 0


if __name__ == '__main__':
    sys.exit(main())
