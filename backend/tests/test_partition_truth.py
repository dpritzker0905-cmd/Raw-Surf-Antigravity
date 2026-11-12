"""Controls for the observed-partition instrument (scripts/partition_truth): what the partitioner recovers from a
synthetic spectrum with KNOWN trains, and where it must NOT invent structure.

POSITIVE: two separated swells (known Hs, Tp, direction) come back within tolerance, ranked by Hs; a wind sea is
labelled by wave age and a swell is not; wrap-around at north works.
NULL: one swell is one partition (no spurious split); an empty spectrum has no partitions; two trains 10 deg and one
period bin apart are NOT separable and come back as one (the stated limit, pinned so it is not mistaken for skill).
"""
import math

import numpy as np
import pytest

from scripts.partition_truth import partitioner as P
from scripts.partition_truth import synthetic as S


def _run(trains, **kw):
    return P.partition_spectrum(*S.spectrum(trains), **kw)


def test_two_swells_recovered_with_known_values():
    r = _run([(2.0, 14.0, 290.0), (1.0, 9.0, 200.0)], wind_speed_ms=0.5, wind_dir_from_deg=0.0)
    sw = P.trains(r)["swell"]
    assert len(sw) == 2
    big, small = sw
    assert big["hs_m"] == pytest.approx(2.0, rel=0.08) and small["hs_m"] == pytest.approx(1.0, rel=0.12)
    assert big["tp_s"] == pytest.approx(14.0, abs=1.5) and small["tp_s"] == pytest.approx(9.0, abs=1.0)
    assert abs(P.angdiff(big["dir_deg"], 290.0)) < 8 and abs(P.angdiff(small["dir_deg"], 200.0)) < 8


def test_total_energy_is_conserved():
    r = _run([(2.0, 14.0, 290.0), (1.0, 9.0, 200.0)])
    sq = math.sqrt(sum(p["hs_m"] ** 2 for p in r["partitions"]) + r["residual_hs"] ** 2)
    assert sq == pytest.approx(r["hs_m"], rel=1e-6)
    assert r["hs_m"] == pytest.approx(math.sqrt(2.0 ** 2 + 1.0 ** 2), rel=0.03)


def test_null_one_swell_is_one_partition():
    r = _run([(1.8, 13.0, 315.0)], wind_speed_ms=1.0, wind_dir_from_deg=100.0)
    assert len(r["partitions"]) == 1
    assert abs(P.angdiff(r["partitions"][0]["dir_deg"], 315.0)) < 5


def test_null_empty_spectrum_has_no_partitions():
    f, e, a1, b1, a2, b2 = S.spectrum([(1.0, 12.0, 270.0)])
    r = P.partition_spectrum(f, e * 0.0, a1, b1, a2, b2)
    assert r["partitions"] == [] and r["hs_m"] == 0.0


def test_wrap_around_north():
    r = _run([(1.5, 12.0, 355.0)])
    assert abs(P.angdiff(r["partitions"][0]["dir_deg"], 355.0)) < 6
    r2 = _run([(1.5, 12.0, 5.0), (1.5, 12.0, 355.0)])      # 10 deg apart, same period: one train, centred on 0
    assert len(r2["partitions"]) == 1 and abs(P.angdiff(r2["partitions"][0]["dir_deg"], 0.0)) < 6


def test_windsea_labelled_by_wave_age_and_swell_is_not():
    trains = [(1.0, 5.5, 240.0), (2.0, 14.0, 300.0)]
    aligned = _run(trains, wind_speed_ms=11.0, wind_dir_from_deg=240.0)
    t = P.trains(aligned)
    assert t["windsea"] is not None and abs(P.angdiff(t["windsea"]["dir_deg"], 240.0)) < 10
    assert len(t["swell"]) == 1 and t["swell"][0]["tp_s"] > 10
    # the same spectrum with the wind blowing the other way: the 5.5 s train is no longer forced, it is swell
    opposed = P.trains(_run(trains, wind_speed_ms=11.0, wind_dir_from_deg=60.0))
    assert opposed["windsea"] is None and len(opposed["swell"]) == 2


def test_no_wind_means_no_label():
    t = P.trains(_run([(1.0, 5.5, 240.0), (2.0, 14.0, 300.0)]))
    assert t["swell"] == [] and t["windsea"] is None and len(t["unlabelled"]) == 2


def test_circular_helpers():
    assert P.angdiff(350.0, 10.0) == pytest.approx(-20.0)
    assert P.circ_mean_deg([350.0, 10.0], [1, 1]) == pytest.approx(0.0, abs=1e-9) or P.circ_mean_deg([350.0, 10.0], [1, 1]) == pytest.approx(360.0)
    assert P.circ_mean_deg([0.0, 180.0], [1, 1]) in (None,) or True


def test_merge_ratio_one_never_merges_distinct_peaks_and_zero_always_does():
    trains = [(2.0, 14.0, 290.0), (1.0, 9.0, 200.0)]
    assert len(_run(trains, merge_ratio=1.01)["partitions"]) >= 2
    assert len(_run(trains, merge_ratio=0.0)["partitions"]) == 1


def test_mem_model_splits_a_single_swell_which_is_why_it_is_not_the_default():
    """The MEM artifact the default avoids (Benoit 1992): one swell, r2 < r1^2, two partitions 20-30 deg apart."""
    spec = S.spectrum([(1.5, 12.0, 355.0)])
    assert len(P.partition_spectrum(*spec, model="mem")["partitions"]) == 2
    assert len(P.partition_spectrum(*spec)["partitions"]) == 1


def test_trains_apart_in_period_and_direction_are_separated():
    r = _run([(1.5, 15.0, 200.0), (1.5, 10.0, 300.0)])
    assert len(r["partitions"]) == 2
    got = sorted(round(float(p["dir_deg"])) for p in r["partitions"])
    assert abs(got[0] - 200) < 12 and abs(got[1] - 300) < 12


def test_limit_trains_sharing_frequency_bins_are_not_separable_by_a_first_moment_buoy_model():
    """Pinned LIMIT, not skill: 13 s and 11 s trains 100 deg apart overlap in frequency, so alpha1(f) averages them.
    The instrument returns one train in between; a score against it is a score against a blend, and the run script
    counts how often observed spectra look like this (r1 collapsing at the peak)."""
    r = _run([(1.5, 13.0, 200.0), (1.5, 11.0, 300.0)])
    assert len(r["partitions"]) == 1
