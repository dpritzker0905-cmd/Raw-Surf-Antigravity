"""Controls for scripts/partition_truth/hawaii_gate.py (pure helpers; no network)."""
from datetime import datetime, timezone

import numpy as np

from scripts.partition_truth import hawaii_gate as hg


def test_circular_difference_wraps_through_north():
    assert float(hg.ad(350.0, 10.0)) == -20.0
    assert float(hg.ad(10.0, 350.0)) == 20.0
    assert abs(float(hg.ad(180.0, 0.0))) == 180.0


def test_circular_mean_across_north_and_sector_wrap():
    assert min(hg.cmean([350.0, 10.0]), 360.0 - hg.cmean([350.0, 10.0])) < 1e-6
    assert bool(hg.in_sector(5.0, 285.0, 20.0)) and bool(hg.in_sector(300.0, 285.0, 20.0))
    assert not bool(hg.in_sector(90.0, 285.0, 20.0))


def test_preregistered_classes_are_pinned():
    # written before any error was computed; 51214 is American Samoa and must stay out of both Hawaii classes
    assert hg.CLASSES == {"51201": "exposed", "51202": "exposed", "51206": "exposed",
                          "51211": "sheltered", "51212": "sheltered", "51214": "not_hawaii"}


def _rows(errs_by_buoy, pers=0.0):
    out, t = [], datetime(2026, 10, 20, tzinfo=timezone.utc)
    for b, errs in errs_by_buoy.items():
        for e in errs:
            out.append({"buoy": b, "cls": "exposed", "T": t, "obs": 100.0, "e_gfs": e, "e_pers": pers})
    return out


def test_positive_control_recovers_a_seeded_rotation_and_shuffle_null_is_worse():
    rng = np.random.default_rng(0)
    L = _rows({"a": list(rng.normal(0, 8, 200)), "b": list(rng.normal(0, 8, 200))})
    c = hg.controls(L)
    assert abs(c["positive_control_recovered_rotation_deg"] - 30.0) < 0.5
    assert c["flip180_mae"] > 170.0


def test_buoy_cluster_bootstrap_separates_a_real_gap_from_no_gap():
    gap = hg.cluster_boot(_rows({"a": [40.0] * 30, "b": [35.0] * 30, "c": [45.0] * 30}), "e_gfs", "e_pers")
    assert gap["lo"] > 0
    flat = hg.cluster_boot(_rows({"a": [10.0, -10.0] * 15, "b": [-10.0, 10.0] * 15}, pers=10.0), "e_gfs", "e_pers")
    assert flat["lo"] <= 0 <= flat["hi"]
