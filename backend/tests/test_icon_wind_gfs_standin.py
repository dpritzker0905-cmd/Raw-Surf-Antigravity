"""ICON wind past its native horizon (~180 h) is the stored GFS wind at the same valid time, labelled
`gfs_wind_standin`, not ICON's own days looped (owner 2026-11-15 16:14 EST "Yes to all, hard hand-off";
pre-registered gate: docs/weather-program/log/2026-11-15-wind-long-range.md). Kill: ICON_WIND_GFS_STANDIN=0."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.weather_pipeline.euro_wind_extension import (
    extend_euro_wind_from_gfs,
    extend_icon_wind_from_gfs,
    icon_gfs_standin_on,
)
from services.weather_pipeline.wind_ingestion import ingest_icon_wind_global_impl

RUN = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
ICON_NATIVE_MAX = RUN + timedelta(hours=180)


def _item(h, estimated=False, model="GFS"):
    vt = RUN + timedelta(hours=h)
    return SimpleNamespace(model=model, domain="wind", layer="wind", region_id="global_coarse",
                           is_estimated=estimated, valid_time_start=vt,
                           filename=f"{model.lower()}_wind_{vt:%Y%m%dT%H%M%SZ}.json", resolution=10.0)


def _scheduler(items):
    s = MagicMock()
    s.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=items))
    clones = {}

    def load(fn):
        grid = MagicMock()
        grid.vectors = [MagicMock()]
        clone = MagicMock()
        clone.grid = grid
        p = MagicMock()
        p.grid = grid
        p.model_copy = MagicMock(return_value=clone)
        clones[fn] = clone
        return p

    s.store.load_product = MagicMock(side_effect=load)
    s.store.save_products_batch = MagicMock(side_effect=lambda batch: len(batch))
    return s, clones


@pytest.mark.asyncio
async def test_icon_tail_is_gfs_at_the_same_valid_time_with_standin_label():
    items = [_item(150), _item(180), _item(183), _item(186), _item(336), _item(339), _item(189, estimated=True),
             _item(192, model="EURO")]
    sched, _ = _scheduler(items)
    saved = await extend_icon_wind_from_gfs(sched, RUN, ICON_NATIVE_MAX)
    assert saved == 3  # 183, 186, 336: strictly after the native max, up to run+336 h, GFS native only
    batch = sched.store.save_products_batch.call_args[0][0]
    for clone, _res in batch:
        assert clone.model == "ICON"
        assert clone.is_estimated is True and clone.is_forecast_authoritative is False
        assert clone.estimate_basis["type"] == "gfs_wind_standin"
        assert clone.estimate_basis["native_horizon_hours"] == 180
        assert clone.run_time == RUN
    loaded = [c.args[0] for c in sched.store.load_product.call_args_list]
    assert loaded == [items[2].filename, items[3].filename, items[4].filename]  # same valid times, no shift


@pytest.mark.asyncio
async def test_euro_tail_labels_unchanged_by_the_refactor(monkeypatch):
    monkeypatch.delenv("EURO_WIND_EXTEND", raising=False)
    sched, _ = _scheduler([_item(243)])
    assert await extend_euro_wind_from_gfs(sched, RUN, RUN + timedelta(hours=240)) == 1
    clone = sched.store.save_products_batch.call_args[0][0][0][0]
    assert clone.model == "EURO" and clone.provider == "gfs_fallback"
    assert clone.estimate_basis["type"] == "gfs_wind_fallback"


def test_kill_switch(monkeypatch):
    monkeypatch.delenv("ICON_WIND_GFS_STANDIN", raising=False)
    assert icon_gfs_standin_on() is True  # D-065: ships ON
    monkeypatch.setenv("ICON_WIND_GFS_STANDIN", "0")
    assert icon_gfs_standin_on() is False


def _dwd_results():
    times = [(RUN + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(181)]
    return [{"latitude": 0.0, "longitude": 0.0, "hourly": {"time": times, "wind_speed_10m": [5.0] * 181,
                                                          "wind_direction_10m": [90.0] * 181, "wind_gusts_10m": [7.0] * 181}}]


@pytest.mark.asyncio
async def test_ingest_uses_standin_and_never_loops(monkeypatch):
    monkeypatch.delenv("ICON_WIND_GFS_STANDIN", raising=False)
    monkeypatch.delenv("ICON_WIND_EXTEND", raising=False)
    monkeypatch.setenv("ICON_WIND_DWD_DIRECT", "1")
    sched = MagicMock()
    sched._cleanup_and_pause = AsyncMock()
    sched._fetch_or_mock = AsyncMock(return_value=None)
    saves = []

    async def record(normalizer, store, results, **kw):
        saves.append(kw)
        return len(results)

    standin = AsyncMock(return_value=52)
    loop = MagicMock()
    with patch("services.dwd_wind_service.fetch_icon_wind_global_coarse", new=AsyncMock(return_value=_dwd_results())), \
         patch("services.weather_pipeline.wind_ingestion.normalize_and_save_loop", new=record), \
         patch("services.weather_pipeline.euro_wind_extension.extend_icon_wind_from_gfs", new=standin), \
         patch("services.weather_pipeline.viewport_helper.extend_icon_wind_to_14d", new=loop):
        assert await ingest_icon_wind_global_impl(sched) is True
    assert len(saves) == 1 and saves[0]["estimated_after_index"] is None  # natives only from ICON itself
    standin.assert_awaited_once()
    assert standin.await_args.args[2] == datetime.fromisoformat(_dwd_results()[0]["hourly"]["time"][-1]).replace(tzinfo=timezone.utc)
    loop.assert_not_called()
    sched.store.prune_superseded_products.assert_called_once()
