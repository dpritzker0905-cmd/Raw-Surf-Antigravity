"""THE HEIGHT-CHAIN ANCHORS -- exact served values in BOTH regimes, so a constant cannot move silently.

WHY (MASTER-AUDIT-11.0 Phase 0): the repo's one exact height anchor
(test_small_island_coastal_promotion.py, Pipeline 12 m/18 s = 29.50 ft) sits in the DEPTH-SATURATED
regime, where the served value is the gamma*d ceiling and every pre-cap constant cancels. Measured
at HEAD ce9250a2 (2026-08-09): SURF_REFRACTION_KR=1.0, SURF_HEIGHT_H110=0, and BOTH reverted all
read 29.50 ft exactly -- a documented one-env-var revert of the shipped refraction calibration was
invisible to every value test in the tree. This file adds the non-saturated anchor that sees them.

MEASURED AT HEAD ce9250a2 -- the basis for every assertion below. Pipeline 2 m / 14 s / 315 deg:
    shipped (Kr 0.797, H110 on) : 10.11 ft  shoaling
    SURF_REFRACTION_KR=1.0      : 12.68 ft  (+25.5%)   the one-env-var revert, now visible
    SURF_HEIGHT_H110=0          :  7.96 ft  (-21.3%)
    both reverted               :  9.99 ft  ( -1.2%)   THE TRAP -- see below

(!) THE PAIR NEARLY CANCELS: (1/0.797) x (1/1.27) = 0.988, so a DOUBLE revert moves this anchor
only 0.12 ft -- 2.4x the tolerance, thin margin. That is why each single revert's measured delta is
pinned as a DISCRIMINATION CONTROL: the controls prove the anchor can see each constant
individually; the value assertion alone would catch the pair by a whisker and each leg not at all
if the tolerance ever loosened.

(!) CHARTER: these anchors pin the SHIPPED calibration. If the ERA5-gated workstream deliberately
moves gamma / Kr / H110, this file is EXPECTED to fail and must be re-anchored IN THE SAME COMMIT.
That is its job: a calibration change must be visible in the diff, never silent. (The owner-anchor
harness cannot do this -- it is measured blind to any directional/height change: a 47% height cut
moves all five owner anchors by 0.0.)
"""
import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from services.weather_pipeline.surf_point import (            # noqa: E402
    estimate_surf_at, resolve_surf_geometry)

FT = 3.28084
PIPELINE = (21.665, -158.051)
TOL_FT = 0.05                       # same tolerance as the recorded 29.50 anchor


@pytest.fixture()
def clean_flags(monkeypatch):
    """Both flags are read at CALL time (surf_transform.py:510, surf_height_convention.py:74),
    so env control needs no module reloads -- but stray values from the outer environment would
    silently re-anchor everything, so start every test from the shipped defaults."""
    monkeypatch.delenv("SURF_REFRACTION_KR", raising=False)
    monkeypatch.delenv("SURF_HEIGHT_H110", raising=False)
    return monkeypatch


def _pipeline_ft(hs, tp):
    g = resolve_surf_geometry(*PIPELINE)
    if g.shore_normal_deg is None:
        pytest.skip("shore-normal assets unavailable in this environment")
    h, regime = estimate_surf_at(PIPELINE[0], PIPELINE[1], hs, tp, 315.0, geometry=g)
    return h * FT, regime


def test_the_nonsaturated_anchor_pins_the_shipped_pair(clean_flags):
    h, regime = _pipeline_ft(2.0, 14.0)
    assert regime == "shoaling", f"expected the non-saturated regime, got {regime}"
    assert abs(h - 10.11) < TOL_FT, (
        f"Pipeline 2 m/14 s = {h:.2f} ft, expected the 10.11 ft anchor measured at ce9250a2. "
        f"If a height constant moved DELIBERATELY, re-anchor this file in the same commit; "
        f"if not, a calibration constant has drifted silently.")


def test_the_anchor_SEES_the_refraction_revert(clean_flags):
    """The discrimination the 29.50 anchor provably lacks: SURF_REFRACTION_KR=1.0 is the
    documented one-env-var revert of the 2026-08-05 calibration, and it must move this anchor by
    its measured +25.5%."""
    clean_flags.setenv("SURF_REFRACTION_KR", "1.0")
    h, _ = _pipeline_ft(2.0, 14.0)
    assert abs(h - 12.68) < TOL_FT, (
        f"Kr=1.0 gave {h:.2f} ft, expected 12.68 -- the anchor has gone blind to refraction "
        f"(or Kr's application point moved; see surf_transform.py:504-514)")


def test_the_anchor_SEES_the_convention_revert(clean_flags):
    clean_flags.setenv("SURF_HEIGHT_H110", "0")
    h, _ = _pipeline_ft(2.0, 14.0)
    assert abs(h - 7.96) < TOL_FT, (
        f"H110=0 gave {h:.2f} ft, expected 7.96 -- the anchor has gone blind to the height "
        f"convention (or the conversion moved off the single choke point)")


def test_the_double_revert_is_nearly_invisible_and_still_caught(clean_flags):
    """(1/0.797)x(1/1.27)=0.988: the validated pair nearly cancels, which is WHY it shipped as a
    pair -- and why a pair-revert is the hardest regression to see. 9.99 vs 10.11 clears the
    tolerance by only 2.4x; the two single-revert controls above are the real detectors."""
    clean_flags.setenv("SURF_REFRACTION_KR", "1.0")
    clean_flags.setenv("SURF_HEIGHT_H110", "0")
    h, _ = _pipeline_ft(2.0, 14.0)
    assert abs(h - 9.99) < TOL_FT
    assert abs(9.99 - 10.11) > 2 * TOL_FT, (
        "the pair-cancellation margin shrank below 2x the tolerance -- the double revert is now "
        "genuinely invisible to the value assertion; tighten TOL_FT or add a third control")


def test_the_saturated_anchor_is_blind_by_design_and_pinned_as_such(clean_flags):
    """Documents WHY this file exists: at Hs 12 m the served value is the gamma*d ceiling and both
    flags cancel out of it entirely. If saturation ever becomes flag-sensitive (e.g. the cap seam
    fix converts before comparing), this fails LOUDLY and both anchor files re-anchor together."""
    base, r = _pipeline_ft(12.0, 18.0)
    assert r == "breaking" and abs(base - 29.50) < TOL_FT
    clean_flags.setenv("SURF_REFRACTION_KR", "1.0")
    clean_flags.setenv("SURF_HEIGHT_H110", "0")
    both, _ = _pipeline_ft(12.0, 18.0)
    assert abs(both - base) < 1e-9, (
        f"the saturated regime became flag-sensitive ({base:.2f} -> {both:.2f} ft) -- the cap "
        f"seam changed; re-anchor BOTH anchor files in this commit")
