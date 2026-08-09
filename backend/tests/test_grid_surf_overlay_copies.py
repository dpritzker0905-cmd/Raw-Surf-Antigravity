"""The surf overlay's copies and its wind sampler — Phase-1 rewrites pinned against the originals.

Two changes landed 2026-08-09 (MASTER-AUDIT-11.0 §3.4 + serving-perf F1), both REQUIRED to be
behaviour-preserving:
  1. `_make_nearest_sampler` replaced a per-cell pure-Python O(M) scan (8.9x the warm cost of the
     whole rating loop) with a numpy argmin. The differential here carries a VERBATIM copy of the
     old scan and demands identical outputs — including ties, poles, the antimeridian, and exact
     node hits. ⚠️ The old copy imports surf_rating.KT_TO_MS rather than hardcoding it: a bench
     draft hardcoded 1852/3600 and produced a 100% mismatch that was entirely the harness's.
  2. `apply_surf_overlay` stopped deep-copying before the skip decision (+119 ms/world frame,
     wasted). The cache-safety contract is UNCHANGED and pinned here in all three branches:
     skip, transform, and the exception-before-copy path — the original cached product must never
     be mutated, because store.py returns shallow model_copy()s whose diagnostics dict is SHARED.
"""
import random
import sys
import os

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from datetime import datetime, timezone

from services.weather_pipeline.grid_resolver_surf import (   # noqa: E402
    _make_nearest_sampler, apply_surf_overlay)
from services.weather_pipeline.schemas import (               # noqa: E402
    CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct)
from services.weather_pipeline.surf_rating import KT_TO_MS    # noqa: E402


def _vex(m, seed=20260809):
    rng = random.Random(seed)
    return [GridVector(lat=rng.uniform(-80, 85), lng=rng.uniform(-180, 180),
                       speed=rng.uniform(0, 40), direction=rng.uniform(0, 360))
            for _ in range(m)]


def _old_sampler(vex):
    """VERBATIM logic of the closure `_make_nearest_sampler` replaced (5e181f69 and earlier)."""
    def sampler(lat, lng):
        if lat is None or lng is None:
            return None
        best_v, best_d = None, None
        for v in vex:
            dlng = abs(v.lng - lng)
            if dlng > 180:
                dlng = 360 - dlng
            d = (v.lat - lat) ** 2 + dlng ** 2
            if best_d is None or d < best_d:
                best_d = d
                best_v = v
        if best_v is None:
            return None
        return (best_v.speed * KT_TO_MS, getattr(best_v, "direction", None))
    return sampler


def test_the_argmin_sampler_is_bit_identical_to_the_scan_it_replaced():
    vex = _vex(629)
    old, new = _old_sampler(vex), _make_nearest_sampler(vex)
    rng = random.Random(7)
    probes = ([(rng.uniform(-70, 70), rng.uniform(-180, 180)) for _ in range(1500)]
              + [(v.lat, v.lng) for v in vex[:60]]                 # exact node hits
              + [(85.0, 180.0), (-80.0, -180.0), (0.0, 179.999), (0.0, -179.999), (0.0, 0.0)])
    mismatches = [(la, ln) for la, ln in probes if old(la, ln) != new(la, ln)]
    assert not mismatches, (
        f"{len(mismatches)} of {len(probes)} probes diverge from the verbatim old scan; "
        f"first: {mismatches[0]} -> old {old(*mismatches[0])} new {new(*mismatches[0])}")
    assert new(None, 3.0) is None and new(3.0, None) is None


def test_ties_resolve_to_the_first_vector_exactly_like_the_strict_scan():
    """np.argmin keeps the FIRST minimum; the old `d < best_d` scan kept the first winner. Two
    vectors at identical distance must select the earlier one under both."""
    a = GridVector(lat=10.0, lng=10.0, speed=5.0, direction=90.0)
    b = GridVector(lat=10.0, lng=10.0, speed=25.0, direction=270.0)   # same coords, later
    for order in ((a, b), (b, a)):
        old, new = _old_sampler(list(order)), _make_nearest_sampler(list(order))
        assert old(10.0, 10.0) == new(10.0, 10.0) == (order[0].speed * KT_TO_MS,
                                                      order[0].direction)


def _product(nv=40, span_world=True):
    east = 180 if span_world else -100
    rng = random.Random(3)
    vecs = [GridVector(lat=rng.uniform(20, 40), lng=rng.uniform(-140, -110), speed=2.0)
            for _ in range(nv)]
    return NormalizedProduct(
        model="GFS", provider="open-meteo", domain="marine", layer="waves",
        run_time=datetime.now(timezone.utc), valid_time=datetime.now(timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        coverage=CoverageBounds(west=-180, south=-80, east=east, north=85),
        grid=NormalizedGrid(bounds=CoverageBounds(west=-180, south=-80, east=east, north=85),
                            cols=1, rows=1, vectors=vecs, diagnostics={"base": "cached"}),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=3600)


class _Manifest:
    products = []


async def test_the_skip_branch_never_mutates_the_shared_cached_product():
    """World-span frame -> the skip branch. It used to pay a full deepcopy for a diagnostics
    stamp; now it must pay a shallow copy AND still never touch the original (the diagnostics
    dict is shared with the cache)."""
    cached = _product(span_world=True)
    base_diag = cached.grid.diagnostics
    out = await apply_surf_overlay(cached, store=None, manifest=_Manifest(), model="GFS",
                                   domain="marine", layer="waves", surf=True, target_dt=None)
    assert out is not cached
    assert out.grid.diagnostics.get("surf_transform", {}).get("skipped") == "coarse_extent"
    assert "surf_transform" not in base_diag, "the SHARED cached diagnostics dict was mutated"
    assert cached.grid.diagnostics is base_diag and base_diag == {"base": "cached"}
    assert out.grid.vectors is cached.grid.vectors, (
        "the skip branch copied vectors it never mutates — the 119 ms this change removed")


async def test_the_transform_branch_mutates_only_its_own_vector_copies(monkeypatch):
    """Regional frame -> the transform branch. The transform mutates vectors in place; the
    per-vector copies must contain that entirely (the live-proven surf=0/surf=1 cache
    cross-contamination incident is the reason this contract exists)."""
    def fake_transform(vectors, *a, **k):
        for v in vectors:
            v.speed = -777.0
            v.is_valid = False
        return len(vectors), 0

    import services.weather_pipeline.surf_rating as SR
    monkeypatch.setattr(SR, "rating_transform_grid", fake_transform)
    cached = _product(span_world=False)
    speeds_before = [v.speed for v in cached.grid.vectors]
    out = await apply_surf_overlay(cached, store=None, manifest=_Manifest(), model="GFS",
                                   domain="marine", layer="waves", surf=True, target_dt=None)
    assert all(v.speed == -777.0 for v in out.grid.vectors), "transform did not reach the copy"
    assert [v.speed for v in cached.grid.vectors] == speeds_before, (
        "the transform reached the SHARED cached vectors — cache poisoning is back")
    assert "surf_transform" not in cached.grid.diagnostics
    assert out.is_estimated is True and cached.is_estimated is False


async def test_an_exception_before_any_copy_still_never_touches_the_cache(monkeypatch):
    """The forensic skip_reason stamp must not poison the cache when the failure predates the
    branch copy (e.g. the bathymetry import itself)."""
    monkeypatch.setitem(sys.modules, "services.weather_pipeline.bathymetry", None)
    cached = _product(span_world=False)
    out = await apply_surf_overlay(cached, store=None, manifest=_Manifest(), model="GFS",
                                   domain="marine", layer="waves", surf=True, target_dt=None)
    assert "surf_skip_reason" in (out.grid.diagnostics or {}), "forensic stamp lost"
    assert "surf_skip_reason" not in (cached.grid.diagnostics or {}), (
        "the skip_reason was stamped onto the SHARED cached product")
