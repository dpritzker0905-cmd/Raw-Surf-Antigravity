"""A non-finite height or period is not a sea state: the surf chain gives no estimate, and never raises.

Found 2026-11-17 (LongCat, verified by the research lead, reproduced before the fix):
  * Tp = +inf raised ZeroDivisionError in the Komar step (L0 = inf, then 0.0 ** -0.2), bulk and partitioned;
  * Hs = +inf did NOT raise: it came back as a FINITE height (the depth cap), a made-up number from a fill value;
  * Hs = -inf came back as (0.0, 'calm').
NaN was already guarded. Finite inputs are untouched by the guard."""
import math
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import surf_point
from services.weather_pipeline.surf_transform import estimate_surf, estimate_surf_partitioned, komar_breaker_height

INF, NAN = float("inf"), float("nan")
GEOMETRY = {"break_depth_m": 3.0, "shore_normal_deg": 270.0, "swell_from_deg": 280.0}
NON_FINITE = [(1.0, INF), (1.0, -INF), (1.0, NAN), (INF, 10.0), (-INF, 10.0), (NAN, 10.0), (INF, INF), (NAN, INF),
              (INF, NAN), (-INF, -INF)]


@pytest.mark.parametrize("hs,tp", NON_FINITE)
@pytest.mark.parametrize("kwargs", [{}, GEOMETRY], ids=["bare", "geometry"])
def test_a_non_finite_height_or_period_gives_no_estimate_and_never_raises(hs, tp, kwargs):
    assert estimate_surf(hs, tp, 20.0, coastal=True, shelf_width_km=10.0, **kwargs) == (None, "unknown")


@pytest.mark.parametrize("hs,tp", NON_FINITE)
def test_the_guard_comes_before_every_other_branch(hs, tp):
    assert estimate_surf(hs, tp, 20.0, coastal=False) == (None, "unknown")           # not passed through as open ocean
    assert estimate_surf(hs, tp, None, coastal=True) == (None, "unknown")            # nor as an unknown-depth height


def test_an_infinite_height_is_no_longer_served_as_the_depth_cap():
    """The dangerous one: before the fix this returned a finite 'breaking' height, indistinguishable from a real one."""
    h, regime = estimate_surf(INF, 10.0, 20.0, coastal=True, shelf_width_km=10.0, **GEOMETRY)
    assert h is None and regime == "unknown"


def test_the_komar_step_returns_none_for_non_finite_inputs():
    for hs, tp in ((1.0, INF), (INF, 10.0), (NAN, 10.0), (1.0, NAN), (INF, INF), (1.0, -INF), (-INF, 10.0)):
        assert komar_breaker_height(hs, tp) is None
    assert komar_breaker_height(1.0, 10.0) == pytest.approx(0.56 * (1.0 / (9.81 * 100.0 / (2.0 * math.pi))) ** -0.2, rel=1e-3)


BAD_TRAINS = [{"h": 0.5, "tp": INF, "dir": 280.0, "kind": "swell"}, {"h": INF, "tp": 9.0, "dir": 280.0, "kind": "swell"},
              {"h": NAN, "tp": 9.0, "dir": 280.0, "kind": "swell"}, {"h": 0.5, "tp": NAN, "dir": 280.0, "kind": "swell"},
              {"h": -INF, "tp": 9.0, "dir": 280.0, "kind": "swell"}, {"h": 0.5, "tp": -INF, "dir": 280.0, "kind": "swell"}]
PART_KW = {"coastal": True, "shelf_width_km": 10.0, "shore_normal_deg": 270.0}


@pytest.mark.parametrize("bad", BAD_TRAINS, ids=["tp_inf", "h_inf", "h_nan", "tp_nan", "h_neg_inf", "tp_neg_inf"])
def test_a_non_finite_train_is_dropped_and_the_other_trains_are_kept(bad):
    """Decided and pinned: one bad train costs that train and nothing else, wherever it sits in the list."""
    a = {"h": 1.0, "tp": 10.0, "dir": 280.0, "kind": "swell"}
    b = {"h": 0.6, "tp": 14.0, "dir": 275.0, "kind": "swell"}
    want = estimate_surf_partitioned([a, b], 20.0, **PART_KW)
    assert want[0] is not None and math.isfinite(want[0])
    for parts in ([a, b, bad], [bad, a, b], [a, bad, b]):
        assert estimate_surf_partitioned(parts, 20.0, **PART_KW) == want
    assert estimate_surf_partitioned([bad], 20.0, **PART_KW) == (None, "unknown")    # nothing usable: the caller falls back


@pytest.mark.parametrize("bad", [t for t in BAD_TRAINS if not math.isfinite(t["tp"])], ids=["tp_inf", "tp_nan", "tp_neg_inf"])
def test_a_non_finite_period_does_not_set_the_depth_cap(bad):
    """Before 2026-11-17 a dropped inf-period train still raised the cap to its ceiling (2.345 -> 2.430 m here)."""
    big = [{"h": 4.0, "tp": 10.0, "dir": 280.0, "kind": "swell"}, {"h": 3.0, "tp": 8.0, "dir": 275.0, "kind": "swell"}]
    want = estimate_surf_partitioned(big, 20.0, break_depth_m=3.0, **PART_KW)
    assert want[1] == "breaking"                                                     # the cap binds, or this tests nothing
    for parts in (big + [bad], [bad] + big):
        assert estimate_surf_partitioned(parts, 20.0, break_depth_m=3.0, **PART_KW) == want


def test_the_point_composition_gives_no_estimate_at_a_real_coordinate():
    geo = surf_point.resolve_surf_geometry(21.6650, -158.0500)                       # the pipeline sweep point
    for hs, tp in NON_FINITE:
        assert surf_point.estimate_surf_at(21.6650, -158.0500, hs, tp, swell_from_deg=315.0, geometry=geo) == (None, "unknown")


@pytest.mark.parametrize("hs,tp", [(0.1, 2.0), (1.0, 10.0), (4.0, 14.0), (12.0, 20.0), (20.0, 30.0), (1e6, 25.0), (1.0, 1e6)])
def test_large_but_finite_inputs_still_get_a_finite_estimate(hs, tp):
    h, regime = estimate_surf(hs, tp, 20.0, coastal=True, shelf_width_km=10.0, **GEOMETRY)
    assert h is not None and math.isfinite(h) and h > 0.0 and regime in ("shelf", "shoaling", "breaking")


def test_the_edges_that_already_had_an_answer_keep_it():
    assert estimate_surf(0.0, 10.0, 20.0) == (0.0, "calm") and estimate_surf(-1.0, 10.0, 20.0) == (0.0, "calm")
    assert estimate_surf(1.0, 0.0, 20.0) == (None, "unknown") and estimate_surf(1.0, -5.0, 20.0) == (None, "unknown")
    assert estimate_surf(None, 10.0, 20.0) == (None, "unknown") and estimate_surf(1.0, None, 20.0) == (None, "unknown")
