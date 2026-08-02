"""ONE FORECAST COMPOSITION, enforced per FACTOR across every rating surface.

CLAUDE.md's binding rule: every surface that shows surf height or quality goes through the SAME
chain, with `spot_ratings.rate_one_spot` as the reference implementation. The failure mode is never
a wrong formula — it is a new optional engine input reaching SOME surfaces and not others:

    `902f47a9`  the hub served the OFFSHORE height as the surf height (wrong by up to +92.7%)
    `9b808d05`  the hub's 10 POSITIONAL args stopped one short of `break_depth_m`, so it opted out
                of per-spot capacity  (Mavericks +62.3, Trestles -42.5 — signed BOTH ways)

`test_spot_hub_rating_parity.py` guards that second one by substring-matching the hub's source. This
file generalises it: it AST-extracts the ACTUAL rating call at every surface, resolves positional
args against the live `rating_score` signature, and requires each surface to hold an explicit
position on EVERY optional factor — supplied, or waived with a reason and its measured cost.

★ Add a factor to `rating_score` and these tests FAIL until all three surfaces declare. That is the
whole point: the two incidents above were both "somebody added an input and one caller didn't get
the memo", and neither a code review nor a green suite caught them.

Measured 2026-07-30, hub vs glyph on identical inputs across 6 spots x 6 sizes x 5 periods x 3
winds, SWEPT over the gated factor's own range (tide 0.0-1.0; reference size 0.6-4.0 m):

    all flags OFF (production today)     |dScore| median  0.0   LEVEL differs   0.0%
    RATING_LOCAL_SIZE=1                  |dScore| median 10.6   LEVEL differs  59.1%
    RATING_TIDE=1                        |dScore| median  5.8   LEVEL differs  41.0%
    both on                              |dScore| median 15.4   LEVEL differs  70.1%

⚠️ THESE NUMBERS WERE CORRECTED. The first pass quoted ONE hand-picked point per flag and reported
it as the cost: tide_norm=0.05 against a "mid tide" preference is near the worst case `tide_fit` can
produce and gave 71.5%, against 41.0% swept across the whole tidal cycle. A factor with a bounded
range must be swept before a number is taken off it.
⚠️ The reference-size figure is SYNTHETIC by necessity: `load_size_climatology_l2_cached()` returns
None — no spot has a real size reference yet — so the 0.6-4.0 m range is a plausible span, not
observed data. It bounds the shape of the risk; it is not a measurement of it.

★ And `reference_size_m=1.2` is NOT a no-op even though 1.2 m is the documented default: `size_score`
switches to a different CURVE SHAPE whenever a reference is supplied ("the two branches are
intentionally different shapes" — its own docstring, absolute/legacy vs local-relative). So
RATING_LOCAL_SIZE does not merely calibrate per spot; it re-shapes the size gate for every spot
that has climatology, which makes a surface sitting the flag out diverge more, not less.

⇒ The surfaces agreed EXACTLY while every gated factor was off, and were ONE FLAG FLIP from
disagreeing on 4-6 of every 10 spot-hours. The waivers below are the inventory of that debt, with
the number attached.

★ THE FLIP HAPPENED. `3263031c` (2026-08-01) set RATING_LOCAL_SIZE=1 in all three lanes, which
turned the `reference_size_m` row of that inventory from a priced risk into a live divergence — the
glyphs began grading against each spot's own good day while the hub kept the global 1.2 m curve.
That row is now SUPPLIED at the hub (the blocker was the `spot_id` interface, not a decision; see
its entry). The remaining waivers are still gated OFF, so the "all flags OFF" agreement test below
keeps its meaning: it pins the compositions equal on the paths where nothing is gated on.
"""
import ast
import inspect

import pytest

from services.weather_pipeline import sim_rating, spot_conditions, spot_ratings
from services.weather_pipeline.shore_normal_asset import break_depth_at
from services.weather_pipeline.surf_rating import compute_surf_rating, rating_score

# The three REQUIRED physical inputs; everything after them is an optional composition factor.
_REQUIRED = ("surf_h_m", "tp_s", "wind_speed_ms")

SUPPLIED = "supplied"


class SeeAlso(str):
    """A waiver that defers to the substantive waiver for the named factor, stated once elsewhere in
    the registry (`partitions` is blocked identically at all three surfaces; saying so three times
    invites the three copies to drift). Resolution REQUIRES a real waiver to exist, so deferring
    cannot be used to smuggle in a gap that nobody ever justified."""
    __slots__ = ()


def _resolve(position):
    """A waiver's substantive text: itself, or the one it defers to. Raises when the chain is
    broken, so a `SeeAlso` pointing at nothing fails the suite rather than passing silently."""
    if not isinstance(position, SeeAlso):
        return position
    for entry in SURFACES.values():
        candidate = entry["factors"].get(str(position))
        if candidate is not None and candidate is not SUPPLIED and not isinstance(candidate, SeeAlso):
            return candidate
    raise AssertionError(
        f"SeeAlso({str(position)!r}) defers to a waiver that does not exist anywhere in the "
        f"registry. Every gap must be justified somewhere.")

# ── THE REGISTRY ────────────────────────────────────────────────────────────────────────────────
# Per surface, per optional factor: SUPPLIED, or a waiver string saying WHY and what it costs.
# A waiver is a debt entry, not an excuse — it must name the blocker, not merely restate the gap.
SURFACES = {
    "spot_ratings (REFERENCE — map glyphs + precompute)": {
        "module": spot_ratings,
        "factors": {
            "wind_from_deg": SUPPLIED,
            "shore_normal_deg": SUPPLIED,
            "swell_from_deg": SUPPLIED,
            "tide_norm": SUPPLIED,          # gated RATING_TIDE
            "best_tide": SUPPLIED,
            "breaker_xi": SUPPLIED,         # gated RATING_BREAKER_TYPE
            "reference_size_m": SUPPLIED,   # gated RATING_LOCAL_SIZE
            "break_depth_m": SUPPLIED,
            # Gated SURF_PARTITIONS (default OFF — 4x the point resolutions; the serve box has a
            # three-incident melt history, so the flip needs the precompute cost measured first).
            # The PLUMBING is unconditional: the response carries the reconciled trains its own
            # `surf_height_m` ran on, and the rating grades that SAME list — one sea state per
            # spot-hour, by construction. Flag off -> partitions None -> byte-identical to before.
            "partitions": SUPPLIED,
        },
    },
    "spot_conditions (the spot HUB)": {
        "module": spot_conditions,
        "factors": {
            "wind_from_deg": SUPPLIED,
            "shore_normal_deg": SUPPLIED,
            "swell_from_deg": SUPPLIED,
            "break_depth_m": SUPPLIED,      # `9b808d05`
            # CLOSED 2026-08-01. The waiver here read "BLOCKED ON AN INTERFACE, not on a decision":
            # `resolve_spot_conditions(model, lat, lng, forecast_days)` never received a spot id and
            # `spot_size_climatology.reference_map` is keyed by one, so the hub could not look a
            # reference up. That interface now carries an optional `spot_id` through all 7 call
            # sites, and the hub resolves the reference with the SAME gate (RATING_LOCAL_SIZE) and
            # the SAME loader the reference implementation uses — `reference_for_spot` is literally
            # `reference_map(load_size_climatology_l2_cached())`, memoised, so there is no third
            # derivation of the number to drift.
            # ⚠️ IT WAS NOT LATENT ANY MORE WHEN IT WAS FIXED. `3263031c` flipped RATING_LOCAL_SIZE
            # to 1 in all three lanes, which is exactly the flip this waiver priced at "level differs
            # on 59.1% of evaluations, median 10.6 points" (re-measured 2026-07-30 across 540
            # spot/size/period/wind combinations: median 10.5, p95 56.2, max 75.2, level differs
            # 60.6%). A caller with no id still passes None → the global curve → pre-flip behaviour.
            "reference_size_m": SUPPLIED,   # gated RATING_LOCAL_SIZE
            "tide_norm": (
                "The hub does not load the spot row, so it has no `best_tide` prior, and "
                "`tide_fit` is neutral without one. Measured 2026-07-30 in production: 38 of 1,773 "
                "spots carry a best_tide at all and only 18 (1.0%) parse to a usable LEVEL band "
                "('all tides'/'incoming' yield no band). COST IF RATING_TIDE FLIPS, swept across the "
                "whole tidal cycle: 41.0% level divergence at spots that DO have a band."),
            "best_tide": SeeAlso("tide_norm"),
            "breaker_xi": (
                "Inert everywhere today: `bathymetry.bed_slope_at` returns None until the finer "
                "slope asset is bundled, so `breaker_type_quality` is a neutral 1.0 at every "
                "surface including the reference. Wire it WITH the asset, not before."),
            # The hub's marine lane samples cached grids, not `resolve_point`, so it cannot read
            # the response's trains — `_spectral_partitions` samples the SAME three layers from the
            # same local cache and reconciles them, gated on the SAME flag. A partition miss never
            # triggers the upstream fallback.
            "partitions": SUPPLIED,
        },
    },
    "sim_rating (the weather SIM)": {
        "module": sim_rating,
        "factors": {
            "wind_from_deg": SUPPLIED,
            "shore_normal_deg": SUPPLIED,
            "swell_from_deg": SUPPLIED,
            "reference_size_m": SUPPLIED,   # same RATING_LOCAL_SIZE gate as the reference
            "break_depth_m": SUPPLIED,
            "tide_norm": (
                "The sim's lane is SYNCHRONOUS (urllib, no async client) and `tide.tide_norm_at` "
                "is async HTTP. Adding a third network call to a tool handler is the regression "
                "`576dcbdd` fixed — measured 42.2 s blocking, past where an MCP client reports a "
                "TIMEOUT instead of an answer. Weighed against 18 of 1,773 spots (1.0%) having a "
                "usable tide band, the cost is not worth the coverage."),
            "best_tide": SeeAlso("tide_norm"),
            "breaker_xi": SeeAlso("breaker_xi"),
            # The sim's scenario vocabulary is a single train, so partitions arrive only from the
            # LIVE lane (the point response carries the trains the server's height ran on) and are
            # DROPPED the moment a what-if changes any swell field (`_baseline_partitions`) — the
            # forecast's trains do not describe a hypothetical sea. No fetches, no sim-side flag.
            "partitions": SUPPLIED,
        },
    },
}


def _optional_factors():
    """Every optional composition factor on the LIVE engine signature."""
    return [p for p in inspect.signature(rating_score).parameters if p not in _REQUIRED]


def _rating_call(module):
    """The rating call a surface actually makes: the set of parameter NAMES it supplies.

    Positional args are resolved against the live signature, so a call that passes ten positional
    arguments counts as supplying the first ten parameters — and automatically stops counting one
    of them the day somebody inserts a parameter earlier in the signature."""
    sig = list(inspect.signature(rating_score).parameters)
    found = []
    for node in ast.walk(ast.parse(inspect.getsource(module))):
        if not isinstance(node, ast.Call):
            continue
        fn = node.func
        name = fn.attr if isinstance(fn, ast.Attribute) else getattr(fn, "id", None)
        if name in ("compute_surf_rating", "rating_score"):
            found.append(set(sig[:len(node.args)]) | {k.arg for k in node.keywords if k.arg})
    assert found, f"{module.__name__} makes no rating call — did it stop being a rating surface?"
    # A surface may legitimately have more than one call site; require every one to agree, else
    # the surface grades the same spot two ways depending on which branch ran.
    assert all(f == found[0] for f in found), \
        f"{module.__name__} has rating calls that supply DIFFERENT factors: {found}"
    return found[0]


@pytest.mark.parametrize("label", sorted(SURFACES))
def test_every_optional_factor_has_a_declared_position(label):
    """The registry must cover the live signature exactly — no factor unaccounted for, and no
    stale entry for a factor that no longer exists."""
    declared = set(SURFACES[label]["factors"])
    actual = set(_optional_factors())
    missing = actual - declared
    assert not missing, (
        f"{label} has no declared position on {sorted(missing)}.\n"
        f"A new optional factor reached `rating_score`. Every rating surface must either SUPPLY it "
        f"or waive it with a reason — that is exactly what `9b808d05` failed to do.")
    stale = declared - actual
    assert not stale, f"{label} declares {sorted(stale)}, which is no longer on the signature."


@pytest.mark.parametrize("label", sorted(SURFACES))
def test_the_registry_matches_what_the_code_actually_passes(label):
    """The declarations must be TRUE. A registry that drifts from the call is worse than none."""
    entry = SURFACES[label]
    passed = _rating_call(entry["module"])
    for factor, position in entry["factors"].items():
        if position is SUPPLIED:
            assert factor in passed, (
                f"{label} DECLARES it supplies `{factor}` but its rating call does not pass it. "
                f"Either the call regressed or the registry is lying.")
        else:
            assert factor not in passed, (
                f"{label} now passes `{factor}` — good. Delete its waiver and mark it SUPPLIED "
                f"so the registry stays true:\n    {position}")
            reason = _resolve(position)
            assert len(reason) > 60, f"{label}: the waiver for `{factor}` must say WHY, and cost."


def test_the_reference_surface_supplies_the_most():
    """`rate_one_spot` is the reference implementation; no other surface may supply a factor it
    doesn't, or the thing being mirrored is behind the thing mirroring it."""
    ref = _rating_call(spot_ratings)
    for label, entry in SURFACES.items():
        if entry["module"] is spot_ratings:
            continue
        extra = _rating_call(entry["module"]) - ref
        assert not extra, (
            f"{label} supplies {sorted(extra)}, which the REFERENCE implementation does not. "
            f"Add it to `spot_ratings.rate_one_spot` first — CLAUDE.md: mirror it, never "
            f"re-derive it.")


# ── BEHAVIOUR, not just call shape ──────────────────────────────────────────────────────────────

_SPOTS = [("Mavericks", 37.4915, -122.5083, 225.1),
          ("Lower Trestles", 33.3819, -117.5885, 219.0),
          ("Pipeline", 21.6637, -158.0515, 308.1),
          ("Cocoa Beach Pier", 28.3676, -80.6012, 99.1)]
_HS = (0.4, 0.8, 1.5, 2.5, 4.0, 6.0)
_TPS = (6.0, 9.0, 12.0, 16.0, 20.0)


@pytest.mark.parametrize("name,lat,lng,normal", _SPOTS)
def test_all_three_surfaces_agree_exactly_with_flags_off(name, lat, lng, normal):
    """PRODUCTION TODAY: every gated factor is off, so the three compositions must be identical.
    This is the assertion that would have gone red for `9b808d05`."""
    bd = break_depth_at(lat, lng)
    assert bd is not None, f"{name} lost its break depth — fixture is stale"
    for h in _HS:
        for tp in _TPS:
            glyph = compute_surf_rating(h, tp, 4.0, normal, normal, normal,
                                        None, None, None, None, break_depth_m=bd)
            hub = compute_surf_rating(h, tp, 4.0, wind_from_deg=normal, shore_normal_deg=normal,
                                      swell_from_deg=normal, break_depth_m=bd)
            sim = rating_score(h, tp, 4.0, wind_from_deg=normal, shore_normal_deg=normal,
                               swell_from_deg=normal, reference_size_m=None, break_depth_m=bd)
            assert glyph == hub, f"{name} {h}m/{tp}s: glyph {glyph} != hub {hub}"
            assert glyph[0] == sim, f"{name} {h}m/{tp}s: glyph {glyph[0]} != sim {sim}"


def test_the_waived_gaps_are_real_and_not_theoretical():
    """Pins the MEASURED cost in this file's header, so nobody deletes a waiver as hypothetical.
    Flipping a gated factor on for the reference and not the hub MUST change the level."""
    bd = break_depth_at(33.3819, -117.5885)
    changed_by_size = changed_by_tide = 0
    total = 0
    for h in _HS:
        for tp in _TPS:
            hub = compute_surf_rating(h, tp, 4.0, wind_from_deg=219.0, shore_normal_deg=219.0,
                                      swell_from_deg=219.0, break_depth_m=bd)
            with_size = compute_surf_rating(h, tp, 4.0, 219.0, 219.0, 219.0,
                                            None, None, None, 1.1, break_depth_m=bd)
            with_tide = compute_surf_rating(h, tp, 4.0, 219.0, 219.0, 219.0,
                                            0.05, "mid tide", None, None, break_depth_m=bd)
            total += 1
            changed_by_size += with_size[1] != hub[1]
            changed_by_tide += with_tide[1] != hub[1]
    assert changed_by_size / total > 0.3, (
        "RATING_LOCAL_SIZE no longer moves the level — re-measure the waiver's cost before "
        "trusting the number in this file's header.")
    assert changed_by_tide / total > 0.3, (
        "RATING_TIDE no longer moves the level — re-measure the waiver's cost.")


# ═══════════════════════════════════════════════════════════════════════════════════════════════
# POST-`rating_score` STEPS — the shape this file could not see (#14)
# ═══════════════════════════════════════════════════════════════════════════════════════════════
#
# Everything above inspects the rating CALL and its ARGUMENTS. That is structurally blind to a step
# applied AFTER the call returns: such a step has no argument to declare, so no amount of argument
# checking can notice a surface skipping it. ★ A guard that inspects one shape cannot report a
# defect of another shape.
#
# It cost a real divergence. The OBSERVATION GATE ran at the three glyph surfaces and NOT at the
# spot hub or the weather sim, so the same spot graded differently depending on where you looked —
# measured live: Moss Landing served 83.9 'good' on the map while the ungated lanes said 95.9
# 'epic', with the heights agreeing to 0.59%. Every test in this file passed throughout.
#
# Owner decision 2026-07-31 (#13): the hub and the sim answer "what will the app SHOW", so they gate
# too. This registry is what keeps the next post-step from repeating the asymmetry.

POST_STEPS = {
    # step name -> the symbol a surface must reference to be applying it
    "observation_gate": ("observation_gate", "gate_single_model_surface", "_build_observation_gate"),
}

# Surfaces that must apply every post-step, and where the step lives for each.
POST_STEP_SURFACES = {
    "precompute -> glyph payload": ("services.weather_pipeline.rating_confirmation", None),
    "map rating band":             ("services.weather_pipeline.grid_resolver_surf", None),
    "spot hub":                    ("services.weather_pipeline.spot_conditions", None),
    "weather sim":                 ("services.weather_pipeline.sim_rating", None),
}


def _references(module_path, symbols):
    """True when the module's SOURCE references any of `symbols` — an AST/name scan, not an import
    check, because the gate is reached through a function-local import at several surfaces."""
    import importlib
    mod = importlib.import_module(module_path)
    src = inspect.getsource(mod)
    tree = ast.parse(src)
    names = set()
    for node in ast.walk(tree):
        if isinstance(node, ast.Name):
            names.add(node.id)
        elif isinstance(node, ast.Attribute):
            names.add(node.attr)
        elif isinstance(node, ast.alias):
            names.add(node.asname or node.name.split(".")[-1])
    return bool(names & set(symbols))


@pytest.mark.parametrize("surface", sorted(POST_STEP_SURFACES))
@pytest.mark.parametrize("step", sorted(POST_STEPS))
def test_every_surface_applies_every_post_rating_step(surface, step):
    """THE #14 GUARD. A step applied after `rating_score` returns has no argument to declare, so the
    argument-based tests above cannot see it. This one checks the surface references the step at
    all."""
    module_path, _ = POST_STEP_SURFACES[surface]
    assert _references(module_path, POST_STEPS[step]), (
        f"{surface} ({module_path}) does not reference the post-rating step {step!r}. Every rating "
        f"surface must apply every post-`rating_score` step, or the same spot grades differently "
        f"depending on which surface a user happens to look at — which is exactly how the hub and "
        f"the sim came to disagree with the map (#13). Expected one of: {POST_STEPS[step]}")


def test_the_post_step_registry_is_not_silently_empty():
    """A registry that drifts to empty would make the guard above vacuously green."""
    assert POST_STEPS and POST_STEP_SURFACES
    assert len(POST_STEP_SURFACES) >= 4, "all five rating surfaces must be listed"


def test_the_single_model_gate_helper_exists_and_returns_the_raw_score_too():
    """The cap changes the DISPLAYED verdict, never the physics — a surface that gates must still be
    able to publish the ungated score, or the divergence becomes unauditable."""
    from services.weather_pipeline.rating_confirmation import gate_single_model_surface
    params = list(inspect.signature(gate_single_model_surface).parameters)
    assert params[:4] == ["score", "lat", "lng", "valid_time"]
    gated, level, confirm, raw = gate_single_model_surface(None, 0.0, 0.0, None)
    assert (gated, level, confirm, raw) == (None, None, None, None)


@pytest.mark.parametrize("innocent", [
    "services.weather_pipeline.surf_rating",      # the engine itself never gates
    "services.weather_pipeline.surf_transform",   # pure physics, no display verdict
])
def test_the_post_step_guard_can_actually_fail(innocent):
    """NEGATIVE CONTROL. A guard proves nothing until you have watched it fail. `_references` must
    return False for a module that genuinely does not apply the step — otherwise the parametrized
    test above is vacuously green and would keep passing if every surface dropped the gate."""
    assert not _references(innocent, POST_STEPS["observation_gate"]), (
        f"{innocent} appears to reference the observation gate, so the post-step guard cannot "
        f"distinguish a gating surface from a non-gating one. Pick a different control module.")
