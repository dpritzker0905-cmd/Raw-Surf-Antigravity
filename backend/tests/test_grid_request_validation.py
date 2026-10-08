"""PF03/LIVE04/WS01/SV08: refuse impossible requests before upstream amplification.

The HTTP router, real resolver and real series builder run; only storage/upstream
I/O is substituted. Positive requests must still reach that same upstream seam.
"""
import asyncio
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import httpx
import pytest
from fastapi import FastAPI

from routes import weather
from services.weather_pipeline import grid_response, series_response
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct


BOX = '-82,26,-78,30'


class Upstream:
    normalizer = None

    def __init__(self):
        self.fetches = []
        self.reads = 0
        self.state = (1.25, None, 217.5)

    def get_manifest(self):
        self.reads += 1
        return SimpleNamespace(products=[])

    def is_viewport_enabled(self, *args, **kwargs):
        return True

    async def get_cached_dynamic_product(self, **kwargs):
        return None

    def _find_any_cached_product(self, *args, **kwargs):
        return None

    async def fetch_viewport_grid_upstream(self, **kwargs):
        self.fetches.append(kwargs)
        bounds = CoverageBounds(west=-82, south=26, east=-78, north=30)
        return NormalizedProduct(
            model=kwargs['model'], domain=kwargs['domain'], layer=kwargs['layer'],
            provider='open-meteo', run_time=kwargs['target_dt'], valid_time=kwargs['target_dt'],
            coverage=bounds, is_forecast_authoritative=True, is_estimated=False,
            grid=NormalizedGrid(bounds=bounds, cols=1, rows=1,
                                vectors=[GridVector(lat=27, lng=-80, speed=self.state[0],
                                                    period=self.state[1], direction=self.state[2])]),
            value_kind='wave_height', value_unit='m', display_unit_hint='ft',
            freshness_sec=1800, source_variables=[], product_id='offline.json')


@pytest.fixture
def upstream(monkeypatch):
    seam = Upstream()
    monkeypatch.setattr(weather, 'store', seam)
    monkeypatch.setattr(weather, 'viewport_service', seam)
    monkeypatch.setenv('GFS_ICON_SERIES_FASTPATH', '0')
    monkeypatch.setenv('EURO_SERIES_LIVE_COPERNICUS', '0')
    monkeypatch.setenv('GRID_SERIES_RESPONSE_BOUNDS', '0')
    monkeypatch.setattr(series_response, 'ADMISSION', series_response.SeriesAdmission())
    # This unrelated Gulf companion is not the request validation boundary.
    async def retain(product, *args):
        return product
    monkeypatch.setattr('services.weather_pipeline.coarse_gulf_fill.fill_coarse_enclosed_sea_from_gfs_served', retain)
    return seam


def request(route, params):
    async def run():
        app = FastAPI()
        app.include_router(weather.router, prefix='/api')
        app.add_middleware(grid_response.GridResponseIngress)
        async with httpx.AsyncClient(transport=httpx.ASGITransport(app=app), base_url='https://offline.invalid') as client:
            return await client.get('/api/weather/' + route, params=params)
    return asyncio.run(run())


def params(route, *, bbox=BOX, hour=0, model='GFS', domain='marine', layer='waves'):
    result = dict(model=model, domain=domain, layer=layer, bbox=bbox)
    if route == 'grid':
        result['valid_time'] = (datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
                                + timedelta(hours=hour)).isoformat()
    else:
        result['hours'] = str(hour)
    return result


@pytest.mark.parametrize('bounded', ['0', '1'])
@pytest.mark.parametrize('route', ['grid', 'grid_series'])
@pytest.mark.parametrize('bbox', ['-82,-91,-78,30', '-82,26,-78,91', '-82,30,-78,26'])
def test_invalid_latitudes_refuse_before_storage_or_upstream(upstream, monkeypatch, route, bbox, bounded):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', bounded)
    response = request(route, params(route, bbox=bbox))
    assert response.status_code == 400, (response.status_code, len(upstream.fetches))
    assert upstream.fetches == [] and upstream.reads == 0


@pytest.mark.parametrize('bounded', ['0', '1'])
@pytest.mark.parametrize('route', ['grid', 'grid_series'])
def test_far_future_refuses_before_any_work(upstream, monkeypatch, route, bounded):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', bounded)
    query = params(route, hour=5000)
    if route == 'grid_series':
        query['hours'] = ','.join(str(h) for h in range(5000, 5048))
    response = request(route, query)
    assert response.status_code == 400, (response.status_code, len(upstream.fetches))
    assert upstream.fetches == [] and upstream.reads == 0


@pytest.mark.parametrize('route', ['grid', 'grid_series'])
@pytest.mark.parametrize('bbox', [BOX, '170,-20,-170,20', '-200,-20,-190,20', '-180,-90,180,90'])
def test_valid_regional_dateline_unwrapped_and_world_bounds_reach_upstream(upstream, monkeypatch, route, bbox):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
    response = request(route, params(route, bbox=bbox))
    assert response.status_code == 200, response.text[:300]
    assert len(upstream.fetches) == 1
    vector = response.json()['grid']['vectors'][0] if route == 'grid' else response.json()['frames'][0]['vectors'][0]
    assert (vector['speed'], vector['period'], vector['direction']) == (1.25, None, 217.5)


@pytest.mark.parametrize('route', ['grid', 'grid_series'])
@pytest.mark.parametrize('model,horizon', [('GFS', 384), ('EURO', 336), ('ICON', 336)])
def test_advertised_horizon_edge_remains_servable(upstream, monkeypatch, route, model, horizon):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
    response = request(route, params(route, model=model, hour=horizon))
    assert response.status_code == 200 and len(upstream.fetches) == 1


def test_historical_grid_replay_remains_servable(upstream, monkeypatch):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
    query = params('grid')
    query['valid_time'] = '2026-08-09T06:00:00Z'
    assert request('grid', query).status_code == 200
    assert len(upstream.fetches) == 1


@pytest.mark.parametrize('route', ['grid', 'grid_series'])
@pytest.mark.parametrize('model,horizon', [('GFS', 384), ('EURO', 336), ('ICON', 336)])
def test_beyond_model_horizon_refuses_without_fetch(upstream, monkeypatch, route, model, horizon):
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
    assert request(route, params(route, model=model, hour=horizon + 2)).status_code == 400
    assert upstream.fetches == [] and upstream.reads == 0


@pytest.mark.parametrize('hours', ['0,5000', str(-(10**30))])
def test_invalid_page_is_refused_atomically_including_datetime_overflow(upstream, hours):
    query = params('grid_series')
    query['hours'] = hours
    assert request('grid_series', query).status_code == 400
    assert upstream.fetches == [] and upstream.reads == 0


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
def test_invalid_series_cannot_enter_either_fast_path(upstream, monkeypatch, model):
    from services.weather_pipeline import grid_series_helper as helper
    monkeypatch.setenv('GFS_ICON_SERIES_FASTPATH', '1')
    monkeypatch.setenv('EURO_SERIES_LIVE_COPERNICUS', '1')
    async def forbidden(*args, **kwargs):
        raise AssertionError('invalid page entered a fast path')
    monkeypatch.setattr(helper, '_build_euro_marine_series', forbidden)
    monkeypatch.setattr(helper, '_build_openmeteo_marine_series', forbidden)
    assert request('grid_series', params('grid_series', model=model, hour=5000)).status_code == 400
    assert upstream.fetches == [] and upstream.reads == 0


@pytest.mark.parametrize('minute', [0, 29, 30, 59])
def test_clock_rounding_and_layer_specific_horizon(minute):
    from fastapi import HTTPException
    from services.weather_pipeline.grid_request_validation import validate_grid_time
    now = datetime(2026, 10, 8, 12, minute, tzinfo=timezone.utc)
    edge = now.replace(minute=0) + timedelta(hours=168 + (1 if minute else 0))
    validate_grid_time('ICON', 'weather', 'precipitation', edge, now=now)
    with pytest.raises(HTTPException) as refused:
        validate_grid_time('ICON', 'weather', 'precipitation', edge + timedelta(seconds=1), now=now)
    assert refused.value.status_code == 400
    # Timezone notation changes no instant; an offset must not evade admission.
    with pytest.raises(HTTPException):
        validate_grid_time('ICON', 'weather', 'precipitation',
                           (edge + timedelta(seconds=1)).astimezone(timezone(timedelta(hours=-4))), now=now)


@pytest.mark.parametrize('mutant', [None, 'period', 'direction'])
def test_admitted_http_grid_and_series_physical_jacobians_match(upstream, monkeypatch, mutant):
    from services.weather_pipeline import grid_series_helper as helper
    monkeypatch.setenv('GRID_RESPONSE_BOUNDS', '0')
    if mutant:
        original = helper._frame_provenance
        def altered(product):
            receipt = original(product)
            receipt['vectors'] = [v.model_copy(update={mutant: getattr(v, mutant) * 1.01})
                                  for v in product.grid.vectors]
            return receipt
        monkeypatch.setattr(helper, '_frame_provenance', altered)

    def sample(state, route):
        upstream.state = state
        response = request(route, params(route))
        assert response.status_code == 200
        vector = response.json()['grid']['vectors'][0] if route == 'grid' else response.json()['frames'][0]['vectors'][0]
        return tuple(vector[key] for key in ('speed', 'period', 'direction'))

    def compare():
        for state in ((.3, 4.5, 7.), (1.25, 11.3, 217.5), (4.7, 17., 359.)):
            before, after = sample(state, 'grid'), sample(state, 'grid_series')
            for column, step in enumerate((.01, .1, 1.)):
                changed = list(state)
                changed[column] += step
                b, a = sample(changed, 'grid'), sample(changed, 'grid_series')
                for output in range(3):
                    assert abs((b[output] - before[output])/step - (a[output] - after[output])/step) < 1e-10
            assert before == after == state
    if mutant:
        with pytest.raises(AssertionError):
            compare()
    else:
        compare()
