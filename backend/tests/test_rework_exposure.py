"""SURF_EXPOSURE_RECONCILED rework (2026-11-04): the pre-registered partition-wise exposure factors
(docs/weather-program/flip-candidates/scorecards/rework-2026-11-04/exposure-partitioned-preregistration.md).
E1 = sqrt(sum w_i x_i), E2 = sqrt(sum w_i (0.55 + 0.45 x_i)^2), R = sqrt(x_bulk); unrepresentative partitions keep
the served factor; the served factor is the production one."""
import math

import pytest

from scripts import rework_exposure_run as X
from services.weather_pipeline.surf_transform import _height_exposure_factor

SN = 270.0


def P(h, tp, d, kind="swell"):
    return {"h": h, "tp": tp, "dir": d, "kind": kind}


def test_one_head_on_train_is_unchanged_by_every_arm():
    f0, fc, rep = X.factors([P(1.0, 14.0, SN)], SN, SN, 1.0, 14.0)
    assert rep and f0 == pytest.approx(1.0)
    assert fc == pytest.approx({"E1": 1.0, "E2": 1.0, "R": 1.0})


def test_a_head_on_swell_under_an_off_axis_bulk_direction_is_raised_by_the_split():
    parts = [P(1.0, 15.0, SN), P(0.6, 6.0, SN + 80.0, "windsea")]
    total = math.sqrt(1.0 + 0.36)
    f0, fc, rep = X.factors(parts, SN + 60.0, SN, total, 15.0)
    assert rep and f0 == pytest.approx(_height_exposure_factor(SN + 60.0, SN))
    assert fc["E2"] > f0, "the dominant head-on swell carries most of the energy"
    assert fc["R"] < f0, "the bulk reconciled curve can only lower"


def test_e1_never_exceeds_e2_and_r_never_exceeds_the_served_factor():
    for d1 in range(0, 360, 30):
        for d2 in range(0, 360, 45):
            parts = [P(1.2, 13.0, d1), P(0.5, 8.0, d2, "windsea")]
            f0, fc, rep = X.factors(parts, d1, SN, math.sqrt(1.44 + 0.25), 13.0)
            assert fc["E1"] <= fc["E2"] + 1e-12
            assert fc["R"] <= f0 + 1e-12


def test_unrepresentative_partitions_and_no_shore_normal_keep_the_served_factor():
    f0, fc, rep = X.factors([P(0.1, 14.0, SN + 90)], SN + 90, SN, 2.0, 14.0)
    assert not rep and fc["E1"] == fc["E2"] == f0
    f0, fc, rep = X.factors([P(1.0, 14.0, SN)], SN, None, 1.0, 14.0)
    assert not rep and fc["E1"] == fc["E2"] == fc["R"] == f0 == 1.0


def test_the_exposure_curve_is_the_served_formula():
    for d in range(0, 360, 15):
        x = X.x_of(d, SN)
        assert 0.55 + 0.45 * x == pytest.approx(_height_exposure_factor(d, SN))


def test_the_euro_host_is_added_only_by_the_runner_and_the_cycle_rule():
    from services.weather_pipeline import eval_provenance as pv
    assert X.EURO_HOST not in pv.ALLOWED_HOSTS, "importing the runner never widens the network guard"
    assert X.EURO_URL.format(d="20241201", hh="00", step=24, ext="index").endswith(
        "/20241201/00z/ifs/0p25/wave/20241201000000-24h-wave-fc.index")
