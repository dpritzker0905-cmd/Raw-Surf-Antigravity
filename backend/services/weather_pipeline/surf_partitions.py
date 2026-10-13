"""surf_partitions.py -- when a point's swell trains may stand in for its total sea, and how they are scaled to it.

Moved verbatim from `surf_transform.py` on 2026-09-28 (that file sat at 799 of the 800-line cap, and the next
physics change to the height chain needs the room). Pure arithmetic, no env levers: `reconcile_partitions`
scales the trains to the model's own total Hs, and `partitions_represent` is the height + period gate that
decides whether the trains represent the sea at all. The spectral HEIGHT (`estimate_surf_partitioned`) stays in
`surf_transform.py` beside `estimate_surf`, which it calls once per train.
"""
import math


def reconcile_partitions(partitions, total_h_m, tolerance: float = 0.02):
    """Rescale swell partitions so their energy sums to the TOTAL significant wave height.

    Returns a NEW list (inputs untouched). Fails OPEN — no total, no usable partitions, or a
    degenerate quadrature returns the input unchanged, so a reconciliation problem can never cost
    the caller its estimate.

    ★★ WHY THIS IS MANDATORY, not tidiness. The partitions do NOT reconcile with the total field,
    and they miss in BOTH directions. Measured live against production, 16 spots, 2026-07-29:

        |quadrature - total| / total      median 9.5%,  max 43.8% (Anchor Point)
        partitions OVER the total (>2%)   10 of 16 spots
        partitions UNDER the total (<-2%)  1 of 16 (Bondi Beach, -22.3%)

    Sampled independently from separate grid products, interpolation is not energy-conserving, so
    `sqrt(sum(Hs_i**2))` drifts from the `waves` layer's own Hs. Feeding the raw partitions to
    `estimate_surf_partitioned` therefore INVENTS energy the model never reported: measured, the raw
    partitioned height ran a median **+6.2%** above the total-field estimate, purely from the
    overshoot. Normalising drops that to **+0.6%** while KEEPING the per-spot corrections that are
    the point of the change (still -44.7%..+26.8%, signed both ways).

    ★ The split of responsibility is the whole idea: the total Hs is the SCALE — the better-
    constrained quantity, the one the app already serves everywhere and the one `buoy_calibration`
    was built against — and the partitions are the SHAPE, i.e. how that energy is distributed across
    periods and bearings. Honouring the periods separately must not quietly re-scale the sea state;
    that would be an unvalidated change to a calibrated number, smuggled in behind a spectral fix.

    ⚠️ Do NOT "fix" this by dropping to `swell_1` instead. Wind sea is genuinely part of the surf on
    a windy day, and at Hossegor `swell_1` has measured EQUAL to the entire total — see
    `estimate_surf_partitioned`.
    """
    if not partitions or total_h_m is None:
        return partitions
    try:
        total = float(total_h_m)
    except (TypeError, ValueError):
        return partitions
    if total <= 0:
        return partitions
    usable = [p for p in partitions
              if isinstance(p, dict) and p.get("h") is not None and float(p["h"]) > 0]
    if not usable:
        return partitions
    quad = math.sqrt(sum(float(p["h"]) ** 2 for p in usable))
    if quad <= 0:
        return partitions
    k = total / quad
    if abs(k - 1.0) <= tolerance:
        # Already consistent; return unchanged so an in-tolerance sea state is byte-identical.
        return partitions
    return [dict(p, h=float(p["h"]) * k) if (isinstance(p, dict) and p.get("h") is not None
                                             and float(p["h"]) > 0) else p
            for p in partitions]


# The floor below which a partition set does not REPRESENT the sea: if the trains' raw quadrature
# carries less than half the total Hs (i.e. under a quarter of the energy), the dominant train is
# missing — reconciling the survivors would inflate a minority train to carry ALL the energy at its
# own period, a sea state neither the blended field nor the true spectrum describes (review 2026-07-30:
# a lone cached swell_1 of 0.84 m against a 1.73 m total would have been scaled 2.06x into a clean
# 10.25 s sea that never existed). Well below every measured LEGITIMATE deviation (max under: Bondi
# -22.3%; over deviations are unaffected), so it only rejects degenerate coverage.
PARTITION_MIN_QUAD_FRAC = 0.5

# The PERIOD half of the same question. The height test above cannot see a missing LONG train:
# a long-period swell carries little height but dominates energy FLUX (P ~ h^2 * T, c_g = gT/4pi),
# so a decomposition can pass the quadrature gate while omitting the train that matters most to a
# surfer — and to any flux-based ranking.
#
# The check: the total's period is a PEAK period, normally inherited from the dominant train, so
# T_total must not exceed EVERY partition's period. It cannot, if the partitions cover the spectrum.
#
# ⚠️ THE THRESHOLD IS A RATIO, NOT `>` — and that distinction is the whole finding. Measured live
# 2026-07-31, 36 samples (6 FL sites x forecast hours 0/6/12/24/48/72, GFS):
#     ratio = T_total / max(partition T):  min 0.466  p25 0.672  MEDIAN 0.999  p75 1.000  max 1.330
# The median pinned at ~1.000 is the HEALTHY case (peak period inherited from the dominant train),
# so a boolean `T_total > max` reads ordinary ties as defects: 7 of 36 samples "exceeded", but their
# ratios split at a natural GAP around 1.08 —
#     1.0021, 1.0476, 1.0502   interpolation/rounding noise on a tie
#     1.1161, 1.1308, 1.1711, 1.3298   physically real: a total peak period up to 33% longer than
#                                      ANY partition, which the partitions cannot produce
# 1.10 sits in that gap: it admits all three noise cases and rejects all four real ones. The earlier
# report of this defect ("T_total exceeds every partition at 5 of 6 FL sites") was a boolean over
# near-ties; the honest rate is ~19% of sample-hours, ~11% material.
PARTITION_MAX_TP_RATIO = 1.10


def partitions_represent(partitions, total_h_m, total_tp_s=None,
                         min_quad_frac: float = PARTITION_MIN_QUAD_FRAC,
                         max_tp_ratio: float = PARTITION_MAX_TP_RATIO):
    """True when the trains plausibly describe the sea the total reports — the supply-side gate
    BOTH forecast suppliers (`point_resolution._resolve_partitions`, the hub's
    `_spectral_partitions`) apply BEFORE reconciling. One definition, two callers, so the two
    lanes cannot drift on what counts as representative (the distributed-guards lesson).
    Fails CLOSED on unusable input: garbage trains do not represent anything.

    Two independent tests, because a decomposition can fail on either axis alone:
      HEIGHT  the trains' quadrature carries at least `min_quad_frac` of the total Hs
      PERIOD  the total's peak period is not `max_tp_ratio`x longer than every train's

    `total_tp_s` is OPTIONAL and the period test is skipped when it is absent or unusable — a
    caller that cannot supply a trustworthy total period gets exactly today's behaviour rather than
    a verdict invented from a missing input.
    """
    if not partitions or total_h_m is None:
        return False
    try:
        total = float(total_h_m)
    except (TypeError, ValueError):
        return False
    if total != total or total <= 0:
        return False
    try:
        quad = math.sqrt(sum(float(p["h"]) ** 2 for p in partitions
                             if isinstance(p, dict) and p.get("h") is not None))
    except (TypeError, ValueError):
        return False
    if quad != quad or quad <= 0:
        return False
    if quad / total < min_quad_frac:
        return False

    if total_tp_s is None:
        return True
    try:
        t_total = float(total_tp_s)
    except (TypeError, ValueError):
        return True                      # unusable input -> skip the test, never invent a verdict
    if t_total != t_total or t_total <= 0:
        return True
    tps = []
    for p in partitions:
        if not isinstance(p, dict):
            continue
        try:
            tp = float(p.get("tp"))
        except (TypeError, ValueError):
            continue
        if tp == tp and tp > 0:
            tps.append(tp)
    if not tps:
        return True                      # no partition periods to compare against
    return t_total / max(tps) <= max_tp_ratio
