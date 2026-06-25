"""
EURO wind → GFS fallback (the "EURO wind heatmap never activates" fix).

EURO wind (ecmwf_ifs) has no fresh global product and its on-demand open-meteo fetch fails for the
current horizon — live curl: every EURO wind hour past the stale product returned 500 (no CORS) while
GFS wind returned 200. EURO MARINE already falls back to GFS when Copernicus fails; EURO WIND did not,
so it 500'd and the heatmap never activated. This gives EURO wind the same GFS fallback so it always
shows real wind data.
"""
from datetime import datetime, timezone

from fastapi.testclient import TestClient

from server import app
from routes import weather
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)

client = TestClient(app, raise_server_exceptions=False)


def _gfs_wind_product(target_dt):
    bounds = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
    vectors = [
        GridVector(lat=0.0, lng=-180.0, speed=10.0, direction=90.0, u=-10.0, v=0.0),
        GridVector(lat=0.0, lng=0.0, speed=12.0, direction=90.0, u=-12.0, v=0.0),
    ]
    grid = NormalizedGrid(bounds=bounds, cols=2, rows=1, vectors=vectors)
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="wind", layer="wind",
        run_time=target_dt, valid_time=target_dt, is_forecast_authoritative=True,
        is_estimated=False, coverage=bounds, grid=grid,
        value_kind="wind_speed", value_unit="kn", display_unit_hint="kn",
        source_variables=["wind_speed_10m"], freshness_sec=1800,
    )


def test_euro_wind_falls_back_to_gfs(mock_weather_setup, monkeypatch):
    store, dynamic_idx = mock_weather_setup

    async def mock_fetch(model=None, domain=None, layer=None, valid_time_str=None, target_dt=None, bbox_str=None, **kwargs):
        if str(model).upper() == "EURO":
            raise Exception("simulated EURO wind upstream failure")
        return _gfs_wind_product(target_dt or datetime(2026, 6, 25, 20, 0, 0, tzinfo=timezone.utc))

    monkeypatch.setattr(weather.viewport_service, "fetch_viewport_grid_upstream", mock_fetch)

    r = client.get(
        "/api/weather/grid?model=EURO&domain=wind&layer=wind"
        "&valid_time=2026-06-25T20:00:00Z&bbox=-180,-80,180,85"
    )
    assert r.status_code == 200, r.text[:400]      # NOT a 500
    j = r.json()
    assert j["model"] == "EURO"                    # relabeled EURO
    assert j["provider"] == "gfs_fallback"         # honest provenance
    assert len(j["grid"]["vectors"]) > 0           # real wind data
