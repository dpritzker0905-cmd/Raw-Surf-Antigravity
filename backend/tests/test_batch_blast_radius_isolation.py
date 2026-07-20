"""Per-item isolation for the three accumulate-then-save surfaces (2026-07-20 bug-class
sweep — the f9c5e59a blast-radius shape, each skeptic-confirmed):

1. scheduler_helpers.normalize_and_save_loop — a degenerate hourly.time entry used to abort
   the loop BEFORE save_products_batch (whole fetch lost); the blind Z-append also turned
   VALID offset-suffixed ISO-8601 into double-offset ValueErrors.
2. store_helpers.save_products_batch_helper — the per-item loop had no try/except, so one
   poisoned product aborted before the manifest write: rest of batch lost + already-written
   items stranded as unregistered orphans.
3. report_calibration._gather_snapshot — bare gather: one raising spot discarded every
   completed snapshot; the outer wait_for timeout cancelled the lot (zero, not partial).
"""
import asyncio
from datetime import datetime, timezone

import pytest

from services.weather_pipeline.scheduler_helpers import normalize_and_save_loop
from services.weather_pipeline.schemas import (
    GridVector, NormalizedGrid, NormalizedProduct, CoverageBounds
)
from services.weather_pipeline.store import ProductStore
from services.weather_pipeline.report_calibration import _gather_snapshot


# ---------------------------------------------------------------- 1. normalize_and_save_loop

class _FakeNormalizer:
    def __init__(self):
        self.target_times = []

    async def normalize_async(self, **kwargs):
        self.target_times.append(kwargs["target_time"])

        class _P:
            is_test_fixture = False
            is_estimated = False
            is_forecast_authoritative = True
            estimate_basis = None
            source_dataset = "test"
        return _P()


class _FakeStore:
    def __init__(self):
        self.saved = None

    def save_products_batch(self, products):
        self.saved = list(products)
        return len(products)


def test_degenerate_time_entries_cost_one_timestep_not_the_batch():
    """None, truncated, and offset-suffixed entries: the loop must keep going and the batch
    must save every parseable timestep. Pre-fix, entry #2 (None) aborted the whole job."""
    normalizer = _FakeNormalizer()
    store = _FakeStore()
    times = [
        "2026-07-20T00:00",            # naive — legacy shim path
        None,                          # AttributeError on .endswith pre-fix
        "2026-07-2",                   # truncated ValueError
        "2026-07-20T09:00:00+00:00",   # VALID offset-suffixed — pre-fix double-offset ValueError
        "2026-07-20T12:00Z",           # bare-Z path
    ]
    n = asyncio.run(normalize_and_save_loop(
        normalizer, store, [{"hourly": {"time": times}}],
        model="GFS", provider="test", domain="marine", layer="waves",
        bbox={"west": -80, "south": 25, "east": -79, "north": 26}, resolution=1.0,
        run_time=datetime(2026, 7, 20, tzinfo=timezone.utc),
        is_test_env=True, step=1,
    ))
    assert n == 3                                  # naive + offset-suffixed + bare-Z
    assert store.saved is not None and len(store.saved) == 3
    # The offset-suffixed entry must parse to the correct aware instant (not raise).
    assert datetime(2026, 7, 20, 9, 0, tzinfo=timezone.utc) in normalizer.target_times
    # The naive entry is interpreted as UTC, exactly like the legacy Z-append did.
    assert datetime(2026, 7, 20, 0, 0, tzinfo=timezone.utc) in normalizer.target_times


# ---------------------------------------------------------- 2. save_products_batch_helper

BOUNDS = CoverageBounds(west=-85.0, south=24.0, east=-79.0, north=31.0)


def _real_product(hour):
    grid = NormalizedGrid(bounds=BOUNDS, cols=1, rows=1, vectors=[
        GridVector(lat=24.0, lng=-85.0, speed=1.0, u=-1.0, v=0.0, period=8.0, is_valid=True)
    ])
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime(2026, 7, 20, tzinfo=timezone.utc),
        valid_time=datetime(2026, 7, 20, hour, 0, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        coverage=BOUNDS, grid=grid, value_kind="wave_height", value_unit="m",
        display_unit_hint="ft", source_variables=["wave_height"], freshness_sec=1800,
        region_id="global_coarse", tile_id="global_coarse", coverage_mode="global",
    )


class _PoisonProduct:
    """Raises on the very first attribute the batch loop touches."""
    @property
    def grid(self):
        raise RuntimeError("poisoned product")


def test_poisoned_item_costs_one_item_and_manifest_still_writes(tmp_path):
    store = ProductStore(cache_dir=tmp_path / "wp")
    good1, good2 = _real_product(0), _real_product(3)
    n = store.save_products_batch([(good1, 10.0), (_PoisonProduct(), 10.0), (good2, 10.0)])
    assert n == 2
    # Both good items registered in the manifest (no orphaning), files on disk.
    manifest = store.get_manifest()
    names = {p.filename for p in manifest.products}
    assert good1.product_id in names and good2.product_id in names
    assert (store.cache_dir / good1.product_id).exists()
    assert (store.cache_dir / good2.product_id).exists()


# ----------------------------------------------------------------- 3. _gather_snapshot

def test_one_raising_spot_keeps_the_rest():
    async def fn(sp):
        if sp == "bad":
            raise RuntimeError("spot exploded")
        return {"spot_id": sp}
    out = asyncio.run(_gather_snapshot(fn, ["a", "bad", "b"]))
    got = {e["spot_id"] for e in out if e}
    assert got == {"a", "b"}


def test_deadline_keeps_completed_partials():
    async def fn(sp):
        if sp == "slow":
            await asyncio.sleep(5.0)
        return {"spot_id": sp}
    out = asyncio.run(_gather_snapshot(fn, ["a", "slow", "b"], timeout=0.3))
    got = {e["spot_id"] for e in out if e}
    assert got == {"a", "b"}          # pre-fix: wait_for cancelled ALL three -> zero


def test_empty_spots_returns_empty():
    async def fn(sp):  # pragma: no cover - never called
        return sp
    assert asyncio.run(_gather_snapshot(fn, [])) == []
