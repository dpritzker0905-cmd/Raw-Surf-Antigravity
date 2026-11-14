"""Flip blocker 2 (2026-11-12): the forecast served OUTSIDE /api/weather/ follows the accounts-only rule. /conditions/*
and /tides/* refuse a caller without an account; the spot pages (/explore/spot-details, /explore/surf-spots) answer
without their forecast and compute none; an account gets the RESOLVED tier's model and window (days included)."""
import inspect
from types import SimpleNamespace
from unittest.mock import AsyncMock, Mock

import pytest
from fastapi import FastAPI, Request
from fastapi.testclient import TestClient

from services import forecast_tier_window as FTW
from services import runtime_flags as rf
from services import weather_tier_clamp as C


@pytest.mark.parametrize("path,expected", [
    ("/api/conditions/forecast/s1", (("model", "days"), "refuse")),
    ("/api/conditions/batch", (("model",), "refuse")),
    ("/api/conditions/s1", (("model",), "refuse")),
    ("/api/tides/s1", ((), "refuse")),
    ("/api/explore/spot-details/s1", (("model", "subscription_tier"), "withhold")),
    ("/api/explore/surf-spots", (("model", "subscription_tier"), "withhold")),
    ("/api/weather/point-tide", ((), "refuse")),
    ("/api/weather/grid", (("model", "valid_time"), "refuse")),
    ("/api/surf-conditions", ((), "refuse")),
    ("/api/surf-conditions/", ((), "refuse")),
    ("/api/surf-conditions/known-spots", None),
    ("/api/explore/search", None),
    ("/api/surf-spots/s1", None),
    ("/api/weather/capabilities", None),
])
def test_which_routes_the_clamp_governs(path, expected):
    assert C.gate(path) == expected


def test_days_is_clamped_to_today_plus_the_window():
    cap = FTW.tier_horizon_hours("free", "GFS") // 24 + 1
    assert C.clamp_params([("days", "10")], ("model", "days"), "free")[0] == [("days", str(cap))]
    assert C.clamp_params([], ("model", "days"), "free")[0] == [("days", str(cap))]         # the route default is 10
    assert C.clamp_params([("days", "2")], ("model", "days"), "free") == ([("days", "2")], [])
    for odd in ("x", "10.0", "1e3", ""):                 # FAIL CLOSED: never passed through to the route's own parser
        assert C.clamp_params([("days", odd)], ("model", "days"), "free")[0] == [("days", str(cap))], odd
    premium_cap = FTW.tier_horizon_hours("premium", "EURO") // 24 + 1
    assert premium_cap >= C.FORECAST_DAYS_DEFAULT
    assert C.clamp_params([], ("model", "days"), "premium") == ([], [])


def test_the_days_default_mirror_matches_the_route():
    from routes.surf_data import conditions
    assert inspect.signature(conditions.get_spot_forecast).parameters["days"].default == C.FORECAST_DAYS_DEFAULT


def _client(monkeypatch, on="1"):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(C.FLAG, on)
    monkeypatch.setenv("WEATHER_ACCOUNT_RATE_LIMIT", "0")
    rf._reset_for_tests(lambda: None)
    app = FastAPI()
    seen = {}

    def echo(name):
        async def handler(request: Request):
            seen[name] = dict(request.query_params)
            return {"ok": True}
        return handler

    for path, name in [("/api/conditions/forecast/{sid}", "forecast"), ("/api/conditions/batch", "batch"),
                       ("/api/conditions/{sid}", "now"), ("/api/tides/{sid}", "tides"),
                       ("/api/explore/spot-details/{sid}", "details"), ("/api/explore/surf-spots", "spots"),
                       ("/api/explore/search", "search")]:
        app.add_api_route(path, echo(name), methods=["GET"])

    async def identity(auth):
        return {"Bearer free": ("u-free", "free"), "Bearer prem": ("u-prem", "premium")}.get(auth, (None, "guest"))

    app.add_middleware(C.WeatherTierClampMiddleware, identity_fn=identity)
    return TestClient(app), seen


FREE = {"Authorization": "Bearer free"}
PREM = {"Authorization": "Bearer prem"}


@pytest.mark.parametrize("url", ["/api/conditions/forecast/s1", "/api/conditions/batch?spot_ids=a,b",
                                 "/api/conditions/s1?model=GFS", "/api/tides/s1"])
def test_signed_out_is_refused_on_the_hub_forecast_reads(monkeypatch, url):
    client, seen = _client(monkeypatch)
    r = client.get(url)
    assert r.status_code == 401 and r.headers["x-raw-tier-clamp"] == "account" and not seen
    assert client.get(url, headers=FREE).status_code == 200


def test_an_account_gets_its_own_window_on_the_hub(monkeypatch):
    client, seen = _client(monkeypatch)
    cap = FTW.tier_horizon_hours("free", "GFS") // 24 + 1
    r = client.get("/api/conditions/forecast/s1?model=EURO&days=10", headers=FREE)
    assert seen["forecast"] == {"model": "GFS", "days": str(cap)}
    assert r.headers["cache-control"] == "private, no-store"
    client.get("/api/conditions/forecast/s1?model=EURO", headers=PREM)
    assert seen["forecast"] == {"model": "EURO"}
    client.get("/api/conditions/batch?spot_ids=a&model=ICON", headers=FREE)
    assert seen["batch"] == {"spot_ids": "a", "model": "GFS"}


def test_spot_pages_answer_signed_out_without_the_forecast_and_privately(monkeypatch):
    client, seen = _client(monkeypatch)
    r = client.get("/api/explore/spot-details/s1?subscription_tier=premium&model=EURO&subscription_tier=pro")
    assert r.status_code == 200
    assert seen["details"] == {"model": "EURO", "subscription_tier": C.SIGNED_OUT}   # the route withholds for it
    assert r.headers["cache-control"] == "private, no-store" and "Authorization" in r.headers["vary"]
    client.get("/api/explore/surf-spots?limit=5")
    assert seen["spots"]["subscription_tier"] == C.SIGNED_OUT
    client.get("/api/explore/spot-details/s1?subscription_tier=premium&model=EURO", headers=FREE)
    assert seen["details"] == {"model": "GFS", "subscription_tier": "free"}          # the RESOLVED tier, not the asserted


def test_routes_outside_the_hub_and_the_switch_off_are_untouched(monkeypatch):
    client, seen = _client(monkeypatch)
    r = client.get("/api/explore/search?q=x")
    assert r.status_code == 200 and "x-raw-tier-clamp-on" not in r.headers
    client, seen = _client(monkeypatch, on="0")
    assert client.get("/api/tides/s1").status_code == 200
    client.get("/api/explore/spot-details/s1?subscription_tier=guest")
    assert seen["details"] == {"subscription_tier": "guest"}


def _db():
    spot = SimpleNamespace(id="s1", name="Known beach", region="Coast", difficulty="intermediate", image_url=None,
                           latitude=28.4, longitude=-80.6, description="d", best_tide=None)
    first = Mock()
    first.scalar_one_or_none.return_value = spot
    empty = Mock()
    empty.scalars.return_value.all.return_value = []
    return SimpleNamespace(execute=AsyncMock(side_effect=[first, empty, empty, empty, empty]))


@pytest.mark.asyncio
async def test_spot_details_signed_out_computes_no_forecast_and_sends_none(monkeypatch):
    from routes.explore_discover import spot_details as route
    resolver = AsyncMock(return_value={"current_conditions": {"wave_height_ft": 3}, "forecast": [{"date": "d"}]})
    monkeypatch.setattr(route.point_resolution_service, "resolve_spot_conditions", resolver)
    out = await route.get_spot_details("s1", subscription_tier=C.SIGNED_OUT, model="GFS", db=_db())
    assert resolver.await_count == 0
    assert out["name"] == "Known beach" and out["current_conditions"] is None and out["forecast"] == []
    assert out["forecast_status"] == "sign_in_required" and out["forecast_days_allowed"] == 0
    out = await route.get_spot_details("s1", subscription_tier="free", model="GFS", db=_db())
    assert resolver.await_count == 1 and out["current_conditions"] == {"wave_height_ft": 3}


FORECAST_CALLS = ("resolve_spot_conditions", "pipeline_current_conditions", "get_full_conditions", "rate_one_spot(",
                  "estimate_surf_at(", "compute_surf_rating(", "fetch_marine_conditions(", "PointResolutionService")
# Public GETs that live in a forecast-computing MODULE but serve no forecast, each with its reason. Adding a route here is
# a review decision: it must not return heights, ratings, conditions or tides.
NOT_FORECAST = {
    "/api/photographer-requests/active": "marketplace requests (alerts.py also runs the alert check)",
    "/api/photographer-requests/my-requests": "marketplace requests",
    "/api/photographer-requests/x": "marketplace request detail",
    "/api/explore/search": "spots, users and posts by name",
    "/api/explore/trending": "posts",
    "/api/surf-conditions/known-spots": "static spot names and coordinates (HUB_PUBLIC)",
    "/api/surf-spots/x/live-shooting-pulse": "live photographer activity",
    "/api/weather/products": "product inventory (public by design: run ages, census jobs)",
    "/api/weather/buoy-calibration": "calibration statistics",
    "/api/weather/report-calibration": "calibration statistics",
    "/api/weather/status": "service status (the client reads the switch from it)",
    "/api/weather/capabilities": "horizons and the `tier_clamp` switch (the client reads it before signing in)",
    "/api/weather/diagnostics-log": "client diagnostics sink",
}


def _public_get_routes_in_forecast_modules():
    """Every public GET of the real app defined in a module that computes a forecast, conditions or a rating anywhere
    (handler OR helper: the spot pages compute in helpers), so a sibling route cannot hide behind a helper."""
    import re
    import sys
    import server
    from fastapi.routing import APIRoute
    out = []
    for r in server.app.routes:
        if not isinstance(r, APIRoute) or "GET" not in r.methods or r.path.startswith("/api/admin"):
            continue
        if not any(m in inspect.getsource(sys.modules[r.endpoint.__module__]) for m in FORECAST_CALLS):
            continue
        src = inspect.getsource(r.endpoint)
        if "get_current_user_id" in src or "require_admin" in src:   # strict identity already: not a public read
            continue
        out.append(re.sub(r"\{[^}]+\}", "x", r.path))
    return out


def test_every_public_get_route_that_computes_a_forecast_is_governed():
    """Security review 2026-11-12 (sibling-path parity): a forecast route outside the clamp's table would be a way
    around the accounts-only rule. Every public GET in a forecast-computing module is gated, or named in NOT_FORECAST."""
    routes = _public_get_routes_in_forecast_modules()
    for must in ("/api/conditions/forecast/x", "/api/surf-conditions", "/api/explore/spot-details/x",
                 "/api/explore/surf-spots", "/api/weather/grid_series", "/api/weather/point"):
        assert must in routes, must                                 # positive control: the sweep sees the hub
    ungated = sorted(p for p in routes if C.gate(p) is None and p not in NOT_FORECAST)
    assert ungated == [], ungated
    assert not [p for p in NOT_FORECAST if C.gate(p) is not None]   # an exemption that is gated is stale


def test_surf_spots_signed_out_fetches_no_conditions_and_withholds():
    from routes.explore_discover import explore
    src = inspect.getsource(explore.get_surf_spots_with_conditions)
    assert "conditions_tasks = [] if signed_out else" in src
    assert "if signed_out:\n            withhold_signed_out(spot_data)" in src
