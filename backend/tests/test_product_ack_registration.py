"""Real single/batch storage seams: registration describes acknowledged bytes only."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone, timedelta
from types import SimpleNamespace as S
import json
import secrets
import threading

import pytest
import requests

from services.weather_pipeline import store as sm
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct


def product(hour=0, height=2):
    now = datetime.now(timezone.utc).replace(microsecond=0)
    bounds = CoverageBounds(west=-180, south=-80, east=180, north=85)
    return NormalizedProduct(
        model='GFS', provider='noaa', domain='marine', layer='waves', run_time=now,
        valid_time=now+timedelta(hours=hour), coverage=bounds, is_forecast_authoritative=True, is_estimated=False,
        grid=NormalizedGrid(bounds=bounds, cols=1, rows=1,
                            vectors=[GridVector(lat=0, lng=0, speed=height)]),
        value_kind='height', value_unit='m', display_unit_hint='ft', source_variables=['hs'],
        freshness_sec=0, region_id='global_coarse')


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    monkeypatch.setattr(sm.ProductStore, '_cached_manifest', None)
    monkeypatch.setattr(sm.ProductStore, '_last_manifest_sha', None)
    monkeypatch.setattr(sm, '_get_supabase_storage', lambda: S())
    monkeypatch.setattr(sm, '_fetch_remote_manifest_products', lambda: [])
    from services.weather_pipeline import manifest_pointer
    monkeypatch.setattr(manifest_pointer, 'publish_run_keyed', lambda *args: None)
    monkeypatch.setattr(manifest_pointer, 'read_pointer', lambda: None)
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', secrets.token_urlsafe(36))
    monkeypatch.setenv('L2_WRITER', '1')
    monkeypatch.setenv('L2_UPLOAD_MAX_ATTEMPTS', '1')
    started, release = threading.Event(), threading.Event()
    release.set()
    state = {'code': 201, 'payloads': [], 'block': False}

    def post(url, **kwargs):
        name = url.rsplit('/', 1)[-1]
        if name != 'manifest.json':
            started.set()
            if state['block']:
                assert release.wait(3), 'fixture release missing'
            return S(status_code=state['code'], text='fixture', headers={})
        state['payloads'].append(json.loads(kwargs['data']))
        return S(status_code=201, text='fixture', headers={})

    monkeypatch.setattr(requests, 'post', post)
    with ThreadPoolExecutor(max_workers=2) as uploads, ThreadPoolExecutor(max_workers=1) as manifests:
        monkeypatch.setattr(sm, '_upload_executor', uploads)
        monkeypatch.setattr(sm, '_manifest_executor', manifests)
        yield S(store=sm.ProductStore(tmp_path), state=state, started=started, release=release,
                uploads=uploads, manifests=manifests)
        release.set()


def save(store, batch, p):
    return store.save_products_batch([(p, 10)]) if batch else store.save_product(p)


@pytest.mark.parametrize('batch', [False, True])
def test_delayed_upload_cannot_publish_or_replace_prior_local_bytes(runtime, monkeypatch, batch):
    p = product()
    monkeypatch.setenv('L2_WRITER', '0')
    save(runtime.store, batch, p)
    prior = runtime.store.get_manifest().model_dump()
    filename = p.product_id
    old_bytes = (runtime.store.cache_dir / filename).read_bytes()
    monkeypatch.setenv('L2_WRITER', '1')
    runtime.state['block'] = True
    runtime.release.clear()
    runtime.started.clear()
    p.grid.vectors[0].speed = 9
    with ThreadPoolExecutor(max_workers=1) as caller:
        future = caller.submit(save, runtime.store, batch, p)
        try:
            assert runtime.started.wait(2)
            # A separate executor is free to publish while the product request is held.
            runtime.manifests.submit(lambda: None).result(2)
            assert not runtime.state['payloads'], 'manifest published before product acknowledgment'
            assert (runtime.store.cache_dir / filename).read_bytes() == old_bytes
            assert runtime.store.get_manifest().model_dump() == prior
        finally:
            runtime.release.set()
        assert future.result(3)
    runtime.manifests.submit(lambda: None).result(2)
    assert runtime.state['payloads']
    assert json.loads((runtime.store.cache_dir / filename).read_bytes())['grid']['vectors'][0]['speed'] == 9


@pytest.mark.parametrize('batch', [False, True])
@pytest.mark.parametrize('code', [403, 429, 503])
def test_failed_replacement_preserves_prior_registration_and_bytes(runtime, monkeypatch, batch, code):
    p = product()
    monkeypatch.setenv('L2_WRITER', '0')
    save(runtime.store, batch, p)
    prior = runtime.store.get_manifest().products[0].model_dump()
    filename = p.product_id
    old_bytes = (runtime.store.cache_dir / filename).read_bytes()
    monkeypatch.setenv('L2_WRITER', '1')
    runtime.state['code'] = code
    p.run_time += timedelta(hours=1)
    p.grid.vectors[0].speed = 9
    assert not save(runtime.store, batch, p)
    runtime.uploads.submit(lambda: None).result(2)
    runtime.manifests.submit(lambda: None).result(2)
    assert runtime.store.get_manifest().products[0].model_dump() == prior
    assert (runtime.store.cache_dir / filename).read_bytes() == old_bytes
    assert not runtime.state['payloads']


def test_batch_keeps_parallel_uploads_and_registers_only_acknowledged_subset(runtime, monkeypatch):
    barrier = threading.Barrier(2)
    original = requests.post

    def post(url, **kwargs):
        if url.endswith('manifest.json'):
            return original(url, **kwargs)
        barrier.wait(2)  # Serializing the whole batch would fail this positive control.
        good = json.loads(kwargs['data'])['grid']['vectors'][0]['speed'] == 2
        return S(status_code=201 if good else 429, text='fixture', headers={})

    monkeypatch.setattr(requests, 'post', post)
    good, failed = product(1), product(2, height=9)
    class Poison:
        @property
        def grid(self):
            raise RuntimeError('malformed item')

    assert runtime.store.save_products_batch([(good, 10), (Poison(), 10), (failed, 10)]) == 1
    runtime.manifests.submit(lambda: None).result(2)
    assert [p.filename for p in runtime.store.get_manifest().products] == [good.product_id]
    assert [p['filename'] for p in runtime.state['payloads'][-1]['products']] == [good.product_id]
    assert not (runtime.store.cache_dir / failed.product_id).exists()


@pytest.mark.parametrize('ack', [None, False])
def test_completed_future_without_explicit_ack_does_not_register(runtime, monkeypatch, ack):
    monkeypatch.setattr(runtime.store, '_upload_to_supabase', lambda *a, **k: ack)
    assert runtime.store.save_products_batch([(product(), 10)]) == 0
    assert not runtime.store.get_manifest().products


def test_stalled_batch_bounds_payload_queue_and_refuses_partial_success(runtime, monkeypatch):
    from services.weather_pipeline import product_ack_registration as ack
    monkeypatch.setattr(ack, '_timeout', lambda: .01)
    runtime.state['block'] = True
    runtime.release.clear()
    prepared = []

    def products():
        for i in range(20):
            p = product(i)
            p.product_id = f'gfs_marine_waves_global_coarse_{p.valid_time:%Y%m%dT%H%M%SZ}.json'
            from services.weather_pipeline.store_helpers import _build_manifest_item
            prepared.append(p)
            yield _build_manifest_item(p, p.product_id, 10, False), p.model_dump_json().encode()

    try:
        with pytest.raises(TimeoutError):
            ack.save_prepared_products(runtime.store, products())
        assert len(prepared) == 4
        assert not runtime.store.get_manifest().products
    finally:
        runtime.release.set()
    runtime.uploads.submit(lambda: None).result(2)
    runtime.manifests.submit(lambda: None).result(2)
    assert not runtime.store.get_manifest().products, 'late success must not register timed-out bytes'
    assert not runtime.state['payloads']
