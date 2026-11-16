"""The ENS member-mean hand-off for ICON 180-336 h / EURO 240-336 h wind (services/weather_pipeline/
ens_wind_extension.py). Owner 2026-11-15 16:14 EST "Yes to all, hard hand-off"; gate:
docs/weather-program/log/2026-11-15-wind-long-range.md. Kill: ENS_WIND_EXTENSION=0."""
from datetime import datetime, timedelta, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import numpy as np
import pytest

from services.weather_pipeline import ens_wind_core as ec
from services.weather_pipeline import ens_wind_extension as ex

RUN = datetime(2026, 11, 15, 0, tzinfo=timezone.utc)
ENS_RUN = datetime(2026, 11, 14, 12, tzinfo=timezone.utc)
STEPS = [s for s in ec.ens_archived_steps(360) if s >= 144]


def _fields(speed_of_step):
    out = {}
    for s in STEPS:
        sp = np.full((181, 360), float(speed_of_step(s)))
        out[s] = {"u": -sp, "v": np.zeros_like(sp), "speed": sp, "gust": sp * 0.5, "gust_p90": sp * 2.0,
                  "spread": np.ones_like(sp)}
    return out


def _packed(speed_of_step=lambda s: 5.0, run=ENS_RUN, k=None):
    npz, meta = ex.pack(run, STEPS, _fields(speed_of_step), k)
    return meta, ex.unpack(npz)


def test_pack_roundtrip_and_label():
    meta, arrays = _packed()
    assert meta["basis"] == "ens_mean_extension" and meta["label"].startswith("Days 8")
    assert arrays["speed_186"].shape == (181, 360) and arrays["speed_186"].dtype == np.float32


def test_tail_lattice_is_strictly_after_native_and_ends_at_336():
    vts = ex.tail_valid_times(RUN, RUN + timedelta(hours=180))
    assert vts[0] == RUN + timedelta(hours=183) and vts[-1] == RUN + timedelta(hours=336)
    assert all((b - a) == timedelta(hours=3) for a, b in zip(vts, vts[1:]))
    off = ex.tail_valid_times(RUN, RUN + timedelta(hours=181))
    assert off[0] == RUN + timedelta(hours=183)


def test_points_interpolate_within_the_ens_run_and_clip_gust_to_wind():
    meta, arrays = _packed(lambda s: s / 10.0)        # speed rises with the step: 6-hourly steps, 3-hourly served
    pts = ex.build_points(meta, arrays, RUN, RUN + timedelta(hours=180), [0.0, 10.0], [0.0, 10.0, 20.0])
    assert len(pts) == 6 and pts[0]["__provider"] == "ecmwf_ens"
    h = pts[0]["hourly"]
    # first served hour: RUN+183 h = ENS lead 195 h, between archived 192 and 198 -> 19.5 m/s
    assert h["time"][0] == (RUN + timedelta(hours=183)).strftime("%Y-%m-%dT%H:%M")
    assert h["wind_speed_10m"][0] == pytest.approx(19.5, abs=1e-3)
    assert h["wind_direction_10m"][0] == pytest.approx(90.0)       # u < 0: blowing west, FROM the east
    assert all(g >= s for g, s in zip(h["wind_gusts_10m"], h["wind_speed_10m"]))   # gust 0.5 x speed clipped up
    assert h["wind_gusts_p90_10m"][0] == pytest.approx(39.0, abs=1e-3)              # p90 = 2 x speed, interpolated


def test_lagged_run_serves_up_to_its_own_last_step_and_never_past_48h():
    """Amendment 3 (director 2026-11-16): an ENS run <= 48 h old serves, but only the valid times it reaches (its
    +360 h); later hours get no tail. Over 48 h old: nothing."""
    assert ex.build_points(*_packed(run=RUN - timedelta(hours=49)), RUN, RUN + timedelta(hours=180), [0.0], [0.0]) is None
    meta, arrays = _packed(run=RUN - timedelta(hours=48))
    pts = ex.build_points(meta, arrays, RUN, RUN + timedelta(hours=180), [0.0], [0.0])
    times = pts[0]["hourly"]["time"]
    assert times[0] == (RUN + timedelta(hours=183)).strftime("%Y-%m-%dT%H:%M")
    assert times[-1] == (RUN + timedelta(hours=312)).strftime("%Y-%m-%dT%H:%M")   # = the lagged run's +360 h
    b = ex.estimate_basis(meta, 180, RUN)
    assert b["older_run"] is True and b["ens_run_age_h"] == 48 and "older run, 48 h" in b["label"]
    fresh = ex.estimate_basis(_packed()[0], 180, RUN)
    assert fresh["older_run"] is False and fresh["label"] == ec.LABEL
    meta2, arrays2 = _packed()
    meta2["steps"] = [s for s in STEPS if s >= 204]           # cannot reach the first tail hour: no tail
    assert ex.build_points(meta2, arrays2, RUN, RUN + timedelta(hours=180), [0.0], [0.0]) is None


def test_debias_factor_applies_by_lead_bin_only_when_recorded():
    meta, arrays = _packed(k={"B3_264_336": 1.1})
    pts = ex.build_points(meta, arrays, RUN, RUN + timedelta(hours=180), [0.0], [0.0])
    sp = pts[0]["hourly"]["wind_speed_10m"]
    assert sp[0] == pytest.approx(5.0) and sp[-1] == pytest.approx(5.5)


def _sched():
    s = MagicMock()
    s.store.cache_dir = "unused"
    return s


@pytest.mark.asyncio
async def test_fallback_order_never_gfs_for_icon(monkeypatch):
    """Owner 2026-11-15 19:27 EST: no GFS for ICON past 7.5 days. ENS first; without it ICON returns None (the caller
    keeps today's legacy tail) and EURO keeps its GFS clones."""
    monkeypatch.delenv("ENS_WIND_EXTENSION", raising=False)
    bbox = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    meta, arrays = _packed()
    saver = AsyncMock(return_value=51)
    with patch.object(ex, "load_latest", return_value=(meta, arrays)), \
         patch("services.weather_pipeline.scheduler_helpers.normalize_and_save_loop", new=saver):
        n = await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False)
        assert n == 51
        kw = saver.await_args.kwargs
        assert kw["estimate_basis"]["type"] == "ens_mean_extension" and kw["estimated_after_index"] == 0
        assert kw["model"] == "ICON" and kw["region_id"] == "global_coarse"
    gfs = AsyncMock(return_value=33)
    with patch.object(ex, "load_latest", return_value=None), \
         patch("services.weather_pipeline.euro_wind_extension.extend_euro_wind_from_gfs", new=gfs):
        assert await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False) is None
        assert gfs.await_count == 0
        assert await ex.extend_wind_tail(_sched(), "EURO", RUN, RUN + timedelta(hours=240), bbox, 10.0, False) == 33
    monkeypatch.setenv("ENS_WIND_EXTENSION", "0")
    loader = MagicMock()
    with patch.object(ex, "load_latest", new=loader):
        assert await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False) is None
    loader.assert_not_called()

def test_sample_step_matches_build_points_at_a_native_step():
    meta, arrays = _packed(lambda s: s / 10.0)
    pts = ex.build_points(meta, arrays, RUN, RUN + timedelta(hours=180), [5.0], [7.0])
    h = pts[0]["hourly"]
    i = h["time"].index((ENS_RUN + timedelta(hours=198)).strftime("%Y-%m-%dT%H:%M"))   # ENS step 198 is archived
    f = ex.sample_step(meta, arrays, 198, [5.0], [7.0])
    assert f["speed"][0] == pytest.approx(h["wind_speed_10m"][i], abs=1e-3)
    assert f["gust"][0] == pytest.approx(h["wind_gusts_10m"][i], abs=1e-3) and bool(f["clipped"][0])
    assert f["gust_p90"][0] == pytest.approx(h["wind_gusts_p90_10m"][i], abs=1e-3)
    wrap = ex.sample_step(meta, arrays, 198, [0.0, 0.0], [359.5, -0.5])
    assert wrap["speed"][0] == pytest.approx(wrap["speed"][1])



@pytest.mark.asyncio
async def test_icon_ingest_writes_no_loop_when_ens_is_on_but_absent(monkeypatch):
    """Amendment 3: with ENS on and no usable run, ICON's ingest writes NO tail (never the loop, never GFS)."""
    from services.weather_pipeline.wind_ingestion import ingest_icon_wind_global_impl
    monkeypatch.delenv("ENS_WIND_EXTENSION", raising=False)
    monkeypatch.delenv("ICON_WIND_EXTEND", raising=False)
    monkeypatch.setenv("ICON_WIND_DWD_DIRECT", "1")
    times = [(RUN + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(181)]
    raw = [{"latitude": 0.0, "longitude": 0.0, "hourly": {"time": times, "wind_speed_10m": [5.0] * 181,
                                                         "wind_direction_10m": [90.0] * 181, "wind_gusts_10m": [7.0] * 181}}]
    sched = MagicMock()
    sched._cleanup_and_pause = AsyncMock()
    sched._fetch_or_mock = AsyncMock(return_value=None)
    saves = []

    async def record(normalizer, store, results, **kw):
        saves.append(kw)
        return len(results)
    loop = MagicMock()
    with patch("services.dwd_wind_service.fetch_icon_wind_global_coarse", new=AsyncMock(return_value=raw)), \
         patch("services.weather_pipeline.wind_ingestion.normalize_and_save_loop", new=record), \
         patch.object(ex, "load_latest", return_value=None), \
         patch("services.weather_pipeline.viewport_helper.extend_icon_wind_to_14d", new=loop):
        assert await ingest_icon_wind_global_impl(sched) is True
    assert len(saves) == 1 and saves[0]["estimated_after_index"] is None   # natives only
    loop.assert_not_called()
