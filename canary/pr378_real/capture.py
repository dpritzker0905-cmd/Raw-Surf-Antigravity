"""Bounded provider capture; no shared application service, storage or credentials.

Sparse-hour instrumentation changes only the fetchers' loop schedules. Their
decoders/regridders and the normalizer/store/estimator are the pinned real code.
This is a small regional replay, not global operational-ingestion qualification.
"""
import gzip
import hashlib
import importlib.util
import json
import os
from pathlib import Path
import socket
import sys
from datetime import datetime, timedelta, timezone
from urllib.parse import urlsplit

from bootstrap import BASE, HERE, prepare

OUT = HERE / 'capture-output'
OUT.mkdir(exist_ok=True)
FORBIDDEN = ('SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY', 'DATABASE_URL',
             'RENDER_API_KEY', 'OPENAI_API_KEY', 'COPERNICUSMARINE_SERVICE_USERNAME',
             'COPERNICUSMARINE_SERVICE_PASSWORD')
if any(os.environ.get(k) for k in FORBIDDEN):
    raise RuntimeError('Capture refuses connected application/provider credentials')
if os.environ.get('ESTIMATE_COHERENT_TRENDS') != '0':
    raise RuntimeError('Capture requires explicit guard=0')
os.environ.update(L2_WRITER='0', L2_WRITER_GATE='1', DISABLE_FORECAST_SCHEDULER='1',
                  LOCAL_TEST_FIXTURE='false', NODE_ENV='development', NOAA_FETCH_MIN_HOURS='0',
                  ECMWF_OPENDATA_SOURCE='aws', ECMWF_WAVE_ENSEMBLE='0')
os.environ.pop('TESTING', None)
BACKEND, SOURCE = prepare()
BBOX = {'west': -124., 'east': -122., 'south': 36., 'north': 37.}
RESOLUTION = 1.
NOW = datetime.now(timezone.utc)
http_evidence, decoded_evidence, instrumentation = [], [], []
downloaded = 0
group = 'preflight'


def sha(raw):
    return hashlib.sha256(raw).hexdigest()


def stamp(dt):
    return dt.astimezone(timezone.utc).isoformat()


def audit_network():
    import requests
    original = requests.Session.send
    def send(session, request, **kwargs):
        global downloaded
        host = urlsplit(request.url).hostname or ''
        if not (request.url.startswith('https://') and host in (
                'opendata.dwd.de', 'noaa-gfs-bdp-pds.s3.amazonaws.com',
                'ecmwf-forecasts.s3.eu-central-1.amazonaws.com', 'data.ecmwf.int',
                'www.ecmwf.int', 'ecmwf-forecasts.s3.amazonaws.com')):
            raise RuntimeError('Unapproved capture host: ' + host)
        if request.method not in ('GET', 'HEAD') or request.headers.get('Authorization'):
            raise RuntimeError('Capture only allows anonymous GET/HEAD')
        response = original(session, request, **kwargs)
        raw = response.content
        downloaded += len(raw)
        if downloaded > 480 * 1024 * 1024:
            raise RuntimeError('Capture exceeded 480MiB HTTP budget')
        digest = sha(raw)
        directory = OUT / 'raw_http'
        directory.mkdir(exist_ok=True)
        if raw:
            (directory / digest).write_bytes(raw)
        http_evidence.append({'group': group, 'url': request.url, 'range': request.headers.get('Range'),
                              'method': request.method, 'status': response.status_code,
                              'bytes': len(raw), 'sha256': digest})
        return response
    requests.Session.send = send


def audit_grib():
    import pygrib
    original = pygrib.open
    def open_grib(path, *args, **kwargs):
        raw = Path(path).read_bytes()
        messages = []
        with original(path) as handle:
            for message in handle:
                messages.append({'analysis': stamp(message.analDate.replace(tzinfo=timezone.utc)),
                                 'valid': stamp(message.validDate.replace(tzinfo=timezone.utc)),
                                 'shortName': message.shortName, 'units': message.units,
                                 'name': message.name, 'paramId': message.paramId})
        decoded_evidence.append({'group': group, 'sha256': sha(raw), 'bytes': len(raw), 'messages': messages,
                                 'last_provider_url': http_evidence[-1]['url'] if http_evidence else None})
        return original(path, *args, **kwargs)
    pygrib.open = open_grib


def sparse_module(name, hours):
    path = BACKEND / 'services' / (name + '.py')
    source = path.read_text()
    if name in ('dwd_gwam_fetcher', 'noaa_gfs_wave_fetcher'):
        original = 'f_hours = list(range(0, max_f + 1, 3))'
        replacement = 'f_hours = ' + repr(hours)
        if source.count(original) != 1:
            raise RuntimeError('Sparse instrumentation seam changed')
        modified = source.replace(original, replacement)
    else:
        modified = source
    namespace = {'__name__': 'pr378_capture_' + name, '__file__': str(path)}
    exec(compile(modified, str(path), 'exec'), namespace)
    if name == 'ecmwf_opendata_fetcher':
        namespace['_step_list'] = lambda maximum: list(hours)
    instrumentation.append({'module': name, 'source_sha256': sha(source.encode()),
                            'instrumented_sha256': sha(modified.encode()), 'selected_hours': hours,
                            'change': 'sparse hour schedule only; explicit provider cycle when recorded'})
    return namespace


def fetch(name, hours, cycle=None):
    global group
    module = sparse_module(name, hours)
    if name == 'dwd_gwam_fetcher':
        chosen = cycle
        module['_pick_cycle'] = lambda *args: (chosen, chosen.strftime('%Y%m%d'), chosen.strftime('%H'))
    elif name == 'noaa_gfs_wave_fetcher' and cycle is not None:
        prefix = (f"https://noaa-gfs-bdp-pds.s3.amazonaws.com/gfs.{cycle:%Y%m%d}/{cycle:%H}/wave/gridded/"
                  f"gfswave.t{cycle:%H}z.global.0p25.")
        module['_pick_cycle'] = lambda *args: (cycle, prefix)
    elif name == 'ecmwf_opendata_fetcher':
        original_spec = module['retrieve_spec']
        module['retrieve_spec'] = lambda *args: dict(original_spec(*args), date=cycle.strftime('%Y%m%d'), time=cycle.hour)
    group = name + ':' + (stamp(cycle) if cycle else 'latest')
    print('FETCH ' + group + ' hours=' + repr(hours), flush=True)
    before = len(decoded_evidence)
    points, ok, failed, times = module['fetch_global_coarse'](
        {'bbox': BBOX, 'resolution': RESOLUTION, 'forecast_days': 16, 'layer': 'waves'})
    if not points or failed or ok != len(hours) or not times:
        raise RuntimeError('Incomplete selected provider frames: ' + group + ' ' + repr((ok, failed, times)))
    actual_cycle = datetime.fromisoformat(points[0]['__model_run_time'])
    messages = [m for item in decoded_evidence[before:] for m in item['messages']]
    if not messages or {datetime.fromisoformat(m['analysis']) for m in messages} != {actual_cycle}:
        raise RuntimeError('Decoded GRIB cycle disagrees with point provenance')
    if cycle is not None and actual_cycle != cycle:
        raise RuntimeError('Provider delivered an unexpected analysis cycle')
    expected_times = {actual_cycle + timedelta(hours=h) for h in hours}
    if ({datetime.fromisoformat(t.replace('Z', '+00:00')) for t in times} != expected_times or
            {datetime.fromisoformat(m['valid']) for m in messages} != expected_times):
        raise RuntimeError('Selected GRIB valid times differ from requested hours')
    for valid in expected_times:
        step_messages = [m for m in messages if datetime.fromisoformat(m['valid']) == valid]
        if name == 'dwd_gwam_fetcher':
            fields = [d for d in decoded_evidence[before:] if any(datetime.fromisoformat(m['valid']) == valid for m in d['messages'])]
            requested_vars = {urlsplit(d['last_provider_url']).path.split('/')[-2] for d in fields}
            if (len(step_messages) != len(module['VAR_MAP']) or
                    len({m['paramId'] for m in step_messages}) != len(module['VAR_MAP']) or
                    requested_vars != {v[0] for v in module['VAR_MAP']}):
                raise RuntimeError('DWD selected field coverage incomplete: ' + repr((requested_vars, step_messages)))
            print('DWD actual field metadata ' + json.dumps(step_messages), flush=True)
        elif name == 'noaa_gfs_wave_fetcher' and len(step_messages) != 12:
            raise RuntimeError('NOAA selected step does not contain all12 decoded wave messages')
    result = {'points': points, 'times': times, 'run_iso': stamp(actual_cycle), 'group': group}
    (OUT / (name + '_' + actual_cycle.strftime('%Y%m%d%H') + '.json')).write_text(json.dumps(result))
    return result


def main():
    audit_network()
    audit_grib()
    # One actual retained 00Z GWAM cycle and the current 12Z ECMWF wave cycle.
    day = NOW.replace(hour=0, minute=0, second=0, microsecond=0)
    icon = fetch('dwd_gwam_fetcher', [165, 168], day)
    euro_cycle = day.replace(hour=12) if NOW.hour >= 19 else day - timedelta(hours=12)
    euro = fetch('ecmwf_opendata_fetcher', [234, 240], euro_cycle)
    from cmems_capture import capture
    cmems = capture(OUT)
    if not cmems.get('run_iso'):
        raise RuntimeError('CMEMS bulletin proof unavailable')
    native_sets = [('ICON', icon, ['waves', 'swell_1', 'wind_waves'], 168),
                   ('EURO_ECMWF', euro, ['waves'], 240),
                   ('EURO_CMEMS', cmems, ['waves', 'swell_1', 'swell_2', 'wind_waves'], None)]
    targets = set()
    for _, data, _, _ in native_sets:
        anchor = datetime.fromisoformat(data['times'][-1].replace('Z', '+00:00'))
        run = datetime.fromisoformat(data['run_iso'])
        targets.update([anchor, anchor + timedelta(hours=3), anchor + timedelta(hours=6), run + timedelta(hours=336)])
    noaa = sparse_module('noaa_gfs_wave_fetcher', [])
    from services._fetch_common import http_session
    cycle, prefix = noaa['_pick_cycle'](http_session(), NOW, 384)
    if not cycle:
        raise RuntimeError('No complete GFS donor cycle')
    hours = sorted({int((t - cycle).total_seconds() / 3600) for t in targets})
    if any(h < 0 or h > 384 or h % 3 for h in hours):
        raise RuntimeError('GFS target times outside verified lattice')
    gfs = fetch('noaa_gfs_wave_fetcher', hours, cycle)
    old_cycle = cycle - timedelta(hours=6)
    old_hours = sorted({int((datetime.fromisoformat(d['times'][-1].replace('Z', '+00:00')) - old_cycle).total_seconds()/3600)
                        for _, d, _, _ in native_sets})
    gfs_old = fetch('noaa_gfs_wave_fetcher', old_hours, old_cycle)

    # Acquisition ends here. No subsequent code is allowed to connect anywhere.
    attempts = []
    def deny(*args, **kwargs):
        attempts.append(True)
        raise RuntimeError('Network forbidden after capture')
    socket.socket.connect = deny
    socket.socket.connect_ex = deny
    socket.create_connection = deny
    socket.getaddrinfo = deny
    try:
        socket.create_connection(('example.invalid', 443))
    except RuntimeError:
        pass
    assert len(attempts) == 1
    attempts.clear()
    from services.weather_pipeline.normalizer import WeatherNormalizer
    from services.weather_pipeline.store import ProductStore, _upload_executor, _manifest_executor
    from services.weather_pipeline.estimator import estimate_euro_grid
    from services.weather_pipeline.blend_cycle_health import verified_blend_cycles
    from services.weather_pipeline.model_cycle_health import summarize_model_cycles
    normalizer = WeatherNormalizer()
    bundle = OUT / 'bundle'
    directory = bundle / 'products'
    directory.mkdir(parents=True, exist_ok=True)
    store = ProductStore(cache_dir=directory)
    cases, records = {}, {}

    def normalize(data, model, layer, when, region, family):
        product = normalizer.normalize(model=model, provider='copernicus' if family == 'EURO_CMEMS' else 'open-meteo',
            domain='marine', layer=layer, raw_results=data['points'], bbox=BBOX, resolution=RESOLUTION,
            target_time=when, run_time=NOW, region_id=region, coverage_mode='regional_tile')
        if (not product or product.valid_time != when or product.is_test_fixture or product.is_estimated
                or product.model_run_time_status != 'known' or not any(v.is_valid for v in product.grid.vectors)):
            raise RuntimeError('Real native normalized product refused or substituted')
        name = store.save_product(product, resolution=RESOLUTION)
        if not name:
            raise RuntimeError('Actual ProductStore refused native frame')
        records[name] = {'kind': 'native', 'provider_capture': data.get('group', 'CMEMS'), 'source_family': family}
        return store.load_product(name)

    for family, data, layers, limit in native_sets:
        model = 'ICON' if family == 'ICON' else 'EURO'
        anchor_time = datetime.fromisoformat(data['times'][-1].replace('Z', '+00:00'))
        native_run = datetime.fromisoformat(data['run_iso'])
        native_limit = limit or (anchor_time - native_run).total_seconds() / 3600
        for conflict in (False, True):
            region = 'replay_' + family.lower() + ('_conflict' if conflict else '')
            for layer in layers:
                anchor = normalize(data, model, layer, anchor_time, region, family)
                donor_anchor = normalize(gfs_old if conflict else gfs, 'GFS', layer, anchor_time, region, 'GFS')
                case_ids = []
                for target in (anchor_time + timedelta(hours=3), anchor_time + timedelta(hours=6),
                               native_run + timedelta(hours=336)):
                    donor_target = normalize(gfs, 'GFS', layer, target, region, 'GFS')
                    estimate = estimate_euro_grid(
                        target_hour=native_limit+(target-anchor_time).total_seconds()/3600,
                        native_limit=native_limit, active_layer=layer, euro_anchor_product=anchor,
                        gfs_target_product=donor_target, gfs_anchor_product=donor_anchor,
                        euro_anchor_valid_time=anchor_time, gfs_anchor_valid_time=anchor_time,
                        gfs_target_valid_time=target)
                    if estimate is None:
                        raise RuntimeError('Guard-off real estimate unexpectedly refused')
                    if model == 'ICON':
                        estimate.model = 'ICON'
                        estimate.estimate_basis['type'] = 'icon_persistence_gfs_blend'
                        for suffix in ('product_id', 'valid_time'):
                            estimate.estimate_basis['persistence_anchor_'+suffix] = estimate.estimate_basis.pop('euro_anchor_'+suffix)
                    name = store.save_product(estimate, resolution=RESOLUTION)
                    if not name:
                        raise RuntimeError('Actual ProductStore refused real estimate')
                    records[name] = {'kind': 'estimate', 'contributors': {
                        role: p.product_id for role, p in [('native_anchor', anchor), ('gfs_anchor', donor_anchor), ('gfs_target', donor_target)]}}
                    try:
                        sources = verified_blend_cycles(estimate)
                    except ValueError as exc:
                        if not conflict or 'conflicting cycles' not in str(exc):
                            raise
                    else:
                        if conflict or not sources:
                            raise RuntimeError('Real provenance control did not discriminate conflicting cycles')
                    case_ids.append(name)
                key = family + '/' + layer + ('/conflict' if conflict else '/coherent')
                products = [p for p in store.get_manifest().products if p.product_id in case_ids]
                report, verdict, reasons = summarize_model_cycles(products, NOW, model, 'marine')
                cases[key] = {'model': model, 'products': case_ids, 'expected_cycle_status': report['model_cycle_status'],
                              'expected_verdict': verdict, 'report': report, 'reasons': reasons,
                              'control': 'actual different donor cycles' if conflict else 'actual coherent donor cycle'}

    _upload_executor.shutdown(wait=True)
    _manifest_executor.shutdown(wait=True)
    assert not attempts
    for name, record in records.items():
        raw = (directory / name).read_bytes()
        loaded = store.load_product(name)
        if not loaded or sha(loaded.model_dump_json().encode()) != sha(raw):
            raise RuntimeError('Actual ProductStore load changed serialized grid bytes')
        record.update(sha256=sha(raw), bytes=len(raw), model=loaded.model,
                      valid_time=stamp(loaded.valid_time), model_run_time=stamp(loaded.model_run_time) if loaded.model_run_time else None,
                      model_run_time_status=loaded.model_run_time_status, is_estimated=loaded.is_estimated,
                      valid_cells=sum(v.is_valid for v in loaded.grid.vectors), cells=len(loaded.grid.vectors))
    for name, record in records.items():
        if record['kind'] == 'estimate':
            record['contributor_sha256'] = {role: records[pid]['sha256'] for role, pid in record['contributors'].items()}
    receipt = {'base_commit': BASE, 'as_of': stamp(NOW), 'captured_at': stamp(datetime.now(timezone.utc)),
               'guard': '0', 'mode': 'real-grid-regional-replay', 'bbox': BBOX, 'resolution': RESOLUTION,
               'source_archive_sha256': SOURCE['archive_sha256'], 'instrumentation': instrumentation,
               'http_download_bytes': downloaded, 'http': http_evidence, 'decoded_grib': decoded_evidence,
               'cmems': cmems['evidence'], 'products': records, 'cases': cases,
               'manifest_sha256': sha((directory / 'manifest.json').read_bytes()),
               'network_attempts_after_capture': len(attempts), 'network_positive_control': 'blocked',
               'limits': 'Six-point Pacific regional sample; sparse real native hours; real-cycle negative controls explicitly selected. No global tier, full app, L2 persistence, guard-on, accuracy or availability acceptance.'}
    (bundle / 'receipt.json').write_text(json.dumps(receipt, indent=2) + '\n')
    files = {str(p.relative_to(bundle)).replace('\\', '/'): sha(p.read_bytes()) for p in bundle.rglob('*') if p.is_file()}
    payload = {'files': {name: (bundle/name).read_text() for name in files}, 'sha256': files}
    sealed = gzip.compress(json.dumps(payload, separators=(',', ':')).encode(), mtime=0)
    (OUT / 'bundle.json.gz').write_bytes(sealed)
    (OUT / 'bundle-pin.json').write_text(json.dumps({'sha256': sha(sealed), 'base_commit': BASE,
        'products': len(records), 'cases': len(cases), 'as_of': stamp(NOW)}, indent=2) + '\n')
    print(json.dumps({'capture': 'complete', 'products': len(records), 'cases': len(cases),
                      'bundle_sha256': sha(sealed), 'http_bytes': downloaded, 'guard': '0'}), flush=True)


if __name__ == '__main__':
    try:
        main()
    finally:
        (OUT / 'acquisition-audit.json').write_text(json.dumps({'http': http_evidence,
            'decoded_grib': decoded_evidence, 'downloaded': downloaded}, indent=2) + '\n')
