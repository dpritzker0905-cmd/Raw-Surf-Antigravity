"""WS-08: reject impossible public point coordinates before invoking the resolver.

Drive the real HTTP router, with a recording resolver at the provider-work boundary.
Valid poles, dateline endpoints and owner Gulf coordinates are positive controls.
"""
from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

import routes.weather as weather


LANES = [
    ("GFS", "marine", "waves"),
    ("GFS", "wind", "wind"),
    ("EURO", "weather", "pressure"),
    ("CONSENSUS", "marine", "waves"),
]
INVALID = [("lat", value) for value in
           ("95", "-91", "90.000001", "-90.000001", "nan", "inf", "-inf", "1e309")]
INVALID += [("lng", value) for value in
            ("280", "-181", "180.000001", "-180.000001", "nan", "inf", "-inf", "1e309")]
VALID = [(0, 0), (90, 180), (-90, -180), (90, -180), (-90, 180), (30.04, -87.41)]


@pytest.fixture
def point_client(monkeypatch):
    calls = []

    async def resolve(**kwargs):
        calls.append(kwargs)
        return JSONResponse({"lat": kwargs["lat"], "lng": kwargs["lng"],
                             "source": "offline_fixture", "product_id": None})

    monkeypatch.setattr(weather, "point_resolution_service", SimpleNamespace(resolve_point=resolve))
    app = FastAPI()
    app.include_router(weather.router, prefix="/api")
    with TestClient(app, raise_server_exceptions=False) as client:
        yield client, calls


def params(lane, lat=30.04, lng=-87.41):
    model, domain, layer = lane
    return {"model": model, "domain": domain, "layer": layer, "lat": lat, "lng": lng,
            "valid_time": "2026-10-09T00:00:00Z",
            "grid_product_id": f"{model.lower()}_{domain}_{layer}_global_coarse_20261009T000000Z.json",
            "grid_bbox": "-90,20,-80,35"}


@pytest.mark.parametrize("lane", LANES)
@pytest.mark.parametrize("axis,value", INVALID)
def test_invalid_coordinates_never_reach_resolver(point_client, lane, axis, value):
    client, calls = point_client
    request = params(lane)
    request[axis] = value
    response = client.get("/api/weather/point", params=request)
    assert response.status_code == 422, response.text
    assert calls == [], "invalid coordinates reached provider/grid resolution"
    assert any(error["loc"] == ["query", axis] for error in response.json()["detail"])


@pytest.mark.parametrize("lane", LANES)
@pytest.mark.parametrize("lat,lng", VALID)
def test_valid_coordinates_and_identity_forward_unchanged(point_client, lane, lat, lng):
    client, calls = point_client
    request = params(lane, lat, lng)
    response = client.get("/api/weather/point", params=request)
    assert response.status_code == 200, response.text
    assert (response.json()["lat"], response.json()["lng"]) == (lat, lng)
    assert calls == [{**{key: value for key, value in request.items() if key != "valid_time"},
                      "valid_time_str": request["valid_time"]}]
