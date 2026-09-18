"""Exercise supplier timeout ownership without importing server integrations."""
import asyncio
from types import SimpleNamespace

import pytest

from services.weather_pipeline.phase_timing import trace_series_phases
from services.weather_pipeline.viewport_upstream import fetch_upstream_raw


@pytest.mark.parametrize('model', ['GFS', 'ICON', 'EURO'])
@pytest.mark.parametrize('domain,layer', [('wind', 'wind'), ('weather', 'pressure')])
def test_stalled_supplier_is_cancelled_within_viewport_budget(model, domain, layer, monkeypatch):
    monkeypatch.setenv('VIEWPORT_UPSTREAM_TIMEOUT_SEC', '0.02')
    monkeypatch.setenv('EURO_WIND_UPSTREAM_TIMEOUT_SEC', '0.02')
    cancelled = []

    class Provider:
        async def fetch_grid(self, **kwargs):
            try:
                await asyncio.Event().wait()
            finally:
                cancelled.append(True)

    @trace_series_phases
    async def request():
        result = await fetch_upstream_raw(
            SimpleNamespace(provider=Provider()), model, domain, layer,
            '2026-09-17T12:00:00Z', -90, 12, -89, 13, 1, False, 1,
        )
        return {'upstream': result}

    async def run():
        # The outer bound makes a missing production timeout fail instead of hang.
        return await asyncio.wait_for(request(), timeout=1)

    result = asyncio.run(run())
    raw, resolution, count, bbox = result['upstream']
    assert raw is None
    assert cancelled == [True]
    assert resolution == 1 and count == 4
    assert bbox == {'west': -90, 'south': 12, 'east': -89, 'north': 13}
    phase = result['timing']['phases']['viewport_upstream']
    assert phase['calls'] == 1
    # The dispatcher handles its timeout; this counter describes escaped errors.
    assert phase['failed_or_cancelled'] == 0
    assert 0 < phase['sum_ms'] < 1000
