"""Static-frame parity tolerances come from each field's own encoding step, and marine u/v allow for the sea's height.

WHY (2026-10-23). The pilots publish of run 40019869501 refused 5 ICON world frames ("parity refused, nothing uploaded",
one bad node each), and continue-on-error kept the step green, so those hours silently went unpublished. The logged
dir_confidence error (0.001967) looked like the cause, but it is inside its own tolerance (half its 1/254 step,
0.0019685); four of the five frames had dir_confidence error 0.0. Every one failed the u/v check instead (0.0012 -
0.0016 against a FIXED 0.0012). The stored u/v come from the unrounded height and direction, and the frame rebuilds
them from the 0.01-deg direction, so the error grows with height (h * radians(0.005)). Measured with the real codec
over 400,000 nodes, it crosses 0.0012 at 10-12 m seas. These tests pin: every field's tolerance is half its step; a value
at the very edge of rounding passes, and one off by a whole step or by twice the bound fails; a 15 m sea on the direction
rounding edge passes the u/v check (the old fixed tolerance refuses it: the control); the old 0.0012 stays a floor.
"""
import math
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services import frame_binary as fb  # noqa: E402


def _node(lat, lng, h=1.5, d=200.0, period=10.0, conf=0.8, direction=None):
    """One stored vector as the normalizer writes it: speed 4 dp, direction 2 dp, u/v 4 dp from the UNROUNDED h and d."""
    rad = math.radians(d)
    return {"lat": lat, "lng": lng, "is_valid": True, "speed": round(h, 4),
            "direction": (round(d, 2) % 360.0) if direction is None else direction,
            "u": round(-h * math.sin(rad), 4), "v": round(-h * math.cos(rad), 4), "period": period,
            "dir_confidence": conf}


def _product(first):
    """A 2 x 2 product whose first node is `first`; the other three are ordinary."""
    nodes = [first, _node(0.0, 1.0), _node(1.0, 0.0), _node(1.0, 1.0)]
    return {"grid": {"cols": 2, "rows": 2, "vectors": nodes}, "valid_time": "2026-10-23T00:00:00Z"}


def _check(product, tamper=None):
    dec = fb.decode_frame(fb.encode_frame(product))
    if tamper:
        tamper(dec)
    return fb.parity(product, dec)


# ── every field's tolerance is its own step ─────────────────────────────────────────────────────────────────────────
@pytest.mark.parametrize("fid", [fb.HEIGHT, fb.DIRECTION, fb.PERIOD, fb.DIR_CONFIDENCE, fb.SPEED, fb.PRESSURE_HPA])
def test_every_field_tolerance_is_half_its_own_encoding_step(fid):
    assert fb.TOLERANCE[fid] == fb.FIELD_SPECS[fid][3] / 2.0 + fb.FLOAT_SLACK


def test_the_lane_weight_tolerance_is_one_whole_step_by_its_max_one_floor():
    assert fb.TOLERANCE[fb.LANE_WEIGHT] == fb.FIELD_SPECS[fb.LANE_WEIGHT][3] + fb.FLOAT_SLACK


# ── the rounding edge passes; a whole step, or twice the bound, fails ──────────────────────────────────────────────
EDGE = {   # a source value whose quantisation error is (all but) half a step: the worst rounding can do
    fb.HEIGHT: dict(h=2.0005),                            # 2000.5 mm -> 2000: 0.0005 m off
    fb.DIRECTION: dict(d=123.455, direction=123.455),     # 12345.5 hundredths -> 0.005 deg off (u/v from the same d)
    fb.PERIOD: dict(period=9.875),                        # 987.5 hundredths -> 0.005 s off
    fb.DIR_CONFIDENCE: dict(conf=127.5 / 254.0),          # code 127.5 -> 128: half of 1/254 off (the 0.0019685 edge)
}


@pytest.mark.parametrize("fid", sorted(EDGE))
def test_a_value_on_the_rounding_edge_passes_and_a_step_or_twice_the_bound_off_fails(fid):
    first = _node(0.0, 0.0, **EDGE[fid])
    clean = _check(_product(first))
    name = fb.FIELD_NAMES[fid]
    assert clean["bad"] == 0, clean
    assert clean["max_abs_err"][name] >= fb.FIELD_SPECS[fid][3] / 2.0 - 2e-6, (
        f"the edge case must really sit on the rounding edge to test anything: {clean['max_abs_err']}")
    for off in (fb.FIELD_SPECS[fid][3], 2 * fb.TOLERANCE[fid]):
        def tamper(dec, off=off):
            dec["fields"][fid][0] += off
        assert _check(_product(first), tamper)["bad"] == 1, f"{name} off by {off} passed"


# ── marine u/v: the height term ────────────────────────────────────────────────────────────────────────────────────
def test_the_marine_uv_tolerance_grows_with_height_and_keeps_the_old_floor():
    assert fb.uv_tolerance(fb.HEIGHT, 0.0) == fb.MARINE_UV_TOL_FLOOR == 0.0012
    tols = [fb.uv_tolerance(fb.HEIGHT, h) for h in (0, 5, 8, 10, 12, 15, 20)]
    assert tols == sorted(tols) and tols[-1] > 0.0012
    assert fb.uv_tolerance(fb.HEIGHT, 15.0) == pytest.approx(fb.MARINE_UV_TOL_BASE + 15.0 * math.radians(0.005), abs=1e-7)
    assert fb.uv_tolerance(fb.SPEED, 30.0) == fb.WIND_UV_TOL_BASE + fb.WIND_UV_TOL_PER_KN * 30.0   # wind unchanged


# 15 m, the unrounded direction on the 0.01-deg rounding edge, near 0 deg so the turn lands in one component (u):
# 15 * radians(0.004999) = 0.0013, past the old fixed 0.0012 and inside the new 0.00065 + 15 * radians(0.005) = 0.00196.
BIG_SEA = dict(h=15.0, d=0.004999)


def test_a_big_sea_on_the_direction_rounding_edge_passes_the_uv_check():
    got = _check(_product(_node(0.0, 0.0, **BIG_SEA)))
    assert got["bad"] == 0, got
    assert got["uv_max_err"] > 0.0012, f"the case must exceed the old fixed tolerance to test the height term: {got}"


def test_the_old_fixed_tolerance_refuses_that_big_sea(monkeypatch):
    """The control: with the height term removed (the old fixed 0.0012), the same frame is refused, as ICON's were."""
    monkeypatch.setattr(fb, "MARINE_UV_TOL_PER_M", 0.0)
    monkeypatch.setattr(fb, "MARINE_UV_TOL_BASE", 0.0)
    assert _check(_product(_node(0.0, 0.0, **BIG_SEA)))["bad"] == 1


def test_a_uv_off_by_twice_its_bound_still_fails_at_any_height():
    for h in (0.5, 6.0, 15.0):
        first = _node(0.0, 0.0, h=h, d=211.0)
        off = 2 * fb.uv_tolerance(fb.HEIGHT, h)
        first["u"] = round(first["u"] + off, 4)
        assert _check(_product(first))["bad"] == 1, f"a u/v off by {off} at {h} m passed"
