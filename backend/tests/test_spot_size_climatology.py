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
    # ⚠️ Assert the RELATIONSHIP, not a hardcoded 0.80. This test previously compared the reference
    # against p80 directly, so it pinned the DEFAULT rather than the behaviour and went red the
    # moment REF_PERCENTILE was corrected — the same shape as the guard that pinned a literal call
    # spelling and sat red for 157 commits.
    ref = sc.reference_from_hist(h)
    at_default = sc.percentile_from_hist(h, sc.REF_PERCENTILE)
    assert ref == min(sc.REF_CLAMP_MAX_M, max(sc.REF_CLAMP_MIN_M, at_default))


def test_percentile_interpolates_instead_of_snapping_to_bin_edges():
    """It returned the bin's UPPER EDGE, which biased every reference high by up to a full bin
    (~+0.13 m measured on the live blob) and quantised it to multiples of 0.2 m. The owner's
    acceptance window for a Florida reference is [0.65, 0.85] — 0.2 m wide — so a 0.2 m grid could
    not be calibrated onto it at all: exactly one grid point falls inside."""
    # Everything in the [0.8, 1.0) bin. The median sits INSIDE that bin, not at its top edge.
    h = sc.merge_samples(None, [0.85, 0.87, 0.9, 0.93, 0.95] * 10)
    med = sc.percentile_from_hist(h, 0.50)
    assert 0.8 <= med < 1.0, f"median {med} escaped the bin its samples are in"
    assert med % sc.BIN_WIDTH_M != 0, f"{med} snapped to a bin edge instead of interpolating"

    # Monotone in p, and never outside the populated range.
    vals = [sc.percentile_from_hist(h, p) for p in (0.1, 0.25, 0.5, 0.75, 0.9)]
    assert vals == sorted(vals), f"percentile not monotone in p: {vals}"


def test_ref_percentile_stays_in_the_measured_owner_anchor_plateau():
    """★ The number itself is load-bearing and was measured, not chosen.

    Against the live 1,821-entry blob (2026-07-30), Florida's reference and the owner's five
    acceptance anchors move together:

        p0.30 -> 0.653 m  4/5      p0.55 -> 0.809 m  5/5
        p0.40 -> 0.735 m  5/5      p0.60 -> 0.833 m  5/5
        p0.50 -> 0.785 m  5/5      p0.65 -> 0.856 m  4/5
                                   p0.80 -> 0.954 m  2/5   <- the old default

    At the old p80 the local reference was WORSE than the global 1.2 m default it replaces (2/5 vs
    4/5): clean 2-3 ft read poor_fair and pumping 6-8 ft fell out of epic, the opposite of what the
    owner asked for. p40-p60 is a plateau, so this is margin, not a fit to five points."""
    assert 0.40 <= sc.REF_PERCENTILE <= 0.60, (
        f"REF_PERCENTILE={sc.REF_PERCENTILE} is outside the measured 5/5 plateau [0.40, 0.60]; "
        f"re-run backend/scripts/local_size_gonogo.py before changing it"
    )


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

def test_provenance_markers_survive_the_merge_rebuild():
    """A campaign RESUME MARKER must outlive a precompute cycle.

    `merge_frames_into_climatology` REBUILDS each record (`rec = {"hist": ...}`), so anything not
    copied forward is dropped. That hazard was identified in the code and fixed for lat/lng ALONE,
    leaving `era5` and `backfill` — the deepening campaign's resume markers — stripped on every
    merge. The precompute merges frames BEFORE folding the inbox back in (spot_ratings.py:699 then
    :702), so a freshly banked marker survived only to the next cycle (cron '45 3-23/4', ~4 h).
    ★ The HISTOGRAM was never lost — RESUMABILITY was. An ~85 h campaign re-fetched spots it already
      held on every restart, and the `NEVER BANK AN EMPTY SPOT` guard reasons entirely from "the
      stamp means DONE".
    The CONTROL (a spot absent from this run) is what proves the strip came from the merge itself.
    """
    from services.weather_pipeline.spot_size_climatology import merge_frames_into_climatology
    blob = {"spots": {
        "in-run": {"hist": {}, "n": 0, "lat": 1.0, "lng": 2.0,
                   "era5": {"v": 3, "n": 139016}, "backfill": {"v": 2}},
        "untouched": {"hist": {}, "n": 0, "lat": 3.0, "lng": 4.0, "era5": {"v": 3}},
    }}
    frames = [{"spots": [{"spot_id": "in-run", "surf_height_m": 1.2,
                          "latitude": 1.0, "longitude": 2.0}]}]
    out = merge_frames_into_climatology(blob, frames)
    merged = out["spots"]["in-run"]
    assert merged.get("era5", {}).get("v") == 3, "era5 resume marker stripped by the rebuild"
    assert merged.get("backfill", {}).get("v") == 2, "backfill marker stripped by the rebuild"
    assert merged["lat"] == 1.0 and merged["lng"] == 2.0, "coordinate regression"
    # CONTROL: untouched spots kept their marker even BEFORE the fix, so this alone proves nothing —
    # it is here so a future change that drops them everywhere cannot pass on the assertion above.
    assert out["spots"]["untouched"].get("era5", {}).get("v") == 3
