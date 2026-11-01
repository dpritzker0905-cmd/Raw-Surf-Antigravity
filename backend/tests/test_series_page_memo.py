"""W-4 (2026-10-19): the dark series page memo (GRID_SERIES_PAGE_MEMO) through the actual route, offline.

Pins: the flag-off route is untouched; with the flag on the decoded page equals the flag-off page for the snapped bbox;
an identical request is served from the memo and two concurrent ones share ONE build; a manifest write clears the memo;
a page a later request could build differently is never replayed; a snap never crosses a span edge the resolver
branches on; one disconnected tab never truncates another tab's page.
"""
import asyncio
import gzip
import json
import re
import time
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

import pytest
from fastapi import FastAPI
from httpx import ASGITransport, AsyncClient
from starlette.middleware.gzip import GZipMiddleware

from services.weather_pipeline import grid_series_helper as gsh
from services.weather_pipeline import series_page_memo as M
from services.weather_pipeline.schemas import GridVector

HOURS = "0,3,6"
ON_GRID = "-82.0000,20.0000,-79.0000,22.0000"   # on the GFS 1-deg tile grid, in get_snapped_bbox format: identity
JITTER = ("-81.7,20.3,-79.2,21.6", "-81.4,20.1,-79.5,21.9")   # both snap to ON_GRID


class _Store:
    def __init__(self, stamp="2026-10-19T00:00:00Z"):
        self.manifest = SimpleNamespace(last_manifest_update=datetime.fromisoformat(stamp.replace("Z", "+00:00")),
                                        products=[1, 2, 3])

    def get_manifest(self):
        return self.manifest


@pytest.fixture(autouse=True)
def fresh(monkeypatch):
    monkeypatch.setattr(M, "MEMO", M.PageMemo())
    for name in ("GRID_SERIES_RESPONSE_BOUNDS", "GRID_RESPONSE_BOUNDS", "GRID_SERIES_GZIP_LEVEL"):
        monkeypatch.delenv(name, raising=False)
    monkeypatch.setenv("GRID_SERIES_PAGE_MEMO", "1")
    from routes import weather
    monkeypatch.setattr(weather, "store", _Store())
    return weather


def _app():
    from routes.weather import router
    app = FastAPI()
    app.include_router(router)
    app.add_middleware(GZipMiddleware, minimum_size=500)
    return app


def _payload(bbox, n=3, product_id="gfs_marine_waves_regional_20261019T000000Z.json"):
    return {"model": "GFS", "domain": "marine", "layer": "waves", "base_time": "2026-10-19T00:00:00Z", "bbox_seen": bbox,
            "frame_count": n, "frames": [{"hour_offset": h * 3, "product_id": product_id, "is_estimated": False,
                                          "vectors": [GridVector(lat=20.0 + i, lng=-81.0, speed=1.25 + h, direction=270.0,
                                                                 period=11.5, is_valid=True) for i in range(40)]}
                                         for h in range(n)]}


def _fake_build(calls, sink_rows=None, gate=None, n=None):
    async def build(resolve_grid, viewport_service, model, domain, layer, bbox, hours, request=None, surf=False,
                    base_time=None, resolved_anchor=None):
        calls.append(bbox)
        if gate is not None:
            await gate.wait()
        count = n if n is not None else len(hours.split(","))
        sink = gsh.SERIES_FRAME_SINK.get()
        if sink is not None:
            sink.extend(sink_rows if sink_rows is not None else [(False, "")] * count)
        return _payload(bbox, count)
    return build


async def _get(client, bbox, encoding="gzip"):
    return await client.get("/weather/grid_series", params=dict(model="GFS", layer="waves", bbox=bbox, hours=HOURS),
                            headers={"accept-encoding": encoding})


def _run(coro):
    return asyncio.run(coro)


# ── payload semantics ─────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("encoding", ["gzip", "identity"])
def test_flag_on_page_decodes_equal_to_the_flag_off_page_for_the_snapped_bbox(monkeypatch, encoding):
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                on = await _get(c, JITTER[0], encoding)
                monkeypatch.setenv("GRID_SERIES_PAGE_MEMO", "0")
                off = await _get(c, ON_GRID, encoding)
        return on, off
    on, off = _run(run())
    assert on.status_code == off.status_code == 200
    assert calls == [ON_GRID, ON_GRID], "flag on builds the SNAPPED box; flag off builds what it was asked"
    assert on.json() == off.json()
    assert on.headers["content-encoding"] == ("gzip" if encoding == "gzip" else "identity")
    assert "memo;desc=miss" in on.headers["server-timing"] and "build;dur=" in on.headers["server-timing"]
    assert "server-timing" not in off.headers, "the flag-off route must be untouched"


def test_flag_off_route_builds_the_exact_bbox_and_returns_the_legacy_dict(monkeypatch):
    monkeypatch.setenv("GRID_SERIES_PAGE_MEMO", "0")
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                return await _get(c, JITTER[0])
    r = _run(run())
    assert calls == [JITTER[0]] and r.status_code == 200 and r.json()["bbox_seen"] == JITTER[0]


# ── memo, sharing, invalidation ───────────────────────────────────────────────────────────────────────────────
def test_identical_and_jittered_requests_hit_the_memo_after_one_build():
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                return [await _get(c, b) for b in (JITTER[0], JITTER[0], JITTER[1], ON_GRID)]
    rs = _run(run())
    assert calls == [ON_GRID], "four requests that snap to one tile box must cost ONE build"
    assert [r.headers["server-timing"].split("memo;desc=")[1].split(";")[0] for r in rs] == ["miss", "hit", "hit", "hit"]
    assert all(r.json() == rs[0].json() for r in rs)
    assert rs[1].content == rs[0].content, "a hit replays the encoded body byte for byte"


def test_concurrent_identical_requests_share_one_build():
    calls = []

    async def run():
        gate = asyncio.Event()
        with patch.object(gsh, "build_grid_series", _fake_build(calls, gate=gate)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                tasks = [asyncio.create_task(_get(c, b)) for b in (JITTER[0], JITTER[1], ON_GRID)]
                await asyncio.sleep(0.05)
                gate.set()
                return await asyncio.gather(*tasks)
    rs = _run(run())
    assert calls == [ON_GRID]
    outcomes = sorted(r.headers["server-timing"].split("memo;desc=")[1].split(";")[0] for r in rs)
    assert outcomes == ["miss", "shared", "shared"]
    assert rs[0].json() == rs[1].json() == rs[2].json()


def test_a_manifest_write_clears_the_memo(fresh):
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                await _get(c, ON_GRID)
                await _get(c, ON_GRID)
                fresh.store.manifest = _Store("2026-10-19T03:00:00Z").manifest    # a new run landed
                await _get(c, ON_GRID)
    _run(run())
    assert calls == [ON_GRID, ON_GRID]


@pytest.mark.parametrize("rows,n,why", [
    ([(True, "mid_res_preview")] * 3, 3, "an SWR sharpen is pending"),
    ([(False, "coarse_preview")] * 3, 3, "a preview tier served a frame"),
    ([(False, "")] * 2, 3, "the loop built fewer frames than were served (fast path / live recovery)"),
    ([(False, "")] * 2, 2, "an hour is missing from the page"),
])
def test_a_page_a_later_request_could_build_differently_is_not_replayed(rows, n, why):
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls, sink_rows=rows, n=n)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                await _get(c, ON_GRID)
                await _get(c, ON_GRID)
    _run(run())
    assert calls == [ON_GRID, ON_GRID], why


def test_a_zoomed_mid_clip_inside_the_sharpen_span_is_not_replayed():
    page = _payload(ON_GRID, 3, product_id="gfs_marine_waves_global_mid_20261019T000000Z.json")
    assert not M._cacheable(page, [(False, "")] * 3, 3, "marine", ON_GRID)
    assert M._cacheable(page, [(False, "")] * 3, 3, "marine", "-180,-80,180,85"), "world span never sharpens"


def test_one_tab_disconnecting_does_not_truncate_the_shared_build():
    class Req:
        def __init__(self, gone):
            self.gone = gone

        async def is_disconnected(self):
            return self.gone
    w = M._Waiters()
    stay = Req(False)
    w.add(Req(True))
    w.add(stay)
    assert _run(w.is_disconnected()) is False, "one tab left, another still waits: keep building"
    stay.gone = True
    assert _run(w.is_disconnected()) is True and w.abandoned
    w.add(Req(False))
    assert _run(w.is_disconnected()) is True, "abandonment is sticky: the truncated build is never resumed"


# ── snap guard ────────────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("bbox,model,expected", [
    (JITTER[0], "GFS", ON_GRID),
    ("-81.7,20.3,-79.2,21.6", "ICON", "-82.0000,20.0000,-78.0000,22.0000"),
    ("-180,-80,180,85", "GFS", "-180.0000,-80.0000,180.0000,85.0000"),    # world page: identity
    ("-180,-80,180,85", "EURO", "-180.0000,-80.0000,180.0000,85.0000"),
    ("170.5,10.2,-175.5,12.4", "GFS", "170.5,10.2,-175.5,12.4"),          # crosses the antimeridian: exact
    ("-200.5,10,-190,20", "GFS", "-200.5,10,-190,20"),                     # unwrapped longitudes: exact
    ("-125.3,25.2,-113.6,35.6", "GFS", "-126,25,-113,36"),                  # 11.7 -> 13 deg: no server edge between
    ("-81.6,20.3,-74.3,22.0", "GFS", "-81.6,20.3,-74.3,22.0"),             # 7.3 deg -> 8 would reach the 8 deg reval edge
    ("-81.6,20.3,-67.3,22.0", "GFS", "-81.6,20.3,-67.3,22.0"),             # 14.3 deg -> 15 deg tier edge: exact
])
def test_snap_never_crosses_a_span_edge(bbox, model, expected):
    out = M.snap_series_bbox(bbox, model)
    norm = lambda s: tuple(round(float(x), 4) for x in s.split(","))   # noqa: E731
    assert norm(out) == norm(expected)


def test_every_span_threshold_the_pipeline_reads_is_guarded():
    """A *SPAN* env read added anywhere in weather_pipeline must join _span_edges, or a snap may cross it."""
    root = Path(gsh.__file__).parent
    names = set()
    for f in root.glob("*.py"):
        names |= set(re.findall(r'["\']([A-Z_]*SPAN[A-Z_]*)["\']', f.read_text(encoding="utf-8")))
    guarded = Path(M.__file__).read_text(encoding="utf-8")
    missing = sorted(n for n in names if n not in guarded and n.endswith(("SPAN", "SPAN_DEG")))
    assert not missing, f"span thresholds not guarded by series_page_memo._span_edges: {missing}"


# ── encode + telemetry ────────────────────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("raw,level", [(None, 4), ("3", 3), ("9", 4), ("0", 1), ("x", 4)])
def test_gzip_level_is_clamped_to_one_to_four(monkeypatch, raw, level):
    if raw is not None:
        monkeypatch.setenv("GRID_SERIES_GZIP_LEVEL", raw)
    assert M.gzip_level() == level


def test_encode_is_the_direct_serializer_and_records_stages(monkeypatch):
    from services import request_telemetry as T
    monkeypatch.setattr(T, "_stages", {})
    page = _payload(ON_GRID)
    body, gz, raw_len, _, _ = M._encode(page, 1)
    assert gz and json.loads(gzip.decompress(body)) == json.loads(__import__(
        "services.weather_pipeline.series_response", fromlist=["encode_json"]).encode_json(page))
    assert raw_len == len(gzip.decompress(body))
    calls = []

    async def run():
        with patch.object(gsh, "build_grid_series", _fake_build(calls)):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                await _get(c, ON_GRID)
                await _get(c, ON_GRID)
    _run(run())
    stages = {row["stage"]: row["n"] for row in T.snapshot()["stages"]}
    assert stages == {"grid_series.build": 1, "grid_series.encode": 1, "grid_series.gzip": 1,
                      "grid_series.memo_miss": 1, "grid_series.memo_hit": 1}


def test_with_the_response_envelope_on_the_shared_build_takes_its_admission_slot(monkeypatch):
    from services.weather_pipeline import series_response as S
    monkeypatch.setenv("GRID_SERIES_RESPONSE_BOUNDS", "1")
    monkeypatch.setattr(S, "ADMISSION", S.SeriesAdmission())
    seen = []

    async def build(*a, **k):
        seen.append(dict(S.ADMISSION.active))
        return _payload(ON_GRID)

    async def run():
        with patch.object(gsh, "build_grid_series", build):
            async with AsyncClient(transport=ASGITransport(app=_app()), base_url="http://offline.invalid") as c:
                return await _get(c, ON_GRID)
    assert _run(run()).status_code == 200
    assert seen == [{"mini": 0, "page": 1}] and S.ADMISSION.active == {"mini": 0, "page": 0}


# ── review 2026-10-19 (F4-F7, item 5) ─────────────────────────────────────────────────────────────────────────
class _Req:
    headers = {}

    def __init__(self, gone=False):
        self.gone = gone

    async def is_disconnected(self):
        return self.gone


def _direct(store, request, **kw):
    return M.serve_memo_series(None, None, store, "GFS", "marine", "waves", ON_GRID, HOURS, request=request, **kw)


def test_an_abandoned_flight_is_cancelled_and_a_later_client_gets_its_own_full_build(monkeypatch):
    """F4: A leaves; the build is cancelled; B arrives afterwards and must get a full page, not A's remains."""
    monkeypatch.setenv("GRID_SERIES_PAGE_MEMO_CANCEL_POLL_S", "0.05")
    starts, cancelled = [], []

    async def build(*a, request=None, **k):
        starts.append(a[5])
        if len(starts) == 1:
            try:
                await asyncio.sleep(10)
            except asyncio.CancelledError:
                cancelled.append(True)
                raise
        sink = gsh.SERIES_FRAME_SINK.get()
        sink.extend([(False, "")] * 3)
        return _payload(ON_GRID, 3)

    async def run():
        store, a = _Store(), _Req(gone=False)
        with patch.object(gsh, "build_grid_series", build):
            ta = asyncio.create_task(_direct(store, a))
            await asyncio.sleep(0.1)
            a.gone = True                                    # A pans away mid-build
            await asyncio.sleep(0.2)
            rb = await _direct(store, _Req(gone=False))      # B asks for the same page afterwards
            with pytest.raises(Exception) as ea:
                await ta
            await asyncio.sleep(0.05)
            return rb, ea.value, list(cancelled)             # read INSIDE the loop: asyncio.run cancels leftovers
    rb, err, cancelled_in_loop = _run(run())
    assert cancelled_in_loop == [True], "the abandoned build must be cancelled, not left running on the box"
    assert len(starts) == 2, "B must not join the abandoned flight"
    assert json.loads(rb.body)["frame_count"] == 3 and "memo;desc=miss" in rb.headers["server-timing"]
    assert getattr(err, "status_code", None) == 499


def test_a_flight_whose_loop_saw_everyone_gone_is_never_served(monkeypatch):
    """F4, the other order: the per-hour loop sees the disconnect first and returns a truncated page."""
    async def build(*a, request=None, **k):
        await request.is_disconnected()                      # the loop's own check marks it abandoned
        return _payload(ON_GRID, 1)

    async def run():
        with patch.object(gsh, "build_grid_series", build):
            return await _direct(_Store(), _Req(gone=True))
    with pytest.raises(Exception) as e:
        _run(run())
    assert getattr(e.value, "status_code", None) == 499
    assert not M.MEMO.entries


def test_a_client_arriving_while_an_abandoned_build_finishes_gets_a_fresh_build(monkeypatch):
    """F4, the race the review named: the loop has seen everyone gone and is finishing a truncated page when B joins."""
    monkeypatch.setenv("GRID_SERIES_PAGE_MEMO_CANCEL_POLL_S", "5")     # keep the watcher out of this race
    starts = []

    async def build(*a, request=None, **k):
        starts.append(a[5])
        if len(starts) == 1:
            await request.is_disconnected()        # A is gone: the remaining hours return nothing
            await asyncio.sleep(0.3)               # ...while the already-running hours finish
            return _payload(ON_GRID, 1)
        gsh.SERIES_FRAME_SINK.get().extend([(False, "")] * 3)
        return _payload(ON_GRID, 3)

    async def run():
        store = _Store()
        with patch.object(gsh, "build_grid_series", build):
            ta = asyncio.create_task(_direct(store, _Req(gone=True)))
            await asyncio.sleep(0.1)
            rb = await _direct(store, _Req(gone=False))
            with pytest.raises(Exception):
                await ta
            return rb
    rb = _run(run())
    assert len(starts) == 2 and json.loads(rb.body)["frame_count"] == 3


def test_a_failed_shared_build_is_logged(caplog):
    async def build(*a, **k):
        raise RuntimeError("boom")

    async def run():
        with patch.object(gsh, "build_grid_series", build):
            with pytest.raises(RuntimeError):
                await _direct(_Store(), None)
            await asyncio.sleep(0)
    with caplog.at_level("WARNING"):
        _run(run())
    assert any("shared series build failed" in r.getMessage() for r in caplog.records)


def test_manifest_failure_keeps_sharing_keeps_no_page_and_warns_once(caplog):
    class Broken:
        def get_manifest(self):
            raise OSError("manifest unreadable")
    calls = []

    async def run():
        gate = asyncio.Event()
        with patch.object(gsh, "build_grid_series", _fake_build(calls, gate=gate)):
            tasks = [asyncio.create_task(_direct(Broken(), None)) for _ in range(3)]
            await asyncio.sleep(0.05)
            gate.set()
            await asyncio.gather(*tasks)
            await _direct(Broken(), None)
    with caplog.at_level("WARNING"):
        _run(run())
    assert len(calls) == 2, "three concurrent requests share one build; no page is kept, so the fourth rebuilds"
    assert sum("manifest token unavailable" in r.getMessage() for r in caplog.records) == 1
    assert not M.MEMO.entries


def test_the_build_uses_the_anchor_the_key_was_made_from():
    seen = []

    async def build(*a, resolved_anchor=None, **k):
        seen.append(resolved_anchor)
        gsh.SERIES_FRAME_SINK.get().extend([(False, "")] * 3)
        return _payload(ON_GRID, 3)

    async def run():
        with patch.object(gsh, "build_grid_series", build):
            await _direct(_Store(), None, base_time="2099-01-01T00:00:00Z")   # rejected: server clock + source
    _run(run())
    anchor, source = seen[0]
    key = next(iter(M.MEMO.entries))
    assert source == "client_rejected" and key[-2:] == (anchor.strftime("%Y-%m-%dT%H:%M:%SZ"), source)


def test_with_the_envelope_on_a_late_page_is_refused_with_503(monkeypatch):
    from services.weather_pipeline import series_response as S
    monkeypatch.setenv("GRID_SERIES_RESPONSE_BOUNDS", "1")
    monkeypatch.setenv("GRID_SERIES_DEADLINE_S", "1")
    monkeypatch.setattr(S, "ADMISSION", S.SeriesAdmission())

    async def build(*a, **k):
        await asyncio.sleep(3.0)
        return _payload(ON_GRID, 3)

    async def run():
        with patch.object(gsh, "build_grid_series", build):
            await _direct(_Store(), None)
    t0 = time.monotonic()
    with pytest.raises(Exception) as e:
        _run(run())
    assert getattr(e.value, "status_code", None) == 503
    assert time.monotonic() - t0 < 2.0, "the waiter is refused AT the deadline, not after the build ends"


# ── the real builder: the sink is fed by the actual per-hour loop ──────────────────────────────────────────────
def test_the_real_per_hour_loop_feeds_the_sink_and_a_clean_page_is_kept():
    def product():
        return SimpleNamespace(
            grid=SimpleNamespace(cols=3, rows=2, bounds=SimpleNamespace(west=-82.0, south=20.0, east=-79.0, north=22.0),
                                 vectors=[GridVector(lat=20.0, lng=-82.0 + i, speed=1.0, is_valid=True) for i in range(6)],
                                 diagnostics={}),
            valid_time=datetime(2026, 10, 19, tzinfo=timezone.utc), provider="open-meteo", is_estimated=False,
            run_time=None, upstream_provider="noaa", source_dataset="ncep_gfswave025", estimate_basis=None,
            served_valid_time=None, frame_offset_hours=0.0, frame_substituted=False, stale=False, cache_hit=None,
            product_id="gfs_marine_waves_regional_x.json", region_id="regional", upstream_model=None, wind_lane=None)

    async def resolve_grid(**kw):
        return product()

    store = _Store()

    async def run():
        r1 = await M.serve_memo_series(resolve_grid, None, store, "GFS", "marine", "waves", ON_GRID, HOURS)
        r2 = await M.serve_memo_series(resolve_grid, None, store, "GFS", "marine", "waves", ON_GRID, HOURS)
        return r1, r2
    r1, r2 = _run(run())
    assert "memo;desc=miss" in r1.headers["server-timing"] and "memo;desc=hit" in r2.headers["server-timing"]
    assert json.loads(r1.body)["frame_count"] == 3
