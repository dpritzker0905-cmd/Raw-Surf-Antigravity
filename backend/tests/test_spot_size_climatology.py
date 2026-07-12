"""Unit tests for per-spot LOCAL size climatology (spot_size_climatology.py) + its effect on the rating."""
from services.weather_pipeline import spot_size_climatology as sc
from services.weather_pipeline.surf_rating import size_score, compute_surf_rating, LEVELS


def test_merge_samples_excludes_subfloor_and_bins():
    h = sc.merge_samples(None, [0.05, 0.2, 0.3, 0.9, 5.4])   # 0.05 & 0.2 excluded (<= rideable floor)
    assert sc.hist_count(h) == 3                              # 0.3, 0.9, 5.4 counted
    assert h[sc._bin_index(0.3)] == 1
    assert h[sc._bin_index(0.9)] == 1
    assert h[-1] == 1                                         # 5.4 clamps into the top bin


def test_percentile_and_reference():
    # 100 samples uniformly across 0.4..2.0 m -> p80 near ~1.7 m.
    samples = [0.4 + 1.6 * i / 100 for i in range(100)]
    h = sc.merge_samples(None, samples)
    p80 = sc.percentile_from_hist(h, 0.80)
    assert 1.5 <= p80 <= 1.9
    ref = sc.reference_from_hist(h)
    assert ref == min(sc.REF_CLAMP_MAX_M, max(sc.REF_CLAMP_MIN_M, p80))


def test_reference_none_until_min_samples():
    h = sc.merge_samples(None, [0.6, 0.7])                    # only 2 samples
    assert sc.reference_from_hist(h, min_samples=12) is None  # bootstrap -> no reference yet
    h = sc.merge_samples(h, [0.6] * 20)
    assert sc.reference_from_hist(h, min_samples=12) is not None


def test_reference_clamped_to_sane_range():
    tiny = sc.merge_samples(None, [0.25] * 50)                # degenerate low
    assert sc.reference_from_hist(tiny) >= sc.REF_CLAMP_MIN_M
    huge = sc.merge_samples(None, [9.0] * 50)                 # degenerate high
    assert sc.reference_from_hist(huge) <= sc.REF_CLAMP_MAX_M


def test_merge_frames_accumulates_across_runs():
    frames1 = [{"spots": [{"spot_id": "a", "surf_height_m": 0.6}, {"spot_id": "b", "surf_height_m": 2.4}]}]
    obj = sc.merge_frames_into_climatology(None, frames1)
    assert obj["spots"]["a"]["n"] == 1 and obj["spots"]["b"]["n"] == 1
    frames2 = [{"spots": [{"spot_id": "a", "surf_height_m": 0.7}]}]
    obj = sc.merge_frames_into_climatology(obj, frames2)      # second run folds in
    assert obj["spots"]["a"]["n"] == 2 and obj["spots"]["b"]["n"] == 1


def test_reference_map_skips_undersampled():
    obj = {"spots": {
        "big": {"hist": sc.merge_samples(None, [2.2] * 40)},
        "sparse": {"hist": sc.merge_samples(None, [0.6] * 3)},
    }}
    m = sc.reference_map(obj)
    assert "big" in m and "sparse" not in m                  # only well-sampled spots get a reference


def test_florida_vs_hawaii_science_end_to_end():
    # FL climatology: mostly 0.4-0.9 m (knee-to-chest); Hawaii: mostly 1.5-3.0 m (head-plus).
    fl_hist = sc.merge_samples(None, [0.4, 0.5, 0.6, 0.6, 0.7, 0.8, 0.9] * 6)
    hi_hist = sc.merge_samples(None, [1.5, 1.8, 2.0, 2.2, 2.5, 2.8, 3.0] * 6)
    fl_ref = sc.reference_from_hist(fl_hist)
    hi_ref = sc.reference_from_hist(hi_hist)
    assert fl_ref < hi_ref                                    # FL's good day is much smaller
    # A clean 2-3 ft day (0.75 m): coast faces west (shore-normal 270), swell head-on FROM 270,
    # light offshore wind FROM the land (90), decent 11 s period.
    args = (0.75, 11.0, 2.0, 90.0, 270.0, 270.0)
    fl_score, fl_level = compute_surf_rating(*args, reference_size_m=fl_ref)
    hi_score, hi_level = compute_surf_rating(*args, reference_size_m=hi_ref)
    assert fl_score > hi_score                                # same swell rates HIGHER in FL
    assert LEVELS.index(fl_level) > LEVELS.index(hi_level)    # and a better category
