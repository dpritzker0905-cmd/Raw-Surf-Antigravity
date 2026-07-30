"""In-band lattice gap fill (2026-07-30, the "blank day" family, user-reported).

ECMWF open-data is 6-hourly past +144h while the scrubber walks a 3-hourly lattice, so every odd-3
slot in that band had NO product at any tier (measured live: EURO waves 12-14 gap slots per global
tier, EURO wind 16). The filler interpolates the missing frame between its two native brackets when
they are close (≤6h) and refuses to bridge wide holes — a 46h dead hole is a data-loss condition
that must stay visible, not be painted over with a two-day straight line."""
import math
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from services.weather_pipeline.lattice_fill import (
    interpolate_between,
    find_fill_slots,
    fill_inband_lattice_gaps_impl,
)
from services.weather_pipeline.schemas import (
    NormalizedProduct, NormalizedGrid, GridVector, CoverageBounds,
)

T0 = datetime(2026, 8, 5, 0, 0, tzinfo=timezone.utc)
RUN = datetime(2026, 7, 30, 0, 0, tzinfo=timezone.utc)
BOUNDS = CoverageBounds(west=-180.0, south=-80.0, east=180.0, north=85.0)


def _vec(h, direction, period, is_valid=True):
    rad = direction * math.pi / 180.0
    return GridVector(
        lat=0.0, lng=0.0, speed=h, direction=direction,
        u=-h * math.sin(rad), v=-h * math.cos(rad),
        period=period, is_valid=is_valid,
    )


def _product(valid_time, vectors, cols=2, rows=2, model="EURO", layer="waves", domain="marine",
             region_id="global_coarse", run_time=RUN, is_estimated=False):
    return NormalizedProduct(
        model=model, provider="open-meteo", domain=domain, layer=layer,
        run_time=run_time, valid_time=valid_time,
        is_forecast_authoritative=not is_estimated, is_estimated=is_estimated,
        coverage=BOUNDS,
        grid=NormalizedGrid(bounds=BOUNDS, cols=cols, rows=rows, vectors=vectors),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        product_id=f"test_{model}_{layer}_{valid_time.strftime('%Y%m%dT%H%M%SZ')}",
        source_variables=["wave_height"], freshness_sec=3600,
        region_id=region_id, coverage_mode="global_tile",
    )


def _four(h, direction, period):
    return [_vec(h, direction, period) for _ in range(4)]


# ---------------------------------------------------------------- find_fill_slots

def _item(t, run_time=RUN, filename="f.json", resolution=10.0):
    return SimpleNamespace(valid_time_start=t, run_time=run_time,
                           filename=filename, resolution=resolution)


def test_six_hour_bracket_yields_the_midpoint_slot():
    items = [_item(T0), _item(T0 + timedelta(hours=6))]
    slots = find_fill_slots(items, max_bracket_h=6.0)
    assert [(s.isoformat()) for _, _, s in slots] == [(T0 + timedelta(hours=3)).isoformat()]


def test_clean_three_hourly_series_yields_nothing():
    items = [_item(T0 + timedelta(hours=3 * k)) for k in range(5)]
    assert find_fill_slots(items, max_bracket_h=6.0) == []


def test_wide_hole_is_refused():
    """A 46h hole (the ICON wind purge defect) must NOT be bridged by linear interpolation."""
    items = [_item(T0), _item(T0 + timedelta(hours=46))]
    assert find_fill_slots(items, max_bracket_h=6.0) == []


def test_off_lattice_brackets_yield_nothing():
    """The stale off-lattice tail (13:00/19:00) must not spawn off-lattice interpolations."""
    a = T0 + timedelta(hours=13)
    items = [_item(a), _item(a + timedelta(hours=6))]
    assert find_fill_slots(items, max_bracket_h=6.0) == []


def test_duplicate_valid_time_prefers_newest_run():
    stale = _item(T0, run_time=RUN - timedelta(hours=12), filename="old.json")
    fresh = _item(T0, run_time=RUN, filename="new.json")
    items = [stale, fresh, _item(T0 + timedelta(hours=6))]
    slots = find_fill_slots(items, max_bracket_h=6.0)
    assert len(slots) == 1
    assert slots[0][0].filename == "new.json"


# ---------------------------------------------------------------- interpolate_between

def test_midpoint_interpolates_height_period_and_circular_direction():
    a = _product(T0, _four(1.0, 350.0, 8.0))
    b = _product(T0 + timedelta(hours=6), _four(1.0, 10.0, 10.0))
    est = interpolate_between(a, b, T0 + timedelta(hours=3))
    assert est is not None
    v = est.grid.vectors[0]
    assert v.speed == pytest.approx(1.0, abs=1e-3)
    assert v.period == pytest.approx(9.0, abs=1e-2)
    # circular: midpoint of 350° and 10° is 0°, never the arithmetic 180°
    assert min(v.direction, 360.0 - v.direction) == pytest.approx(0.0, abs=0.1)
    # u/v recomposed consistently with height+direction
    assert math.hypot(v.u, v.v) == pytest.approx(v.speed, abs=1e-3)
    assert est.is_estimated is True
    assert est.provider == "estimated"
    assert est.is_forecast_authoritative is False
    assert est.estimate_basis["type"] == "native_time_interpolation"
    assert est.estimate_basis["weight"] == pytest.approx(0.5)
    assert est.valid_time == T0 + timedelta(hours=3)
    assert len(est.grid.vectors) == est.grid.cols * est.grid.rows


def test_weight_follows_time_not_half():
    a = _product(T0, _four(1.0, 0.0, 8.0))
    b = _product(T0 + timedelta(hours=6), _four(4.0, 0.0, 8.0))
    est = interpolate_between(a, b, T0 + timedelta(hours=3) + timedelta(hours=1, minutes=30))
    # 4.5h of 6h → w=0.75 → h = 0.25*1 + 0.75*4 = 3.25
    assert est.grid.vectors[0].speed == pytest.approx(3.25, abs=1e-3)


def test_invalid_cell_on_either_side_stays_invalid():
    va = [_vec(1.0, 0.0, 8.0), _vec(1.0, 0.0, 8.0, is_valid=False),
          _vec(1.0, 0.0, 8.0), _vec(1.0, 0.0, 8.0)]
    vb = [_vec(2.0, 0.0, 8.0), _vec(2.0, 0.0, 8.0),
          _vec(2.0, 0.0, 8.0, is_valid=False), _vec(2.0, 0.0, 8.0)]
    est = interpolate_between(_product(T0, va), _product(T0 + timedelta(hours=6), vb),
                              T0 + timedelta(hours=3))
    assert est.grid.vectors[1].is_valid is False
    assert est.grid.vectors[2].is_valid is False
    assert est.grid.vectors[0].is_valid is True


def test_mismatched_geometry_is_refused():
    a = _product(T0, _four(1.0, 0.0, 8.0))
    b = _product(T0 + timedelta(hours=6), [_vec(1.0, 0.0, 8.0)] * 6, cols=3, rows=2)
    assert interpolate_between(a, b, T0 + timedelta(hours=3)) is None


def test_slot_outside_bracket_is_refused():
    a = _product(T0, _four(1.0, 0.0, 8.0))
    b = _product(T0 + timedelta(hours=6), _four(1.0, 0.0, 8.0))
    assert interpolate_between(a, b, T0) is None
    assert interpolate_between(a, b, T0 + timedelta(hours=6)) is None
    assert interpolate_between(a, b, T0 - timedelta(hours=3)) is None


# ---------------------------------------------------------------- the job

def _scheduler_with(items_by_filename):
    sched = MagicMock()
    manifest = SimpleNamespace(products=[it for it, _ in items_by_filename.values()])
    sched.store.get_manifest.return_value = manifest
    sched.store.load_product.side_effect = lambda fn: items_by_filename.get(fn, (None, None))[1]
    sched.store.save_products_batch.side_effect = lambda batch: len(batch)
    return sched


def _manifest_entry(product, filename, resolution=10.0):
    item = SimpleNamespace(
        model=product.model, domain=product.domain, layer=product.layer,
        region_id=product.region_id, valid_time_start=product.valid_time,
        run_time=product.run_time, filename=filename, resolution=resolution,
        is_estimated=product.is_estimated,
    )
    return item, product


@pytest.mark.asyncio
async def test_impl_fills_euro_tail_gap_and_refuses_wide_hole(monkeypatch):
    monkeypatch.delenv("LATTICE_INBAND_FILL", raising=False)
    pa = _product(T0, _four(1.0, 90.0, 9.0))
    pb = _product(T0 + timedelta(hours=6), _four(2.0, 90.0, 9.0))
    # ICON wind: native then a 46h-later estimate — the purge-defect shape, must NOT be bridged
    ia = _product(T0, _four(5.0, 180.0, None), model="ICON", layer="wind", domain="wind")
    ib = _product(T0 + timedelta(hours=46), _four(5.0, 180.0, None),
                  model="ICON", layer="wind", domain="wind", is_estimated=True)
    sched = _scheduler_with({
        "a.json": _manifest_entry(pa, "a.json"),
        "b.json": _manifest_entry(pb, "b.json"),
        "ia.json": _manifest_entry(ia, "ia.json"),
        "ib.json": _manifest_entry(ib, "ib.json"),
    })
    ok = await fill_inband_lattice_gaps_impl(sched)
    assert ok is True
    (batch,), _ = sched.store.save_products_batch.call_args
    assert len(batch) == 1
    est, resolution = batch[0]
    assert est.model == "EURO" and est.layer == "waves"
    assert est.valid_time == T0 + timedelta(hours=3)
    assert est.grid.vectors[0].speed == pytest.approx(1.5, abs=1e-3)
    assert resolution == 10.0


@pytest.mark.asyncio
async def test_impl_kill_switch(monkeypatch):
    monkeypatch.setenv("LATTICE_INBAND_FILL", "0")
    sched = MagicMock()
    ok = await fill_inband_lattice_gaps_impl(sched)
    assert ok is False
    sched.store.get_manifest.assert_not_called()


@pytest.mark.asyncio
async def test_impl_is_idempotent_when_slot_already_filled(monkeypatch):
    monkeypatch.delenv("LATTICE_INBAND_FILL", raising=False)
    pa = _product(T0, _four(1.0, 90.0, 9.0))
    mid = _product(T0 + timedelta(hours=3), _four(1.5, 90.0, 9.0), is_estimated=True)
    pb = _product(T0 + timedelta(hours=6), _four(2.0, 90.0, 9.0))
    sched = _scheduler_with({
        "a.json": _manifest_entry(pa, "a.json"),
        "m.json": _manifest_entry(mid, "m.json"),
        "b.json": _manifest_entry(pb, "b.json"),
    })
    ok = await fill_inband_lattice_gaps_impl(sched)
    assert ok is False
    sched.store.save_products_batch.assert_not_called()
