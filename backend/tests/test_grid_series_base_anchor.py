"""F-01 (audit 14.0) — the series anchor must be a CONTRACT, not two independent clocks.

THE DEFECT THIS PINS. `/grid_series` accepted only hour OFFSETS. The browser derived its absolute
anchor with `Math.round(now / 1h)` (`backendWeatherServiceClient.getSharedValidTime`) while this
module derived its own with `datetime.now().replace(minute=0, ...)` -- a FLOOR. The two agree for
30 minutes of every hour and disagree by exactly one hour for the other 30. Nothing in the request
could reconcile them, because no absolute anchor was ever transmitted. Live consequence, measured
2026-09-20 20:52Z: the wheel requested 21Z and the committed series frame was 20Z; at +18 it
requested next-day 15Z and got 14Z.

These tests fix the server clock and assert on the ANCHOR, not on wall time, so they are
deterministic at any minute of any hour -- including the xx:30 boundary that produces the defect.
A test that merely ran at a random minute would pass ~half the time, which is how this survived.
"""
import asyncio
from datetime import datetime, timedelta, timezone

import pytest

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)

BBOX = "-82.0,26.0,-78.0,30.0"


class _FakeVP:
    normalizer = None


class _FrozenDatetime(datetime):
    """Freezes only `datetime.now`; every other datetime behaviour is inherited unchanged."""
    _frozen = datetime(2026, 9, 20, 20, 52, 35, tzinfo=timezone.utc)

    @classmethod
    def now(cls, tz=None):
        return cls._frozen if tz is None else cls._frozen.astimezone(tz)


@pytest.fixture
def frozen_clock(monkeypatch):
    """Server 'now' = 20:52:35Z -> server FLOOR anchor is 20Z. Browser ROUND anchor is 21Z."""
    monkeypatch.setattr(gsh, "datetime", _FrozenDatetime)
    return _FrozenDatetime._frozen


def _product(valid_time):
    """A resolver that SERVES the hour it was asked for.

    The frame's `valid_time` is the SERVED product's, not the requested target -- that is the whole
    point of the field, since a real resolver may legitimately substitute a neighbouring hour. So
    the fixture must echo the request, or the test asserts on the fixture instead of on the anchor.
    """
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 9, 20, 6, 0, tzinfo=timezone.utc),
        valid_time=valid_time,
        is_forecast_authoritative=True, is_estimated=False, coverage=cov, grid=grid,
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=[], freshness_sec=1800, product_id="gfs_test.json",
    )


def _build(hours="0,3", base_time=None):
    async def resolve(*, model, domain, layer, valid_time, bbox,
                      surf=False, background_tasks=None, request=None, series_stride=None):
        vt = valid_time
        if isinstance(vt, str):
            vt = datetime.fromisoformat(vt.replace("Z", "+00:00"))
        return _product(vt)

    return asyncio.run(build_grid_series(
        resolve, _FakeVP(), "GFS", "marine", "waves", BBOX, hours,
        base_time=base_time,
    ))


# --- the defect, and its repair -------------------------------------------------------------

def test_without_anchor_server_floors_the_hour(frozen_clock):
    """BASELINE / backward compatibility: no anchor supplied => unchanged floor behaviour.

    This is the pre-fix behaviour and must survive, because /grid_series is a public contract and
    older clients send no anchor.
    """
    resp = _build(base_time=None)
    assert resp["base_time"] == "2026-09-20T20:00:00Z"
    assert resp.get("base_time_source") == "server"


def test_client_anchor_is_honoured_and_removes_the_one_hour_disagreement(frozen_clock):
    """THE REPAIR: the browser's rounded 21Z anchor must become the series anchor.

    Pre-fix this returned 20:00:00Z -- the exact live mismatch recorded on 2026-09-20.
    """
    resp = _build(hours="0,3", base_time="2026-09-20T21:00:00Z")
    assert resp["base_time"] == "2026-09-20T21:00:00Z"
    assert resp.get("base_time_source") == "client"
    # frame 0 is the anchor itself, frame 1 is anchor+3h -- absolute times, not offsets.
    assert resp["frames"][0]["valid_time"] == "2026-09-20T21:00:00Z"
    assert resp["frames"][1]["valid_time"] == "2026-09-21T00:00:00Z"


def test_anchor_disagreement_is_exactly_one_hour_at_the_xx30_boundary(frozen_clock):
    """The phase sensitivity itself: round vs floor differ by 1h iff minute >= 30."""
    server_anchored = _build(base_time=None)["base_time"]
    client_anchored = _build(base_time="2026-09-20T21:00:00Z")["base_time"]
    delta = (datetime.strptime(client_anchored, "%Y-%m-%dT%H:%M:%SZ")
             - datetime.strptime(server_anchored, "%Y-%m-%dT%H:%M:%SZ"))
    assert delta == timedelta(hours=1)


# --- the anchor is UNTRUSTED INPUT ------------------------------------------------------------

def test_non_hour_anchor_is_snapped_not_trusted_verbatim(frozen_clock):
    """A client may send a smeared clock; the series grid is hourly, so snap it."""
    resp = _build(base_time="2026-09-20T21:47:13Z")
    assert resp["base_time"] == "2026-09-20T21:00:00Z"
    assert resp.get("base_time_source") == "client"


def test_far_future_anchor_is_rejected_and_disclosed(frozen_clock):
    """An out-of-window anchor must NOT pin the series -- it would let a client drive unbounded
    upstream fetches and poison shared caches. Fall back to the server clock and SAY SO."""
    resp = _build(base_time="2027-01-01T00:00:00Z")
    assert resp["base_time"] == "2026-09-20T20:00:00Z"
    assert resp.get("base_time_source") == "client_rejected"


def test_far_past_anchor_is_rejected_and_disclosed(frozen_clock):
    resp = _build(base_time="2020-01-01T00:00:00Z")
    assert resp["base_time"] == "2026-09-20T20:00:00Z"
    assert resp.get("base_time_source") == "client_rejected"


def test_malformed_anchor_fails_open_to_the_server_clock(frozen_clock):
    """A parse failure must degrade to today's behaviour, never 500 -- this route is on the
    scrub hot path and a hard failure blanks the heatmap."""
    resp = _build(base_time="not-a-timestamp")
    assert resp["base_time"] == "2026-09-20T20:00:00Z"
    assert resp.get("base_time_source") == "client_rejected"


def test_naive_anchor_is_treated_as_utc(frozen_clock):
    """The contract is UTC; a client omitting the Z must not silently shift by the server's tz."""
    resp = _build(base_time="2026-09-20T21:00:00")
    assert resp["base_time"] == "2026-09-20T21:00:00Z"
    assert resp.get("base_time_source") == "client"


# --- the ROUTE must actually accept and forward the parameter ---------------------------------

def test_route_forwards_base_time_to_the_builder(monkeypatch):
    """The unit tests above exercise build_grid_series directly. This pins the WIRE: a query
    parameter that never reaches the builder is the 'guard ran nowhere' shape, and it would look
    fine in every test above."""
    from fastapi.testclient import TestClient
    import routes.weather as weather_routes
    from server import app

    seen = {}

    async def fake_build(resolve_grid, viewport_service, model, domain, layer, bbox, hours,
                         request=None, surf=False, base_time=None):
        seen["base_time"] = base_time
        return {"model": model, "frames": [], "frame_count": 0}

    # build_grid_series is imported INSIDE the route body, so patch it at its source module.
    import services.weather_pipeline.grid_series_helper as helper
    monkeypatch.setattr(helper, "build_grid_series", fake_build)

    client = TestClient(app)
    r = client.get("/api/weather/grid_series", params={
        "model": "GFS", "domain": "marine", "layer": "waves",
        "bbox": BBOX, "hours": "0,3", "base_time": "2026-09-20T21:00:00Z",
    })
    assert r.status_code == 200, r.text
    assert seen.get("base_time") == "2026-09-20T21:00:00Z"


def test_route_without_base_time_forwards_none(monkeypatch):
    """Backward compatibility on the wire: an older client omitting the param must still work."""
    from fastapi.testclient import TestClient
    from server import app
    import services.weather_pipeline.grid_series_helper as helper

    seen = {}

    async def fake_build(resolve_grid, viewport_service, model, domain, layer, bbox, hours,
                         request=None, surf=False, base_time=None):
        seen["base_time"] = base_time
        return {"model": model, "frames": [], "frame_count": 0}

    monkeypatch.setattr(helper, "build_grid_series", fake_build)
    client = TestClient(app)
    r = client.get("/api/weather/grid_series", params={
        "model": "GFS", "domain": "marine", "layer": "waves", "bbox": BBOX, "hours": "0",
    })
    assert r.status_code == 200, r.text
    assert seen.get("base_time") is None
