"""O5 / TIER-1: the server clamps forecast reads to the caller's tier, using ONLY the resolver's pinned echo.

Acceptance (ADVICE-OPUS-SONNET.md O5): a guest request for hour 336 or EURO returns the clamped answer; the server
table is the client table (test_forecast_tier_window.py pins forecast_tier_window to LayerAccessResolver.js and this
file pins that the clamp adds no number of its own); __FORCE_PREMIUM_TIER__ no longer grants data, because the server
decides from a verified JWT, never from the client.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest
from fastapi import FastAPI, Request
from fastapi.responses import JSONResponse
from fastapi.testclient import TestClient

from services import forecast_tier_window as FTW
from services import runtime_flags as rf
from services import weather_tier_clamp as C

NOW = datetime(2026, 11, 11, 10, 17, tzinfo=timezone.utc)
SERIES = ("model", "hours")
GRID = ("model", "valid_time")


def _q(params):
    return dict(params)


# ── the pure clamp ────────────────────────────────────────────────────────────────────────────────────────────────────
def test_guest_asking_for_euro_at_hour_336_gets_gfs_inside_its_window():
    out, changed = C.clamp_params([("model", "EURO"), ("hours", "0,3,336")], SERIES, "guest", NOW)
    h = FTW.tier_horizon_hours("guest", "GFS")
    assert _q(out) == {"model": "GFS", "hours": f"0,3,{h}"} and h == 72
    assert set(changed) == {"model", "hours"}


def test_premium_is_untouched_inside_its_window():
    h = FTW.tier_horizon_hours("premium", "EURO")
    params = [("model", "EURO"), ("hours", f"0,24,{h}")]
    assert C.clamp_params(params, SERIES, "premium", NOW) == (params, [])


@pytest.mark.parametrize("tier", ["guest", "free", "basic", "premium"])
def test_every_tier_window_is_the_resolvers_window(tier):
    """No second ladder: the clamp edge IS forecast_tier_window's horizon and model list, for every tier and model."""
    for model in C.TIER_MODELS:
        out, _ = C.clamp_params([("model", model), ("hours", "0,999")], SERIES, tier, NOW)
        m = _q(out)["model"]
        assert (m == model) == (model in FTW.allowed_models(tier))
        assert _q(out)["hours"] == f"0,{FTW.tier_horizon_hours(tier, m)}"


def test_the_clamp_follows_the_echo_when_the_echo_changes(monkeypatch):
    monkeypatch.setitem(FTW.TIER_FORECAST_DAYS, "guest", 5)
    out, _ = C.clamp_params([("model", "GFS"), ("hours", "999")], SERIES, "guest", NOW)
    assert _q(out)["hours"] == str(min(5 * 24, FTW.tier_horizon_hours("premium", "GFS")))


def test_valid_time_beyond_the_window_is_pulled_to_its_edge():
    far = (NOW + timedelta(days=10)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out, changed = C.clamp_params([("model", "GFS"), ("valid_time", far)], GRID, "guest", NOW)
    assert _q(out)["valid_time"] == "2026-11-14T10:00:00Z" and changed == ["valid_time"]
    near = (NOW + timedelta(hours=5)).strftime("%Y-%m-%dT%H:%M:%SZ")
    assert C.clamp_params([("model", "GFS"), ("valid_time", near)], GRID, "guest", NOW)[1] == []


def test_consensus_and_malformed_values_are_left_to_the_route():
    assert C.clamp_params([("model", "CONSENSUS"), ("valid_time", "2026-11-11T12:00Z")], GRID, "guest", NOW)[1] == []
    assert C.clamp_params([("model", "GFS"), ("hours", "a,b")], SERIES, "guest", NOW)[1] == []
    assert C.clamp_params([("model", "GFS"), ("valid_time", "not-a-time")], GRID, "guest", NOW)[1] == []


def test_spot_series_tier_is_the_resolved_one_not_the_asserted_one():
    out, changed = C.clamp_params([("model", "GFS"), ("subscription_tier", "premium")], ("model", "subscription_tier"),
                                  "guest", NOW)
    assert _q(out)["subscription_tier"] == "guest" and "subscription_tier" in changed


def test_routes_covered():
    for path in ("/api/weather/grid_series", "/api/weather/grid", "/api/weather/point", "/api/weather/spot-ratings",
                 "/api/weather/point-rating", "/api/weather/spot-series/abc"):
        assert C.route_params(path) is not None, path
    for path in ("/api/weather/capabilities", "/api/weather/status", "/api/health", "/api/weather/point-tide"):
        assert C.route_params(path) is None, path


# ── who is asking ─────────────────────────────────────────────────────────────────────────────────────────────────────
def test_identity_is_strict_and_fails_closed(monkeypatch):
    import core.security as sec

    async def uid(authorization=None):
        return {"Bearer good": "u1", "Bearer admin": "u2"}.get(authorization)

    monkeypatch.setattr(sec, "get_optional_user_id", uid)
    C._tier_cache.clear()
    tiers = {"u1": "surfer_premium", "u2": None}
    calls = []

    async def lookup(u):
        calls.append(u)
        return tiers[u]

    run = asyncio.run
    assert run(C.resolve_tier(None, lookup)) == "guest"
    assert run(C.resolve_tier("Bearer forged", lookup)) == "guest"
    assert run(C.resolve_tier("Bearer good", lookup)) == "premium"
    assert run(C.resolve_tier("Bearer good", lookup)) == "premium" and calls == ["u1"]        # cached
    assert run(C.resolve_tier("Bearer admin", lookup)) == "guest"                              # no tier = guest

    async def broken(u):
        raise RuntimeError("db down")

    C._tier_cache.clear()
    assert run(C.resolve_tier("Bearer good", broken)) == "guest"


# ── the middleware, end to end on an echo app ─────────────────────────────────────────────────────────────────────────
def _client(monkeypatch, on=True, tier="guest"):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(C.FLAG, "1" if on else "0")
    rf._reset_for_tests(lambda: None)
    app = FastAPI()

    @app.get("/api/weather/grid_series")
    async def series(request: Request):
        return JSONResponse(dict(request.query_params), headers={"Cache-Control": "public, max-age=60"})

    async def tier_fn(auth):
        return tier

    app.add_middleware(C.WeatherTierClampMiddleware, tier_fn=tier_fn)
    return TestClient(app)


def test_guest_gets_the_clamped_answer_and_it_is_never_shared_cached(monkeypatch):
    r = _client(monkeypatch).get("/api/weather/grid_series?model=EURO&hours=0,336")
    assert r.json() == {"model": "GFS", "hours": "0,72"}
    assert r.headers["x-raw-tier-clamp"] == "hours,model"
    assert r.headers["cache-control"] == "private, no-store" and "Authorization" in r.headers["vary"]


def test_premium_beyond_the_guest_window_is_served_but_private(monkeypatch):
    r = _client(monkeypatch, tier="premium").get("/api/weather/grid_series?model=EURO&hours=0,120")
    assert r.json() == {"model": "EURO", "hours": "0,120"} and "x-raw-tier-clamp" not in r.headers
    assert r.headers["cache-control"] == "private, no-store"          # a shared cache must not hand this to a guest


def test_inside_the_guest_window_the_route_keeps_its_cache_headers(monkeypatch):
    r = _client(monkeypatch).get("/api/weather/grid_series?model=GFS&hours=0,3")
    assert r.json() == {"model": "GFS", "hours": "0,3"} and r.headers["cache-control"] == "public, max-age=60"


def test_held_off_nothing_changes(monkeypatch):
    r = _client(monkeypatch, on=False).get("/api/weather/grid_series?model=EURO&hours=0,336")
    assert r.json() == {"model": "EURO", "hours": "0,336"} and r.headers["cache-control"] == "public, max-age=60"


def test_held_off_by_default(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.delenv(C.FLAG, raising=False)
    rf._reset_for_tests(lambda: None)
    assert rf.GUARDED[C.FLAG] == "0" and not C.enabled()


def test_the_server_registers_the_middleware():
    import server
    assert any(m.cls is C.WeatherTierClampMiddleware for m in server.app.user_middleware)


def test_head_is_clamped_like_get(monkeypatch):
    r = _client(monkeypatch).head("/api/weather/grid_series?model=EURO&hours=0,336")
    assert r.headers["x-raw-tier-clamp"] == "hours,model" and r.headers["cache-control"] == "private, no-store"


def test_duplicate_params_are_judged_on_the_value_the_route_reads():
    """Security review: FastAPI serves the LAST value of a repeated scalar; the clamp must judge that one."""
    out, changed = C.clamp_params([("model", "GFS"), ("model", "EURO"), ("hours", "0"), ("hours", "0,336")],
                                  SERIES, "guest", NOW)
    assert out == [("model", "GFS"), ("hours", "0,72")] and "model" in changed and "duplicate" in changed


def test_a_future_base_time_cannot_stretch_the_guest_window():
    """Security review: /grid_series honours base_time up to 26 h ahead; offsets are capped so anchor + offset stays
    inside now + window."""
    anchor = (NOW + timedelta(hours=20)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out, _ = C.clamp_params([("model", "GFS"), ("hours", "0,72"), ("base_time", anchor)], SERIES, "guest", NOW)
    assert _q(out)["hours"] == "0,52"
    far = (NOW + timedelta(hours=40)).strftime("%Y-%m-%dT%H:%M:%SZ")      # the route ignores it (server anchor)
    assert _q(C.clamp_params([("model", "GFS"), ("hours", "72"), ("base_time", far)], SERIES, "guest", NOW)[0])["hours"] == "72"


def test_anchor_skew_mirrors_the_series_helper():
    from services.weather_pipeline.grid_series_helper import SERIES_ANCHOR_MAX_SKEW_HOURS
    assert C.ANCHOR_MAX_SKEW_H == SERIES_ANCHOR_MAX_SKEW_HOURS


def test_spot_series_is_never_shared_cacheable(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    monkeypatch.setenv(C.FLAG, "1")
    rf._reset_for_tests(lambda: None)
    app = FastAPI()

    @app.get("/api/weather/spot-series/{sid}")
    async def ss(sid: str, request: Request):
        return JSONResponse(dict(request.query_params), headers={"Cache-Control": "public, max-age=300"})

    async def tier_fn(auth):
        return "premium"

    app.add_middleware(C.WeatherTierClampMiddleware, tier_fn=tier_fn)
    r = TestClient(app).get("/api/weather/spot-series/x?model=GFS&subscription_tier=premium")
    assert r.json()["subscription_tier"] == "premium" and r.headers["cache-control"] == "private, no-store"


def test_an_anchor_at_the_skew_edge_is_treated_as_honoured():
    """Security review (TOCTOU): the route's clock runs a moment later, so an anchor a hair past 26 h here may be
    honoured there. Inside the +1 h margin the cap assumes it is."""
    edge = (NOW + timedelta(hours=26, minutes=0, seconds=1)).strftime("%Y-%m-%dT%H:%M:%SZ")
    out, _ = C.clamp_params([("model", "GFS"), ("hours", "72"), ("base_time", edge)], SERIES, "guest", NOW)
    assert int(_q(out)["hours"]) <= 72 - 26


# ── one switch for both halves (owner 2026-11-11, "Yes, hold both") ───────────────────────────────────────────────────
def test_capabilities_rows_carry_the_switch(monkeypatch):
    from services.weather_pipeline.capabilities import get_weather_capabilities
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    rf._reset_for_tests(lambda: None)
    monkeypatch.delenv(C.FLAG, raising=False)
    rows = get_weather_capabilities()
    assert rows and all(r["tier_clamp"] is False for r in rows)          # held OFF: the client sends nothing
    monkeypatch.setenv(C.FLAG, "1")
    assert all(r["tier_clamp"] is True for r in get_weather_capabilities())


def test_every_weather_response_announces_the_clamp_only_while_it_is_on(monkeypatch):
    for on in (True, False):
        monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
        monkeypatch.setenv(C.FLAG, "1" if on else "0")
        rf._reset_for_tests(lambda: None)
        app = FastAPI()

        @app.get("/api/weather/capabilities")
        async def caps():
            return [{"model": "GFS"}]

        async def tier_fn(auth):
            return "guest"

        app.add_middleware(C.WeatherTierClampMiddleware, tier_fn=tier_fn)
        r = TestClient(app).get("/api/weather/capabilities")
        assert (r.headers.get("x-raw-tier-clamp-on") == "1") is on


def test_cors_caches_the_preflight_and_exposes_the_switch():
    """Clamp ON makes the browser preflight every weather GET (Authorization): the answer must carry a 2 h Max-Age, and
    the switch headers must be readable cross-origin."""
    import server
    client = TestClient(server.app)
    origin = "https://raw-surf.netlify.app"
    pre = client.options("/api/weather/grid_series", headers={
        "Origin": origin, "Access-Control-Request-Method": "GET", "Access-Control-Request-Headers": "authorization"})
    assert pre.headers.get("access-control-max-age") == "7200"
    cors = next(m for m in server.app.user_middleware if m.cls.__name__ == "CORSMiddleware")
    exposed = {h.lower() for h in cors.kwargs.get("expose_headers", [])}
    assert {"x-raw-tier-clamp-on", "x-raw-tier-clamp"} <= exposed
