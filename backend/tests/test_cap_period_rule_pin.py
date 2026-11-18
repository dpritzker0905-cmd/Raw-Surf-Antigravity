"""The partitioned depth cap's PERIOD RULE, pinned as it is today, and marked UNDECIDED (D-081).

When swell trains are transformed separately and recombined (`estimate_surf_partitioned`), the combined height is
bounded by a depth-limited cap, and that cap needs ONE period for its breaker index. Today's rule:

    the cap period is the LONGEST period among the LISTED trains,

whatever that train's share of the energy, and whether or not the train itself transformed to anything.

That is a design choice, not a measured result. The alternative, the period of the MOST ENERGETIC transformed train,
gave a different served height on 31 of 1,089 capped spot-steps in an offline replay of one ECMWF run (27 of them on
the US east coast; `log/2026-11-18-fable-cap-period-rule-pin.md`). Neither rule has been scored against anything.

Nothing live uses this path: both partition lanes are off (`SURF_PARTITIONS`, `ECMWF_PERIOD_BANDS`). These tests exist
so that (1) nobody changes the rule by accident, and (2) nobody turns a partition lane ON without a gate that decides
it. A deliberate change of rule changes these tests in the same PR as its gate.
"""
import os
import re
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import surf_transform as st  # noqa: E402

DEPTH, SHELF_KM, BREAK_DEPTH = 20.0, 5.0, 3.0
KW = dict(coastal=True, shelf_width_km=SHELF_KM, break_depth_m=BREAK_DEPTH, water_level_m=0.0)
SLOPE = DEPTH / (SHELF_KM * 1000.0)


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    for k in ("SURF_BREAK_DEPTH", "SURF_HEIGHT_H110", "SURF_CAP_SEAM_MONOTONE"):
        monkeypatch.delenv(k, raising=False)


def _cap(tp):
    return st.breaker_index(tp, slope=SLOPE) * st.effective_cap_depth(DEPTH, BREAK_DEPTH, 0.0)


# A big short-period sea that transforms to the larger height, and a smaller long-period train. Each train is first
# capped on its OWN period; the rule under test is the period of the cap on their COMBINED height.
DOMINANT = {"h": 6.0, "tp": 8.0, "dir": None, "kind": "windsea"}
MINOR_LONG = {"h": 0.7, "tp": 20.0, "dir": None, "kind": "swell"}


def _alone(train):
    return st.estimate_surf(train["h"], train["tp"], DEPTH, swell_from_deg=None, shore_normal_deg=None,
                            magnet_factor=1.0, **KW)[0]


def test_the_two_candidate_rules_give_different_answers_here_so_this_file_can_tell_them_apart():
    assert _cap(20.0) > _cap(8.0) * 1.05
    big, small = _alone(DOMINANT), _alone(MINOR_LONG)
    assert big > small > 0, "the short-period train must be the MORE energetic one after the transform"
    assert (big * big + small * small) ** 0.5 >= _cap(20.0), "the combined height must reach the cap"


def test_the_cap_period_is_the_longest_listed_period_not_the_most_energetic_trains():
    height, regime = st.estimate_surf_partitioned([DOMINANT, MINOR_LONG], DEPTH, **KW)
    assert regime == "breaking", "the cap must bind, or this test pins nothing about the cap"
    assert height == pytest.approx(_cap(20.0), rel=1e-12)            # TODAY'S RULE: the longest listed period
    assert height != pytest.approx(_cap(8.0), rel=1e-6)              # not the dominant train's period


def test_the_order_of_the_trains_does_not_matter():
    a = st.estimate_surf_partitioned([DOMINANT, MINOR_LONG], DEPTH, **KW)
    b = st.estimate_surf_partitioned([MINOR_LONG, DOMINANT], DEPTH, **KW)
    assert a == b


@pytest.mark.parametrize("unused", [{"h": None, "tp": 20.0}, {"h": 0.0, "tp": 20.0}, {"h": -1.0, "tp": 20.0}])
def test_a_listed_train_that_is_not_used_still_sets_the_cap_period(unused):
    """TODAY'S RULE reads the LISTED trains: a train with no usable height contributes no energy and still supplies
    the cap period. In the offline replay this case occurred on 0 of 1,276 spot-steps; it is pinned because it is
    what the code does, not because it is right."""
    two = [DOMINANT, dict(DOMINANT)]                                 # two 8 s trains: together above either cap
    height, regime = st.estimate_surf_partitioned(two + [dict(unused, dir=None, kind="swell")], DEPTH, **KW)
    assert regime == "breaking"
    assert height == pytest.approx(_cap(20.0), rel=1e-12)            # the unused 20 s train supplied the cap period
    without, _ = st.estimate_surf_partitioned(two, DEPTH, **KW)
    assert without == pytest.approx(_cap(8.0), rel=1e-12)            # without it, the trains' own 8 s


def test_one_train_alone_is_capped_on_its_own_period():
    height, regime = st.estimate_surf_partitioned([DOMINANT], DEPTH, **KW)
    assert regime == "breaking" and height == pytest.approx(_cap(8.0), rel=1e-12)


def test_below_the_cap_the_period_rule_changes_nothing():
    small = [{"h": 0.2, "tp": 8.0, "dir": None}, {"h": 0.1, "tp": 20.0, "dir": None}]
    height, regime = st.estimate_surf_partitioned(small, DEPTH, **KW)
    assert height is not None and regime != "breaking"
    assert height < min(_cap(8.0), _cap(20.0))


def test_the_registry_says_the_rule_is_undecided_and_the_lane_is_off():
    from routes.admin.surf_forecast import _RATING_FLAGS
    default, what = _RATING_FLAGS["SURF_PARTITIONS"][0], _RATING_FLAGS["SURF_PARTITIONS"][1]
    assert default == "0"
    assert "cap period rule UNDECIDED (D-081): gate before ON" in what


def test_the_period_band_ingest_lane_is_off_by_default(monkeypatch):
    from services import ecmwf_opendata_fetcher as f
    monkeypatch.delenv("ECMWF_PERIOD_BANDS", raising=False)
    src = open(f.__file__, encoding="utf-8").read()
    assert 'os.environ.get("ECMWF_PERIOD_BANDS", "0") == "1"' in src


def test_the_decision_is_on_the_record():
    path = os.path.join(os.path.dirname(BACKEND), "docs", "weather-program", "DECISIONS.md")
    text = open(path, encoding="utf-8").read()
    m = re.search(r"^### D-081 · (.+)$", text, re.M)
    assert m and "cap" in m.group(1).lower() and "period" in m.group(1).lower()
    entry = text[m.start():]
    assert "SURF_PARTITIONS" in entry and "ECMWF_PERIOD_BANDS" in entry and "test_cap_period_rule_pin.py" in entry
