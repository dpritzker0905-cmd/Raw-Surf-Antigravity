"""SURF_PARTITION_TRACKING (dark): swell partitions are matched by direction + period across the bilinear stencil
before they are interpolated, because GFS-Wave numbers its partitions per node (WW3 §3.12) and a slot-wise blend
mixes two swells wherever the ranking flips. See services/weather_pipeline/partition_tracking.py.

Pinned here:
  * a swapped-slot stencil: the slot-wise blend invents a period and bearing neither train has; tracking keeps both;
  * a no-swap stencil: tracking is EXACTLY the slot-wise answer (the flag moves a number only where a swap is);
  * births and deaths: a train at one corner keeps only that corner's share of the energy, never the whole of it;
  * direction wrap at 0/360;
  * energy: the sum of the trains' Hs^2 equals the weighted mean of the corners' partition energies;
  * time: ids persist through a slot swap, and the hour blend is the same tracked stencil;
  * the wiring: flag OFF, neither supplier calls the tracker and the served trains are byte-identical; flag ON,
    the point lane and the hub serve the SAME tracked trains through the real sampler's grid index.
"""
import json
import math
import os
import random
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import partition_tracking as PT  # noqa: E402

A = {"h": 1.2, "tp": 16.0, "dir": 275.0, "kind": "swell"}     # a long-period W groundswell
B = {"h": 1.0, "tp": 9.0, "dir": 200.0, "kind": "swell"}      # a mid-period SSW swell


def _p(base, slot, h=None, tp=None, d=None):
    q = dict(base, slot=slot)
    if h is not None:
        q["h"] = h
    if tp is not None:
        q["tp"] = tp
    if d is not None:
        q["dir"] = d
    return q


def _swapped_stencil():
    # Corners 0, 1 rank A first; corners 2, 3 rank B first (B slightly bigger there): the slot swap.
    return [
        (0.4, [_p(A, 1), _p(B, 2)]),
        (0.3, [_p(A, 1, h=1.15, tp=15.6), _p(B, 2, h=0.95, tp=9.2)]),
        (0.2, [_p(B, 1, h=1.25, tp=9.1, d=205.0), _p(A, 2, h=1.1, tp=15.8, d=272.0)]),
        (0.1, [_p(B, 1, h=1.3, tp=8.8, d=198.0), _p(A, 2, h=1.05, tp=16.2, d=278.0)]),
    ]


def _no_swap_stencil():
    return [
        (0.4, [_p(A, 1), _p(B, 2)]),
        (0.3, [_p(A, 1, h=1.15, tp=15.6), _p(B, 2, h=0.95, tp=9.2)]),
        (0.2, [_p(A, 1, h=1.25, tp=15.8, d=272.0), _p(B, 2, h=1.1, tp=9.1, d=205.0)]),
        (0.1, [_p(A, 1, h=1.3, tp=16.2, d=278.0), _p(B, 2, h=1.05, tp=8.8, d=198.0)]),
    ]


def _weighted_energy(corners):
    ocean = [(w, ps) for w, ps in corners if ps is not None and w > 0]
    ws = sum(w for w, _ in ocean)
    return sum(w / ws * sum(p["h"] ** 2 for p in ps if p.get("h", 0) > 0 and p.get("tp", 0) > 0) for w, ps in ocean)


# ── the pure module ────────────────────────────────────────────────────────────────────────────────────────

def test_a_swapped_slot_stencil_mixes_two_swells_and_tracking_keeps_them_apart():
    corners = _swapped_stencil()
    slot = PT.slotwise_partitions(corners)
    tracked = PT.tracked_partitions(corners)
    # POSITIVE CONTROL: the slot-wise blend really does invent a train (period between the two, bearing between).
    mixed = [p for p in slot if 10.5 < p["tp"] < 14.5]
    assert mixed, f"the fixture must reproduce the defect in the control arm first (L-F18): {slot}"
    # Tracked: one train is A (period and bearing within its own corners' spread), one is B; nothing between.
    assert len(tracked) == 2
    a = min(tracked, key=lambda p: abs(p["tp"] - 16.0))
    b = min(tracked, key=lambda p: abs(p["tp"] - 9.0))
    assert 15.5 <= a["tp"] <= 16.3 and 271.0 <= a["dir"] <= 279.0, a
    assert 8.7 <= b["tp"] <= 9.3 and 197.0 <= b["dir"] <= 206.0, b
    assert not [p for p in tracked if 10.5 < p["tp"] < 14.5]


def test_a_no_swap_stencil_is_exactly_the_slotwise_answer():
    corners = _no_swap_stencil()
    assert PT.tracked_partitions(corners) == PT.slotwise_partitions(corners)


def test_seeded_no_swap_stencils_are_exactly_slotwise():
    rng = random.Random(7)
    for _ in range(200):
        base = [(rng.uniform(0.3, 3.0), rng.uniform(5.0, 20.0), rng.uniform(0.0, 360.0)) for _ in range(3)]
        # well-separated trains (>= 2 gates apart in period), each corner perturbed well inside one gate
        base.sort(key=lambda t: t[1])
        if any(base[i + 1][1] / base[i][1] < 1.6 for i in range(2)):
            continue
        corners = []
        for _c in range(4):
            ps = [{"h": h * rng.uniform(0.9, 1.1), "tp": tp * rng.uniform(0.97, 1.03),
                   "dir": (d + rng.uniform(-5, 5)) % 360.0, "kind": "swell", "slot": k}
                  for k, (h, tp, d) in enumerate(base)]
            corners.append((rng.uniform(0.05, 1.0), ps))
        assert PT.tracked_partitions(corners) == PT.slotwise_partitions(corners)


def test_a_birth_keeps_only_its_corners_share_of_energy_never_the_whole():
    c_train = {"h": 0.8, "tp": 18.0, "dir": 300.0, "kind": "swell", "slot": 2}
    corners = [(0.25, [_p(A, 1)]), (0.25, [_p(A, 1)]), (0.25, [_p(A, 1)]), (0.25, [_p(A, 1), c_train])]
    tracked = PT.tracked_partitions(corners)
    c = [p for p in tracked if abs(p["tp"] - 18.0) < 0.01]
    assert len(c) == 1
    assert c[0]["h"] == pytest.approx(0.8 * math.sqrt(0.25), abs=1e-4)      # 0.4 m, not 0.8 m
    a = [p for p in tracked if abs(p["tp"] - 16.0) < 0.01]
    assert a and a[0]["h"] == pytest.approx(1.2, abs=1e-4)


def test_a_death_at_some_corners_is_zero_energy_there_and_a_land_corner_drops_out():
    corners = [(0.5, [_p(A, 1)]), (0.3, []), (0.2, None)]       # corner 1 ocean with no train; corner 2 land
    tracked = PT.tracked_partitions(corners)
    assert len(tracked) == 1
    assert tracked[0]["h"] == pytest.approx(1.2 * math.sqrt(0.5 / 0.8), abs=1e-4)
    assert PT.tracked_partitions([(0.5, None), (0.5, None)]) == []


def test_a_genuinely_new_train_is_a_birth_not_a_blend():
    # Same slot, but the corners hold two different trains with no partner anywhere: slot-wise blends them,
    # tracking keeps two weighted trains.
    corners = [(0.5, [_p(A, 1)]), (0.5, [_p(B, 1)])]
    tracked = PT.tracked_partitions(corners)
    assert sorted(p["tp"] for p in tracked) == [9.0, 16.0]
    assert PT.slotwise_partitions(corners)[0]["tp"] not in (9.0, 16.0)


def test_direction_wraps_at_north():
    assert PT.dir_distance(355.0, 5.0) == pytest.approx(10.0)
    assert PT.match_cost({"tp": 12.0, "dir": 355.0}, {"tp": 12.0, "dir": 5.0}) < PT.GATE
    corners = [(0.5, [{"h": 1.0, "tp": 12.0, "dir": 355.0, "kind": "swell", "slot": 1}]),
               (0.5, [{"h": 1.0, "tp": 12.0, "dir": 5.0, "kind": "swell", "slot": 1}])]
    tracked = PT.tracked_partitions(corners)
    assert len(tracked) == 1
    assert PT.dir_distance(tracked[0]["dir"], 0.0) < 0.01, tracked       # north, not south


def test_a_missing_bearing_matches_only_a_close_period():
    assert PT.match_cost({"tp": 12.0, "dir": None}, {"tp": 12.5, "dir": 90.0}) <= PT.GATE
    assert PT.match_cost({"tp": 12.0, "dir": None}, {"tp": 15.0, "dir": 90.0}) > PT.GATE


def test_energy_is_conserved_on_seeded_random_stencils():
    rng = random.Random(11)
    for _ in range(300):
        corners = []
        for _c in range(4):
            if rng.random() < 0.1:
                corners.append((rng.uniform(0.0, 1.0), None))
                continue
            ps = [{"h": rng.uniform(0.1, 3.0), "tp": rng.uniform(4.0, 22.0), "dir": rng.uniform(0, 360),
                   "kind": rng.choice(["swell", "windsea"]), "slot": k} for k in range(rng.randint(0, 3))]
            corners.append((rng.uniform(0.01, 1.0), ps))
        want = _weighted_energy(corners)
        for got in (PT.tracked_partitions(corners), PT.slotwise_partitions(corners)):
            assert PT.total_energy(got) == pytest.approx(want, rel=2e-3, abs=2e-4)


def test_nan_and_nonpositive_trains_are_not_trains():
    corners = [(1.0, [{"h": float("nan"), "tp": 12.0, "dir": 0.0}, {"h": 1.0, "tp": 0.0, "dir": 0.0},
                      {"h": 1.0, "tp": 10.0, "dir": float("nan"), "kind": "swell"}])]
    out = PT.tracked_partitions(corners)
    assert out == [{"h": 1.0, "tp": 10.0, "dir": None, "kind": "swell"}]


def test_ids_persist_through_an_hourly_slot_swap():
    h0 = [_p(A, 1), _p(B, 2)]
    h1 = [_p(B, 1, h=1.3), _p(A, 2, h=1.1)]          # the ranking flips: slot 1 is now B
    seq = PT.track_sequence([h0, h1])
    a_id = [k for k, p in seq[0].items() if p["tp"] == 16.0][0]
    assert seq[1][a_id]["tp"] == 16.0
    blended = PT.interpolate_hours(h0, h1, 0.5)
    assert sorted(round(p["tp"]) for p in blended) == [9, 16]


# ── the wiring, through the real sampler and both suppliers ─────────────────────────────────────────────────

def _products(swapped=True):
    from services.weather_pipeline.schemas import CoverageBounds, GridVector, NormalizedGrid, NormalizedProduct
    now = datetime(2026, 11, 2, 0, tzinfo=timezone.utc)
    bounds = CoverageBounds(west=-120.0, south=30.0, east=-119.75, north=30.25)
    nodes = [(30.0, -120.0), (30.0, -119.75), (30.25, -120.0), (30.25, -119.75)]
    flip = {(30.25, -120.0), (30.25, -119.75)} if swapped else set()

    def _vec(lat, lng, tr):
        r = math.radians(tr["dir"])
        return GridVector(lat=lat, lng=lng, speed=tr["h"], direction=tr["dir"], period=tr["tp"],
                          u=-tr["h"] * math.sin(r), v=-tr["h"] * math.cos(r))

    def _prod(layer, pick):
        vecs = [_vec(la, lo, pick((la, lo) in flip)) for la, lo in nodes]
        b = bounds.model_copy()
        return NormalizedProduct(
            model="GFS", provider="noaa", domain="marine", layer=layer, run_time=now, valid_time=now,
            is_forecast_authoritative=True, is_estimated=False, coverage=b,
            grid=NormalizedGrid(bounds=b.model_copy(), cols=2, rows=2, vectors=vecs),
            value_kind="wave_height", value_unit="m", display_unit_hint="ft",
            source_variables=[layer], freshness_sec=3600)

    a2 = dict(A, h=1.0)
    b2 = dict(B, h=1.3)
    return {
        "swell_1": _prod("swell_1", lambda f: b2 if f else A),
        "swell_2": _prod("swell_2", lambda f: a2 if f else B),
        "wind_waves": _prod("wind_waves", lambda f: {"h": 0.4, "tp": 5.0, "dir": 300.0}),
    }


class _Resolver:
    """The hub's resolver shape (find_cached_grid_product + sampler) over in-memory products."""

    def __init__(self, products):
        from services.weather_pipeline.sampler import PointSampler
        self.products = products
        self.sampler = PointSampler()

    async def find_cached_grid_product(self, model, domain, layer, lat, lng, dt):
        return self.products.get(layer)


def _point_service(products, monkeypatch):
    from services.weather_pipeline.point_resolution import PointResolutionService
    svc = PointResolutionService.__new__(PointResolutionService)
    res = _Resolver(products)
    svc.__dict__["sampler"] = res.sampler

    async def fake_internal(model, domain, layer, lat, lng, valid_time_str, **kw):
        return res.sampler.sample_point(products[layer], lat, lng)     # the slot-wise sample, as served

    async def fake_cached(model, domain, layer, lat, lng, dt):
        return products.get(layer)

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
    monkeypatch.setattr(svc, "find_cached_grid_product", fake_cached, raising=False)
    return svc


LAT, LNG, VT = 30.2, -119.8, "2026-11-02T00:00:00Z"
TOTAL_H = 1.75


async def _both_lanes(monkeypatch, products):
    from services.weather_pipeline import spot_conditions
    svc = _point_service(products, monkeypatch)
    point = await svc._resolve_partitions("GFS", "waves", LAT, LNG, VT, TOTAL_H)
    hub = await spot_conditions._spectral_partitions(
        _Resolver(products), "GFS", LAT, LNG, datetime(2026, 11, 2, tzinfo=timezone.utc), TOTAL_H)
    return point, hub


async def test_flag_off_neither_supplier_calls_the_tracker_and_the_trains_are_byte_identical(monkeypatch):
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    products = _products(swapped=True)
    monkeypatch.delenv("SURF_PARTITION_TRACKING", raising=False)
    base_point, base_hub = await _both_lanes(monkeypatch, products)

    async def _boom(*a, **k):
        raise AssertionError("the tracker ran with the flag off")

    monkeypatch.setattr(PT, "tracked_from_cache", _boom)
    for value in (None, "0", ""):
        if value is None:
            monkeypatch.delenv("SURF_PARTITION_TRACKING", raising=False)
        else:
            monkeypatch.setenv("SURF_PARTITION_TRACKING", value)
        point, hub = await _both_lanes(monkeypatch, products)
        assert json.dumps(point, sort_keys=True) == json.dumps(base_point, sort_keys=True)
        assert json.dumps(hub, sort_keys=True) == json.dumps(base_hub, sort_keys=True)
    assert base_point and base_hub


async def test_flag_on_both_suppliers_serve_the_same_tracked_trains(monkeypatch):
    from services.weather_pipeline.surf_partitions import reconcile_partitions
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    products = _products(swapped=True)
    monkeypatch.setenv("SURF_PARTITION_TRACKING", "0")
    off_point, _ = await _both_lanes(monkeypatch, products)
    monkeypatch.setenv("SURF_PARTITION_TRACKING", "1")
    on_point, on_hub = await _both_lanes(monkeypatch, products)
    assert on_point == on_hub, "the point lane and the hub must serve one composition"
    # Control arm: the slot-wise sample at this point blends the swap into a period neither train has.
    assert [p for p in off_point if p["kind"] == "swell" and min(abs(p["tp"] - 9.0), abs(p["tp"] - 16.0)) > 1.0], off_point
    swells = sorted((p for p in on_point if p["kind"] == "swell"), key=lambda p: p["tp"])
    assert [round(p["tp"]) for p in swells] == [9, 16], on_point
    assert PT.total_energy(on_point) == pytest.approx(TOTAL_H ** 2, rel=1e-6)    # still reconciled to the total
    assert on_point == reconcile_partitions(on_point, TOTAL_H)


async def test_flag_on_without_a_swap_changes_nothing_but_the_arithmetic_is_the_trackers(monkeypatch):
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    monkeypatch.setenv("SURF_PARTITION_TRACKING", "1")
    products = _products(swapped=False)
    res = _Resolver(products)
    corners = PT.stencil_from_products(
        res.sampler, [(products["swell_1"], "swell", 0), (products["swell_2"], "swell", 1),
                      (products["wind_waves"], "windsea", 2)], LAT, LNG)
    assert corners and len(corners) == 4
    assert PT.tracked_partitions(corners) == PT.slotwise_partitions(corners)


async def test_flag_on_fails_open_for_other_models_and_mismatched_lattices(monkeypatch):
    products = _products(swapped=True)
    untracked = [{"h": 1.0, "tp": 12.0, "dir": 250.0, "kind": "swell"}]
    res = _Resolver(products)
    dt = datetime(2026, 11, 2, tzinfo=timezone.utc)
    assert await PT.tracked_from_cache(res, "ICON", LAT, LNG, dt, untracked) is untracked
    assert await PT.tracked_from_cache(res, "GFS", LAT, LNG, None, untracked) is untracked
    other = _products(swapped=True)
    other["swell_2"].grid.bounds.west = -121.0
    assert await PT.tracked_from_cache(_Resolver(other), "GFS", LAT, LNG, dt, untracked) is untracked
    assert await PT.tracked_from_cache(res, "GFS", 50.0, 10.0, dt, untracked) is untracked     # outside the grid
