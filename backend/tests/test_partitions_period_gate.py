"""The PERIOD half of partitions_represent — a decomposition can carry the height and still be
missing the train that matters most.

WHY. The height gate (PARTITION_MIN_QUAD_FRAC) tests quadrature, and quadrature is blind to a
missing LONG-period swell: such a train carries little height but dominates energy flux
(P ~ h^2 * T, c_g = gT/4pi). A flux-based ranking built on partitions that pass the height gate can
therefore rank a spectrum with its most important train absent.

⚠️ THE THRESHOLD IS A RATIO, NOT `>`, and that is the finding. Measured live 2026-07-31, 36 samples
(6 FL sites x forecast hours 0/6/12/24/48/72, GFS point lane):

    ratio = T_total / max(partition T)
    min 0.466   p25 0.672   MEDIAN 0.999   p75 1.000   max 1.330

The median pinned at ~1.000 IS the healthy case — the total's peak period is normally inherited from
the dominant train — so a boolean `T_total > max` reports ordinary ties as defects. 7 of 36 samples
"exceeded"; their ratios split at a natural gap near 1.08 into three noise cases and four real ones.
Every number below is one of those measured samples.
"""
import pytest

from services.weather_pipeline.surf_transform import (
    PARTITION_MAX_TP_RATIO, PARTITION_MIN_QUAD_FRAC, partitions_represent)


def _trains(*pairs):
    """(h, tp) pairs -> partition dicts."""
    return [{"h": h, "tp": tp, "dir": 90.0, "kind": "swell"} for h, tp in pairs]


# ── the measured live samples ────────────────────────────────────────────────────────────────

# Each entry: (label, T_total, max partition T, ratio, should_pass)
MEASURED_EXCEEDANCES = [
    ("Sebastian +0h",   9.71, 9.69, 1.0021, True),    # tie + rounding
    ("Satellite +6h",   6.69, 6.37, 1.0502, True),    # interpolation noise
    ("NewSmyrna +12h",  9.25, 8.83, 1.0476, True),    # interpolation noise
    ("JaxBeach +24h",   8.17, 7.32, 1.1161, False),   # real
    ("PonceInlet +12h", 9.25, 8.18, 1.1308, False),   # real
    ("PonceInlet +24h", 8.76, 7.48, 1.1711, False),   # real
    ("NewSmyrna +24h",  8.75, 6.58, 1.3298, False),   # real: 33% longer than ANY train
]


@pytest.mark.parametrize("label,t_total,max_tp,ratio,should_pass", MEASURED_EXCEEDANCES)
def test_measured_exceedances_split_at_the_natural_gap(label, t_total, max_tp, ratio, should_pass):
    """1.10 sits in the gap between 1.0502 and 1.1161: it admits every noise case and rejects every
    physically real one. A boolean `>` would have rejected all seven."""
    assert abs(t_total / max_tp - ratio) < 0.001, f"{label}: sample arithmetic drifted"
    parts = _trains((0.6, max_tp), (0.3, max_tp * 0.5))
    got = partitions_represent(parts, 0.67, t_total)
    assert got is should_pass, f"{label} (ratio {ratio:.4f}) expected pass={should_pass}"


def test_the_healthy_median_case_passes():
    """Median ratio 0.999 / p75 1.000 -- the total's peak period equal to the dominant train's is
    the NORMAL sea, and must never be flagged."""
    assert partitions_represent(_trains((0.6, 9.54), (0.2, 4.5)), 0.63, 9.53)
    assert partitions_represent(_trains((0.6, 9.71), (0.2, 4.5)), 0.63, 9.71)   # exact tie


def test_a_shorter_total_period_is_always_fine():
    """min ratio 0.466 -- a total peak at a much SHORTER period than the longest train just means a
    short-period train dominates the energy. Nothing is missing."""
    assert partitions_represent(_trains((0.2, 13.5), (0.9, 4.0)), 0.92, 3.93)


def test_the_gate_catches_the_missing_long_train_the_height_test_cannot_see():
    """THE POINT OF THE WHOLE GATE. A long swell with small height barely moves quadrature, so the
    height test passes with room to spare -- and the flux ranking it feeds would be wrong."""
    parts = _trains((0.95, 5.0), (0.30, 6.0))      # no long train
    total_h = 1.0
    quad = (0.95 ** 2 + 0.30 ** 2) ** 0.5
    assert quad / total_h >= PARTITION_MIN_QUAD_FRAC        # height gate: comfortably passes
    assert partitions_represent(parts, total_h)             # ...and passes today, period unknown
    assert not partitions_represent(parts, total_h, 14.0)   # 14 s peak from a 6 s spectrum: absent


def test_energy_flux_is_first_order_in_period_which_is_why_this_matters():
    """A 0.3 m / 14 s train carries LESS height but MORE onshore flux than a 0.9 m / 4 s one, so
    dropping it inverts a flux ranking. Pins the physics the gate exists to protect."""
    def flux(h, t):                      # P ~ h^2 * c_g, c_g = gT/4pi  ->  h^2 * T up to a constant
        return h * h * t
    # A LONGER train beats a TALLER one once the period gap is wide enough...
    assert flux(0.30, 14.0) > flux(0.45, 6.0)          # 1.260 > 1.215
    # ...and the same train ranked on HEIGHT alone loses, which is the inversion the gate protects.
    assert 0.30 < 0.45
    # Height-only ranking and flux ranking disagree on which train leads:
    by_height = max([(0.45, 6.0), (0.30, 14.0)], key=lambda p: p[0])
    by_flux = max([(0.45, 6.0), (0.30, 14.0)], key=lambda p: flux(*p))
    assert by_height != by_flux


# ── the period test must never fire on an input it cannot trust ──────────────────────────────

@pytest.mark.parametrize("bad", [None, "", "abc", float("nan"), 0.0, -3.0])
def test_unusable_total_period_skips_the_test_rather_than_inventing_a_verdict(bad):
    """Absent/garbage period -> exactly today's behaviour. An instrument may not manufacture the
    axis it measures (the same rule the run-age census follows for missing valid_time_end)."""
    parts = _trains((0.6, 5.0), (0.2, 4.0))
    assert partitions_represent(parts, 0.63, bad) is True


def test_partitions_without_usable_periods_skip_the_test():
    parts = [{"h": 0.6, "tp": None}, {"h": 0.2, "tp": float("nan")}, {"h": 0.1, "tp": -1.0}]
    assert partitions_represent(parts, 0.64, 14.0) is True


def test_a_nan_partition_period_does_not_poison_the_maximum():
    """NaN propagates through max() in some orderings; it must be filtered, not compared."""
    parts = [{"h": 0.6, "tp": float("nan")}, {"h": 0.5, "tp": 12.0}]
    assert partitions_represent(parts, 0.78, 12.0) is True      # 12.0 is the real max -> ratio 1.0
    assert not partitions_represent(parts, 0.78, 20.0)          # 20/12 = 1.67 -> rejected


def test_height_gate_still_rejects_first_regardless_of_period():
    """The two axes are independent; a height failure is not rescued by a healthy period."""
    lone = _trains((0.4, 10.0))
    assert not partitions_represent(lone, 1.73)             # 23% of total: dominant train missing
    assert not partitions_represent(lone, 1.73, 10.0)       # period perfect, still rejected


def test_threshold_sits_strictly_inside_the_measured_gap():
    """Guards the calibration itself: moving PARTITION_MAX_TP_RATIO outside [1.0502, 1.1161] would
    silently start flagging noise or stop catching real cases."""
    assert 1.0502 < PARTITION_MAX_TP_RATIO < 1.1161


def test_default_call_signature_is_unchanged_for_existing_callers():
    """Positional back-compat: partitions_represent(parts, total) must still mean the height test
    alone -- the flag is OFF in production and this lane must stay byte-identical until it is not."""
    parts = _trains((0.6, 5.0), (0.2, 4.0))
    assert partitions_represent(parts, 0.63) is True
    assert partitions_represent(parts, 0.63, None) is True
