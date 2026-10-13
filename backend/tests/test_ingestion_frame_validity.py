"""WI-05: refuse invalid replacement frames without treating measured zero as missing."""
import json
from datetime import timedelta

import pytest

from tests.test_prune_shared_objects import runtime, NOW, BOUNDS
from services.weather_pipeline.product_upload_progress import collect_product_uploads
from services.weather_pipeline.schemas import GridVector, NormalizedGrid, NormalizedProduct


def product(model='GFS', provider='noaa', *, speed=4, valid=True, empty=False, domain='marine'):
    return NormalizedProduct(
        model=model, provider=provider, domain=domain, layer='waves' if domain == 'marine' else 'temperature',
        run_time=NOW, valid_time=NOW + timedelta(days=4), coverage=BOUNDS, region_id='gulf',
        is_forecast_authoritative=True, is_estimated=False, freshness_sec=0,
        value_kind='height' if domain == 'marine' else 'temperature', value_unit='m',
        display_unit_hint='ft', source_variables=['hs'],
        grid=NormalizedGrid(bounds=BOUNDS, cols=1, rows=1,
                            vectors=[] if empty else [GridVector(lat=29, lng=-87, speed=speed, is_valid=valid)]),
    )


def save(store, incoming, entrypoint):
    if entrypoint == 'single':
        return store.save_product(incoming, resolution=0.25)
    return store.save_products_batch([(incoming, 0.25)])


@pytest.fixture
def guarded(runtime, monkeypatch):
    monkeypatch.setenv('INGEST_REJECT_INVALID_FRAMES', '1')
    return runtime


@pytest.mark.parametrize('model,provider', [('GFS', 'noaa'), ('EURO', 'ecmwf'), ('ICON', 'dwd')])
@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
@pytest.mark.parametrize('kind', ['all_invalid', 'empty', 'valid_zero'])
def test_invalid_reingest_preserves_good_frame(guarded, model, provider, entrypoint, kind):
    store, storage, _ = guarded
    good = product(model, provider)
    filename = store.save_product(good, resolution=0.25)
    incoming = product(model, provider, speed=0, valid=kind == 'valid_zero', empty=kind == 'empty')
    incoming.run_time = NOW + timedelta(hours=1)
    result = save(store, incoming, entrypoint)
    expected = 0 if kind == 'valid_zero' else 4
    for serialized in [(store.cache_dir / filename).read_bytes(), storage[filename]]:
        actual = json.loads(serialized)
        assert len(actual['grid']['vectors']) == 1
        cell = actual['grid']['vectors'][0]
        assert cell['is_valid'] is True and cell['speed'] == expected
    manifest = store.get_manifest().products
    assert len(manifest) == 1
    assert manifest[0].run_time == (incoming.run_time if kind == 'valid_zero' else good.run_time)
    if kind != 'valid_zero':
        assert result == (None if entrypoint == 'single' else 0)


@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
@pytest.mark.parametrize('flag', [None, '0', 'true'])
def test_unset_off_and_noncanonical_flags_keep_legacy_save(guarded, monkeypatch, entrypoint, flag):
    if flag is None:
        monkeypatch.delenv('INGEST_REJECT_INVALID_FRAMES')
    else:
        monkeypatch.setenv('INGEST_REJECT_INVALID_FRAMES', flag)
    store, storage, _ = guarded
    incoming = product(speed=0, valid=False)
    result = save(store, incoming, entrypoint)
    assert result is not None
    assert len(store.get_manifest().products) == 1
    assert len(storage) == 2  # product plus legacy manifest


@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
def test_partially_valid_grid_is_not_discarded(guarded, entrypoint):
    store, storage, _ = guarded
    incoming = product(speed=0, valid=False)
    incoming.grid.vectors.append(GridVector(lat=29, lng=-86, speed=0, is_valid=True))
    incoming.grid.cols = 2
    assert save(store, incoming, entrypoint) is not None
    assert len(store.get_manifest().products) == 1 and len(storage) == 2


@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
@pytest.mark.parametrize('speed', [float('nan'), float('inf'), -1])
def test_nonfinite_or_negative_marine_height_does_not_publish(guarded, entrypoint, speed):
    store, storage, _ = guarded
    assert save(store, product(speed=speed), entrypoint) == (None if entrypoint == 'single' else 0)
    assert storage == {} and store.get_manifest().products == []


@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
def test_valid_negative_weather_value_is_not_a_negative_wave(guarded, entrypoint):
    store, storage, _ = guarded
    assert save(store, product(speed=-5, domain='weather'), entrypoint) is not None
    assert len(store.get_manifest().products) == 1 and len(storage) == 2


@pytest.mark.parametrize('entrypoint', ['single', 'batch'])
def test_rejected_frame_cannot_green_current_upload_progress(guarded, entrypoint):
    store, _, _ = guarded
    with collect_product_uploads() as progress:
        save(store, product(speed=0, valid=False), entrypoint)
    assert progress.wait(0) == {'submitted': 0, 'acknowledged': 0, 'failed': 0, 'pending': 0}


@pytest.mark.parametrize('bad_first', [False, True])
def test_mixed_batch_counts_only_healthy_upload_and_preserves_other_hour(guarded, bad_first):
    store, storage, _ = guarded
    good = product()
    bad = product(speed=0, valid=False)
    bad.valid_time += timedelta(hours=3)
    batch = [(bad, 0.25), (good, 0.25)] if bad_first else [(good, 0.25), (bad, 0.25)]
    with collect_product_uploads() as progress:
        assert store.save_products_batch(batch) == 1
    assert progress.wait(0)['acknowledged'] == 1
    assert len(store.get_manifest().products) == 1 and len(storage) == 2
