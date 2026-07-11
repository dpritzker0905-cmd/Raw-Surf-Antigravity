"""
F2 — build_grid_series EURO native+estimated merge. A series PAGE can span the EURO marine
native/estimate boundary (240h), e.g. 234..246h. Copernicus only covers <=240h, so the fast
path builds the native hours and the per-hour loop builds the estimated (>240h) hours from
STORED estimated products; the two are merged so the page returns its full hour range.
"""
import asyncio
from datetime import datetime, timezone

from services.weather_pipeline import grid_series_helper
from services.weather_pipeline.grid_series_helper import build_grid_series
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)


def _euro_product(is_estimated):
    now = datetime.now(timezone.utc)
    cov = CoverageBounds(west=-82.0, south=26.0, east=-78.0, north=30.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.0, lng=-80.0, speed=1.0)])
    return NormalizedProduct(
        model="EURO", provider="copernicus", domain="marine", layer="waves",
        run_time=now, valid_time=now, is_forecast_authoritative=not is_estimated,
        is_estimated=is_estimated, coverage=cov, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800,
        product_id="euro_est.json" if is_estimated else "euro_native.json",
    )


async def _fake_resolve_grid(*, model, domain, layer, valid_time, bbox,
                             surf=False, background_tasks=None, request=None):
    # The per-hour loop only runs for the ESTIMATED (>240h) hours; return a stored estimate.
    return _euro_product(is_estimated=True)


async def _fake_fast_path(viewport_service, layer, bbox, hour_list, base):
    # Copernicus native fast path: returns frames only for the requested (native, <=240h) hours.
    frames = [{
        "hour_offset": h, "valid_time": "2026-06-21T00:00:00Z", "cols": 2, "rows": 2,
        "bounds": {"west": -82.0, "south": 26.0, "east": -78.0, "north": 30.0},
        "vectors": [{"lat": 27.0, "lng": -80.0, "speed": 1.0}],
        "provider": "copernicus", "is_estimated": False,
    } for h in hour_list]
    return {
        "model": "EURO", "domain": "marine", "layer": layer, "base_time": "x",
        "bounds": frames[0]["bounds"] if frames else None, "cols": 2, "rows": 2,
        "frame_count": len(frames), "frames": frames,
    }


class _FakeVP:
    normalizer = None


def test_euro_series_merges_native_fast_path_with_estimated_per_hour(monkeypatch):
    # The live-Copernicus fast path is now behind EURO_SERIES_LIVE_COPERNICUS (default OFF); this
    # test exercises that (revert) path's native+estimated merge, so opt into it explicitly.
    monkeypatch.setenv("EURO_SERIES_LIVE_COPERNICUS", "1")
    monkeypatch.setattr(grid_series_helper, "_build_euro_marine_series", _fake_fast_path)
    out = asyncio.run(build_grid_series(
        _fake_resolve_grid, _FakeVP(), "EURO", "marine", "waves",
        "-82,26,-78,30", "234,237,240,243,246",
    ))
    by_h = {f["hour_offset"]: f for f in out["frames"]}
    # Full boundary-spanning range present (native 234..240 + estimated 243..246).
    assert sorted(by_h) == [234, 237, 240, 243, 246]
    # Native frames authoritative; far frames flagged estimated.
    assert by_h[240]["is_estimated"] is False
    assert by_h[243]["is_estimated"] is True
    assert by_h[246]["is_estimated"] is True
    assert out["frame_count"] == 5


def test_euro_series_all_native_returns_fast_path_directly(monkeypatch):
    monkeypatch.setenv("EURO_SERIES_LIVE_COPERNICUS", "1")
    monkeypatch.setattr(grid_series_helper, "_build_euro_marine_series", _fake_fast_path)
    out = asyncio.run(build_grid_series(
        _fake_resolve_grid, _FakeVP(), "EURO", "marine", "waves",
        "0,3,6,141", "0,3,6,141",
    ))
    # All <=240h -> fast path returns directly, every frame native.
    assert out["frame_count"] == 4
    assert all(f["is_estimated"] is False for f in out["frames"])


def test_euro_series_uses_generic_loop_by_default(monkeypatch):
    """ROOT-CAUSE FIX (2026-07-09): with EURO_SERIES_LIVE_COPERNICUS unset (default), EURO marine
    series must NOT call the 40s live-Copernicus fast path — every hour (native AND estimated) resolves
    through the generic per-hour loop (resolve_grid = the fast L2-backed path /grid uses)."""
    monkeypatch.delenv("EURO_SERIES_LIVE_COPERNICUS", raising=False)

    fast_path_called = []
    async def _boom_fast_path(viewport_service, layer, bbox, hour_list, base):
        fast_path_called.append(True)  # must NOT be reached by default
        return _fake_fast_path(viewport_service, layer, bbox, hour_list, base)
    monkeypatch.setattr(grid_series_helper, "_build_euro_marine_series", _boom_fast_path)

    resolved = []
    async def _recording_resolve(*, model, domain, layer, valid_time, bbox,
                                 surf=False, background_tasks=None, request=None):
        resolved.append(valid_time)
        return _euro_product(is_estimated=False)

    out = asyncio.run(build_grid_series(
        _recording_resolve, _FakeVP(), "EURO", "marine", "waves",
        "-82,26,-78,30", "0,3,6,141",
    ))
    assert fast_path_called == []             # 40s live-Copernicus path skipped by default
    assert len(resolved) == 4                 # all four native hours went through the generic loop
    assert out["frame_count"] == 4


def _gfs_product():
    now = datetime.now(timezone.utc)
    cov = CoverageBounds(west=-81.0, south=27.0, east=-80.0, north=28.0)
    grid = NormalizedGrid(bounds=cov, cols=2, rows=2,
                          vectors=[GridVector(lat=27.5, lng=-80.5, speed=1.0)])
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=now, valid_time=now, is_forecast_authoritative=True, is_estimated=False,
        coverage=cov, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=[], freshness_sec=1800, product_id="gfs.json",
    )


def test_gfs_series_first_hour_warms_regional_via_none_background_tasks():
    """The zoom-in clamp backend fix: the FIRST hour must pass background_tasks=None so resolve_grid's SWR
    revalidation (which builds + caches the precise regional viewport tile) actually fires; the rest pass a
    throwaway BackgroundTasks so we don't fan out N background fetches on the 1-CPU box."""
    calls = []  # (valid_time, background_tasks is None)

    async def recording_resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        calls.append((valid_time, background_tasks is None))
        return _gfs_product()

    out = asyncio.run(build_grid_series(
        recording_resolve, None, "GFS", "marine", "waves", "-81,27,-80,28", "0,3,6",
    ))
    assert out["frame_count"] == 3
    # The FIRST hour built (sorted -> hour 0) warmed the regional tile (background_tasks=None) ...
    assert calls[0][1] is True
    # ... and EXACTLY one hour did, with all others using a real (throwaway) BackgroundTasks.
    assert sum(1 for (_, is_none) in calls if is_none) == 1
    assert all(is_none is False for (_, is_none) in calls[1:])


def _fast_path_frames(hour_list):
    return {
        "model": "GFS", "domain": "marine", "layer": "waves", "base_time": "x",
        "bounds": {"west": -90, "south": 24, "east": -84, "north": 29}, "cols": 16, "rows": 8,
        "frame_count": len(hour_list),
        "frames": [{
            "hour_offset": h, "valid_time": "2026-06-29T00:00:00Z", "cols": 16, "rows": 8,
            "bounds": {"west": -90, "south": 24, "east": -84, "north": 29},
            "vectors": [{"lat": 26, "lng": -87, "speed": 0.6}], "provider": "open-meteo", "is_estimated": False,
        } for h in hour_list],
    }


def test_gfs_fast_path_used_when_flag_on(monkeypatch):
    """GFS_ICON_SERIES_FASTPATH=1 → grid_series serves the full-range fast path (REGIONAL for all hours) and
    NEVER falls to the per-hour generic loop (which would serve global-coarse → the Gulf scrub square)."""
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")

    async def fake_fp(viewport_service, model, layer, bbox, hour_list, base):
        return _fast_path_frames(hour_list)
    monkeypatch.setattr(grid_series_helper, "_build_openmeteo_marine_series", fake_fp)

    used_generic = []
    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        used_generic.append(valid_time)
        return _gfs_product()

    out = asyncio.run(build_grid_series(resolve, _FakeVP(), "GFS", "marine", "waves", "-90,24,-84,29", "0,3,6"))
    assert out["frame_count"] == 3 and out["cols"] == 16          # came from the fast path
    assert used_generic == []                                     # generic per-hour loop NOT used


def test_gfs_fast_path_skipped_when_flag_off(monkeypatch):
    monkeypatch.delenv("GFS_ICON_SERIES_FASTPATH", raising=False)

    used_generic = []
    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        used_generic.append(valid_time)
        return _gfs_product()

    out = asyncio.run(build_grid_series(resolve, _FakeVP(), "GFS", "marine", "waves", "-90,24,-84,29", "0,3,6"))
    assert out["frame_count"] == 3 and len(used_generic) == 3     # generic loop ran (flag off)


def test_fast_path_hang_falls_back_within_swr_budget(monkeypatch):
    """Audit #24: Render logs showed the fastpath await hitting its 30s ceiling on 62% of attempts
    (+21% upstream 400s) — a 30s-held request per series page before the instant stored fallback.
    The inner fetch is shielded (keeps warming the provider cache in background) and the client's
    coarse-reval re-fetches, so the request path now awaits only a short first-paint budget
    (GFS_ICON_SERIES_FASTPATH_WAIT_SEC, default 2.5s) and falls back fast."""
    import time
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH", "1")
    monkeypatch.setenv("GFS_ICON_SERIES_FASTPATH_WAIT_SEC", "0.2")

    async def hanging_fp(viewport_service, model, layer, bbox, hour_list, base):
        await asyncio.sleep(10)  # simulates the timeout/degraded-upstream class

    monkeypatch.setattr(grid_series_helper, "_build_openmeteo_marine_series", hanging_fp)

    used_generic = []
    async def resolve(*, model, domain, layer, valid_time, bbox, surf=False, background_tasks=None, request=None):
        used_generic.append(valid_time)
        return _gfs_product()

    t0 = time.monotonic()
    out = asyncio.run(build_grid_series(resolve, _FakeVP(), "GFS", "marine", "waves", "-90,24,-84,29", "0,3"))
    elapsed = time.monotonic() - t0

    assert out["frame_count"] == 2          # served by the per-hour loop (stored fallback)
    assert len(used_generic) == 2           # generic loop actually ran
    assert elapsed < 3.0, f"fallback took {elapsed:.1f}s — the SWR budget did not bind"
