"""Current-source WI02/WI03 diagnosis; assertions describe still-unrepaired behavior.

Not a CI acceptance test. Real entrypoint/store/health code, fake producer/HTTP boundary.
"""
import json
from datetime import datetime, timedelta, timezone
from pathlib import Path
import secrets
from types import SimpleNamespace as S

import pytest
import requests

from scripts import ingest_forecast_ci as ci
from scheduler import forecast
from services.weather_pipeline import store as store_module
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.data_health import compute_data_health, EXPECTED_LANES


@pytest.mark.parametrize('health_enabled,http_status,expected_exit', [(True, 200, 0),
                                                                    (True, 500, 1),
                                                                    (False, 200, 1)])
def test_empty_cycle_exit_is_still_driven_by_metadata_upload(monkeypatch, tmp_path,
                                                          health_enabled, http_status, expected_exit):
    original_init = ProductStore.__init__
    monkeypatch.setattr(ProductStore, '__init__', lambda self, cache_dir=None:
                        original_init(self, tmp_path))
    monkeypatch.setattr(ProductStore, 'restore_from_supabase', lambda self: (0, []))
    monkeypatch.setattr(ProductStore, 'prune_duplicate_valid_times', lambda self: 0)
    monkeypatch.setattr(ProductStore, '_last_upload_time', None)
    monkeypatch.setattr(ProductStore, '_last_upload_errors', [])
    monkeypatch.setattr(ProductStore, '_cached_manifest', None)
    bucket = S(list=lambda: [])
    storage = S(from_=lambda name: bucket)
    monkeypatch.setattr(store_module, '_get_supabase_storage', lambda: S(storage=storage))
    monkeypatch.setattr(forecast, 'ingest_marine_forecast_task', lambda: None)
    monkeypatch.setenv('SUPABASE_URL', 'https://fixture.invalid')
    monkeypatch.setenv('SUPABASE_SERVICE_ROLE_KEY', secrets.token_urlsafe(36))
    monkeypatch.setenv('L2_WRITER', '1')
    monkeypatch.setenv('L2_UPLOAD_MAX_ATTEMPTS', '1')
    monkeypatch.setenv('DATA_HEALTH_CHECK', '1' if health_enabled else '0')
    for key in ('SPOT_RATINGS_PRECOMPUTE', 'BUOY_CALIBRATION', 'REPORT_CALIBRATION'):
        monkeypatch.setenv(key, '0')
    uploads = []

    def post(url, **kwargs):
        uploads.append({'filename': url.rsplit('/', 1)[-1],
                        'health': json.loads(kwargs['data'])})
        return S(status_code=http_status, text='fixture', headers={})

    monkeypatch.setattr(requests, 'post', post)
    exit_code = ci.main()
    assert exit_code == expected_exit
    if health_enabled:
        assert len(uploads) == 1 and uploads[0]['filename'] == 'health.json'
        assert uploads[0]['health']['status'] == 'critical'
    else:
        assert uploads == []
    assert ProductStore().get_persistence_diagnostics()['disk_product_count'] == 0
    destination = Path(__file__).parent/'visual/ingest-progress-current.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    rows = json.loads(destination.read_text()) if destination.exists() else []
    rows.append({'health_enabled': health_enabled, 'http_status': http_status,
                 'exit_code': exit_code, 'product_uploads': 0,
                 'metadata_uploads': len(uploads), 'unrepaired': True})
    destination.write_text(json.dumps(rows, indent=2)+'\n')



@pytest.mark.parametrize('ingest_age,cycle_age,expected', [(1, 7, 'ok'), (1, 55, 'ok'),
                                                       (13, 55, 'critical')])
def test_cycle_age_currently_has_no_health_influence(monkeypatch, ingest_age, cycle_age, expected):
    for name in ('SUPABASE_URL', 'SUPABASE_KEY', 'SUPABASE_SERVICE_ROLE_KEY'):
        monkeypatch.delenv(name, raising=False)
    for name in ('HEALTH_STALE_HOURS', 'HEALTH_CRITICAL_HOURS', 'HEALTH_MIN_HORIZON_HOURS_GFS',
                 'HEALTH_MIN_HORIZON_HOURS_EURO', 'HEALTH_MIN_HORIZON_HOURS_ICON'):
        monkeypatch.delenv(name, raising=False)
    now = datetime(2026, 10, 5, 2, 0, tzinfo=timezone.utc)
    products = [S(model=model, domain=domain, region_id='global_coarse',
                  run_time=now-timedelta(hours=ingest_age),
                  model_run_time=now-timedelta(hours=cycle_age), model_run_time_status='known',
                  valid_time_end=now+timedelta(hours=400), source_dataset='fixture')
                for model, domain in EXPECTED_LANES]
    report = compute_data_health(S(get_manifest=lambda: S(products=products)), now=now)
    assert report['status'] == expected
    destination = Path(__file__).parent/'visual/cycle-health-current.json'
    destination.parent.mkdir(parents=True, exist_ok=True)
    rows = json.loads(destination.read_text()) if destination.exists() else []
    rows.append({'ingest_age_h': ingest_age, 'model_cycle_age_h': cycle_age,
                 'status': report['status'], 'unrepaired': True})
    destination.write_text(json.dumps(rows, indent=2)+'\n')
