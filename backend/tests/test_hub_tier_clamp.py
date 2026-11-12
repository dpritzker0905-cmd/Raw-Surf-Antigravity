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
    assert C.clamp_params([("days", "x")], ("model", "days"), "free") == ([("days", "x")], [])  # the route rejects it
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


def test_surf_spots_signed_out_fetches_no_conditions_and_withholds():
    from routes.explore_discover import explore
    src = inspect.getsource(explore.get_surf_spots_with_conditions)
    assert "conditions_tasks = [] if signed_out else" in src
    assert "if signed_out:\n            withhold_signed_out(spot_data)" in src
