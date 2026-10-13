"""A pan or zoom never costs a full-forecast wind native recovery (2026-10-09 Gulf hurricane incident).

⛔ WHAT HAPPENED (Render srv-d7fhiu7lk1mc73debje0). The Open-Meteo circuit breaker was open ("recent 429s"), so
every fine GFS wind viewport failed fast and spawned a native recovery (wind_native_recovery.py). A recovery
fetched EVERY GFS step (f000-f384 = 129 whole-globe GRIB pairs), then normalized and persisted 128 more hours in the
serve process, and it was deduped only by its exact snapped bbox. Instance 4gt6w spawned 10 between 03:07:50Z and
03:09:21Z, one per pan box, plus warm frames of timeline page 2 (+144 h). The semaphore queued them all and ran
them back to back until 03:32:28Z; CPU sat at 0.90-0.97 and /api/health took 8.8 s or timed out.

PAN_BURST below is that burst, box for box and in arrival order, from the "Spawned GFS native recovery" log lines.
The replay runs it offline: ViewportService against a mock store, the breaker's exact failure, and the REAL
noaa_gfs_wind_fetcher.fetch_global_coarse behind a fake S3 (one `.idx` GET per forecast step = one upstream hour
fetch) and a fake pygrib. Nothing touches the live backend (CLAUDE.md: never load-test it).

Measured with this replay: on dev f364efce (before the fix) 10 recoveries, 1290 upstream hour fetches and 1290 hours
persisted, 18 min 49 s of wall clock with the network faked; after it 2 recoveries (the warm frame that found the lane
idle, and the view the user stopped on), 6 hour fetches and 6 hours persisted, ~4 s.
"""
import asyncio
import sys
import types
from datetime import datetime, timedelta, timezone

import numpy as np
import pytest

from services import dwd_icon_wind_fetcher as FI
from services import noaa_gfs_wind_fetcher as F
from services._fetch_window import window_f_hours
from services.weather_pipeline import wind_native_recovery as wnr
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.providers.open_meteo_provider import OpenMeteoProvider
from services.weather_pipeline.reval_queue import SeriesFrame, current_series_frame, series_frame_scope
from services.weather_pipeline.viewport_service import ViewportService

BREAKER = "Open-Meteo circuit breaker open (recent 429s) — failing fast to fallback."  # the live log's message

VIEWED, WARM = "viewed", "warm"
# (requested bbox, hours after the viewed hour, who asked), instance 4gt6w, 03:07:50Z-03:09:21Z.
PAN_BURST = [
    ("-86,27,-81,30", 144, WARM),    # 03:07:50 timeline page 2, res 0.25
    ("-90,25,-78,32", 0, VIEWED),    # 03:07:55 res 0.5
    ("-90,25,-76,32", 0, VIEWED),    # 03:07:57
    ("-94,24,-80,31", 0, VIEWED),    # 03:07:58
    ("-87,27,-82,29", 144, WARM),    # 03:07:59
    ("-96,20,-76,31", 0, VIEWED),    # 03:08:11 res 1.0
    ("-93,24,-77,33", 0, VIEWED),    # 03:09:00
    ("-89,27,-82,30", 144, WARM),    # 03:09:06
    ("-100,20,-81,31", 0, VIEWED),   # 03:09:12
    ("-94,22,-82,28", 0, VIEWED),    # 03:09:21 the view the owner stopped on, res 0.5
]


# ── fake NOAA S3 + pygrib: the real fetcher script runs; only the wire and the decoder are stand-ins ──
GLAT = np.arange(90.0, -90.01, -1.0)
GLON = np.arange(0.0, 360.0, 1.0)
_LA, _LO = np.meshgrid(GLAT, GLON, indexing="ij")
U_FIELD = np.full(_LA.shape, 6.0)
V_FIELD = np.full(_LA.shape, 8.0)
IDX_TEXT = ("1:0:d=x:UGRD:10 m above ground:anl:\n"
            "2:1000:d=x:VGRD:10 m above ground:anl:\n"
            "3:2000:d=x:TMP:surface:anl:\n")


class _Msg:
    def __init__(self, values):
        self.values = values

    def latlons(self):
        return _LA, _LO


class _Grbs:
    def read(self):
        return [_Msg(U_FIELD), _Msg(V_FIELD)]

    def close(self):
        pass


class _Resp:
    def __init__(self, body, status=200):
        self._b = body
        self.status_code = status

    @property
    def text(self):
        return self._b.decode() if isinstance(self._b, bytes) else self._b

    @property
    def content(self):
        return self._b if isinstance(self._b, bytes) else self._b.encode()


class _NoaaS3:
    """Counts `.idx` GETs: the fetcher makes exactly one per forecast step it downloads."""

    def __init__(self):
        self.hour_fetches = []

    def head(self, url, timeout=None):
        return _Resp(b"", 200)

    def get(self, url, headers=None, timeout=None):
        if url.endswith(".idx"):
            self.hour_fetches.append(int(url.rsplit(".f", 1)[-1][:3]))
            return _Resp(IDX_TEXT)
        a, _, b = headers["Range"][6:].partition("-")
        return _Resp(b"\x00" * (int(b) - int(a) + 1), 206)


def _install_noaa(monkeypatch):
    s3 = _NoaaS3()
    fake_pygrib = types.ModuleType("pygrib")
    fake_pygrib.open = lambda path: _Grbs()
    monkeypatch.setitem(sys.modules, "pygrib", fake_pygrib)
    monkeypatch.setitem(sys.modules, "requests", s3)
    return s3


def _floor3(dt):
    """A GFS step hour: the recovered products land exactly on the requested hour."""
    return dt.replace(hour=(dt.hour // 3) * 3, minute=0, second=0, microsecond=0)


@pytest.fixture(autouse=True)
def _clean_recovery_state():
    from services.weather_pipeline.store import ProductStore

    def _reset():
        wnr.RECOVERY_JOBS.clear()
        wnr.RECOVERY_COOLDOWN.clear()
        wnr.RECOVERED.clear()
        wnr._RECOVERY_SEMAPHORE = None
        with ProductStore._product_cache_lock:
            ProductStore._product_cache.clear()
            ProductStore._product_cache_vectors.clear()

    _reset()
    yield
    for job in wnr.RECOVERY_JOBS.values():
        if not job.task.done():
            job.task.cancel()
    _reset()


# ── THE REGRESSION: the 03:07Z pan burst, replayed ──

def test_the_0307z_pan_burst_costs_two_windowed_recoveries_not_ten_full_ones(mock_weather_setup, monkeypatch):
    store, dynamic_idx = mock_weather_setup
    s3 = _install_noaa(monkeypatch)

    async def breaker_open(*args, **kwargs):
        raise Exception(BREAKER)
    monkeypatch.setattr(OpenMeteoProvider, "fetch_grid", breaker_open)

    gate = asyncio.Event()   # a recovery takes minutes live: the whole burst arrives while the first one runs
    ran = []

    async def native_gfs(bbox, resolution, forecast_days, timeout_sec=None, valid_window=None):
        ran.append(dict(bbox))
        await gate.wait()
        payload = {"bbox": bbox, "resolution": resolution, "forecast_days": forecast_days}
        if valid_window:
            payload["valid_window"] = valid_window   # what noaa_wind_service puts in the subprocess payload
        return F.fetch_global_coarse(payload)[0]

    import services.noaa_wind_service as noaa_svc
    monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", native_gfs)
    viewed_hour = _floor3(datetime.now(timezone.utc))

    async def replay():
        service = ViewportService(store=store, dynamic_index=dynamic_idx)
        for bbox, hours, who in PAN_BURST:
            t = viewed_hour + timedelta(hours=hours)
            with series_frame_scope(SeriesFrame(warm=True) if who == WARM else None):
                try:
                    await service.fetch_viewport_grid_upstream(
                        "GFS", "wind", "wind", t.strftime("%Y-%m-%dT%H:%M:%SZ"), t, bbox)
                except Exception:
                    pass   # no cached fallback in a fresh store: the request 503/504s, as the live ones degraded
            await asyncio.sleep(0)
        in_flight = [job.task for job in wnr.RECOVERY_JOBS.values()]
        gate.set()
        await asyncio.gather(*in_flight, return_exceptions=True)
        return service

    service = asyncio.run(replay())
    persisted = sorted(p.name for p in store.cache_dir.glob("viewport_gfs_wind_*.json"))
    print(f"\nAFTER: recoveries ran={len(ran)} upstream hour fetches={len(s3.hour_fetches)} "
          f"hours persisted={len(persisted)}")

    # Before the fix (this replay on dev f364efce): 10 recoveries, 1290 hour fetches, 1290 hours persisted.
    assert len(ran) == 2, f"expected the warm frame + the final view, got {ran}"
    assert ran[0]["west"] == -86.0 and ran[1] == {"west": -94.0, "south": 22.0, "east": -82.0, "north": 28.0}
    assert 4 <= len(s3.hour_fetches) <= 6, s3.hour_fetches
    assert 4 <= len(persisted) <= 6, persisted
    # Only the two recovered boxes were persisted: every view in between was superseded before it ran.
    recovered_boxes = {name.split("Z_", 1)[1] for name in persisted}
    assert recovered_boxes == {"-86.00_27.00_-81.00_30.00.json", "-94.00_22.00_-82.00_28.00.json"}
    # The view the user stopped on is servable at the hour they are looking at.
    product = asyncio.run(service.get_cached_dynamic_product("GFS", "wind", "wind", viewed_hour, "-94,22,-82,28"))
    assert product is not None and product.grid.vectors
    assert abs(max(v.speed for v in product.grid.vectors) - 10.0 * 1.943844) < 0.05   # 6/8 m/s -> 19.44 kn


# ── the window, at the fetcher ──

def test_window_f_hours_keeps_only_steps_inside_the_window():
    cycle = datetime(2026, 10, 9, 0, tzinfo=timezone.utc)
    steps = list(range(0, 385, 3))
    assert window_f_hours(steps, cycle, None) == steps                       # ingest: unchanged
    win = {"start": "2026-10-09T00:00:00Z", "end": "2026-10-09T06:00:00Z"}
    assert window_f_hours(steps, cycle, win) == [0, 3, 6]
    win = {"start": "2026-10-15T01:00:00Z", "end": "2026-10-15T07:00:00Z"}
    assert window_f_hours(steps, cycle, win) == [147, 150]
    win = {"start": "2026-11-01T00:00:00Z", "end": "2026-11-01T06:00:00Z"}
    assert window_f_hours(steps, cycle, win) == []


def test_the_gfs_fetcher_downloads_only_the_window_steps(monkeypatch):
    s3 = _install_noaa(monkeypatch)
    bbox = {"west": -94.0, "south": 22.0, "east": -82.0, "north": 28.0}
    cycle = datetime.now(timezone.utc).replace(minute=0, second=0, microsecond=0)
    cycle = cycle.replace(hour=(cycle.hour // 6) * 6)   # what _pick_cycle answers when every HEAD is 200
    target = cycle + timedelta(hours=24)
    win = {"start": f"{target - timedelta(hours=3):%Y-%m-%dT%H:%M:%SZ}",
           "end": f"{target + timedelta(hours=3):%Y-%m-%dT%H:%M:%SZ}"}

    points, ok, failed, times = F.fetch_global_coarse(
        {"bbox": bbox, "resolution": 1.0, "forecast_days": 16, "valid_window": win})
    assert s3.hour_fetches == [21, 24, 27] and ok == 3 and failed == 0
    assert len(times) == 3 and all(len(p["hourly"]["wind_speed_10m"]) == 3 for p in points)

    s3.hour_fetches.clear()   # 2 days, not 16: the script gc.collect()s per step and 129 steps cost ~47 s here
    F.fetch_global_coarse({"bbox": bbox, "resolution": 1.0, "forecast_days": 2})
    assert s3.hour_fetches == list(range(0, 49, 3)), "ingest (no window) must keep fetching the whole run"


def _install_icon(monkeypatch, cycle):
    downloads = []
    clat = np.linspace(-89.0, 89.0, 300)
    clon = np.linspace(-179.0, 179.0, 300)

    def fake_download_decode(requests, pygrib, url, tmp):
        downloads.append(url.rsplit("/", 1)[-1])
        if "CLAT" in url:
            return clat
        if "CLON" in url:
            return clon
        return np.full(clat.shape, 5.0)

    monkeypatch.setitem(sys.modules, "pygrib", types.ModuleType("pygrib"))
    monkeypatch.setitem(sys.modules, "requests", _NoaaS3())
    monkeypatch.setattr(FI, "_download_decode", fake_download_decode)
    monkeypatch.setattr(FI, "_pick_cycle", lambda requests, now, max_f: (cycle, f"{cycle:%Y%m%d}", f"{cycle:%H}"))
    return downloads


def test_the_icon_fetcher_downloads_only_the_window_and_skips_clat_when_it_is_empty(monkeypatch):
    cycle = datetime(2026, 10, 9, 0, tzinfo=timezone.utc)
    downloads = _install_icon(monkeypatch, cycle)
    bbox = {"west": -94.0, "south": 22.0, "east": -82.0, "north": 28.0}

    win = {"start": "2026-10-09T21:00:00Z", "end": "2026-10-10T03:00:00Z"}
    _, ok, _, times = FI.fetch_global_coarse({"bbox": bbox, "resolution": 1.0, "forecast_days": 5, "valid_window": win})
    u_steps = sorted(name.split("_")[-3] for name in downloads if name.endswith("_U_10M.grib2.bz2"))
    assert u_steps == ["021", "024", "027"] and ok == 3 and len(times) == 3

    downloads.clear()
    win = {"start": "2026-10-20T00:00:00Z", "end": "2026-10-20T06:00:00Z"}   # past ICON's 5-day run
    out = FI.fetch_global_coarse({"bbox": bbox, "resolution": 1.0, "forecast_days": 5, "valid_window": win})
    assert out == ([], 0, 0, None) and downloads == [], "an empty window must not pay the CLAT/CLON download"


@pytest.mark.parametrize("module, fn_name, script", [
    ("services.noaa_wind_service", "fetch_gfs_wind_global_coarse", "noaa_gfs_wind_fetcher.py"),
    ("services.dwd_wind_service", "fetch_icon_wind_global_coarse", "dwd_icon_wind_fetcher.py"),
])
def test_the_service_wrappers_put_the_window_in_the_subprocess_payload(monkeypatch, module, fn_name, script):
    import importlib
    mod = importlib.import_module(module)
    seen = {}

    async def fake_run(script_name, bbox, resolution, forecast_days, **kwargs):
        seen[script_name] = kwargs.get("extra_payload")
        return []

    monkeypatch.setattr(mod, "run_fetcher_subprocess", fake_run)
    win = {"start": "2026-10-09T00:00:00Z", "end": "2026-10-09T06:00:00Z"}
    asyncio.run(getattr(mod, fn_name)({"west": 0, "south": 0, "east": 1, "north": 1}, 1.0, 5, valid_window=win))
    assert seen[script] == {"valid_window": win}
    asyncio.run(getattr(mod, fn_name)({"west": 0, "south": 0, "east": 1, "north": 1}, 1.0, 5))
    assert seen[script] is None, "ingest calls must send the payload they always sent"


# ── the lane: one running, one waiting per model, reuse, and the viewed hour first ──

class _Lane:
    """maybe_spawn against a GFS fetch that holds the lane until released; records every fetch that ran."""

    def __init__(self, monkeypatch, store=None, dynamic_idx=None):
        import services.noaa_wind_service as noaa_svc
        self.release = asyncio.Event()
        self.ran = []
        self.service = ViewportService(store=store, dynamic_index=dynamic_idx) if store else object()
        self.base = _floor3(datetime.now(timezone.utc))
        self.points = None

        async def fetch(bbox, resolution, forecast_days, timeout_sec=None, valid_window=None):
            self.ran.append((bbox["west"], bbox["south"], bbox["east"], bbox["north"], valid_window["start"]))
            await self.release.wait()
            return self.points(bbox, resolution, valid_window) if self.points else None

        monkeypatch.setattr(noaa_svc, "fetch_gfs_wind_global_coarse", fetch)

    def spawn(self, w, s, e, n, hours=0, res=0.5, model="GFS"):
        t = self.base + timedelta(hours=hours)
        return wnr.maybe_spawn_native_wind_recovery(
            self.service, model=model, domain="wind", layer="wind", target_dt=t,
            west=float(w), south=float(s), east=float(e), north=float(n), resolution=res,
            bbox_str=f"{w},{s},{e},{n}", bbox_key_str=f"{w:.2f}_{s:.2f}_{e:.2f}_{n:.2f}",
            coverage_scope="viewport")

    async def drain(self):
        self.release.set()
        for _ in range(3):
            await asyncio.gather(*[j.task for j in wnr.RECOVERY_JOBS.values()], return_exceptions=True)
            await asyncio.sleep(0)


async def test_a_newer_view_replaces_the_waiting_recovery_never_the_running_one(monkeypatch):
    lane = _Lane(monkeypatch)
    assert lane.spawn(-90, 25, -78, 32) is True
    await asyncio.sleep(0)                          # A takes the lane
    assert lane.spawn(-96, 20, -76, 31, res=1.0) is True    # B waits
    assert lane.spawn(-100, 20, -81, 31, res=1.0) is True   # C replaces B
    assert lane.spawn(-94, 22, -82, 28) is True     # D replaces C
    waiting = [j.key for j in wnr.RECOVERY_JOBS.values() if not j.running]
    assert len(wnr.RECOVERY_JOBS) == 2 and len(waiting) == 1 and "-94.00_22.00" in waiting[0]
    await lane.drain()
    assert [r[:4] for r in lane.ran] == [(-90.0, 25.0, -78.0, 32.0), (-94.0, 22.0, -82.0, 28.0)]


async def test_a_superseded_view_can_ask_again_when_the_user_returns(monkeypatch):
    lane = _Lane(monkeypatch)
    lane.spawn(-90, 25, -78, 32)
    await asyncio.sleep(0)
    assert lane.spawn(-96, 20, -76, 31, res=1.0) is True
    assert lane.spawn(-94, 22, -82, 28) is True      # supersedes the -96 view
    assert lane.spawn(-96, 20, -76, 31, res=1.0) is True, "a view that never ran must not sit on a cooldown"
    await lane.drain()


async def test_a_timeline_frame_starts_nothing_and_its_warm_frame_needs_an_idle_lane(monkeypatch):
    lane = _Lane(monkeypatch)
    with series_frame_scope(SeriesFrame(warm=False)):
        assert lane.spawn(-86, 27, -81, 30, hours=147, res=0.25) is False
    assert not wnr.RECOVERY_JOBS
    with series_frame_scope(SeriesFrame(warm=True)):
        assert lane.spawn(-86, 27, -81, 30, hours=144, res=0.25) is True     # idle lane
    await asyncio.sleep(0)
    with series_frame_scope(SeriesFrame(warm=True)):
        assert lane.spawn(-87, 27, -82, 29, hours=144, res=0.25) is False    # lane busy: kept for the viewed hour
    assert lane.spawn(-94, 22, -82, 28) is True                             # the viewed hour still gets in
    await lane.drain()
    assert len(lane.ran) == 2


async def test_the_viewed_hour_replaces_a_waiting_warm_frame_and_a_warm_frame_never_replaces_it(monkeypatch):
    lane = _Lane(monkeypatch)
    lane.spawn(-90, 25, -78, 32)
    await asyncio.sleep(0)                                                   # running
    assert lane.spawn(-94, 22, -82, 28) is True                             # viewed, waiting
    with series_frame_scope(SeriesFrame(warm=True)):
        assert lane.spawn(-86, 27, -81, 30, hours=144, res=0.25) is False   # cannot displace it
    await lane.drain()
    assert [r[:4] for r in lane.ran] == [(-90.0, 25.0, -78.0, 32.0), (-94.0, 22.0, -82.0, 28.0)]


async def test_a_covered_request_starts_nothing_but_a_finer_zoom_or_another_hour_does(monkeypatch):
    lane = _Lane(monkeypatch)
    assert lane.spawn(-100, 20, -81, 31, res=1.0) is True
    await asyncio.sleep(0)
    assert lane.spawn(-96, 22, -84, 29, res=1.0) is False, "same resolution inside the running box"
    assert lane.spawn(-96, 22, -84, 29, hours=3, res=1.0) is False, "inside the box and its ±3 h window"
    assert lane.spawn(-96, 22, -84, 29, hours=6, res=1.0) is True, "outside the window"
    assert lane.spawn(-94, 22, -82, 28, res=0.5) is True, "a finer zoom is not served by a 1-degree recovery"
    await lane.drain()


async def test_a_finished_recovery_is_reused_until_its_cooldown_ends(mock_weather_setup, monkeypatch):
    from services._fetch_common import coarse_axis
    store, dynamic_idx = mock_weather_setup
    lane = _Lane(monkeypatch, store, dynamic_idx)

    def points(bbox, res, window):
        start = datetime.fromisoformat(window["start"].replace("Z", "+00:00"))
        times = [f"{start + timedelta(hours=h):%Y-%m-%dT%H:%M:%SZ}" for h in (0, 3, 6)]
        return [{"latitude": la, "longitude": lo, "__provider": "noaa",
                 "hourly_units": {"time": "iso8601", "wind_speed_10m": "m/s", "wind_direction_10m": "°"},
                 "hourly": {"time": times, "wind_speed_10m": [9.0] * 3, "wind_direction_10m": [90.0] * 3}}
                for la in coarse_axis(bbox["south"], bbox["north"], res)
                for lo in coarse_axis(bbox["west"], bbox["east"], res)]
    lane.points = points

    lane.spawn(-100, 20, -81, 31, res=1.0)
    await lane.drain()
    assert len(wnr.RECOVERED) == 1 and not wnr.RECOVERY_JOBS
    assert lane.spawn(-96, 22, -84, 29, res=1.0) is False, "a finished recovery covers its box"
    for job in wnr.RECOVERED:
        job.expires = 0.0
    assert lane.spawn(-96, 22, -84, 29, res=1.0) is True
    await lane.drain()


async def test_icon_past_its_native_run_is_not_recovered(monkeypatch):
    lane = _Lane(monkeypatch)
    assert lane.spawn(-94, 22, -82, 28, hours=24 * 8, model="ICON") is False
    assert not wnr.RECOVERY_JOBS


# ── #277 wiring: grid_series marks each frame, and only for the frame ──

async def test_grid_series_runs_each_frame_inside_its_own_frame_scope():
    seen = {}

    async def resolve_grid(model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, **kw):
        frame = current_series_frame()
        seen[valid_time] = (frame is background_tasks, getattr(frame, "warm", None))
        task_view = await asyncio.create_task(asyncio.sleep(0, result=current_series_frame()))
        assert task_view is frame, "a task the frame starts must inherit the frame"
        return None

    await build_grid_series(resolve_grid, object(), "GFS", "wind", "wind", "-94,22,-82,28", "0,3,6")
    assert len(seen) == 3 and all(same for same, _ in seen.values())
    assert sorted(warm for _, warm in seen.values()) == [False, False, True]
    assert current_series_frame() is None, "the scope leaked out of the series"
