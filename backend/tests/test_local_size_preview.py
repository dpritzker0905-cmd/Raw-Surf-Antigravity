"""What happens if we flip RATING_LOCAL_SIZE?

`services/weather_pipeline/local_size_preview.py`. The rollout plan in `95c5f04a` (2026-07-11) said
"once climatology is sane, flip RATING_LOCAL_SIZE=1 and verify". Eighteen days later the blob is
218 KB and fresh, the flag is still 0, and Florida reads poor-to-fair — because nothing could answer
"is it sane yet?" without a production credential.

THE LOAD-BEARING PROPERTY is the ratio identity: `reference_size_m` enters the composite in exactly
two multiplicative factors, so

    score_local == score_global * (sg_l * og_l) / (sg_g * og_g)

exactly. If a future factor ever starts consuming `reference_size_m`, that identity silently becomes
wrong and every preview under-reports. `test_the_ratio_identity_is_exact_against_the_real_engine`
compares against `compute_surf_rating` itself and goes red when it breaks.
"""
import os
import sys

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline import local_size_preview as LSP          # noqa: E402
from services.weather_pipeline.surf_rating import compute_surf_rating    # noqa: E402


def _frames(spots):
    return [{"model": "GFS", "valid_time": "2026-08-03T06:00:00Z", "hour_offset": 0, "spots": spots}]


def _spot(sid, name, score, h, lat=27.86, lng=-80.44, level=None):
    from services.weather_pipeline.surf_rating import score_to_level
    return {"spot_id": sid, "name": name, "score": score, "surf_height_m": h,
            "latitude": lat, "longitude": lng, "level": level or score_to_level(score)}


# ── THE LOAD-BEARING IDENTITY ───────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("h,ref,tp,wind_ms,wind_from,sn,swell", [
    (0.884, 0.70, 7.9, 2.0, 280.0, 76.0, 85.0),     # the measured FL case
    (0.75, 0.70, 11.0, 2.0, 270.0, 90.0, 270.0),    # the owner's anchor
    (1.22, 0.70, 11.0, 2.0, 270.0, 90.0, 270.0),    # 4 ft FL — reads "epic" on the global curve
    (0.75, 2.50, 11.0, 2.0, 270.0, 90.0, 270.0),    # small day at a big-wave coast
    (3.00, 2.50, 14.0, 3.0, 270.0, 90.0, 270.0),    # big day at a big-wave coast
    (0.35, 0.60, 9.0, 5.0, 200.0, 90.0, 260.0),     # near the rideability floor
])
def test_the_ratio_identity_is_exact_against_the_real_engine(h, ref, tp, wind_ms, wind_from, sn, swell):
    """The whole preview rests on this. Not an approximation — an identity."""
    score_g, _ = compute_surf_rating(h, tp, wind_ms, wind_from, sn, swell)
    score_l, _ = compute_surf_rating(h, tp, wind_ms, wind_from, sn, swell, reference_size_m=ref)
    r = LSP._ratio(h, ref, None)
    assert r is not None
    assert round(score_g * r, 1) == pytest.approx(score_l, abs=0.15), (
        f"ratio identity broke: {score_g} * {r} != {score_l} — has a new factor started "
        f"consuming reference_size_m?")


def test_a_flat_spot_is_unchanged_not_indeterminate():
    """Both size_score branches share the ~0.2 m floor, so flat stays 0 either way."""
    assert LSP._ratio(0.1, 0.7, None) == 1.0
    assert LSP._ratio(0.0, 0.7, None) == 1.0


def test_no_reference_means_no_ratio():
    assert LSP._ratio(0.9, None, None) is None


# ── THE PREVIEW ─────────────────────────────────────────────────────────────────────────────────

def test_spots_without_climatology_are_reported_as_untouched():
    """MIN_SAMPLES makes the flip safe by construction: no reference -> global default -> no change.
    The preview must show that as coverage, not silently drop those spots."""
    frames = _frames([_spot("a", "Has ref", 50.0, 0.9), _spot("b", "No ref", 50.0, 0.9)])
    out = LSP.preview_impact({"spots": {"a": {}, "b": {}}}, frames,
                             reference_map_fn=lambda c: {"a": 0.7})
    assert out["readiness"]["spots_rated"] == 2
    assert out["readiness"]["spots_with_reference"] == 1
    assert out["readiness"]["coverage_pct"] == 50.0
    assert out["impact"]["spot_hours_compared"] == 1      # only the one with a reference


def test_local_calibration_is_a_REDISTRIBUTION_not_a_florida_boost():
    """⚠️⚠️ THE CORRECTION THAT COST A WRONG ANSWER TO THE OWNER (2026-07-29).

    I reported that a local reference would take Florida's 2.9 ft hour from 53.6 "fair" to 77.2
    "good". It does not. 77.2 was `sim_explain`'s `score_if_this_were_1_0` — the hypothetical where
    size_gate is PERFECT — which is a different number from what a local reference actually yields.

    Measured: against a 0.7 m Florida reference the two size curves CROSS AT 2.83 ft. Below that,
    local lifts; above it, local lowers. The 2.9 ft hour sits just past the crossover and goes DOWN
    by ~1 point. The real prize is the top end: a 4 ft Florida day scores size_gate 1.000 globally
    (hence 89.3 "epic") and 0.798 locally.

    ★ So local calibration is not "be nicer to Florida" — it is "stop saturating". Anyone reaching
    for this flag to raise small-surf scores is reaching for the wrong lever."""
    small = compute_surf_rating(0.884, 11.0, 2.0, 90.0, 270.0, 270.0)[0]
    tiny = compute_surf_rating(0.61, 11.0, 2.0, 90.0, 270.0, 270.0)[0]
    big = compute_surf_rating(1.22, 11.0, 2.0, 90.0, 270.0, 270.0)[0]
    frames = _frames([_spot("fl_tiny", "Sebastian 2ft", tiny, 0.61),
                      _spot("fl_small", "Sebastian 2.9ft", small, 0.884),
                      _spot("fl_big", "Sebastian 4ft", big, 1.22)])
    out = LSP.preview_impact({"spots": {}}, frames,
                             reference_map_fn=lambda c: {"fl_tiny": 0.7, "fl_small": 0.7,
                                                         "fl_big": 0.7})
    by = {m["spot_id"]: m for m in out["biggest_downgrades"] + out["biggest_upgrades"]}
    assert by["fl_tiny"]["delta"] > 0, "below the crossover a local reference lifts"
    assert by["fl_small"]["delta"] < 0, "just above the crossover it lowers — NOT a boost"
    assert by["fl_big"]["delta"] < 0, "the real prize: the saturated 4 ft 'epic' comes down"
    assert by["fl_big"]["level_now"] == "epic" and by["fl_big"]["level_after"] != "epic"


def test_the_crossover_is_where_the_curves_meet_and_is_pinned():
    """If the curve shapes are ever retuned this moves — and the redistribution story changes with
    it, so it must not move silently."""
    from services.weather_pipeline.surf_rating import size_score
    lo, hi = 0.70, 1.10
    for _ in range(40):
        mid = (lo + hi) / 2
        if size_score(mid, 0.7) > size_score(mid, None):
            lo = mid
        else:
            hi = mid
    assert lo == pytest.approx(0.862, abs=0.01), f"crossover moved to {lo:.3f} m ({lo/0.3048:.2f} ft)"


def test_the_report_counts_level_flow_in_both_directions():
    small = compute_surf_rating(0.884, 11.0, 2.0, 90.0, 270.0, 270.0)[0]
    frames = _frames([_spot("x", "up", small, 0.884)])
    out = LSP.preview_impact({"spots": {}}, frames, reference_map_fn=lambda c: {"x": 0.7})
    assert out["impact"]["level_up"] + out["impact"]["level_down"] + out["impact"]["level_unchanged"] == 1
    if out["impact"]["level_up"]:
        assert any("->" in k for k in out["level_flow"])


def test_an_empty_climatology_is_a_clean_zero_not_a_crash():
    out = LSP.preview_impact(None, _frames([_spot("a", "n", 50.0, 0.9)]),
                             reference_map_fn=lambda c: {})
    assert out["impact"]["spot_hours_compared"] == 0
    assert out["readiness"]["coverage_pct"] == 0.0


def test_break_depth_fn_failure_does_not_break_the_preview():
    def boom(lat, lng):
        raise RuntimeError("geometry unavailable")
    out = LSP.preview_impact({"spots": {}}, _frames([_spot("a", "n", 50.0, 0.9)]),
                             reference_map_fn=lambda c: {"a": 0.7}, break_depth_fn=boom)
    assert out["impact"]["spot_hours_compared"] == 1


# ── THE ROLLOUT PLAN'S OWN ACCEPTANCE CRITERION ─────────────────────────────────────────────────

def test_an_inverted_climatology_is_caught_by_the_exemplars_not_the_aggregate():
    """★ THE POINT OF sanity_check. A blob giving Florida 2.5 m and Pipeline 0.7 m produces a large,
    symmetric, entirely plausible delta spread — the aggregate cannot see it. Named exemplars can."""
    spots = [{"id": "fl", "latitude": 27.8608, "longitude": -80.4464},
             {"id": "pipe", "latitude": 21.6650, "longitude": -158.0533}]
    inverted = LSP.sanity_check({}, spots, reference_map_fn=lambda c: {"fl": 2.5, "pipe": 0.7})
    assert inverted["verdict"] == "INVERTED OR MISCALIBRATED"
    assert inverted["failures"] == 2

    correct = LSP.sanity_check({}, spots, reference_map_fn=lambda c: {"fl": 0.7, "pipe": 2.5})
    assert correct["verdict"] == "SANE"
    assert correct["failures"] == 0


def test_no_data_is_reported_as_not_ready_never_as_sane():
    """A blob with no exemplar coverage must NOT read 'SANE' — that would greenlight a flip on
    nothing at all."""
    spots = [{"id": "fl", "latitude": 27.8608, "longitude": -80.4464}]
    out = LSP.sanity_check({}, spots, reference_map_fn=lambda c: {})
    assert out["verdict"] == "NOT ENOUGH DATA"
