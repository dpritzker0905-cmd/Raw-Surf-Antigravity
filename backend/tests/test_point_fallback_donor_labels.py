"""Real serving labels the actual fallback donor without changing source selection."""
from copy import deepcopy
from unittest.mock import AsyncMock

import pytest

from tests.test_point_direct_provenance import prepare_direct

LAYERS = ['waves', 'swell_1', 'swell_2', 'wind_waves']


@pytest.mark.parametrize('layer', LAYERS)
@pytest.mark.parametrize('native_miss', ['empty', 'exception', 'masked'])
def test_euro_fallback_labels_follow_actual_requested_donor(monkeypatch, layer, native_miss):
    raw, resolve, _, provider = prepare_direct(monkeypatch, 'EURO', 'marine', layer, fallback=True)
    if native_miss == 'exception':
        native = AsyncMock(side_effect=RuntimeError('offline native unavailable'))
    else:
        masked = deepcopy(raw)
        for key, values in masked['hourly'].items():
            if key.endswith('_height'):
                masked['hourly'][key] = [None] * len(values)
        native = AsyncMock(return_value=[masked] if native_miss == 'masked' else [])
    monkeypatch.setattr('services.copernicus_marine_service.fetch_euro_marine', native)
    result = resolve()
    request = provider.fetch_point.call_args.kwargs
    expected_model = 'EURO' if layer == 'waves' else 'GFS'
    expected_source = provider.MARINE_MODELS[expected_model]
    assert request['model'] == expected_model and request['forecast_days'] == 16
    assert result.upstream_model == expected_source
    assert result.provider == result.upstream_provider == ('open-meteo' if layer == 'waves' else 'gfs_estimated_fallback')
    assert result.estimate_basis == {
        'type': 'ecmwf_ifs_derived_fallback' if layer == 'waves' else 'gfs_derived_fallback',
        'method': 'wave_component_ratio_estimation', 'source_method': 'direct_point_api', 'source_model': expected_source}
    assert result.model == 'EURO' and result.is_estimated and not result.is_forecast_authoritative
    assert result.fallback_reason == 'copernicus_missing_fallback'
    assert result.point.speed == 3. and result.point.direction == 90. and result.point.period == 12.
    assert result.surf_height_m is not None
    assert result.model_run_time is None and result.model_run_time_status == 'missing'
    body = result.model_dump(mode='json')
    assert body['estimate_basis']['source_model'] == body['upstream_model']


@pytest.mark.parametrize('layer', LAYERS)
def test_native_euro_success_stays_authoritative_copernicus_without_fallback_fetch(monkeypatch, layer):
    _, resolve, _, provider = prepare_direct(monkeypatch, 'EURO', 'marine', layer)
    result = resolve()
    provider.fetch_point.assert_not_called()
    assert result.provider == result.upstream_provider == 'copernicus'
    assert result.upstream_model == 'cmems_mod_glo_wav_anfc_0.083deg_PT3H-i'
    assert result.is_forecast_authoritative and not result.is_estimated
    assert result.estimate_basis is None


def test_real_fallback_components_retain_partition_eligibility(monkeypatch):
    import asyncio
    from services.weather_pipeline.point_resolution import PointResolutionService
    _, resolve, _, _ = prepare_direct(monkeypatch, 'EURO', 'marine', 'swell_1', fallback=True)
    response = resolve()
    monkeypatch.setenv('SURF_PARTITIONS', '1')
    service = PointResolutionService.__new__(PointResolutionService)
    monkeypatch.setattr(service, '_resolve_point_internal', AsyncMock(return_value=response))
    assert asyncio.run(service._resolve_partitions('EURO', 'waves', 0., 0., 't', 3., 12.)) is None
    assert service._resolve_point_internal.await_count == 3
