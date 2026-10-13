"""The band's per-cell size reference must be readable from the response it decided.

WHY. Queue E#1 -- the rating band and the spot glyphs disagree on colour -- has been open since
2026-08-09. On 2026-09-21 it was narrowed to ONE input: the band's score is monotonically
DECREASING in `reference_size_m`, and at Sebastian Inlet the same cell scores

    ref 2.164 -> 11.7      ref 1.15 -> 24.2      ref 0.50 -> 52.6      band served 59.1

so the band's reference had to be somewhere near 0.45 m against the glyph's 1.15. It had to be
INFERRED from that curve, because the grid climatology lives in L2/Supabase and is unreachable
from a dev box.

⭐⭐ AN INPUT THAT DECIDES THE OUTPUT AND CANNOT BE READ BACK MAKES EVERY DISAGREEMENT A REPLAY
EXERCISE. Echoing it turns band-vs-glyph into a subtraction: the glyph already publishes
`reference_size_m` in the spot-ratings payload.

These tests pin the CONTRACT of that echo. They do not measure any reference -- there is no grid
climatology on this box, which is precisely the condition that made the echo necessary.
"""
import pytest


def _tag_for(refs, reference_fn_present=True):
    """Replay the stamping logic over a list of what reference_fn returned.

    Mirrors grid_resolver_surf's block. Kept as a helper so the CONTRACT is tested directly rather
    than through an async resolver that would need a whole product, a bathymetry stack and a
    thread -- none of which this assertion is about.
    """
    tag = {"rated": len(refs), "value_kind": "surf_rating", "local_size": bool(reference_fn_present)}
    numeric = [float(r) for r in refs if isinstance(r, (int, float))]
    if numeric:
        s = sorted(numeric)
        tag["reference_m"] = {"n": len(s), "min": round(s[0], 3),
                              "p50": round(s[len(s) // 2], 3), "max": round(s[-1], 3)}
    elif reference_fn_present:
        tag["reference_m"] = {"n": 0, "note": "no cell resolved a local reference; "
                                              "the global default applied throughout"}
    return tag


class TestTheEchoAnswersTheQuestionItWasBuiltFor:
    def test_it_reports_the_spread_not_just_one_number(self):
        # A band is many cells. One number could not show that the cells disagree with each other,
        # which is itself a finding when a band looks patchy.
        tag = _tag_for([0.45, 0.50, 1.20])
        assert tag["reference_m"] == {"n": 3, "min": 0.45, "p50": 0.5, "max": 1.2}

    def test_the_sebastian_shape_is_readable(self):
        """The case that motivated it: a band whose references sit far BELOW the spot's 1.15."""
        tag = _tag_for([0.44, 0.45, 0.46, 0.47])
        assert tag["reference_m"]["p50"] < 1.15, (
            "this is the comparison E#1 needs: band p50 against the glyph's reference_size_m"
        )


class TestItDistinguishesAbsenceFromASmallValue:
    def test_no_resolved_reference_says_so_explicitly(self):
        """
        ⭐ THE LOAD-BEARING DISTINCTION. `reference_for` returns None where a cell has too few
        samples, and those cells fall back to the GLOBAL default. "no reference" and "a small
        reference" are different explanations for a bright band, and a summary reporting only
        min/p50/max would silently merge them.
        """
        tag = _tag_for([])
        assert tag["reference_m"]["n"] == 0
        assert "note" in tag["reference_m"]
        assert "min" not in tag["reference_m"], "absence must not be dressed up as a measurement"

    def test_none_returns_are_excluded_from_the_statistics(self):
        # 4 cells asked, 2 answered. Reporting n=4 would overstate the coverage of the number.
        tag = _tag_for([0.5, None, 0.7, None])
        assert tag["reference_m"]["n"] == 2
        assert tag["reference_m"]["min"] == 0.5 and tag["reference_m"]["max"] == 0.7

    def test_the_key_is_absent_entirely_when_no_reference_fn_was_injected(self):
        # local_size False already says the lane ran without a climatology. Emitting an empty
        # reference_m there would imply one was consulted and declined to answer.
        tag = _tag_for([], reference_fn_present=False)
        assert "reference_m" not in tag
        assert tag["local_size"] is False


class TestItCannotDisturbWhatItObserves:
    def test_the_wrapper_returns_the_INNER_value_unchanged(self):
        """
        ⭐ The echo wraps `reference_fn` rather than changing `rating_transform_grid` (which sits at
        797/800 LOC). A wrapper that altered or swallowed the value would change the very scores it
        exists to explain -- an instrument that moves its subject.
        """
        seen = []

        def inner(lat, lng):
            return 0.62

        def recording(lat, lng, _f=inner, _acc=seen):
            r = _f(lat, lng)
            if isinstance(r, (int, float)):
                _acc.append(float(r))
            return r

        assert recording(27.75, -80.5) == 0.62
        assert seen == [0.62]

    def test_a_None_from_the_inner_fn_is_passed_through_as_None(self):
        def recording(lat, lng, _f=lambda a, b: None, _acc=[]):
            r = _f(lat, lng)
            if isinstance(r, (int, float)):
                _acc.append(float(r))
            return r

        assert recording(0, 0) is None, "the band must still fall back to its global default"

    def test_it_records_what_was_CONSUMED_not_what_was_asked(self):
        # Cells the transform skips (open ocean, masked, non-rideable) never call reference_fn, so
        # the summary describes the cells that were actually RATED. That is the population whose
        # colour the owner is looking at.
        consumed = [0.5, 0.5, 0.6]
        assert _tag_for(consumed)["reference_m"]["n"] == 3


class TestRounding:
    @pytest.mark.parametrize("val,expect", [(0.4448, 0.445), (1.2345, 1.234), (2.1644, 2.164)])
    def test_three_decimals_is_enough_to_compare_against_the_glyph(self, val, expect):
        # The glyph publishes reference_size_m at this precision; matching it keeps the comparison
        # a subtraction rather than a rounding argument.
        assert _tag_for([val])["reference_m"]["min"] == expect


def test_the_PRODUCTION_path_really_wraps_and_stamps():
    """
    ⭐ THE LOAD-BEARING TEST. Everything above exercises a helper in THIS file, and would pass
    unchanged against a resolver that never wrapped reference_fn at all. A test that models the
    instrument is testing a different system; this one reads the production source.
    """
    import inspect
    from services.weather_pipeline import grid_resolver_surf as grs
    src = inspect.getsource(grs)
    assert "_recording_reference_fn" in src, "the reference_fn must be wrapped to record what it returned"
    # ⚠️ NOT `'tag["reference_m"]' in src` — that was the FIRST version and a mutation SURVIVED it:
    # deleting the numeric stamp left the absence-branch occurrence behind, so the substring was
    # still present and the test still passed. ⭐ A SUBSTRING TEST OVER SOURCE PASSES ON THE WRONG
    # OCCURRENCE; assert each branch by its own distinguishing content.
    # ⚠️ AND NOT `'"p50": round(' in src` either — that was the SECOND version, and the same
    # mutation survived it too: renaming the KEY left the payload lines untouched, so the substring
    # was still there. ⭐⭐ TWO WEAK ASSERTIONS IN A ROW, BOTH CAUGHT ONLY BY MUTATION — bind the
    # key TO its payload, or a source test just proves some characters exist somewhere.
    assert 'tag["reference_m"] = {"n": len(' in src, (
        "the NUMERIC summary must be stamped under the reference_m KEY, not merely computed"
    )
    assert 'tag["reference_m"] = {"n": 0' in src, "the absence branch must still stamp n=0 + a note"
    assert "reference_fn=(_recording_reference_fn if reference_fn else None)" in src, (
        "the wrapper must be the fn actually PASSED to rating_transform_grid — wrapping something "
        "the band never calls would record an empty list and report 'no reference' forever"
    )
