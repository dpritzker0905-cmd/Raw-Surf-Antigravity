"""Spectral partitions: the data path, the reconciliation guard, and the re-entrancy guard.

`estimate_surf_partitioned` has been landed, tested and DARK since `b9595de6` — nothing supplied
`partitions`. This wires the supply side at the SINGLE injection point where `surf_height_m` is
produced (`point_resolution.resolve_point`), because computing it anywhere else would give the spot
hub and the weather sim a different height from the map glyphs — the divergence CLAUDE.md's ONE
FORECAST COMPOSITION rule exists to prevent.

Two guards carry the weight:

  1. RECONCILIATION. The partitions do not sum to the total field, in BOTH directions. Measured
     live 2026-07-29 over 16 spots: |quadrature - total|/total median 9.5%, max 43.8%; OVER at 10
     spots, UNDER at 1 (Bondi -22.3%). Raw partitions therefore INVENT energy — median +6.2% above
     the total-field estimate. Normalising to the total keeps the model's own scale and changes only
     the distribution across periods.

  2. RE-ENTRANCY. The surf transform lives in `resolve_point`; resolving partitions through that
     same public method would make each partition resolve its own, recursively. It goes through
     `_resolve_point_internal` instead, so recursion is unreachable rather than merely avoided.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.point_resolution import PointResolutionService
from services.weather_pipeline.surf_transform import (
    estimate_surf_partitioned, reconcile_partitions)

import math

# Real production numbers, 2026-07-29.
MAVS_TOTAL = 1.7257
MAVS = [{"h": 0.8419, "tp": 10.25, "dir": 272.21, "kind": "swell"},
        {"h": 0.3904, "tp": 15.37, "dir": 219.29, "kind": "swell"},
        {"h": 1.7135, "tp": 6.69, "dir": 303.36, "kind": "windsea"}]     # quad 1.9487 -> +12.9%
BONDI_TOTAL = 0.5
BONDI = [{"h": 0.20, "tp": 8.85, "dir": 173.0, "kind": "swell"},
         {"h": 0.18, "tp": 3.00, "dir": 4.0, "kind": "swell"},
         {"h": 0.28, "tp": 2.35, "dir": 282.0, "kind": "windsea"}]       # quad 0.3883 -> -22.3%


def _quad(ps):
    return math.sqrt(sum(float(p["h"]) ** 2 for p in ps))


# ── reconciliation ──────────────────────────────────────────────────────────────────────────────

def test_partitions_that_OVERSHOOT_the_total_are_scaled_down():
    """Mavericks: the three trains carry 12.9% more energy than the `waves` layer reports. Feeding
    that in raw would inflate the surf with energy the model never said was there."""
    assert _quad(MAVS) > MAVS_TOTAL
    out = reconcile_partitions(MAVS, MAVS_TOTAL)
    assert _quad(out) == pytest.approx(MAVS_TOTAL, rel=1e-9)


def test_partitions_that_UNDERSHOOT_the_total_are_scaled_UP():
    """Bondi is the other direction — the guard must not be a one-sided clamp."""
    assert _quad(BONDI) < BONDI_TOTAL
    out = reconcile_partitions(BONDI, BONDI_TOTAL)
    assert _quad(out) == pytest.approx(BONDI_TOTAL, rel=1e-9)


def test_reconciling_changes_the_SCALE_and_never_the_SHAPE():
    """The total Hs is the scale; the partitions are the shape. Periods, bearings and the ENERGY
    RATIO between trains must all survive untouched — otherwise this is re-weighting the spectrum,
    not normalising it."""
    out = reconcile_partitions(MAVS, MAVS_TOTAL)
    for before, after in zip(MAVS, out):
        assert after["tp"] == before["tp"]
        assert after["dir"] == before["dir"]
        assert after["kind"] == before["kind"]
    for before, after in zip(MAVS, out):
        assert after["h"] / before["h"] == pytest.approx(out[0]["h"] / MAVS[0]["h"], rel=1e-9)


def test_the_input_list_is_not_mutated():
    """The caller's partitions are reused for the rating factors; silently rescaling them in place
    would move a second consumer without its knowledge."""
    snapshot = [dict(p) for p in MAVS]
    reconcile_partitions(MAVS, MAVS_TOTAL)
    assert MAVS == snapshot


def test_an_already_consistent_sea_state_is_returned_UNCHANGED():
    """Inside tolerance the object is returned as-is, so a consistent sea state is byte-identical
    and cannot drift by a rounding step."""
    assert reconcile_partitions(MAVS, _quad(MAVS)) is MAVS


@pytest.mark.parametrize("total", [None, 0, -1.0, "not a number"])
def test_reconciliation_fails_OPEN_on_an_unusable_total(total):
    assert reconcile_partitions(MAVS, total) is MAVS


@pytest.mark.parametrize("parts", [None, [], [{"h": None, "tp": 10.0}], [{"h": 0.0, "tp": 10.0}]])
def test_reconciliation_fails_OPEN_on_unusable_partitions(parts):
    assert reconcile_partitions(parts, 1.5) is parts


def test_reconciling_removes_the_systematic_INFLATION_it_exists_for():
    """The measured effect: raw partitions ran a median +6.2% above the total-field estimate purely
    from the overshoot. At Mavericks the reconciled estimate must sit BELOW the raw one."""
    kw = dict(coastal=True, shelf_width_km=44.0, shore_normal_deg=225.1, break_depth_m=22.1)
    raw, _ = estimate_surf_partitioned(MAVS, 101.5, **kw)
    norm, _ = estimate_surf_partitioned(reconcile_partitions(MAVS, MAVS_TOTAL), 101.5, **kw)
    assert raw is not None and norm is not None
    assert norm < raw, "reconciling an overshoot must reduce the estimate"


# ── the supply path ─────────────────────────────────────────────────────────────────────────────

class _FakePoint:
    def __init__(self, speed, period, direction):
        self.speed, self.period, self.direction = speed, period, direction


class _FakeResponse:
    def __init__(self, point):
        self.point = point


def _service_with(monkeypatch, answers, calls):
    """A service whose INTERNAL resolve returns canned points and records every layer asked for."""
    svc = PointResolutionService.__new__(PointResolutionService)

    async def fake_internal(model, domain, layer, lat, lng, valid_time_str, **kw):
        calls.append(layer)
        a = answers.get(layer)
        return _FakeResponse(_FakePoint(*a)) if a else _FakeResponse(None)

    monkeypatch.setattr(svc, "_resolve_point_internal", fake_internal, raising=False)
    return svc


ANSWERS = {"swell_1": (0.8419, 10.25, 272.21), "swell_2": (0.3904, 15.37, 219.29),
           "wind_waves": (1.7135, 6.69, 303.36)}


@pytest.mark.asyncio
async def test_the_flag_is_OFF_by_default_and_nothing_is_fetched(monkeypatch):
    """4x the point resolutions is not a default. The serve box is 1-CPU with a three-incident melt
    history; this must cost nothing until somebody turns it on deliberately."""
    monkeypatch.delenv("SURF_PARTITIONS", raising=False)
    calls = []
    svc = _service_with(monkeypatch, ANSWERS, calls)
    assert await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", 1.7) is None
    assert calls == [], "the disabled path must not dial at all"


@pytest.mark.asyncio
async def test_only_the_TOTAL_layer_has_partitions_to_split(monkeypatch):
    """Asking swell_1 for its own partitions is the recursion this guards against, stated as intent
    rather than relying on the call graph alone."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    calls = []
    svc = _service_with(monkeypatch, ANSWERS, calls)
    for layer in ("swell_1", "swell_2", "wind_waves"):
        assert await svc._resolve_partitions("GFS", layer, 37.5, -122.5, "t", 1.7) is None
    assert calls == []


@pytest.mark.asyncio
async def test_partitions_are_resolved_reconciled_and_typed(monkeypatch):
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    calls = []
    svc = _service_with(monkeypatch, ANSWERS, calls)
    out = await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", MAVS_TOTAL)
    assert calls == ["swell_1", "swell_2", "wind_waves"]
    assert [p["kind"] for p in out] == ["swell", "swell", "windsea"]
    assert [p["tp"] for p in out] == [10.25, 15.37, 6.69]
    assert _quad(out) == pytest.approx(MAVS_TOTAL, rel=1e-6), "must come back reconciled"


@pytest.mark.asyncio
async def test_the_resolution_goes_through_the_INTERNAL_method(monkeypatch):
    """THE RE-ENTRANCY GUARD, pinned structurally: the surf transform lives in `resolve_point`, so
    if partitions were resolved through it each partition would resolve its own, forever."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    calls = []
    svc = _service_with(monkeypatch, ANSWERS, calls)

    async def explode(*a, **k):
        raise AssertionError("_resolve_partitions must not call the PUBLIC resolve_point")

    monkeypatch.setattr(svc, "resolve_point", explode, raising=False)
    assert await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", MAVS_TOTAL)


@pytest.mark.asyncio
async def test_a_partition_that_fails_is_SKIPPED_not_fatal(monkeypatch):
    """Fails open in every branch — a partition miss must never cost the caller its estimate."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    calls = []
    svc = PointResolutionService.__new__(PointResolutionService)

    async def flaky(model, domain, layer, lat, lng, valid_time_str, **kw):
        calls.append(layer)
        if layer == "swell_2":
            raise RuntimeError("product missing")
        return _FakeResponse(_FakePoint(*ANSWERS[layer]))

    monkeypatch.setattr(svc, "_resolve_point_internal", flaky, raising=False)
    out = await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", MAVS_TOTAL)
    assert calls == ["swell_1", "swell_2", "wind_waves"]
    assert len(out) == 2, "the surviving trains are still used"


@pytest.mark.asyncio
async def test_no_usable_partition_returns_None_so_the_caller_falls_back(monkeypatch):
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    svc = _service_with(monkeypatch, {}, [])
    assert await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", 1.7) is None


@pytest.mark.asyncio
async def test_a_flat_or_zero_period_partition_is_rejected(monkeypatch):
    """h=0 or Tp=0 together are a mask signature, not a calm sea — a dead-calm ocean still has a
    peak period. Feeding one in would put a zero-energy train into the quadrature."""
    monkeypatch.setenv("SURF_PARTITIONS", "1")
    svc = _service_with(monkeypatch, {"swell_1": (0.84, 10.25, 272.0),
                                      "swell_2": (0.0, 0.0, 0.0),
                                      "wind_waves": (1.71, 0.0, 303.0)}, [])
    out = await svc._resolve_partitions("GFS", "waves", 37.5, -122.5, "t", 0.84)
    assert len(out) == 1 and out[0]["tp"] == 10.25
