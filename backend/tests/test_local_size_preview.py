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


# ── THE DEFECT THE FLIP ACTUALLY FIXES ──────────────────────────────────────────────────────────

@pytest.mark.parametrize("tp", [7.0, 9.0, 12.0, 15.0])
def test_CHARACTERISATION_the_global_curve_is_size_blind_above_4ft(tp):
    """⛔ KNOWN DEFECT, pinned so it is visible and so the fix is provable.

    `size_score` maps [0.2 m -> 1.2 m] onto [0 -> 1] and then FLATLINES. Real surf runs 0.2 m to
    10 m+, so the entire useful range of the size factor is spent in the first four feet and every
    wave above that scores identically until the oversize gate fires. Measured 2026-07-29 with
    perfect wind and head-on swell: 4 / 6 / 8 / 10 / 12 ft are BYTE-IDENTICAL at every period.

    ★★ This is the FOURTH instance of the saturation family. The first three were factors that could
    not say NO (fixed by making them multiply: wind_gate, oversize_gate, period_gate). This is the
    mirror — a factor that cannot say MORE — and the same root: a bounded factor pinned at its bound
    carries no information.

    When RATING_LOCAL_SIZE ships this test should be REPLACED, not deleted: it is the before-picture.
    """
    scores = {ft: compute_surf_rating(ft * 0.3048, tp, 2.0, 270.0, 90.0, 90.0)[0]
              for ft in (4, 6, 8, 10, 12)}
    assert len(set(scores.values())) == 1, (
        f"the global size curve has started discriminating above 4 ft at Tp {tp} — if that was "
        f"intentional, replace this characterisation test: {scores}")


def test_a_local_reference_RESTORES_the_dynamic_range():
    """★ The value of the flip, made provable. A spot-relative reference moves saturation from a
    fixed 3.9 ft to 2.5x the spot's own good day, so size starts carrying information again across
    the range that spot actually sees."""
    from services.weather_pipeline.surf_rating import size_score
    # Florida (p80 ~0.7 m): discriminates out to ~5.7 ft instead of stopping at 3.9.
    fl = [size_score(ft * 0.3048, 0.7) for ft in (4, 5, 6)]
    assert fl[0] < fl[1] < fl[2], f"FL reference should still be discriminating at 4-6 ft: {fl}"
    # A big-wave coast (p80 ~2.5 m): still discriminating at 12 ft, where global is long since 1.0.
    pipe = [size_score(ft * 0.3048, 2.5) for ft in (4, 8, 12)]
    assert pipe[0] < pipe[1] < pipe[2], f"big-wave reference should discriminate to 12 ft: {pipe}"
    assert all(p < 1.0 for p in pipe), "a 12 ft day must not saturate a 25 ft spot"
    # And the global curve is flat across that same span — the contrast that justifies the flip.
    glob = [size_score(ft * 0.3048, None) for ft in (4, 8, 12)]
    assert len(set(glob)) == 1 and glob[0] == 1.0


# ── A THRESHOLD OUTLIVES THE CALIBRATION OF ITS INPUT (2026-08-09) ──────────────────────────────
# The census paged 6 consecutive runs because Pipeline read 1.48 m against a >=1.5 bound authored at
# REF_PERCENTILE=0.80 and graded at 0.50. These pin the two claims apart so the gate can never again
# be simultaneously wrong-framed and load-bearing.

_SPOTS = [{"id": "fl", "latitude": 27.8608, "longitude": -80.4464},
          {"id": "pipe", "latitude": 21.6650, "longitude": -158.0533}]


def test_an_absolute_miss_in_a_FOREIGN_frame_refuses_instead_of_asserting_inversion():
    """The real 2026-08-09 blob: ordering intact, Pipeline 1.3% under a p80-authored floor."""
    out = LSP.sanity_check({}, _SPOTS, reference_map_fn=lambda c: {"fl": 0.86, "pipe": 1.48},
                           operative_pctl=0.50)
    assert out["verdict"] == "BOUNDS STALE", out
    assert out["failures"] == 1                      # the miss is still COUNTED and still printed
    assert out["bounds_frame"]["binds"] is False
    assert out["ordering"]["inverted"] is False
    assert out["ordering"]["worst"]["margin"] > 1.0


def test_the_same_miss_PAGES_when_the_frame_matches_or_the_kill_switch_is_set():
    """Non-widening is the whole point: in its own frame the bound is untouched and still fires."""
    refs = lambda c: {"fl": 0.86, "pipe": 1.48}      # noqa: E731
    assert LSP.sanity_check({}, _SPOTS, reference_map_fn=refs,
                            operative_pctl=0.80)["verdict"] == "INVERTED OR MISCALIBRATED"
    assert LSP.sanity_check({}, _SPOTS, reference_map_fn=refs, operative_pctl=0.50,
                            strict_absolute=True)["verdict"] == "INVERTED OR MISCALIBRATED"


def test_ordering_still_catches_a_real_inversion_in_ANY_frame():
    """MUTATION CONTROL. The refusal above must not have bought silence: the blob this gate exists
    for must fail at every percentile, including the one where the absolute bounds do not bind."""
    for pctl in (0.50, 0.65, 0.80, None):
        out = LSP.sanity_check({}, _SPOTS, reference_map_fn=lambda c: {"fl": 2.5, "pipe": 0.7},
                               operative_pctl=pctl)
        assert out["verdict"] == "INVERTED OR MISCALIBRATED", (pctl, out)
        assert out["ordering"]["inverted"] is True
        assert out["ordering"]["worst"]["margin"] < 1.0


def test_the_separation_floor_is_DERIVED_from_the_authored_bounds_not_chosen():
    """If someone edits a bound, the ordering claim must follow it — the two cannot drift apart."""
    pairs = {(s, b): r for s, b, r in LSP._authored_pairs()}
    assert pairs[("Florida east coast (Sebastian Inlet)", "Hawaii North Shore (Pipeline)")] == \
        pytest.approx(1.5 / 1.1)
    # ⚠️ The bug caught before it ran: a single min(lo)/max(hi) would be 1.0/1.1 = 0.909 — BELOW 1.0,
    # i.e. it would pass an inversion. Per-pair ratios never produce that.
    assert min(pairs.values()) == pytest.approx(1.0 / 1.1)
    assert all(r > 1.0 for (s, b), r in pairs.items() if "Uluwatu" not in b)


def test_a_flat_ordering_margin_of_exactly_one_is_not_inverted():
    """Boundary: `< 1.0` is the inversion test, so sitting exactly on the authored ratio passes.
    Pinned because the defect that started all this was a bound sitting EXACTLY on its value."""
    out = LSP.sanity_check({}, _SPOTS, reference_map_fn=lambda c: {"fl": 1.0, "pipe": 1.5 / 1.1},
                           operative_pctl=0.50)
    assert out["ordering"]["worst"]["margin"] == pytest.approx(1.0)
    assert out["ordering"]["inverted"] is False


def test_no_data_is_reported_as_not_ready_never_as_sane():
    """A blob with no exemplar coverage must NOT read 'SANE' — that would greenlight a flip on
    nothing at all."""
    spots = [{"id": "fl", "latitude": 27.8608, "longitude": -80.4464}]
    out = LSP.sanity_check({}, spots, reference_map_fn=lambda c: {})
    assert out["verdict"] == "NOT ENOUGH DATA"
