"""Strategy slice 1 (2026-07-10 late): EURO wind 240->336h tail is PRE-BAKED on the runner as
GFS-fallback clones — the same model=EURO/provider=gfs_fallback/is_estimated labels the live
dynamic fallback serves (grid_resolver ~:430, b0655047), computed once per cycle from STORED GFS
global products (no upstream fetches — raw-results reuse across jobs is the dead premise of
audit finding #15). Valid-time-keyed _estimated filenames overwrite in place across cycles
(cf0b4b23 continuity). Kill switch: EURO_WIND_EXTEND=0."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from services.weather_pipeline.euro_wind_extension import extend_euro_wind_from_gfs
from services.weather_pipeline.wind_ingestion import ingest_euro_wind_global_impl


# hour=0 so hour-offsets land on absolute 3h-aligned wall-clock hours (the module's tail filter
# uses hour-of-day % 3, matching real products' synoptic alignment) deterministically.
RUN = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
NATIVE_MAX = RUN + timedelta(hours=240)


def _gfs_manifest_item(hours_from_run, estimated=False, region="global_coarse"):
    vt = RUN + timedelta(hours=hours_from_run)
    return SimpleNamespace(
        model="GFS", domain="wind", layer="wind", region_id=region,
        is_estimated=estimated, valid_time_start=vt,
        filename=f"gfs_wind_wind_global_coarse_{vt.strftime('%Y%m%dT%H%M%SZ')}.json",
        resolution=10.0,
    )


def _gfs_product(valid_time):
    grid = MagicMock()
    grid.vectors = [MagicMock()]
    p = MagicMock()
    p.grid = grid
    clone = MagicMock()
    clone.grid = grid
    p.model_copy = MagicMock(return_value=clone)
    p.valid_time = valid_time
    return p, clone


def _scheduler_with_manifest(items):
    s = MagicMock()
    s.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=items))
    loaded = {}
    for it in items:
        prod, clone = _gfs_product(it.valid_time_start)
        loaded[it.filename] = (prod, clone)
    s.store.load_product = MagicMock(side_effect=lambda fn: loaded.get(fn, (None, None))[0])
    s.store.save_products_batch = MagicMock(side_effect=lambda batch: len(batch))
    return s, loaded


@pytest.mark.asyncio
async def test_clones_gfs_tail_with_fallback_labels(monkeypatch):
    monkeypatch.delenv("EURO_WIND_EXTEND", raising=False)
    # sources: inside native (skip), 3-hourly beyond native (take), beyond ceiling (skip),
    # estimated (skip), non-3h-aligned (skip)
    items = [
        _gfs_manifest_item(120),                    # inside native window -> skip
        _gfs_manifest_item(243), _gfs_manifest_item(246), _gfs_manifest_item(336),  # take
        _gfs_manifest_item(339),                    # beyond ceiling -> skip
        _gfs_manifest_item(252, estimated=True),    # estimated source -> skip
    ]
    sched, loaded = _scheduler_with_manifest(items)

    saved = await extend_euro_wind_from_gfs(sched, RUN, NATIVE_MAX)

    assert saved == 3
    batch = sched.store.save_products_batch.call_args[0][0]
    assert len(batch) == 3
    for clone, resolution in batch:
        assert clone.model == "EURO"
        assert clone.provider == "gfs_fallback"
        assert clone.is_estimated is True
        assert clone.is_forecast_authoritative is False
        assert clone.estimate_basis["type"] == "gfs_wind_fallback"
        assert clone.estimate_basis["method"] == "gfs_relabel_prebake"
        assert clone.run_time == RUN                 # current generation for prune ordering
        assert clone.product_id is None              # save derives the _estimated filename
        assert resolution == 10.0


@pytest.mark.asyncio
async def test_kill_switch_and_empty_sources(monkeypatch):
    monkeypatch.setenv("EURO_WIND_EXTEND", "0")
    sched, _ = _scheduler_with_manifest([_gfs_manifest_item(243)])
    assert await extend_euro_wind_from_gfs(sched, RUN, NATIVE_MAX) == 0
    sched.store.save_products_batch.assert_not_called()

    monkeypatch.delenv("EURO_WIND_EXTEND", raising=False)
    sched2, _ = _scheduler_with_manifest([])  # no GFS sources at all
    assert await extend_euro_wind_from_gfs(sched2, RUN, NATIVE_MAX) == 0
    sched2.store.save_products_batch.assert_not_called()


def _ecmwf_results(points=2, hours=240):
    base = datetime.now(timezone.utc).replace(hour=0, minute=0, second=0, microsecond=0)
    times = [(base + timedelta(hours=h)).strftime("%Y-%m-%dT%H:%M") for h in range(hours)]
    return [
        {"latitude": 10.0 * i, "longitude": 10.0 * i,
         "hourly": {"time": list(times),
                    "wind_speed_10m": [5.0] * hours,
                    "wind_direction_10m": [90] * hours}}
        for i in range(points)
    ]


@pytest.mark.asyncio
async def test_euro_global_ingest_invokes_extension_after_native_save(monkeypatch):
    monkeypatch.delenv("EURO_WIND_EXTEND", raising=False)
    monkeypatch.setenv("EURO_WIND_ECMWF_DIRECT", "1")
    sched = MagicMock()
    sched.normalizer = MagicMock()
    sched.store = MagicMock()
    sched._cleanup_and_pause = AsyncMock()
    sched._fetch_or_mock = AsyncMock(return_value=None)

    async def record_save(normalizer, store, results, **kw):
        return len(results)

    ext = AsyncMock(return_value=7)
    with patch("services.ecmwf_wind_service.fetch_euro_wind_global_coarse",
               new=AsyncMock(return_value=_ecmwf_results())), \
         patch("services.weather_pipeline.wind_ingestion.normalize_and_save_loop", new=record_save), \
         patch("services.weather_pipeline.euro_wind_extension.extend_euro_wind_from_gfs", new=ext):
        ok = await ingest_euro_wind_global_impl(sched)

    assert ok is True
    ext.assert_awaited_once()
    args = ext.await_args.args
    assert args[0] is sched
    assert args[2] is not None  # native_max parsed from the ECMWF results
    sched.store.prune_superseded_products.assert_called_once()
