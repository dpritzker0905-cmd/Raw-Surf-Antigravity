"""
/grid route resilience — the EURO-wind 500 fix.

EURO wind has no forecast products beyond its latest stale run (manifest: data stops ~17h ago), so
for current valid_times resolve_grid's dynamic-fetch path throws an UNHANDLED exception → FastAPI
emits a bare 500 "Internal Server Error" that carries NO Access-Control-Allow-Origin header → the
browser misreports it as a CORS error and the wind client's safe-zero fallback clears the heatmap.

get_grid now converts any unexpected failure into a graceful no-coverage 404 (CORS-safe; the client
retains the previous frame + retries) while PRESERVING intentional HTTPExceptions (499/503/4xx).
"""
import pytest
from fastapi import HTTPException
from fastapi.testclient import TestClient

from server import app

client = TestClient(app, raise_server_exceptions=False)

GRID = ("/api/weather/grid?model=EURO&domain=wind&layer=wind"
        "&valid_time=2026-06-25T17:00:00.000Z&bbox=-180,-80,180,85")


def test_grid_unhandled_exception_degrades_to_404_not_500(monkeypatch):
    from services.weather_pipeline import grid_resolver

    async def boom(*a, **k):
        raise RuntimeError("simulated EURO wind dynamic-fetch failure")

    monkeypatch.setattr(grid_resolver, "resolve_grid", boom)
    r = client.get(GRID)
    assert r.status_code == 404, r.text          # graceful no-coverage, NOT a bare 500
    body = r.json()
    assert body.get("status") == "error"
    assert body.get("reason") == "no_copernicus_coverage"   # EURO branch of make_no_coverage_grid_response


def test_grid_preserves_intentional_httpexception(monkeypatch):
    from services.weather_pipeline import grid_resolver

    async def busy(*a, **k):
        raise HTTPException(status_code=503, detail="Grid service temporarily unavailable")

    monkeypatch.setattr(grid_resolver, "resolve_grid", busy)
    r = client.get(GRID)
    assert r.status_code == 503, r.text          # intentional status preserved, not masked as 404
    assert "temporarily unavailable" in r.text.lower()
