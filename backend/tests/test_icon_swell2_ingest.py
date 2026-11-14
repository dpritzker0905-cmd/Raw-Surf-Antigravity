"""ICON swell_2 stored as a derived product (2026-11-13, option B; services/weather_pipeline/icon_swell2_ingest.py).

The blend math itself is pinned against the browser by test_icon_swell2_blend.py; this pins the JOB: both global tiers are baked,
labelled estimated with the browser's basis and the inputs' identities, EURO is paired within 3 h (else GFS alone, 1/0), an unchanged
pair is carried (no load, no upload), and it stores nothing unless armed (ICON_SWELL2_STORED=1; dark by default).
"""
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.weather_pipeline.icon_swell2_ingest import ingest_icon_swell2_blend_impl
from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct

RUN = datetime(2026, 11, 13, 6, 0, tzinfo=timezone.utc)
BOUNDS = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)
ING = datetime(2026, 11, 13, 9, 0, tzinfo=timezone.utc)


def _product(model, t, speed, direction=90.0, region="global_coarse"):
    import math
    r = math.radians(direction)
    grid = NormalizedGrid(bounds=BOUNDS, cols=1, rows=1, vectors=[GridVector(
        lat=0.0, lng=0.0, speed=speed, direction=direction, u=-speed * math.sin(r), v=-speed * math.cos(r), period=10.0, is_valid=True)])
    return NormalizedProduct(model=model, provider="p", domain="marine", layer="swell_2", run_time=RUN, valid_time=t,
                             is_forecast_authoritative=True, is_estimated=False, coverage=BOUNDS, grid=grid, value_kind="wave_height",
                             value_unit="m", display_unit_hint="ft", source_variables=[], freshness_sec=1800, region_id=region,
                             coverage_mode="global_tile", product_id=f"{model.lower()}_{region}_{t:%H}.json")


def _item(model, t, filename, region="global_coarse", estimated=False, basis=None, ingested=ING):
    return SimpleNamespace(model=model, domain="marine", layer="swell_2", region_id=region, is_estimated=estimated,
                           valid_time_start=t, filename=filename, resolution=10.0 if region == "global_coarse" else 2.0,
                           ingested_at=ingested, estimate_basis=basis)


def _scheduler(items, loaded):
    s = MagicMock()
    s.store.get_manifest = MagicMock(return_value=SimpleNamespace(products=items))
    s.store.load_product = MagicMock(side_effect=lambda fn: loaded.get(fn))
    s.store.save_products_batch = MagicMock(side_effect=lambda batch: len(batch))
    return s


def _pair(t, region, gfs_speed=1.0, euro_speed=2.0, euro_dt=0):
    g = _item("GFS", t, f"g_{region}_{t:%H}.json", region)
    e = _item("EURO", t + timedelta(hours=euro_dt), f"e_{region}_{t:%H}.json", region)
    return [g, e], {g.filename: _product("GFS", t, gfs_speed, region=region),
                    e.filename: _product("EURO", t + timedelta(hours=euro_dt), euro_speed, region=region)}


@pytest.mark.asyncio
async def test_bakes_both_tiers_with_the_browser_blend_and_basis(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_STORED", "1")
    t = RUN + timedelta(hours=12)
    i1, l1 = _pair(t, "global_coarse")
    i2, l2 = _pair(t, "global_mid")
    s = _scheduler(i1 + i2, {**l1, **l2})
    assert await ingest_icon_swell2_blend_impl(s) is True
    batch = s.store.save_products_batch.call_args[0][0]
    assert sorted(p.region_id for p, _ in batch) == ["global_coarse", "global_mid"]
    for p, res in batch:
        assert (p.model, p.layer, p.provider, p.is_estimated, p.source_dataset) == ("ICON", "swell_2", "estimated", True, "estimated_blend")
        v = p.grid.vectors[0]
        assert v.speed == pytest.approx(0.6 * 1.0 + 0.4 * 2.0) and v.direction == pytest.approx(90.0) and v.is_valid
        b = p.estimate_basis
        assert (b["type"], b["gfs_weight"], b["euro_weight"]) == ("icon_swell_2_gfs_euro_blend", 0.6, pytest.approx(0.4))
        assert b["gfs_source"].startswith(f"g_{p.region_id}_") and b["euro_source"].startswith(f"e_{p.region_id}_")
        assert res == (10.0 if p.region_id == "global_coarse" else 2.0)


@pytest.mark.asyncio
async def test_euro_beyond_three_hours_blends_gfs_alone(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_STORED", "1")
    t = RUN + timedelta(hours=12)
    items, loaded = _pair(t, "global_coarse", euro_dt=6)          # EURO's nearest frame is 6 h away: outside /grid's window
    s = _scheduler(items, loaded)
    assert await ingest_icon_swell2_blend_impl(s) is True
    p = s.store.save_products_batch.call_args[0][0][0][0]
    assert (p.estimate_basis["gfs_weight"], p.estimate_basis["euro_weight"], p.estimate_basis["euro_source"]) == (1.0, 0.0, None)
    assert p.grid.vectors[0].speed == pytest.approx(1.0)


@pytest.mark.asyncio
async def test_an_unchanged_pair_is_carried_not_rebuilt(monkeypatch):
    monkeypatch.setenv("ICON_SWELL2_STORED", "1")
    t = RUN + timedelta(hours=12)
    items, loaded = _pair(t, "global_coarse")
    src = (f"g_global_coarse_{t:%H}.json@{ING.isoformat()}", f"e_global_coarse_{t:%H}.json@{ING.isoformat()}")
    done = _item("ICON", t, "icon_done.json", estimated=True, basis={"gfs_source": src[0], "euro_source": src[1]})
    s = _scheduler(items + [done], loaded)
    assert await ingest_icon_swell2_blend_impl(s) is False
    s.store.load_product.assert_not_called()
    s.store.save_products_batch.assert_not_called()
    # a re-ingested input (new ingested_at) is a new input: rebuilt
    items[1].ingested_at = ING + timedelta(hours=4)
    s2 = _scheduler(items + [done], loaded)
    assert await ingest_icon_swell2_blend_impl(s2) is True


@pytest.mark.asyncio
@pytest.mark.parametrize("value", [None, "0"])
async def test_dark_by_default_and_off_stores_nothing(monkeypatch, value):
    if value is None:
        monkeypatch.delenv("ICON_SWELL2_STORED", raising=False)
    else:
        monkeypatch.setenv("ICON_SWELL2_STORED", value)
    items, loaded = _pair(RUN, "global_coarse")
    s = _scheduler(items, loaded)
    assert await ingest_icon_swell2_blend_impl(s) is False
    s.store.get_manifest.assert_not_called()
    s.store.save_products_batch.assert_not_called()
