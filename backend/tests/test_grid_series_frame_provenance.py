"""R11-04 (Report 11.0) — series frames must carry run/upstream identity, and the response
must census the runs it mixed.

THE DEFECT THIS PINS: grid_series frames stripped run_time/upstream_provider/source_dataset/
estimate_basis — all four served by the per-hour /grid lane — so (1) one series response could
mix MODEL RUNS across adjacent hours with no disclosure (each hour resolves independently
against a manifest that legitimately holds two run generations mid-ingest), and (2) the
frontend's model->dataset guess (FALSIFIED for EURO, measured 2026-08-03) stayed the active
provenance path for every series-committed frame because `frame.upstream_provider` was never
present. These are SERIALIZATION assertions: the data existed on the resolved product at the
exact line the frame dict was built.
"""
import asyncio
import copy

import pytest
from datetime import datetime, timedelta, timezone

from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)

_BASE_RUN = datetime(2026, 8, 9, 6, 0, tzinfo=timezone.utc)


def _product(run_time, upstream="ecmwf", dataset="ecmwf_wam"):
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    p = NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=run_time, valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False, coverage=cov, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id="gfs_test.json",
    )
    # Optional provenance fields, exactly as the live resolver attaches them.
    p.upstream_provider = upstream
    p.source_dataset = dataset
    return p


class _FakeVP:
    normalizer = None


def _build(resolve, hours="0,3"):
    return asyncio.run(build_grid_series(
        resolve, _FakeVP(), "GFS", "marine", "waves",
        "-82.0,26.0,-78.0,30.0", hours))


def test_series_frames_carry_run_and_upstream_identity():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        return _product(_BASE_RUN)

    resp = _build(resolve)
    assert resp["frame_count"] == 2
    for f in resp["frames"]:
        assert f["run_time"] == "2026-08-09T06:00:00Z"
        assert f["upstream_provider"] == "ecmwf"
        assert f["source_dataset"] == "ecmwf_wam"
        # Absent basis serializes as None, never a KeyError — additive contract.
        assert "estimate_basis" in f and f["estimate_basis"] is None


def test_cycle_identity_survives_product_manifest_sampler_and_series():
    from services.weather_pipeline.store_helpers import _build_manifest_item
    from services.weather_pipeline.sampler import PointSampler
    from services.weather_pipeline.schemas import ManifestProduct, NormalizedPointResponse
    from services.weather_pipeline.grid_series_helper import _frame_provenance
    p = _product(_BASE_RUN)
    p.model_run_time = _BASE_RUN.replace(hour=0)
    p.model_run_time_status = 'known'
    p.ingested_at = _BASE_RUN.replace(hour=8)
    p = NormalizedProduct.model_validate_json(p.model_dump_json())
    manifest = _build_manifest_item(p, 'p.json', .25, False)
    manifest = ManifestProduct.model_validate_json(manifest.model_dump_json())
    sampler = PointSampler()
    responses = [sampler.sample_point(p, 27, -80), sampler.sample_point(p, 80, 0),
                 sampler._build_unavailable_response(p, 27, -80, 'test')]
    for item in [manifest, *responses]:
        assert item.model_run_time == p.model_run_time
        assert item.ingested_at == p.ingested_at
        assert item.model_run_time_status == 'known'
        assert item.run_time == _BASE_RUN, 'legacy storage time must not change during this migration'
    for response in responses:
        assert NormalizedPointResponse.model_validate_json(response.model_dump_json()).model_run_time == p.model_run_time
    frame = _frame_provenance(p)
    assert datetime.fromisoformat(frame['model_run_time']) == p.model_run_time
    assert datetime.fromisoformat(frame['ingested_at']) == p.ingested_at
    async def resolve(**kw):
        return p
    assert all(f['model_run_time_status'] == 'known' for f in _build(resolve)['frames'])


def test_legacy_product_does_not_promote_storage_time_into_a_model_cycle():
    from services.weather_pipeline.grid_series_helper import _frame_provenance
    result = _frame_provenance(_product(_BASE_RUN))
    assert result['model_run_time'] is None
    assert result['model_run_time_status'] == 'missing'


def test_run_census_flags_a_mixed_run_page():
    calls = {"n": 0}

    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        # Second hour resolves from a NEWER run — the mid-ingest interleave, by construction.
        calls["n"] += 1
        return _product(_BASE_RUN + timedelta(hours=6 * (calls["n"] - 1)))

    resp = _build(resolve)
    census = resp["run_census"]
    assert census["mixed_runs"] is True
    assert census["distinct_runs"] == 2
    assert census["min_run_time"] == "2026-08-09T06:00:00Z"
    assert census["max_run_time"] == "2026-08-09T12:00:00Z"


def test_run_census_is_calm_on_a_single_run_page():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        return _product(_BASE_RUN)

    resp = _build(resolve)
    assert resp["run_census"]["mixed_runs"] is False
    assert resp["run_census"]["distinct_runs"] == 1


def test_missing_provenance_stays_additive_none():
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None):
        p = _product(_BASE_RUN)
        # A product with no upstream attribution (e.g. a legacy manifest entry).
        p.upstream_provider = None
        p.source_dataset = None
        return p

    resp = _build(resolve)
    f = resp["frames"][0]
    assert f["upstream_provider"] is None and f["source_dataset"] is None
    # run census still works off run_time alone
    assert resp["run_census"]["distinct_runs"] == 1


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
@pytest.mark.parametrize('bounded', ['0', '1'])
def test_actual_series_http_preserves_refused_read_and_substitute_coverage(monkeypatch, model, bounded):
    from fastapi import FastAPI
    from httpx import ASGITransport, AsyncClient
    from routes import weather
    from services.weather_pipeline import grid_resolver, series_response
    from services.weather_pipeline.grid_response import GridResponseIngress
    from services.weather_pipeline.l2_retry import _stamp
    p = _product(_BASE_RUN)
    p.model = model
    p.partial_coverage = True
    p = _stamp(p, [{'file': 'regional_not_served.json', 'status': 'HTTP 429'}])
    retained = copy.deepcopy(p)
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', bounded)
    monkeypatch.setenv('EURO_SERIES_LIVE_COPERNICUS', '0')
    monkeypatch.setenv('GFS_ICON_SERIES_FASTPATH', '0')
    monkeypatch.setattr(series_response, 'ADMISSION', series_response.SeriesAdmission())

    async def resolve(*args, **kwargs):
        return p

    async def passthrough(product, *args):
        return product

    monkeypatch.setattr(grid_resolver, 'resolve_grid', resolve)
    monkeypatch.setattr('services.weather_pipeline.coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served', passthrough)

    async def run():
        app = FastAPI()
        app.include_router(weather.router, prefix='/api')
        app.add_middleware(GridResponseIngress)
        async with AsyncClient(transport=ASGITransport(app=app), base_url='https://offline.invalid') as client:
            params = dict(model=model, domain='marine', layer='waves', bbox='-82,26,-78,30')
            grid = await client.get('/api/weather/grid', params={**params, 'valid_time': p.valid_time.isoformat()})
            series = await client.get('/api/weather/grid_series', params={**params, 'hours': '0,3'})
            assert grid.status_code == series.status_code == 200
            source = grid.json()
            assert source['fallbackReason'] == 'l2_read_refused' and source['partial_coverage']
            assert len(series.json()['frames']) == 2
            for frame in series.json()['frames']:
                for key in ('warnings', 'fallbackReason', 'partial_coverage'):
                    assert frame.get(key) == source[key], key
                assert frame['vectors'] == source['grid']['vectors']
            assert p == retained
    asyncio.run(run())


def test_fallback_frame_warning_copy_does_not_alias_cached_product():
    from services.weather_pipeline.grid_series_viewport import _frame_provenance
    p = _product(_BASE_RUN)
    p.warnings = ['missing regional coverage']
    p.fallbackReason = 'l2_read_refused'
    receipt = _frame_provenance(p)
    assert receipt.get('warnings') == p.warnings
    receipt['warnings'].append('client-only')
    assert p.warnings == ['missing regional coverage']


def test_clean_frame_does_not_invent_warning_or_fallback_metadata():
    from services.weather_pipeline.grid_series_viewport import _frame_provenance
    receipt = _frame_provenance(_product(_BASE_RUN))
    assert not receipt.get('warnings') and not receipt.get('fallbackReason')
    assert not receipt.get('partial_coverage')


@pytest.mark.parametrize('mutant', [None, 'period', 'direction'])
def test_fallback_receipt_preserves_series_jacobian_and_detects_numeric_mutants(monkeypatch, mutant):
    from services.weather_pipeline import grid_series_helper as helper
    original = helper._frame_provenance
    if mutant:
        def altered(product):
            receipt = original(product)
            if product.warnings:
                receipt['vectors'] = [v.model_copy(update={mutant: getattr(v, mutant) * 1.01}) for v in product.grid.vectors]
            return receipt
        monkeypatch.setattr(helper, '_frame_provenance', altered)

    def sample(state, degraded):
        p = _product(_BASE_RUN)
        p.grid.vectors[0].speed, p.grid.vectors[0].period, p.grid.vectors[0].direction = state
        if degraded:
            p.warnings = ['L2 read refused (HTTP 429)']
            p.fallbackReason = 'l2_read_refused'
            p.partial_coverage = True
        async def resolve(**kwargs):
            return p
        vector = _build(resolve, hours='0')['frames'][0]['vectors'][0]
        return vector.speed, vector.period, vector.direction

    def compare():
        for state in ((.3, 4.5, 7.), (1.25, 11.3, 217.5), (4.7, 17., 359.)):
            before, after = sample(state, False), sample(state, True)
            for column, step in enumerate((.01, .1, 1.)):
                changed = list(state)
                changed[column] += step
                b, a = sample(changed, False), sample(changed, True)
                for output in range(3):
                    assert abs((b[output]-before[output])/step - (a[output]-after[output])/step) < 1e-10
            assert before == after == state
    if mutant:
        with pytest.raises(AssertionError):
            compare()
    else:
        compare()
