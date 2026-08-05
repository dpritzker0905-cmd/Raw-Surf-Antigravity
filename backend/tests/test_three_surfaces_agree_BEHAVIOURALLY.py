"""THE THREE SURFACES, DRIVEN END TO END, MUST PRODUCE THE SAME NUMBER.

⛔⛔ WHY THIS FILE EXISTS — the guard everyone believes covers this does not.

`test_rating_composition_parity.py::test_all_three_surfaces_agree_exactly_with_flags_off` is named
for this job and its docstring says "this is the assertion that would have gone red for `9b808d05`".
Measured 2026-08-05 with `sys.settrace` over all four of its parametrisations:

    surf_rating.py        7,686 calls
    shore_normal_asset.py 1,444 calls
    spot_ratings.py       EXECUTED = False
    spot_conditions.py    EXECUTED = False
    sim_rating.py         EXECUTED = False

Its three "surfaces" are ONE function called three ways — `compute_surf_rating` positionally,
`compute_surf_rating` by keyword, and `rating_score` by keyword. It is a real and useful test of
ENGINE self-consistency across call styles. It is not a test of the surfaces, and it could not have
gone red for `9b808d05`.

WHAT IS ACTUALLY GUARDED, AND WHAT IS NOT (measured, not assumed):

    test_the_registry_matches_what_the_code_actually_passes   AST over each surface's real call
                                                              site, positionals resolved against
                                                              the live signature -> catches
                                                              "which FACTORS are supplied"    ✅
    test_all_three_surfaces_agree_exactly_with_flags_off      engine self-consistency         ✅
    THIS FILE                                                 same inputs -> same NUMBER      ← gap

The gap is not theoretical. The 2026-08-05 audit found `RATING_OBS_GATE` read by three surfaces and
not by the hub or the sim: identical arguments, different published score. An argument-set guard
cannot see that, because the argument sets match.

⭐ MUTATION-TESTED, AND ONE MUTANT SURVIVED — the survivor is the useful part.

    sim-only `wind_spd * KT_TO_MS * 1.35`   -> 12 of 13 RED   ✅ caught
    sim-only `break_depth_m=None`           -> 13 of 13 GREEN  ⛔ NOT caught

⛔ THIS TEST IS STRUCTURALLY BLIND TO `break_depth_m`, AND THAT IS NOT A FLAW IN THE TEST. That
argument feeds the depth-limited cap, and the cap almost never binds: measured separately over
9 spots x 5 seas, a 1.523x swing in the breaker index moved the served height in 1 of 45 cases by
0.3% (see test_slope_gamma_is_contaminated_but_inert.py). A factor that does not change the output
cannot be caught by comparing outputs. Adding sea states will not fix it — there are essentially
none where the cap binds.

⇒ THE TWO GUARDS ARE COMPLEMENTARY, AND BOTH ARE REQUIRED:
    test_the_registry_matches_what_the_code_actually_passes  catches a factor being DROPPED,
                                                             including an inert one (AST, arg sets)
    THIS FILE                                                catches a factor that MOVES THE NUMBER
                                                             diverging between surfaces
Neither subsumes the other. `9b808d05` — the ten-positional-args defect that dropped
`break_depth_m` — is caught by the FIRST one, not this one. Do not delete either believing the
other covers it.

★ THE HARNESS IS FAITHFUL, NOT CONVENIENT. The three surfaces take DIFFERENT inputs — the sim takes
an OFFSHORE Hs and computes the breaking height itself, while `rate_one_spot` reads a breaking
height off the point response that `point_surf_augment` produced. So the stub resolver below does
exactly what `point_surf_augment` does: it runs `estimate_surf_at` on the same offshore sea. Feeding
`rate_one_spot` a raw offshore height instead would compare two different seas and pass while
production diverged — the "instrument lied first" class this repo keeps hitting.
"""
import asyncio
import os
import sys
from datetime import datetime, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)

from services.weather_pipeline.schemas import (                       # noqa: E402
    NormalizedPointDetail, NormalizedPointResponse)

# Real spots with resolvable geometry, spanning shore normals and shelf types.
SPOTS = [
    ("Mavericks", 37.4915, -122.5083),
    ("Lower Trestles", 33.3819, -117.5885),
    ("Pipeline", 21.6637, -158.0515),
    ("Cocoa Beach Pier", 28.3676, -80.6012),
]
# (offshore Hs m, Tp s, swell-from deg, wind kt, wind-from deg)
SEAS = [
    (1.0, 10.0, 290.0, 6.0, 95.0),
    (2.0, 13.0, 300.0, 12.0, 45.0),
    (3.5, 16.0, 270.0, 4.0, 180.0),
]
VT = "2026-08-05T12:00:00Z"


def _point(domain, layer, lat, lng, speed, period, direction):
    return NormalizedPointResponse(
        model="GFS", provider="open-meteo", domain=domain, layer=layer,
        run_time=datetime(2026, 8, 5, 6, tzinfo=timezone.utc),
        valid_time=datetime(2026, 8, 5, 12, tzinfo=timezone.utc),
        is_forecast_authoritative=True, is_estimated=False,
        point=NormalizedPointDetail(requested_lat=lat, requested_lng=lng, sampled_lat=lat,
                                    sampled_lng=lng, speed=speed, period=period,
                                    direction=direction, interpolation_method="t"),
        value_kind="wave_height", value_unit="m", display_unit_hint="ft",
        source_variables=["wave_height"], freshness_sec=1800)


class _Resolver:
    """Stands in for the point lane, doing what `point_surf_augment` does: resolve the geometry and
    run `estimate_surf_at` on the offshore sea, then stamp the BREAKING height on the response.

    Reproducing that step is the whole point — `rate_one_spot` grades `marine.surf_height_m`, so a
    stub that returned the raw offshore height would be feeding it a different sea than the sim
    computes, and the comparison would be meaningless while looking green.
    """

    def __init__(self, hs, tp, sdir, wkt, wdir):
        self.hs, self.tp, self.sdir, self.wkt, self.wdir = hs, tp, sdir, wkt, wdir

    async def resolve_point(self, **kw):
        lat, lng = kw["lat"], kw["lng"]
        if kw["domain"] == "wind":
            return _point("wind", "wind", lat, lng, self.wkt, None, self.wdir)
        from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
        r = _point("marine", "waves", lat, lng, self.hs, self.tp, self.sdir)
        geo = resolve_surf_geometry(lat, lng)
        breaking, _regime = estimate_surf_at(lat, lng, self.hs, self.tp,
                                             swell_from_deg=self.sdir, geometry=geo)
        r.surf_height_m = breaking
        r.shore_normal_deg = geo.shore_normal_deg
        return r


def _glyph(spot, sea):
    from services.weather_pipeline import spot_ratings
    hs, tp, sdir, wkt, wdir = sea
    name, lat, lng = spot
    row = {"id": "t-" + name, "name": name, "latitude": lat, "longitude": lng}
    out = asyncio.run(spot_ratings.rate_one_spot(_Resolver(*sea), row, "GFS", VT))
    return out.get("score"), out.get("level"), out.get("surf_height_m")


def _sim(spot, sea):
    """⚠️ RETURNS `quality_raw`, NOT `quality_rating` — AND THE DIFFERENCE IS THE WHOLE POINT.

    The observation gate is applied at DIFFERENT LAYERS on the two surfaces, by design:
      * the sim gates INLINE inside `calculate_surf_rating` (whenever a `valid_time` is supplied);
      * the glyph does NOT — `rate_one_spot` returns an UNGATED score, and the cap is applied later
        and frame-wide by `run_spot_ratings_precompute` -> `apply_gate_to_frames` (spot_ratings.py
        :686). `rate_one_spot` does not even emit `confirmed` / `raw_score`; the gate adds them.

    A FIRST DRAFT OF THIS FILE COMPARED `quality_rating` AND WENT RED: Mavericks 3.5 m/16 s read
    glyph 70.4 vs sim 69.9, and 69.9 is exactly `CAP_UNCONFIRMED`. That looked like a composition
    violation and was NOT one — it was this harness comparing a PRE-gate number with a POST-gate
    number. Measured: the same call returns `quality_raw` = 70.4, identical to the glyph.

    ⇒ Comparing composition means comparing the two chains BEFORE a post-rating display step that
    the two surfaces deliberately apply in different places. The gate's own asymmetry is pinned
    separately, in test_observation_gate_single_model_surfaces.py.
    """
    from services.weather_pipeline.sim_rating import calculate_surf_rating
    hs, tp, sdir, wkt, wdir = sea
    name, lat, lng = spot
    row = {"id": "t-" + name, "name": name, "latitude": lat, "longitude": lng}
    out = calculate_surf_rating(row, hs, tp, sdir, wkt, wdir, valid_time=VT)
    raw = out.get("quality_raw")
    # `quality_label` is the GATED label (it reads `fair_good` off a 69.9 cap while `quality_raw`
    # is 70.4). The sim publishes no raw LABEL, so derive it from the raw score through the ONE
    # shared ladder both surfaces use — comparing a gated label with an ungated one is the same
    # apples/oranges mistake the docstring above records for the score.
    from services.weather_pipeline.surf_rating import score_to_level
    return raw, (score_to_level(raw) if raw is not None else None), out.get("breaking_height_ft")


# ── the assertions ──────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("spot", SPOTS, ids=[s[0] for s in SPOTS])
@pytest.mark.parametrize("sea", SEAS, ids=[f"{s[0]}m-{s[1]}s" for s in SEAS])
def test_the_glyph_and_the_sim_grade_the_same_sea_the_same_way(spot, sea):
    """Drives BOTH real entry points — `spot_ratings.rate_one_spot` and
    `sim_rating.calculate_surf_rating` — on one sea state and compares the published number."""
    g_score, g_level, g_h = _glyph(spot, sea)
    s_score, s_level, s_ft = _sim(spot, sea)

    # SETUP ASSERTIONS: a None on either side would make every comparison below vacuously true.
    assert g_score is not None, f"{spot[0]}: the glyph produced no score — harness broken"
    assert s_score is not None, f"{spot[0]}: the sim produced no score — harness broken"
    assert g_h, f"{spot[0]}: the glyph produced no height — the stub resolver stopped working"

    # The two chains must agree on the HEIGHT first; a score match on different heights is luck.
    g_ft = g_h * 3.28084
    assert g_ft == pytest.approx(s_ft, rel=0.02), (
        f"{spot[0]} {sea[0]}m/{sea[1]}s: glyph {g_ft:.2f} ft vs sim {s_ft:.2f} ft — the two "
        f"surfaces resolved DIFFERENT breaking heights from the same offshore sea."
    )
    assert g_score == pytest.approx(s_score, abs=0.15), (
        f"{spot[0]} {sea[0]}m/{sea[1]}s: glyph {g_score} vs sim {s_score} on identical inputs and "
        f"an agreeing height. ONE FORECAST COMPOSITION violation — a factor, a post-rating step or "
        f"a flag is being applied on one surface and not the other. An argument-set guard cannot "
        f"see this, which is why this file exists."
    )
    assert g_level == s_level, f"{spot[0]}: level {g_level} vs {s_level}"


def test_this_file_actually_executes_the_three_surfaces__THE_CONTROL():
    """The failure this file was written to end: a parity test that executes NONE of the surfaces
    it names. Proven with settrace, exactly as the defect was."""
    executed = set()

    def tracer(frame, event, arg):
        fn = frame.f_code.co_filename
        for mod in ("spot_ratings.py", "sim_rating.py", "surf_point.py"):
            if fn.endswith(mod):
                executed.add(mod)
        return None

    sys.settrace(tracer)
    try:
        _glyph(SPOTS[0], SEAS[0])
        _sim(SPOTS[0], SEAS[0])
    finally:
        sys.settrace(None)

    for mod in ("spot_ratings.py", "sim_rating.py", "surf_point.py"):
        assert mod in executed, (
            f"{mod} was NEVER EXECUTED by this test — it has become the same tautology as "
            f"test_all_three_surfaces_agree_exactly_with_flags_off. See this file's header."
        )
