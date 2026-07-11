"""Strategy slice 1 second half (2026-07-11): ICON marine 168->336h estimates are PRE-BAKED on the
runner (persistence(ICON@168) + GFS trend — the client blend's exact math, which is the estimator's
is_icon_valid=False weight path) so far-hour ICON marine serves from stored products instead of the
client's THREE /grid fetches per hour per viewport. estimator.py untouched — the wrapper relabels
the returned product (model=ICON, basis icon_persistence_gfs_blend). copernicus_validator
early-returns for non-EURO models (verified), so no whitelist change. Kill: ICON_MARINE_EXTEND=0."""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.weather_pipeline.schemas import (
    GridVector, NormalizedGrid, NormalizedProduct, CoverageBounds
)
from services.weather_pipeline.icon_marine_extension import (
    ingest_icon_marine_extended_estimates_impl,
)

RUN = datetime(2026, 7, 11, 0, 0, tzinfo=timezone.utc)
ANCHOR_T = RUN + timedelta(hours=168)
BOUNDS = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _product(model, layer, valid_time, speed=1.5):
    grid = NormalizedGrid(
        bounds=BOUNDS, cols=1, rows=1,
        vectors=[GridVector(lat=0.0, lng=0.0, speed=speed, direction=90.0,
                            u=-speed, v=0.0, period=8.0, is_valid=True)],
    )
    return NormalizedProduct(
        model=model, provider="open-meteo", domain="marine", layer=layer,
        run_time=RUN, valid_time=valid_time, is_forecast_authoritative=True,
        is_estimated=False, coverage=BOUNDS, grid=grid, value_kind="wave_height",
        value_unit="m", display_unit_hint="ft", source_variables=[],
        freshness_sec=1800, region_id="global_coarse", coverage_mode="global_tile",
        # real loaded products always carry product_id (set at save) — the basis provenance
        # keys assert on it
        product_id=f"{model.lower()}_marine_{layer}_global_coarse_{valid_time.strftime('%Y%m%dT%H%M%SZ')}.json",
    )


def _item(model, layer, valid_time, filename, estimated=False):
    return SimpleNamespace(
        model=model, domain="marine", layer=layer, region_id="global_coarse",
        is_estimated=estimated, valid_time_start=valid_time, filename=filename,
        resolution=10.0,
    )


def _scheduler(layers=("waves",), target_hours=(171, 174, 177)):
    items, loaded = [], {}
    for layer in layers:
        a = _item("ICON", layer, ANCHOR_T, f"icon_{layer}_anchor.json")
        ga = _item("GFS", layer, ANCHOR_T, f"gfs_{layer}_anchor.json")
        items += [a, ga]
        loaded[a.filename] = _product("ICON", layer, ANCHOR_T, speed=2.0)
        loaded[ga.filename] = _product("GFS", layer, ANCHOR_T, speed=1.0)
        for h in target_hours:
            t = _item("GFS", layer, RUN + timedelta(hours=h), f"gfs_{layer}_t{h}.json")
            items.append(t)
            loaded[t.filename] = _product("GFS", layer, RUN + timedelta(hours=h), speed=1.2)
    s = MagicMock()
    s.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=items))
    s.store.load_product = MagicMock(side_effect=lambda fn: loaded.get(fn))
    s.store.save_products_batch = MagicMock(side_effect=lambda batch: len(batch))
    return s


@pytest.mark.asyncio
async def test_bakes_icon_estimates_with_honest_basis(monkeypatch):
    monkeypatch.delenv("ICON_MARINE_EXTEND", raising=False)
    sched = _scheduler(layers=("waves", "swell_1"))

    ok = await ingest_icon_marine_extended_estimates_impl(sched)

    assert ok is True
    batch = sched.store.save_products_batch.call_args[0][0]
    assert len(batch) == 6  # 3 targets x 2 layers
    for est, resolution in batch:
        assert est.model == "ICON"
        assert est.is_estimated is True
        assert est.is_forecast_authoritative is False
        assert est.estimate_basis["type"] == "icon_persistence_gfs_blend"
        assert est.estimate_basis["persistence_anchor_product_id"]  # remapped from euro_*
        assert "euro_anchor_product_id" not in est.estimate_basis
        assert est.grid and len(est.grid.vectors) == 1
        assert est.grid.vectors[0].speed > 0  # blend produced a real value
        assert resolution == 10.0


@pytest.mark.asyncio
async def test_kill_switch_and_missing_anchor(monkeypatch):
    monkeypatch.setenv("ICON_MARINE_EXTEND", "0")
    sched = _scheduler()
    assert await ingest_icon_marine_extended_estimates_impl(sched) is False
    sched.store.save_products_batch.assert_not_called()

    monkeypatch.delenv("ICON_MARINE_EXTEND", raising=False)
    empty = MagicMock()
    empty.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=[]))
    assert await ingest_icon_marine_extended_estimates_impl(empty) is False
    empty.store.save_products_batch.assert_not_called()


@pytest.mark.asyncio
async def test_targets_beyond_ceiling_are_excluded(monkeypatch):
    monkeypatch.delenv("ICON_MARINE_EXTEND", raising=False)
    # one in-window target + one beyond run+336h
    sched = _scheduler(layers=("waves",), target_hours=(300, 360))
    ok = await ingest_icon_marine_extended_estimates_impl(sched)
    assert ok is True
    batch = sched.store.save_products_batch.call_args[0][0]
    assert len(batch) == 1  # only the +300h target; +360h is past the 336h ceiling
