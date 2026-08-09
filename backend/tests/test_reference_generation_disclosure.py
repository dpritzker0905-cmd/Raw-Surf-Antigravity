"""The reference-generation disclosure (2026-08-09, parity run 31311733401 — PEDRAS NEGRAS).

THE CLASS: the size reference is a MOVING input — every precompute folds fresh breaking heights
into the climatology, so a served glyph frame can carry an OLDER reference generation than a
later reader's blob lookup. The probe's first self-diagnosing red proved it end-to-end: same
model runs, heights within 0.9%, every multiplier equal except size_gate (glyph 0.5898 @ ref
1.2793 vs sim 0.318 @ ref 2.199) — an 18.2-point "composition" red that was actually an
unrecorded input generation. Replayed with the glyph's own reference the sim scored 39.6
poor_fair, d = 0.0 EXACTLY. Same shape as model-run identity (R11-04), one input over:
`run_time` records the sea's generation; `reference_size_m` records the rating config's.
"""
import ast
import os

_BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _src(rel):
    return open(os.path.join(_BACKEND, rel), encoding="utf-8").read()


def test_glyph_payload_discloses_its_reference_generation_absent_not_null():
    """Mirrors the forecast_confidence conditional-spread contract one payload over: present when
    a local reference graded the spot, ABSENT when the global 1.2 m curve did (absence IS the
    lane; a null on every global-curve spot would be bytes nobody reads)."""
    src = _src(os.path.join("services", "weather_pipeline", "spot_ratings.py"))
    assert '**({"reference_size_m": round(float(reference_size_m), 4)}' in src, (
        "the glyph payload no longer discloses which size reference graded it — the parity "
        "monitor is blind to reference-generation skew again (the Pedras Negras class)")
    ast.parse(src)


def test_probe_gates_on_the_glyphs_own_reference_when_disclosed():
    """d_score asks 'is the sim's COMPOSITION correct?' — answerable only on SHARED inputs, and
    the reference is an input. When the row discloses reference_size_m, the gating calc must
    grade with it; the lookup lane remains the fallback for pre-disclosure frames."""
    src = _src(os.path.join("scripts", "sim_health_probe.py"))
    assert 'glyph_ref = item.get("reference_size_m")' in src
    assert '"served_reference_size_m": glyph_ref' in src, (
        "the probe's gating calc no longer grades on the glyph's disclosed reference — "
        "reference-generation skew will page as fake composition again")
    assert '"gating_reference_lane"' in src, "the row must say WHICH lane gated"
    ast.parse(src)


def test_the_pedras_negras_inversion_is_pinned():
    """The regression fixture from the live red: at h=1.261 m the size curve must separate the
    two reference generations exactly as observed (glyph 0.5898 @ 1.2793; sim 0.318 @ 2.199).
    If the curve changes shape, this pin moves and the artefact-vs-replay method breaks — that
    is a calibration decision, not a refactor side effect."""
    os.environ["RATING_LOCAL_SIZE"] = "1"
    import sys
    sys.path.insert(0, _BACKEND)
    from services.weather_pipeline.surf_rating import size_score
    assert abs(size_score(1.261, 1.2793) - 0.5898) < 0.002
    assert abs(size_score(1.261, 2.199) - 0.318) < 0.002
