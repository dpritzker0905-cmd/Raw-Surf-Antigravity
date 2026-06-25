"""
The EURO-wind "heatmap stuck on previous model" root: a hanging open-meteo upstream fetch.

EURO wind (open-meteo ecmwf_ifs) for an uncached wide viewport was hanging ~90s because the dynamic
viewport fetch had a timeout for the Copernicus (EURO marine) path but NOT for the open-meteo path.
Live curl proof: EURO wind /grid with the browser's wrapped zoom-2 bbox returned status=000 after 90s,
while GFS/ICON returned in <0.5s. The hang blocked the worker and the heatmap stayed on the prior
model. This locks in the timeout on the open-meteo path so it fails fast → graceful degradation.
"""
import asyncio
import time

from fastapi.testclient import TestClient

from server import app
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider

client = TestClient(app, raise_server_exceptions=False)


def test_open_meteo_dynamic_fetch_times_out_gracefully(mock_weather_setup, monkeypatch):
    store, dynamic_idx = mock_weather_setup

    async def hang_fetch_grid(*args, **kwargs):
        await asyncio.sleep(10)          # would hang the worker for ~90s in prod
        return [{"hourly": {}}]

    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", hang_fetch_grid)
    monkeypatch.setenv("VIEWPORT_UPSTREAM_TIMEOUT_SEC", "0.3")

    t0 = time.monotonic()
    r = client.get(
        "/api/weather/grid?model=GFS&domain=wind&layer=wind"
        "&valid_time=2026-06-25T12:00:00Z&bbox=-180,-80,180,85"
    )
    elapsed = time.monotonic() - t0

    # Exercised the timeout (waited ~0.3s) but did NOT hang the full 10s.
    assert 0.25 < elapsed < 5.0, f"expected ~0.3s timeout, took {elapsed:.2f}s"
    # Degraded gracefully — never a bare 500 (which would carry no CORS headers).
    assert r.status_code != 500, r.text[:300]
    assert r.status_code in (404, 503, 504), f"got {r.status_code}: {r.text[:200]}"
