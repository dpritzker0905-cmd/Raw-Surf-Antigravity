"""Exercise the actual CI entrypoint and product save/upload paths without cloud access."""
from concurrent.futures import ThreadPoolExecutor
from datetime import datetime, timezone
import secrets
import threading
from types import SimpleNamespace as S

import pytest


import requests

from scripts import ingest_forecast_ci as ci
from scheduler import forecast
from services.weather_pipeline import store as store_module
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
from services.weather_pipeline.store import ProductStore


@pytest.mark.parametrize('script', ['ingest_forecast_ci.py', 'sweep_orphaned_l2.py',
                                   'diagnostics/purge_test_fixtures.py'])
def test_importing_weather_cli_never_promotes_the_host_process_to_writer(monkeypatch, script):
    import runpy
    from pathlib import Path
    monkeypatch.delenv('L2_WRITER', raising=False)
    runpy.run_path(str(Path(__file__).resolve().parents[1] / 'scripts' / script))
    assert 'L2_WRITER' not in __import__('os').environ


def test_ingest_main_explicitly_claims_writer_role_before_its_config_check(monkeypatch):
    monkeypatch.delenv('L2_WRITER', raising=False)
    monkeypatch.delenv('SUPABASE_URL', raising=False)
    assert ci.main() == 1
    assert __import__('os').environ['L2_WRITER'] == '1'


def product(estimated=False):
    now = datetime.now(timezone.utc)
    bounds = CoverageBounds(west=-180, south=-80, east=180, north=85)
    return NormalizedProduct(
        model='GFS', provider='noaa', domain='marine', layer='waves', run_time=now,
        model_run_time=now, model_run_time_status='known', valid_time=now,
        is_forecast_authoritative=not estimated, is_estimated=estimated, coverage=bounds,
        grid=NormalizedGrid(bounds=bounds, cols=1, rows=1,
                            vectors=[GridVector(lat=0, lng=0, speed=2)]),
        value_kind='height', value_unit='m', display_unit_hint='ft', source_variables=['hs'],
        freshness_sec=0, region_id='global_coarse')


@pytest.fixture
def runtime(monkeypatch, tmp_path):
    original_init = ProductStore.__init__
    monkeypatch.setattr(ProductStore, '__init__', lambda self, cache_dir=None: original_init(self, tmp_path))
    monkeypatch.setattr(ProductStore, 'restore_from_supabase', lambda self: (0, []))
    monkeypatch.setattr(ProductStore, 'prune_duplicate_valid_times', lambda self: 0)
    monkeypatch.setattr(ProductStore, '_last_upload_time', None)
    monkeypatch.setattr(ProductStore, '_last_upload_errors', [])
    monkeypatch.setattr(ProductStore, '_cached_manifest', None)
    monkeypatch.setattr(store_module, '_get_supabase_storage', lambda: S(storage=S(from_=lambda _: S(list=lambda: []))))
    from services.weather_pipeline import manifest_pointer
    monkeypatch.setattr(manifest_pointer, 'publish_run_keyed', lambda *args, **kwargs: None)
    monkeypatch.setattr(manifest_pointer, 'read_pointer', lambda: None)
    for name in ('SPOT_RATINGS_PRECOMPUTE', 'BUOY_CALIBRATION', 'REPORT_CALIBRATION'):
        monkeypatch.setenv(name, '0')
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', secrets.token_urlsafe(36))
    monkeypatch.setenv('L2_WRITER', '1')
    monkeypatch.setenv('L2_UPLOAD_MAX_ATTEMPTS', '1')
    calls = []
    status = {'product': 201, 'metadata': 200}

    def post(url, **kwargs):
        name = url.rsplit('/', 1)[-1]
        calls.append(name)
        code = status['product' if name.startswith('gfs_marine_waves_') else 'metadata']
        return S(status_code=code, text='fixture', headers={})

    monkeypatch.setattr(requests, 'post', post)
    with ThreadPoolExecutor(max_workers=2) as uploads, ThreadPoolExecutor(max_workers=1) as manifests:
        monkeypatch.setattr(store_module, '_upload_executor', uploads)
        monkeypatch.setattr(store_module, '_manifest_executor', manifests)
        yield S(calls=calls, status=status, uploads=uploads, manifests=manifests)


@pytest.mark.parametrize('health', ['0', '1'])
def test_empty_ingestion_fails_even_when_metadata_succeeds(runtime, monkeypatch, health):
    monkeypatch.setenv('DATA_HEALTH_CHECK', health)
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: None)
    assert ci.main() == 1
    assert not any(name.startswith('gfs_marine_waves_') for name in runtime.calls)


def test_manifest_only_upload_is_not_product_progress(runtime, monkeypatch):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task',
                        lambda: ProductStore()._upload_to_supabase('manifest.json', b'{}'))
    assert ci.main() == 1
    assert 'manifest.json' in runtime.calls


@pytest.mark.parametrize('batch,estimated', [(False, False), (True, False), (False, True), (True, True)])
def test_acknowledged_native_and_estimated_products_count(runtime, monkeypatch, batch, estimated):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')

    def ingest():
        store = ProductStore()
        if batch:
            assert store.save_products_batch([(product(estimated), 10)]) == 1
        else:
            assert store.save_product(product(estimated))
        # Before the repair, the caller has no upload-drain barrier. Keep these positive
        # controls deterministic so they do not mistake an upload race for the original bug.
        runtime.uploads.submit(lambda: None).result(timeout=2)
        runtime.manifests.submit(lambda: None).result(timeout=2)

    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', ingest)
    assert ci.main() == 0
    assert any(name.startswith('gfs_marine_waves_') for name in runtime.calls)


@pytest.mark.parametrize('http_status', [403, 500])
def test_failed_product_with_successful_metadata_fails(runtime, monkeypatch, http_status):
    runtime.status['product'] = http_status
    monkeypatch.setenv('DATA_HEALTH_CHECK', '1')
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: ProductStore().save_product(product()))
    assert ci.main() == 1


def test_prior_invocation_upload_cannot_make_an_empty_invocation_green(runtime, monkeypatch):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')

    def first():
        ProductStore().save_product(product())
        runtime.uploads.submit(lambda: None).result(timeout=2)
        runtime.manifests.submit(lambda: None).result(timeout=2)

    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', first)
    assert ci.main() == 0
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: None)
    assert ci.main() == 1


def test_partial_product_failure_fails_even_with_acknowledged_success(runtime, monkeypatch):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')
    post = requests.post

    def selective(url, **kwargs):
        if url.endswith('_estimated.json'):
            return S(status_code=403, text='fixture', headers={})
        return post(url, **kwargs)

    monkeypatch.setattr(requests, 'post', selective)
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task',
                        lambda: ProductStore().save_products_batch([(product(), 10), (product(True), 10)]))
    assert ci.main() == 1


@pytest.mark.parametrize('health,expected', [('ok', 0), ('warn', 0), ('critical', 1)])
def test_health_verdict_controls_exit_after_real_ack(runtime, monkeypatch, health, expected):
    from services.weather_pipeline import data_health
    monkeypatch.setenv('DATA_HEALTH_CHECK', '1')
    monkeypatch.setattr(data_health, 'compute_data_health',
                        lambda store: {'status': health, 'alerts': []})
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task',
                        lambda: ProductStore().save_product(product()))
    assert ci.main() == expected


def test_failed_scheduled_lane_fails_with_real_product_ack(runtime, monkeypatch):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')

    def ingest():
        ProductStore().save_product(product())
        return {'failed_jobs': ['EURO Marine Global'], 'completed_jobs': ['GFS Marine Global']}

    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', ingest)
    assert ci.main() == 1


def test_unreadable_enabled_health_fails_after_ack(runtime, monkeypatch):
    from services.weather_pipeline import data_health
    monkeypatch.setenv('DATA_HEALTH_CHECK', '1')

    def unreadable(store):
        raise RuntimeError('fixture unavailable')

    monkeypatch.setattr(data_health, 'compute_data_health', unreadable)
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task',
                        lambda: ProductStore().save_product(product()))
    assert ci.main() == 1


@pytest.mark.parametrize('available,writer', [(False, '1'), (True, '0')])
def test_unavailable_storage_or_blocked_writer_cannot_count_progress(runtime, monkeypatch, available, writer):
    if not available:
        monkeypatch.setattr(store_module, '_get_supabase_storage', lambda: None)
    monkeypatch.setenv('L2_WRITER', writer)
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: ProductStore().save_product(product()))
    assert ci.main() == 1


def test_test_fixture_product_does_not_count_as_durable_progress(runtime, monkeypatch):
    p = product()
    p.provider = 'test-fixture'
    p.is_test_fixture = True
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: ProductStore().save_product(p))
    assert ci.main() == 1


def test_restore_progress_is_not_current_cycle_upload_progress(runtime, monkeypatch):
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')
    monkeypatch.setattr(ProductStore, 'restore_from_supabase', lambda self: (20, []))
    monkeypatch.setattr(ProductStore, '_last_upload_time', datetime.now(timezone.utc).isoformat())
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: None)
    assert ci.main() == 1


def test_delayed_upload_is_drained_before_deciding_success(runtime, monkeypatch):
    started, release = threading.Event(), threading.Event()
    post = requests.post

    def delayed(url, **kwargs):
        if url.rsplit('/', 1)[-1].startswith('gfs_marine_waves_'):
            started.set()
            assert release.wait(2)
        return post(url, **kwargs)

    monkeypatch.setattr(requests, 'post', delayed)
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: ProductStore().save_product(product()))
    with ThreadPoolExecutor(max_workers=1) as caller:
        result = caller.submit(ci.main)
        try:
            assert started.wait(2)
            assert not result.done()
            assert not ProductStore().get_manifest().products
        finally:
            release.set()
        assert result.result(3) == 0


def test_timeout_and_late_previous_ack_cannot_turn_next_empty_cycle_green(runtime, monkeypatch):
    started, release, finished = threading.Event(), threading.Event(), threading.Event()
    post = requests.post

    def delayed(url, **kwargs):
        if url.rsplit('/', 1)[-1].startswith('gfs_marine_waves_'):
            started.set()
            assert release.wait(2)
            try:
                return post(url, **kwargs)
            finally:
                finished.set()
        return post(url, **kwargs)

    monkeypatch.setattr(requests, 'post', delayed)
    monkeypatch.setattr(ci, 'PRODUCT_UPLOAD_DRAIN_SECONDS', .01)
    from services.weather_pipeline import product_ack_registration
    monkeypatch.setattr(product_ack_registration, '_timeout', lambda: .01)
    monkeypatch.setenv('DATA_HEALTH_CHECK', '0')
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: ProductStore().save_product(product()))
    try:
        assert ci.main() == 1
        assert started.is_set()

        def next_empty_cycle():
            release.set()
            assert finished.wait(2)

        monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', next_empty_cycle)
        assert ci.main() == 1
    finally:
        release.set()


def test_batch_submit_failure_is_recorded_as_failure(runtime, monkeypatch):
    class RefusingExecutor:
        def submit(self, *args, **kwargs):
            raise RuntimeError('executor closed')

    monkeypatch.setattr(store_module, '_upload_executor', RefusingExecutor())
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task',
                        lambda: ProductStore().save_products_batch([(product(), 10)]))
    assert ci.main() == 1


@pytest.mark.parametrize('failure', ['exception', 'empty', 'none'])
def test_actual_scheduler_returns_failed_required_job_and_continues(runtime, monkeypatch, failure):
    from services.weather_pipeline import scheduler as pipeline
    completed = []

    class Jobs:
        def __init__(self, store):
            pass

        def __getattr__(self, name):
            async def run():
                completed.append(name)
                if name == 'ingest_euro_marine_global':
                    if failure == 'exception':
                        raise RuntimeError('fixture lane failure')
                    if failure == 'empty':
                        return False
                return True
            return run

    async def no_wait(*args):
        pass

    monkeypatch.setattr(pipeline, 'WeatherPipelineScheduler', Jobs)
    monkeypatch.setattr(forecast, 'ingest_global_model', no_wait)
    monkeypatch.setattr(forecast.asyncio, 'sleep', no_wait)
    monkeypatch.setattr(forecast.gc, 'collect', lambda: 0)
    monkeypatch.setattr(ProductStore, 'prune_old_products', lambda *args: 0)
    monkeypatch.setenv('MARINE_INGEST_ALL', '1')
    monkeypatch.setenv('INGEST_PILOTS', 'skip')
    receipt = forecast.ingest_marine_forecast_task()
    assert 'ingest_euro_pressure_global' in completed  # Failure cannot skip other lanes.
    assert receipt['failed_jobs'] == ([] if failure == 'none' else ['EURO Marine Global'])
    assert receipt['completed_jobs']
