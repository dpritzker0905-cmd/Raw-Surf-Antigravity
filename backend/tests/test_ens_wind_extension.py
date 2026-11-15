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
        out[s] = {"u": -sp, "v": np.zeros_like(sp), "speed": sp, "gust": sp * 0.5, "spread": np.ones_like(sp)}
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


def test_stale_or_short_ens_run_is_never_served_partially():
    meta, arrays = _packed(run=RUN - timedelta(hours=48))
    assert ex.build_points(meta, arrays, RUN, RUN + timedelta(hours=180), [0.0], [0.0]) is None
    meta2, arrays2 = _packed()
    meta2["steps"] = [s for s in STEPS if s <= 300]
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
async def test_fallback_order(monkeypatch):
    monkeypatch.delenv("ENS_WIND_EXTENSION", raising=False)
    monkeypatch.delenv("ICON_WIND_GFS_STANDIN", raising=False)
    bbox = {"west": -180.0, "south": -80.0, "east": 180.0, "north": 85.0}
    meta, arrays = _packed()
    saver = AsyncMock(return_value=51)
    with patch.object(ex, "load_latest", return_value=(meta, arrays)), \
         patch("services.weather_pipeline.scheduler_helpers.normalize_and_save_loop", new=saver), \
         patch("services.weather_pipeline.euro_wind_extension.extend_icon_wind_from_gfs", new=AsyncMock(return_value=7)) as gfs:
        n = await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False)
        assert n == 51 and gfs.await_count == 0
        kw = saver.await_args.kwargs
        assert kw["estimate_basis"]["type"] == "ens_mean_extension" and kw["estimated_after_index"] == 0
        assert kw["model"] == "ICON" and kw["region_id"] == "global_coarse"
    # ENS file absent -> the GFS stand-in
    with patch.object(ex, "load_latest", return_value=None), \
         patch("services.weather_pipeline.euro_wind_extension.extend_icon_wind_from_gfs", new=AsyncMock(return_value=7)):
        assert await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False) == 7
    # ENS killed -> the GFS stand-in without reading the file
    monkeypatch.setenv("ENS_WIND_EXTENSION", "0")
    loader = MagicMock()
    with patch.object(ex, "load_latest", new=loader), \
         patch("services.weather_pipeline.euro_wind_extension.extend_euro_wind_from_gfs", new=AsyncMock(return_value=33)):
        assert await ex.extend_wind_tail(_sched(), "EURO", RUN, RUN + timedelta(hours=240), bbox, 10.0, False) == 33
    loader.assert_not_called()
    # both ICON switches killed -> None (the caller's legacy loop)
    monkeypatch.setenv("ICON_WIND_GFS_STANDIN", "0")
    assert await ex.extend_wind_tail(_sched(), "ICON", RUN, RUN + timedelta(hours=180), bbox, 10.0, False) is None
