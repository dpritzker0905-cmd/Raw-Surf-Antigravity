"""`effective_swell_exposure` answers confidently from a MARGINAL slice of the wave energy.

It excludes windsea and normalises over the SWELL partitions only:

    sum(h_p^2 * swell_exposure(dir_p)) / sum(h_p^2)      [swell partitions only]

and its ONLY guard is `den <= 0 -> None`. Nothing requires the swell partitions to carry a
meaningful share of the TOTAL wave energy. So on a windsea-dominated day it computes "can the swell
reach this coast" from whatever slice is left — and returns it with full confidence.

★★★ MEASURED LIVE 2026-08-03, 49 served spots, production functions, GFS point lane, all four
marine layers per spot. The divergence from today's total-field path is ENTIRELY concentrated where
the swell partitions carry almost none of the energy:

    swell share of total energy     n     median |d exposure|   max
    < 10%                          11          0.235           0.900
    10-30%                          8          0.118           0.453
    30-60%                         11          0.019           0.117
    > 60%   (the CONTROL)          19          0.028           0.304

The control is the argument: where the swells ARE the sea, the two paths agree, exactly as they
must. 8.4x that at <10%. And 22.4% of sampled spots sit under 10%.

THE WORST CASE, and it is not exotic — Shelly Bay, Bermuda:
    shore normal 135.0   total field 136.2 deg  => essentially HEAD-ON, exposure 1.000
    swell_1 245.9 deg carrying 6% of the energy => partition path returns 0.100
A 10x veto of a genuinely head-on sea, sourced from 6% of it.

⚠️ THIS IS A PRE-FLIP GATE, NOT A LIVE DEFECT. `SURF_PARTITIONS` is OFF, so
`effective_swell_exposure` does not run in production today (`partitions` is None at every site).
The queue's rule for that flag is "enable everywhere or nowhere" — this is the kind of thing that
has to be closed BEFORE the flip, not discovered after it.

⭐ THE FIX IS A REFUSAL, AND THE FALLBACK ALREADY EXISTS. `surf_rating.py:565-567` already reads
`ex = effective_swell_exposure(...)` and falls back to the total-field `swell_exposure` when it is
None. So refusing costs nothing new and lands on TODAY'S PRODUCTION BEHAVIOUR — the risk is
strictly one-sided.

★ THE CLASS: [[THE-COVERAGE-CLASS]] again — a resource chosen with no requirement that it REPRESENT
what it must speak for, degrading silently.
"""
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from services.weather_pipeline.surf_rating import (  # noqa: E402
    MIN_SWELL_ENERGY_SHARE, effective_swell_exposure, swell_exposure,
)


def _parts(h_swell, dir_swell, h_windsea, dir_windsea=200.0):
    return [{"h": h_swell, "tp": 14.0, "dir": dir_swell, "kind": "swell"},
            {"h": h_windsea, "tp": 5.0, "dir": dir_windsea, "kind": "windsea"}]


def test_shelly_bay_a_6_percent_swell_may_not_veto_a_head_on_sea():
    """★ THE FAILING INSTANCE, with the measured numbers. h 1.0 vs 4.0 => energies 1 vs 16, so the
    swell carries 1/17 = 5.9% of the sea — Shelly Bay's measured 6%."""
    normal, total_dir, swell_dir = 135.0, 136.2, 245.9
    parts = _parts(1.0, swell_dir, 4.0)

    # the sea itself arrives essentially head-on
    assert swell_exposure(total_dir, normal) > 0.99

    # and the swell-only view of it is the floor — which is exactly why it must not be trusted here
    assert swell_exposure(swell_dir, normal) < 0.11

    assert effective_swell_exposure(parts, normal) is None, (
        "a swell carrying 6% of the energy vetoed a head-on sea 10x; the partition path must "
        "REFUSE and let the caller fall back to the total field")


def test_it_still_answers_when_the_swells_ARE_the_sea():
    """THE CONTROL. Measured: where swell carries >60% of the energy the two paths agree (median
    |delta| 0.028). An instrument that refuses everywhere is not a guard, it is an off switch."""
    normal = 270.0
    parts = _parts(2.0, 270.0, 1.0)            # energies 4 vs 1 => swell share 80%
    ex = effective_swell_exposure(parts, normal)
    assert ex is not None, "refused on a swell-dominated sea — the feature is now inert"
    assert ex > 0.99                            # head-on swell, and it is the sea


def test_the_energy_weighting_across_swell_trains_is_unchanged():
    """The original contract: two swell trains weight by h^2 among THEMSELVES. Windsea is small
    here so the share gate does not bind, and the arithmetic must be byte-identical to before."""
    parts = [{"h": 2.0, "tp": 14.0, "dir": 90.0, "kind": "swell"},
             {"h": 1.0, "tp": 10.0, "dir": 270.0, "kind": "swell"},
             {"h": 0.5, "tp": 5.0, "dir": 200.0, "kind": "windsea"}]
    ex = effective_swell_exposure(parts, 270.0)
    assert abs(ex - (4 * 0.1 + 1 * 1.0) / 5.0) < 1e-9      # 0.28, exactly as before


def test_the_threshold_binds_where_it_is_documented_to():
    """Pin the boundary from BOTH sides so the constant cannot drift silently. Swell energy share
    is h_s^2 / (h_s^2 + h_w^2); solve for the windsea height that lands just either side."""
    import math
    normal, swell_dir = 135.0, 245.9           # off-angle, so the two sides differ visibly
    h_s = 1.0
    # share = 1/(1+h_w^2)  =>  h_w = sqrt(1/share - 1)
    just_above = math.sqrt(1.0 / (MIN_SWELL_ENERGY_SHARE + 0.02) - 1.0)
    just_below = math.sqrt(1.0 / (MIN_SWELL_ENERGY_SHARE - 0.02) - 1.0)
    assert effective_swell_exposure(_parts(h_s, swell_dir, just_above), normal) is not None
    assert effective_swell_exposure(_parts(h_s, swell_dir, just_below), normal) is None


def test_no_windsea_partition_means_the_swells_are_the_whole_sea():
    """A clean groundswell day has no windsea train at all. Share = 1.0; must never refuse."""
    parts = [{"h": 1.5, "tp": 15.0, "dir": 270.0, "kind": "swell"}]
    assert effective_swell_exposure(parts, 270.0) is not None


def test_the_pre_existing_refusals_still_hold():
    """Unknown geometry and a directionless swell were already None; the new gate must not have
    changed which branch answers them."""
    parts = _parts(2.0, 270.0, 1.0)
    assert effective_swell_exposure(parts, None) is None
    assert effective_swell_exposure([{"h": 1.0, "tp": 9.0, "kind": "swell"}], 270.0) is None
    assert effective_swell_exposure([], 270.0) is None
    assert effective_swell_exposure(None, 270.0) is None


def test_the_gate_is_REACHABLE_through_the_real_upstream_chain():
    """⭐⭐⭐ A GUARD THAT CANNOT REACH THE DEFECTIVE SURFACE IS NOT A GUARD.

    Every other test here hands `effective_swell_exposure` a partitions list directly. Production
    builds one in `point_resolution._resolve_partitions` and puts it through TWO upstream steps
    first, either of which could make this gate inert:

      1. `_PARTITION_LAYERS` — if the windsea train were not collected, `total_e` would equal the
         swell energy, the share would always be 1.0, and the gate could NEVER fire. It is
         collected: ("swell_1","swell"), ("swell_2","swell"), ("wind_waves","windsea").
      2. `partitions_represent` then `reconcile_partitions` — if the represent gate already
         rejected this shape, the gate would be redundant; if reconcile changed the energy ratio,
         the share it measures would not be the share production sees.

    Asserted here on the Shelly Bay numbers: represent PASSES (so it does NOT already catch this),
    reconcile leaves the ratio INVARIANT (it applies a common scale), and the gate still fires.
    The two gates ask different questions — `partitions_represent`: "do the trains describe the
    sea?" (yes, swell+windsea IS the sea); this gate: "do the SWELL trains alone describe it?" (no,
    5.9%). Complementary, not overlapping.
    """
    import math
    from services.weather_pipeline.point_resolution import PointResolutionService
    from services.weather_pipeline.surf_transform import (
        partitions_represent, reconcile_partitions)

    # 1. the windsea train is actually collected by the live builder
    kinds = {kind for _layer, kind in PointResolutionService._PARTITION_LAYERS}
    assert "windsea" in kinds, (
        "production stopped collecting a windsea train — the energy-share gate is now INERT, "
        "because total_e would equal the swell energy and the share would always be 1.0")

    parts = _parts(1.0, 245.9, 4.0, dir_windsea=136.2)
    total_h = math.sqrt(1.0 + 16.0)

    # 2. the upstream represent gate does NOT already reject this shape
    assert partitions_represent(parts, total_h, 5.5) is True, (
        "partitions_represent now rejects this case, so the energy-share gate is redundant here — "
        "re-derive whether it is still needed before trusting either")

    # 3. reconcile applies a common scale, so the ENERGY RATIO it measures survives
    rec = reconcile_partitions(parts, total_h)
    e_swell = sum(p["h"] ** 2 for p in rec if p.get("kind") != "windsea")
    e_all = sum(p["h"] ** 2 for p in rec)
    assert abs(e_swell / e_all - 1.0 / 17.0) < 1e-6, "reconcile changed the energy ratio"

    # 4. and the gate still fires on what production would actually hand it
    assert effective_swell_exposure(rec, 135.0) is None


def test_dominant_swell_period_is_DELIBERATELY_NOT_GATED_the_same_way():
    """⛔ DO NOT APPLY THE ENERGY-SHARE GATE TO `dominant_swell_period`. I hypothesised the same
    class here — it also picks a SWELL train with no share requirement, so a marginal swell should
    inflate the period the way one vetoed the exposure — and THE MEASUREMENT REFUSED THE HYPOTHESIS.

    Same 49 spots, same live fetch, partition period vs the total-field period:

        swell share    n    median |dTp|   max |dTp|   median |d period_quality|   max
        < 10%         11       0.46 s       4.65 s            0.031               0.309
        10-30%         8       1.62 s       4.90 s            0.103               0.327
        30-60%        11       0.20 s       1.50 s            0.000               0.100
        > 60% CONTROL 19       0.07 s      *6.08 s*           0.005              *0.405*

    ★★★ THE CONTROL DOES NOT SEPARATE. The LARGEST period difference and the largest quality
    difference both land in the swell-DOMINATED band — which is precisely the behaviour the
    docstring exists to deliver ("a 16 s groundswell hiding under an 8 s windsea reads ~11 s
    blended; this recovers the 16 s"). A gate keyed on energy share would suppress the intended
    feature where it works best and would be fitting to noise where it does not.

    ★ AND THE JACOBIAN IS SMALL where the hypothesis had any support: at <10% share the median
    period_quality effect is 0.031, on a factor that is 0.40 of one of nine terms — against the
    exposure defect's 0.900 swing on a term that floors at 0.10. Sensitivity x uncertainty says
    this is not worth a gate.

    This test pins the ungated behaviour so a later symmetric "fix" has to argue with the numbers.
    """
    from services.weather_pipeline.surf_rating import dominant_swell_period
    # Haulover Inlet, measured: swell carries 3% of the energy and still sets the period.
    parts = _parts(1.0, 245.9, 5.7)          # energies 1 vs ~32 => ~3% swell share
    assert dominant_swell_period(parts) == 14.0, (
        "the period recovery was gated; the measurement in this docstring says do not")
    # and the exposure on the SAME trains still refuses — the two factors are treated differently
    # ON PURPOSE, and that asymmetry is the finding.
    assert effective_swell_exposure(parts, 135.0) is None


def test_a_refusal_lands_the_EXPOSURE_TERM_on_todays_production_value():
    """⭐ THE SAFETY ARGUMENT, asserted rather than claimed: `rating_factors` falls back to the
    total-field exposure when the partition path returns None, so the EXPOSURE FACTOR reproduces
    exactly what production serves today with SURF_PARTITIONS off. This gate can only shrink the
    flip's blast radius on that term; it can never make it worse than the status quo.

    ⚠️ AND THE SCOPE IS THE EXPOSURE TERM ONLY — asserted here so nobody reads more into the gate
    than it does. The first version of this test claimed the whole SCORE was unchanged and FAILED
    (46.2 vs 63.7). That was the test over-claiming, not the code misbehaving: passing `partitions`
    also switches on `sea_cleanliness` and the dominant-swell period, and on a 94%-windsea sea a
    cleanliness penalty is exactly the right answer — that is the factor built to carry it. The
    defect was that `swell_exposure` was ALSO carrying it, twice and from 6% of the energy."""
    from services.weather_pipeline.surf_rating import rating_factors, sea_cleanliness
    normal, total_dir, swell_dir = 135.0, 136.2, 245.9
    parts = _parts(1.0, swell_dir, 4.0)
    common = dict(surf_h_m=1.2, tp_s=9.0, swell_from_deg=total_dir, shore_normal_deg=normal,
                  wind_speed_ms=3.0, wind_from_deg=total_dir)

    without = rating_factors(**common)                                        # today
    with_marginal = rating_factors(**common, partitions=parts)

    assert with_marginal["factors"]["swell_exposure"] == without["factors"]["swell_exposure"], (
        "a refused partition exposure did not fall back to the total-field value")
    assert with_marginal["factors"]["swell_exposure"] > 0.99                  # the sea IS head-on

    # the residual score difference is the windsea penalty, and it lives in the factor that owns it
    assert with_marginal["factors"]["sea_clean"] == sea_cleanliness(parts) < 1.0
    assert with_marginal["limiter"] != "swell_exposure", (
        "exposure is still the binding term on a head-on sea")
