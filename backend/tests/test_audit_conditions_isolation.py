"""Perturb only the optional preview; the valid current answer must survive."""
import asyncio
import importlib.util
from pathlib import Path
from types import SimpleNamespace

import pytest
from fastapi import FastAPI, HTTPException
from fastapi.testclient import TestClient


@pytest.fixture
def conditions(monkeypatch):
    path = Path(__file__).parents[1] / 'routes/surf_data/conditions.py'
    spec = importlib.util.spec_from_file_location('audit_conditions_routes', path)
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    current = dict(wave_height_ft=3.5, wave_direction=90, wave_period=10,
                   swell_height_ft=2.8, swell_direction=85, label='Waist high',
                   updated_at='2026-10-02T12:00:00Z', rating=72)

    async def resolve(**kwargs):
        return {'current_conditions': current.copy()}

    class Database:
        async def execute(self, statement):
            return SimpleNamespace(scalar_one_or_none=lambda: SimpleNamespace(
                latitude=28.369, longitude=-80.603, name='Synthetic surf spot'))

    async def database():
        yield Database()

    monkeypatch.setattr(module.point_resolution_service, 'resolve_spot_conditions', resolve)
    app = FastAPI()
    app.include_router(module.router, prefix='/api')
    app.dependency_overrides[module.get_db] = database
    with TestClient(app) as client:
        yield module, client


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
@pytest.mark.parametrize('failure', ['exception', 'rate_limit', 'timeout', 'malformed'])
def test_optional_preview_failure_preserves_current(conditions, monkeypatch, model, failure):
    module, client = conditions

    async def fetch(**kwargs):
        if failure == 'exception':
            raise RuntimeError('Synthetic provider outage')
        if failure == 'rate_limit':
            raise HTTPException(429, 'Synthetic provider rate limit')
        if failure == 'timeout':
            await asyncio.sleep(0.03)
            return {'hourly': {}}
        return {'hourly': {'time': ['2026-10-02T12:00'], 'wave_height': ['invalid']}}

    monkeypatch.setattr(module, 'CONDITIONS_PREVIEW_TIMEOUT_SECONDS', 0.005, raising=False)
    monkeypatch.setattr(module.point_resolution_service.provider, 'fetch_point', fetch)
    response = client.get('/api/conditions/synthetic?model=' + model)
    assert response.status_code == 200
    body = response.json()
    assert body['current']['wave_height_ft'] == 3.5
    assert body['current']['rating'] == 72
    assert body['current']['updated_at'] == '2026-10-02T12:00:00Z'
    assert body['forecast'] == []
    assert body['forecast_status'] == 'unavailable'


def test_preview_success_uses_breaking_forecast(conditions, monkeypatch):
    module, client = conditions
    async def fetch(**kwargs):
        return {'hourly': {'time': [f'2026-10-02T{h:02}:00' for h in range(12, 20)],
                           'wave_height': [1.0] * 8, 'wave_period': [10.0] * 8,
                           'wave_direction': [90.0] * 8}}
    monkeypatch.setattr(module.point_resolution_service.provider, 'fetch_point', fetch)
    response = client.get('/api/conditions/synthetic')
    assert response.status_code == 200
    body = response.json()
    assert body['current']['wave_height_ft'] == 3.5
    assert len(body['forecast']) == 6
    assert body['forecast'][0]['wave_height_ft'] > 0
    assert body['forecast_status'] == 'available'


def test_current_resolution_failure_still_fails(conditions, monkeypatch):
    module, client = conditions
    async def resolve(**kwargs):
        raise RuntimeError('Synthetic current resolution failure')
    monkeypatch.setattr(module.point_resolution_service, 'resolve_spot_conditions', resolve)
    response = client.get('/api/conditions/synthetic')
    assert response.status_code == 502
    assert response.json() == {'detail': 'Unable to fetch conditions'}
