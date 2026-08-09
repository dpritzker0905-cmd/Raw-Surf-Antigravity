"""THE DIRECTIONAL A/B HARNESS — the instrument the owner anchors cannot be.

WHY THIS FILE EXISTS. `test_owner_calibration_anchors.py` is the acceptance spec for SIZE, and it
says so itself: *"These are CLEAN-CONDITION anchors: light dead-offshore wind, head-on swell. Every
gate is 1.0."* All six anchors sit at dtheta = 0, so **they are blind to any directional change by
construction** -- measured 2026-08-03, a 47% height cut moved all five by exactly 0.0. Every
directional finding since has therefore been ungradeable, and MASTER-AUDIT-2.0 named the missing
harness as the blocker on the queue's #1 item.

⭐ THE INVARIANT THIS ENFORCES IS A LAW, NOT A CALIBRATION. "How much of the swell is aimed at this
coast" is ONE physical quantity, and the engine reduces it TWICE:

    quality   surf_rating.swell_exposure          = 0.10 + 0.90*max(0, cos dtheta)      floor 0.100
    height    surf_transform._height_exposure_factor = 0.55 + 0.45*exposure             floor 0.595

The height factor's own docstring says height "scales gentler than energy", i.e. H ~ sqrt(E). So the
energy the HEIGHT chain implies is `height_factor**2`, and it must agree with what the QUALITY chain
says that same energy is. **Whatever the true physics turns out to be, these two must agree with each
other.** That check needs no calibration and cannot be satisfied by a plausible wrong number -- the
same property that made the deep-water steepness check trustworthy in the marine audit.

⚠️ THEY DO NOT AGREE TODAY, and this file PINS the disagreement rather than failing CI over it:
1.00x head-on, rising monotonically to **3.54x** past 90 deg. A characterization pin is the honest
way to guard a known defect -- it keeps the suite green while making any change to it DELIBERATE.
⇒ When the two floors are reconciled, `MAX_ENERGY_DISAGREEMENT` must be updated in the same commit,
which is exactly the review moment this file exists to create.

★ WHICH ONE IS WRONG -- the harness answers this too, and it is the height. A real sea is a
directional spectrum `cos^(2s)(phi/2)` (Longuet-Higgins 1963; Mitsuyasu 1975), s ~ 70 for swell and
s ~ 10 for wind sea, so the true onshore flux at a given dtheta is BRACKETED by those two spectra.
At dtheta = 90 the bracket is [0.068, 0.181]:
  * the quality factor's 0.100 lies INSIDE it;
  * the height factor's implied 0.354 lies ABOVE BOTH -- outside anything a real sea delivers.

⛔⛔ THIS FILE DOES NOT AUTHORISE CHANGING A CONSTANT. Height is currently correct BY CANCELLATION
(`HEIGHT-ACCURACY-two-errors-that-cancel-2026-07-30`: never flip `SURF_HEIGHT_H110` alone, +25.5%),
and the spectral numbers are deep-water LOWER bounds -- refraction and ultra-refraction push the
other way. This harness makes a directional change GRADEABLE. It does not make it safe.
"""
import math
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
sys.path.insert(0, os.path.join(backend_dir, "scripts"))

from services.weather_pipeline import surf_transform as ST                # noqa: E402
from services.weather_pipeline.surf_rating import (                       # noqa: E402
    compute_surf_rating, swell_exposure,
)
from directional_exposure_science import onshore_flux                     # noqa: E402

# Spreading parameters bracketing a real sea (see the module docstring).
S_SWELL, S_WINDSEA = 70.0, 10.0

SHORE_NORMAL = 90.0
DTHETAS = (0.0, 30.0, 45.0, 60.0, 75.0, 85.0, 90.0, 100.0, 120.0, 150.0, 180.0)

# One canonical sea state, held fixed so DIRECTION is the only variable that moves.
SEA = dict(Hs_m=2.0, Tp_s=12.0, depth_m=30.0, coastal=True, shelf_width_km=20.0, break_depth_m=6.0)
WIND_MS, WIND_FROM = 2.0, 270.0          # dead offshore for a shore facing 090 -> wind gates are 1.0
REFERENCE_SIZE_M = 1.2

# The pinned disagreement. UPDATE DELIBERATELY, never to make a red suite green.
MAX_ENERGY_DISAGREEMENT = 3.54
DISAGREEMENT_TOL = 0.05


def _height_at(dtheta):
    h, _regime = ST.estimate_surf(swell_from_deg=SHORE_NORMAL + dtheta,
                                  shore_normal_deg=SHORE_NORMAL, **SEA)
    return h


def _score_at(dtheta):
    h = _height_at(dtheta)
    score, _level = compute_surf_rating(
        h, SEA["Tp_s"], WIND_MS, wind_from_deg=WIND_FROM, shore_normal_deg=SHORE_NORMAL,
        swell_from_deg=SHORE_NORMAL + dtheta, reference_size_m=REFERENCE_SIZE_M)
    return score


def energy_disagreement(dtheta):
    """height_factor**2 / quality_exposure -- 1.0 if the two reductions agree."""
    q = swell_exposure(SHORE_NORMAL + dtheta, SHORE_NORMAL)
    h = ST._height_exposure_factor(SHORE_NORMAL + dtheta, SHORE_NORMAL)
    return (h * h) / q


# ── 1. THE CONTRACT: this harness must SEE direction, and the anchors must not ──────────────────

def test_harness_discriminates_direction_where_the_owner_anchors_cannot():
    """The reason this file exists. A directional sweep must move BOTH graded quantities.

    The paired assertion is the control: the owner anchors' own configuration (head-on, every gate
    1.0) is reproduced here and must move by ~0. A harness that cannot show the anchors are blind
    has not demonstrated it is any better than them."""
    heights = [_height_at(d) for d in DTHETAS]
    scores = [_score_at(d) for d in DTHETAS]

    assert min(heights) > 0, "setup: the sea state must produce surf at every angle"
    assert all(s is not None for s in scores), "setup: every angle must produce a score"

    # THE HARNESS SEES DIRECTION.
    assert max(heights) / min(heights) > 1.5, (
        f"height barely moved across a 0-180 deg sweep ({min(heights):.3f}..{max(heights):.3f}); "
        f"this harness would be as blind as the anchors it replaces")
    assert max(scores) / max(min(scores), 1e-9) > 5.0, (
        f"score barely moved across a 0-180 deg sweep ({min(scores):.2f}..{max(scores):.2f})")

    # THE CONTROL: the anchors' own head-on configuration is directionally inert.
    head_on = [_score_at(0.0) for _ in range(3)]
    assert max(head_on) - min(head_on) == 0.0

    # And monotone: turning the swell away must never IMPROVE either quantity.
    for a, b in zip(DTHETAS, DTHETAS[1:]):
        assert _height_at(b) <= _height_at(a) + 1e-9, f"height rose turning away ({a}->{b})"
        assert _score_at(b) <= _score_at(a) + 1e-9, f"score rose turning away ({a}->{b})"


# ── 2. THE LAW: two reductions of one quantity must agree ───────────────────────────────────────

def test_the_two_directional_factors_disagree_and_this_pins_by_how_much():
    """CHARACTERIZATION PIN of a KNOWN DEFECT (MASTER-AUDIT-2.0 section 2).

    `height_factor**2` is the energy the height chain implies; `swell_exposure` is what the quality
    chain says the same energy is. They agree head-on and diverge to 3.54x past 90 deg -- so one
    payload can report "5.3 ft Head High" and "3.3/100 very_poor" at once (measured at Arugam Bay).

    ⇒ Reconciling the floors MUST update this constant in the same commit."""
    ratios = {d: energy_disagreement(d) for d in DTHETAS}

    assert ratios[0.0] == pytest.approx(1.0, abs=1e-6), (
        "head-on must agree exactly; if this breaks, one factor's SHAPE changed, not just its floor")

    worst = max(ratios.values())
    assert worst == pytest.approx(MAX_ENERGY_DISAGREEMENT, abs=DISAGREEMENT_TOL), (
        f"the height/quality energy disagreement moved to {worst:.3f} (pinned "
        f"{MAX_ENERGY_DISAGREEMENT}). If this was deliberate, update the constant and say why.")

    # It is monotone in dtheta: the further off-angle, the worse the two agree.
    seq = [ratios[d] for d in DTHETAS]
    assert all(b >= a - 1e-9 for a, b in zip(seq, seq[1:])), (
        "the disagreement is no longer monotone in dtheta -- the defect changed shape")


def test_SURF_EXPOSURE_RECONCILED_closes_the_disagreement_to_exactly_one(monkeypatch):
    """THE RECONCILIATION, and the same-commit pin the docstring above demands (2026-08-09).

    `SURF_EXPOSURE_RECONCILED=1` replaces the height factor's `0.55 + 0.45*exposure` with
    `sqrt(exposure)`, so `height_factor**2 == exposure` BY CONSTRUCTION and the two chains agree on
    energy at EVERY angle -- 1.000, not merely closer. That is a law (H ~ sqrt(E)), not a fitted
    constant, which is why it can be asserted exactly rather than within a tolerance.

    ⛔ DEFAULT OFF, and this test does not authorise flipping it. What moves is the HEIGHT:
    0.0% head-on, -2.6% at 45 deg, -17.5% at 75 deg, -46.9% at the floor (measured 2026-08-09).
    Head-on being untouched is exactly why the owner anchors stay green AND why they cannot grade
    this -- their own docstring says every gate is 1.0. The gate for turning it on is a served-reach
    census, not a green suite."""
    monkeypatch.setenv("SURF_EXPOSURE_RECONCILED", "1")
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    for d in DTHETAS:
        assert energy_disagreement(d) == pytest.approx(1.0, abs=1e-9), (
            f"reconciled mode must make the chains agree exactly at dtheta={d}")


def test_the_reconciliation_is_OFF_by_default_so_served_heights_are_unchanged(monkeypatch):
    """A kill switch that is on by accident is not a kill switch. Absence of the env var must give
    the legacy value at the floor, byte for byte."""
    monkeypatch.delenv("SURF_EXPOSURE_RECONCILED", raising=False)
    monkeypatch.setenv("SURF_V3_EXPOSURE", "1")
    from services.weather_pipeline.surf_transform import _height_exposure_factor
    assert _height_exposure_factor(120.0, 0.0) == pytest.approx(0.595, abs=1e-9)
    assert energy_disagreement(120.0) == pytest.approx(MAX_ENERGY_DISAGREEMENT, abs=DISAGREEMENT_TOL)


# ── 3. WHICH ONE IS WRONG: the physical bracket ─────────────────────────────────────────────────

@pytest.mark.parametrize("dtheta", [90.0, 100.0, 120.0, 150.0])
def test_height_is_always_more_generous_than_quality_and_both_are_flat_where_physics_is_not(dtheta):
    """A real sea's onshore flux is bracketed by a narrow swell spectrum (s=70) and a broad wind sea
    (s=10) -- the widest defensible range for "how much energy arrives".

    ⭐ The FIRST assert is the robust one and holds at every angle: the height chain always claims
    MORE energy than the quality chain, for the same swell at the same coast.

    ⚠️ CORRECTED WHEN THIS TEST FIRST RAN. I had asserted the quality factor stays inside the
    bracket. It does at 90-100 deg and NOT beyond: at 120 deg the bracket top is 0.026 and the
    quality floor is 0.100, ~4x too generous (the height factor is ~14x). **Both factors are
    constants where the physics keeps falling**, so past ~110 deg neither is defensible -- the
    quality floor is merely the less wrong of the two. `test_the_quality_floor_leaves_the_physical_
    bracket_between_100_and_110_deg` pins where that happens."""
    lo = onshore_flux(dtheta, S_SWELL)
    hi = onshore_flux(dtheta, S_WINDSEA)
    assert lo <= hi, "setup: the swell spectrum must deliver no more than the broad wind sea"

    quality = swell_exposure(SHORE_NORMAL + dtheta, SHORE_NORMAL)
    implied = ST._height_exposure_factor(SHORE_NORMAL + dtheta, SHORE_NORMAL) ** 2

    # THE ROBUST CLAIM: the height chain is the more generous of the two, everywhere off-angle.
    assert implied > quality, (
        f"height-implied energy {implied:.4f} is no longer above quality exposure {quality:.4f} at "
        f"{dtheta} deg. If the floors were reconciled, update MAX_ENERGY_DISAGREEMENT too.")

    # THE HEIGHT FACTOR IS OUTSIDE ANY REAL SEA at every angle tested. Inverts when fixed.
    assert implied > hi, (
        f"height-implied energy {implied:.4f} is no longer above the physical bracket "
        f"[{lo:.4f}, {hi:.4f}] at {dtheta} deg -- if deliberate, rewrite this test to assert the "
        f"bracket rather than the excess.")


def test_the_quality_floor_leaves_the_physical_bracket_between_100_and_110_deg():
    """Pins WHERE the quality floor stops being defensible, because "the floor is fine" and "the
    floor is 4x too generous" are both true at different angles and quoting either alone misleads.

    Uses the broad wind sea (s=10) as the ceiling -- the most generous real sea there is. If even
    that delivers less than our constant, the constant is not describing an ocean."""
    inside = [d for d in (90.0, 100.0)
              if swell_exposure(SHORE_NORMAL + d, SHORE_NORMAL) <= onshore_flux(d, S_WINDSEA)]
    outside = [d for d in (110.0, 120.0, 150.0)
               if swell_exposure(SHORE_NORMAL + d, SHORE_NORMAL) > onshore_flux(d, S_WINDSEA)]

    assert inside == [90.0, 100.0], (
        f"the quality floor now leaves the bracket earlier than 110 deg (still inside at {inside})")
    assert outside == [110.0, 120.0, 150.0], (
        f"the quality floor now stays inside the bracket past 100 deg (outside at {outside})")


# ── 4. THE HARNESS MUST NOT BE BLIND — mutation self-check ──────────────────────────────────────

def test_a_change_to_either_floor_moves_this_harness(monkeypatch):
    """The failure mode this whole file exists to avoid: an instrument that reports success having
    tested nothing. If mutating either factor leaves every number unchanged, the harness is as
    useless as the anchors and must not be trusted.

    Both mutations are applied to the module the caller actually reaches, and the baseline is
    captured first so the comparison cannot be against a constant."""
    base_score = _score_at(120.0)
    base_height = _height_at(120.0)
    base_ratio = energy_disagreement(120.0)

    # MUTANT A: raise the QUALITY floor 0.10 -> 0.40.
    monkeypatch.setattr(
        "services.weather_pipeline.surf_rating.swell_exposure",
        lambda s, n: max(0.40, 0.40 + 0.60 * max(0.0, math.cos(math.radians(s - n)))))
    assert _score_at(120.0) != pytest.approx(base_score, abs=1e-6), (
        "raising the quality floor did not move the score -- the harness cannot see the quality factor")

    monkeypatch.undo()

    # MUTANT B: disable the HEIGHT exposure factor entirely via its own kill switch.
    monkeypatch.setenv("SURF_V3_EXPOSURE", "0")
    assert _height_at(120.0) != pytest.approx(base_height, abs=1e-6), (
        "disabling SURF_V3_EXPOSURE did not move the height -- the harness cannot see the height factor")
    monkeypatch.undo()

    # And the baseline is restored, so the mutations did not leak into the rest of the session.
    assert energy_disagreement(120.0) == pytest.approx(base_ratio, abs=1e-9)
