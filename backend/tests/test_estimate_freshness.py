from datetime import datetime, timedelta, timezone
from itertools import permutations

import pytest

from services.weather_pipeline import store as store_module
from services.weather_pipeline.estimate_freshness import obsolete_estimate_ids
from services.weather_pipeline.grid_resolver_selection import find_candidates
from services.weather_pipeline.manifest_point_selection import point_candidates, choose_for_point
from services.weather_pipeline.product_selection import select_best_candidate
from services.weather_pipeline.schemas import CoverageBounds, ManifestProduct, PipelineManifest

ASK = datetime(2026, 10, 13, 15, tzinfo=timezone.utc)
NEW = datetime(2026, 10, 7, 12, tzinfo=timezone.utc)
OLD = NEW - timedelta(days=3)


def item(estimated=False, valid=ASK, receipt=OLD, cycle=OLD, region='global_coarse', resolution=10):
    return ManifestProduct(model='EURO', provider='test', domain='marine', layer='waves',
                           run_time=receipt, model_run_time=cycle,
                           model_run_time_status='known' if cycle else 'missing',
                           valid_time_start=valid, valid_time_end=valid, resolution=resolution,
                           freshness_sec=3600, is_forecast_authoritative=not estimated,
                           is_estimated=estimated, region_id=region, coverage_mode='global_tile',
                           coverage=CoverageBounds(west=-180, east=180, south=-80, north=80),
                           filename=f"{'estimate' if estimated else 'native'}-{valid:%H}-{region}-{resolution}.json")


def manifest(*products):
    return PipelineManifest(last_manifest_update=NEW, products=list(products))


@pytest.mark.parametrize('cycle', [OLD, None])
def test_real_grid_and_point_selection_reject_old_exact_estimate_only_when_enabled(monkeypatch, cycle):
    estimate = item(True, cycle=cycle)
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    for ordered in permutations([estimate, native]):
        snapshot = manifest(*ordered)
        for flag, expected in [('0', estimate), ('1', native), ('0', estimate)]:
            monkeypatch.setenv('FRESH_ESTIMATE_SELECTION', flag)
            candidates = find_candidates(snapshot, 'EURO', 'marine', 'waves', ASK)
            assert select_best_candidate(*candidates, -180, -80, 180, 80) is expected
            assert choose_for_point(point_candidates(snapshot, 'EURO', 'marine', 'waves', ASK), 28, -80) is expected


def test_reconciliation_is_a_reproducer_for_resurrecting_future_valid_estimates(monkeypatch):
    estimate = item(True)
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    monkeypatch.setenv('MANIFEST_RETENTION_DAYS', '36500')
    monkeypatch.setattr(store_module, '_fetch_remote_manifest_products',
                        lambda: [estimate.model_dump(mode='json')])
    for flag, expected_count in [('0', 2), ('1', 1), ('0', 2)]:
        monkeypatch.setenv('FRESH_ESTIMATE_SELECTION', flag)
        snapshot = manifest(native)
        store_module.reconcile_manifest_products_for_upload(snapshot, exclude_keys={estimate.filename})
        assert len(snapshot.products) == 1  # The prune's first upload excludes it.
        store_module.reconcile_manifest_products_for_upload(snapshot)
        assert len(snapshot.products) == expected_count
        assert native in snapshot.products


@pytest.mark.parametrize('difference', ['far_hour', 'region', 'resolution', 'new_estimate'])
def test_unique_tails_other_coverage_and_fresh_estimates_survive(difference):
    estimate = item(True)
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    if difference == 'far_hour':
        native.valid_time_start = ASK - timedelta(hours=6)
    elif difference == 'region':
        native.region_id = 'global_mid'
    elif difference == 'resolution':
        native.resolution = 2
    else:
        estimate.run_time = NEW
        estimate.model_run_time = NEW
    assert obsolete_estimate_ids([estimate, native]) == set()


def test_older_verified_cycle_is_not_hidden_by_late_receipt():
    estimate = item(True, receipt=NEW + timedelta(hours=1))
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    assert obsolete_estimate_ids([estimate, native]) == {id(estimate)}


def test_receipt_is_never_used_as_a_model_cycle():
    estimate = item(True, receipt=NEW, cycle=None)
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    assert obsolete_estimate_ids([estimate, native]) == set()


def test_unverified_anchor_cycle_cannot_override_receipt_order():
    estimate = item(True, receipt=NEW, cycle=None)
    estimate.estimate_basis = {'cycle_sources': [{'role': 'native_anchor',
                                               'model_run_time': OLD.isoformat()}]}
    native = item(False, ASK - timedelta(hours=3), NEW, NEW)
    assert obsolete_estimate_ids([estimate, native]) == set()
