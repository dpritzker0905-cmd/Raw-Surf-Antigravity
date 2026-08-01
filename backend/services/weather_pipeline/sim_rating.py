"""sim_rating.py — the weather sim's COMPOSITION layer: geometry in, breaking height + quality out.

Extracted from `weather_sim_mcp.py` (789/800 lines, the loc ratchet blocked every further change).
Nothing about the physics changed in the move; the functions are byte-equivalent and
`weather_sim_mcp` re-exports every name the suite reads.

★ WHY IT LIVES HERE, next to `spot_ratings` and `spot_conditions`, and not in the MCP server file:
CLAUDE.md's ONE FORECAST COMPOSITION rule names `spot_ratings.rate_one_spot` as the reference
implementation that every surface must mirror. There are exactly three surfaces that compose a
rating — the map glyphs / precompute (`spot_ratings`), the spot hub (`spot_conditions`) and the sim
(this module). Keeping them siblings is what lets `tests/test_rating_composition_parity.py`
enumerate all three and fail when a new engine input reaches some of them and not others. That has
now happened twice:

    `902f47a9`  the hub served the OFFSHORE height as the surf height (wrong by up to 92.7%)
    `9b808d05`  the hub's 10 POSITIONAL args stopped one short of `break_depth_m`, so it opted out
                of per-spot capacity (Mavericks +62.3, Trestles -42.5 — signed BOTH ways)

⚠️ Pass every optional factor to the rating engine BY NAME. A positional call is precisely how a new
engine input silently fails to reach a surface.
"""
import logging
import math
import os
from typing import Any, Dict, Optional

from services.conditions_labels import get_conditions_label
from services.weather_pipeline import sim_explain
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
# The PRODUCTION rating engine is authoritative (CLAUDE.md). The sim delegates to it rather than
# carrying a second formula — a divergent copy is exactly how this file's ancestor came to rate a
# flat ocean "Epic".
# ⚠️ The knots constants are read as ATTRIBUTES off `SR`, never from-imported: a from-import
# snapshots the value at import time and re-opens exactly the divergence `surf_rating.KT_TO_MS`
# closes. The functions below are stateless and safe to bind.
from services.weather_pipeline import surf_rating as SR
from services.weather_pipeline.surf_rating import (
    offshoreness, oversize_gate, oversize_thresholds, rating_score, score_to_level,
)
from services.weather_pipeline.surf_transform import komar_breaker_height

logger = logging.getLogger("weather_sim_mcp")


def _sim_flag(name: str, default: str = "1") -> bool:
    return os.environ.get(name, default) != "0"


_GEOMETRY_CACHE: Dict[Any, Any] = {}

# (climatology object, {spot_id: reference_m}) -- see reference_size_for.
_REF_MAP_MEMO = (None, {})


def spot_geometry(spot: Dict[str, Any]):
    """Resolved production geometry for a spot, or None when unavailable/disabled.

    Cached per coordinate — the bathymetry lookups are pure and a what-if sweep hits one spot
    repeatedly."""
    if not _sim_flag("SIM_PRODUCTION_GEOMETRY"):
        return None
    lat, lng = spot.get("latitude"), spot.get("longitude")
    if lat is None or lng is None:
        return None
    key = (round(float(lat), 6), round(float(lng), 6))
    if key not in _GEOMETRY_CACHE:
        try:
            _GEOMETRY_CACHE[key] = resolve_surf_geometry(float(lat), float(lng))
        except Exception as e:
            logger.warning(f"geometry resolution failed for {spot.get('name')}: {e}")
            _GEOMETRY_CACHE[key] = None
    return _GEOMETRY_CACHE[key]


def shore_normal_for(spot: Dict[str, Any]) -> Optional[float]:
    """THE one seaward bearing for this spot — resolved bathymetry, else the catalog fallback.

    Every consumer in this module (wind class, swell alignment, the delegated rating, the height
    exposure factor) reads it from here. `2851a598` already fixed one two-reference-frame bug in
    this file (wind class keyed off `optimal_wind_dir` while the score keyed off `orientation`);
    `swell_alignment_pct` still had the same defect against `optimal_swell_dir` — it reported 100%
    alignment for a Mavericks swell the engine was scoring at 42% — so both are gone and there is
    one frame."""
    geo = spot_geometry(spot)
    if geo is not None and geo.shore_normal_deg is not None:
        return float(geo.shore_normal_deg)
    o = spot.get("orientation")
    return float(o) if o is not None else None


def reference_size_for(spot: Dict[str, Any], allow_lookup: bool = False) -> Optional[float]:
    """Local size reference, gated on the SAME flag production gates it on. Off (the default) means
    the global 1.2 m curve — exactly what the app served before `3263031c`.

    ⛔ THE DICT ALONE WAS NEVER ENOUGH, AND THAT IS WHY THE SIM DIVERGED. This read only
    `spot["reference_size_m"]`, and `sim_spots` carries that key for THREE hand-tuned mock spots
    (4.0 / 1.5 / 1.2). The ~1,773 real catalogue spots have none, so the moment RATING_LOCAL_SIZE
    flipped the sim went on grading against the global 1.2 m curve while the glyph graded against
    each spot's own good day. Measured by the parity monitor within minutes of the flip (run
    30683570880): sim HIGH by a median +22.2 points, 5 of 6 spots differing in LEVEL.
    ★★ The flag was never the missing thing — the DATA was. A flag and its data are two lanes.

    ⚠️⚠️ THE PERMISSION IS ITS OWN PARAMETER, AND REUSING `valid_time` FOR IT WAS A BUG I SHIPPED
    AND REVERTED WITHIN THE HOUR. The lookup dials on a cold cache, so it must be gated by the
    ZERO-NETWORK INVARIANT (`simulate_weather_change` with all five inputs and no hour does zero
    HTTP — the `576dcbdd` regression was 42.2 s of blocking, past where an MCP client reports a
    TIMEOUT). Keying that on `valid_time is not None` looked economical and broke two things:
      * `get_weather_forecast` HAS an hour and never passed it, so the sim's primary user-facing
        forecast tool would have stayed on the global curve while the parity probe — which does
        pass it — read GREEN. A false green on the one path a user actually reads.
      * making `sim_window` pass `valid_time` to obtain a reference ALSO switched on the
        observation gate, which caps at 69.9 and flattens the ranking it decides. That is exactly
        the "gating a RANK key inverts its meaning" defect `79e1001a` fixed for `sim_compare`, and
        it changed which hour won (`test_sim_daylight` caught it: 09:00 -> 06:00).
    ★★ `valid_time` is the observation gate's JOIN KEY. An I/O budget is a different concept, and
    one parameter serving two concepts couples them wherever only one is wanted.

    ★ ONE DERIVATION. This is `reference_map(load_size_climatology_l2_cached())` —
    the same two symbols `spot_ratings` composes for the glyph and `spot_conditions` for the hub —
    memoised against the loaded object. Re-deriving it here would be the THIRD copy of a number
    CLAUDE.md says to mirror, never re-derive. Gating stays with the caller by that helper's own
    contract; this function is the caller.
    """
    if os.environ.get("RATING_LOCAL_SIZE", "0") != "1":
        return None
    ref = spot.get("reference_size_m")
    if ref is not None:
        return ref                      # hand-tuned default, or already grafted upstream
    if not allow_lookup:
        return None                     # zero-network path — see the invariant note above
    sid = spot.get("id") or spot.get("spot_id")
    if sid is None:
        return None
    try:
        from services.weather_pipeline.spot_size_climatology import (
            load_size_climatology_l2_cached, reference_map)
    except ImportError:
        # NOT swallowed with the data misses below. A missing SYMBOL is a wiring/deploy fault,
        # not an absent reference, and conflating them is how this fix first shipped broken:
        # it imported `reference_for_spot`, a helper that existed only in a concurrent
        # session's UNCOMMITTED working tree. Every local test passed while the deployed lane
        # raised ImportError into a fail-open `except Exception` and graded the global curve
        # in silence. Diagnosed only because the probe printed WHICH question failed.
        raise
    clim = load_size_climatology_l2_cached()
    if not clim:
        return None                     # no blob -> global curve, the pre-flip behaviour
    # Memoised against the LOADED OBJECT, not a TTL: `reference_map` is a ~1,800-entry
    # percentile sweep and this runs once per spot per rated hour. ONE tuple assignment, so a
    # concurrent reader sees either the whole old pair or the whole new one, never a new
    # source paired with a stale map. Same composition `spot_ratings` performs for the glyph.
    global _REF_MAP_MEMO
    src, mapping = _REF_MAP_MEMO
    if src is not clim:
        mapping = reference_map(clim) or {}
        _REF_MAP_MEMO = (clim, mapping)
    return mapping.get(str(sid))


# 3. Core Physics and Weather Calculation Engine
def calculate_surf_rating(
    spot: Dict[str, Any],
    swell_h: float,
    swell_p: float,
    swell_dir: float,
    wind_spd: float,
    wind_dir: float,
    partitions=None,
    valid_time=None,
    allow_reference_lookup: bool = False,
) -> Dict[str, Any]:
    """Breaking wave height and 0-100 surf quality for a spot under a given weather vector.

    Delegates BOTH the physics and its composition to production (`surf_point.estimate_surf_at` ->
    `surf_transform.estimate_surf`, and `surf_rating.rating_score`), so the number this returns is
    the number the app would show at that coordinate.

    ``partitions`` (optional list of {h, tp, dir, kind}, already RECONCILED) makes both halves
    spectral, exactly as the served point lane is when SURF_PARTITIONS is on. The sim's scenario
    vocabulary is a single train, so partitions only arrive from the LIVE lane (the app's point
    response carries the trains its own height ran on) — and a caller who overrides any swell field
    must DROP them, because they describe the forecast sea, not the hypothetical one. None keeps
    the total-field path, byte-identical to before.
    """
    shore_normal = shore_normal_for(spot)
    geo = spot_geometry(spot)

    # 1. Nearshore breaking height — the FULL production chain, not just Komar.
    # Raw `komar_breaker_height(Hs, Tp)` skips cross-shelf bottom friction, the swell-angle
    # exposure factor, sub-grid magnets and the depth-limited breaking cap. Measured 2026-07-27
    # that omission over-read the served height by a median 19.1% (max +39.2%).
    regime = "estimate"
    breaking_height = None
    if geo is not None:
        try:
            breaking_height, regime = estimate_surf_at(
                float(spot["latitude"]), float(spot["longitude"]),
                swell_h, swell_p, swell_from_deg=swell_dir, geometry=geo,
                partitions=partitions)
        except Exception as e:
            logger.warning(f"estimate_surf_at failed for {spot.get('name')}: {e}")
            breaking_height = None
    if breaking_height is None:
        # No geometry (kill switch, missing coords, open-ocean/unknown regime) -> the previous
        # deep-water-only estimate. Never a crash, never a silent zero for a real swell.
        breaking_height = komar_breaker_height(swell_h, swell_p)
        if breaking_height is None:      # non-physical input (h<=0 or Tp<=0) -> flat
            breaking_height, regime = 0.0, "calm"
        elif geo is None:
            regime = "deep_water_estimate"
        # Invariant 6: the rating grades the SAME representation the height ran on. This height is
        # BLENDED Komar (the trains never touched it), so the trains are dropped for the rating
        # and the explanation too — otherwise one payload's height and quality would describe two
        # different seas (review 2026-07-30, the SIM_PRODUCTION_GEOMETRY=0 branch).
        partitions = None

    # 2. Wind CLASS — derived from the SAME reference frame the delegated score uses, so the label
    # persisted to condition_reports.wind_conditions cannot contradict the score. Thresholds are the
    # exact equivalents of the old angular ones (wind_diff < 45 deg <=> offshoreness > cos45).
    _off = offshoreness(wind_dir, shore_normal)
    if wind_spd < 3.0:
        wind_label = "Glassy"
    elif _off is None:
        wind_label = "Sideshore"          # unknown geometry -> the neutral class
    elif _off > 0.7071:
        wind_label = "Offshore"
    elif _off < -0.7071:
        wind_label = "Onshore"
    else:
        wind_label = "Sideshore"

    # 3. Swell alignment — reported against the SAME shore normal (see shore_normal_for).
    if shore_normal is None:
        swell_alignment = 1.0             # unknown geometry fails OPEN, as the height factor does
    else:
        swell_diff = abs((swell_dir - shore_normal + 180) % 360 - 180)
        swell_alignment = max(0.1, math.cos(math.radians(swell_diff)))

    breaking_height_ft = round(breaking_height * 3.28084, 1)  # metres to feet

    # 4. Final Wave Quality Rating (0 to 100) — DELEGATED to the production engine, whose
    # multiplicative size_gate is 0 below the rideability floor, so flat is 0 by construction.
    # `break_depth_m` is the oversize gate's spot-capacity signal: a big-wave spot must keep its
    # ceiling (Mavericks reads 22.1 m => it can hold ~57 ft) rather than inherit the generic one.
    #
    # ⚠️ KEYWORDS, NOT POSITION — every optional factor below is named. See this module's header:
    # a positional call is how `9b808d05` silently dropped `break_depth_m` at the spot hub.
    # `tests/test_rating_composition_parity.py` pins this call against the other two surfaces.
    _break_depth = geo.break_depth_m if geo is not None else None
    quality_score = rating_score(
        breaking_height,                      # nearshore BREAKING height, metres
        swell_p,
        wind_spd * SR.KT_TO_MS,               # engine wants m/s; sim inputs are knots
        wind_from_deg=wind_dir,
        shore_normal_deg=shore_normal,
        swell_from_deg=swell_dir,
        reference_size_m=reference_size_for(spot, allow_reference_lookup),
        partitions=partitions,
        break_depth_m=_break_depth,
    )
    quality_label = score_to_level(quality_score)

    # ── THE OBSERVATION GATE (#13, owner decision 2026-07-31) ─────────────────────────────────
    # The sim now answers "what will the app SHOW", not "what does the model say", so it caps the
    # same way the glyph surfaces do. The UNGATED score stays on the payload (`quality_raw`) and
    # `sim_observed.parity` still reports `matches_ungated_model_score`, so the diagnostic that
    # found this asymmetry in the first place keeps working.
    # ⚠️ Needs a `valid_time` to find the confirmation the precompute derived; without one there is
    # nothing to join on, so the sim stays ungated rather than capping on an invented miss — a
    # what-if with no hour is not a forecast the app would ever have shown.
    quality_raw, quality_confirmed = round(float(quality_score), 1) if quality_score is not None else None, None
    if valid_time is not None:
        from services.weather_pipeline.rating_confirmation import gate_single_model_surface
        _g, _l, quality_confirmed, quality_raw = gate_single_model_surface(
            quality_score, spot.get("latitude"), spot.get("longitude"), valid_time)
        if _g is not None:
            quality_score, quality_label = _g, _l

    # 4b. SIZE VERDICT — say out loud when the surf is past rideable, instead of leaving the caller
    # to infer it from a number that merely got smaller. Before the oversize veto shipped
    # (2026-07-29) the rating SATURATED: 4 / 12 / 25 / 35 ft all scored 97.3 "epic", so a closeout
    # and a groomed head-high day were indistinguishable in this payload. The veto fixes the score;
    # this field makes the REASON legible — a low score from 40 kt of onshore slop and a low score
    # from 35 ft of unrideable closeout are different answers to "should I paddle out?".
    _ref = reference_size_for(spot, allow_reference_lookup)
    _og = oversize_gate(breaking_height, _ref, break_depth_m=_break_depth)
    _over_start, _over_floor = oversize_thresholds(_ref, _break_depth)
    if _og >= 1.0:
        size_verdict = "within_range"
    elif _og <= 0.35:
        size_verdict = "too_big_to_ride"
    else:
        size_verdict = "at_the_upper_limit"

    # 5. `conditions_label` is the app's SIZE ladder, not a quality verdict. Every other writer
    # emits "Waist High"/"Chest High"/…, and SpotHubConditionsTab.js keys a colour map on those
    # exact strings — an off-vocabulary value silently renders grey. The verdict travels in its own
    # `quality_label` field instead of overloading this one.
    # 6. WHY that score. A product of nine factors has exactly one way to be low — some factor is
    # low — but this payload could only ever report the finished number, so "why is my offshore-wind
    # day only poor-to-fair?" needed a bespoke script against the engine internals to answer (it did,
    # on 2026-07-29). `sim_explain` reads the SAME factors back from `surf_rating`'s own functions
    # and CHECKS its reconstruction against `quality_score`, so it can never become a second opinion.
    explanation = sim_explain.explain(
        surf_h_m=breaking_height,
        tp_s=swell_p,
        wind_speed_knots=wind_spd,
        wind_from_deg=wind_dir,
        shore_normal_deg=shore_normal,
        swell_from_deg=swell_dir,
        reference_size_m=_ref,
        partitions=partitions,
        break_depth_m=_break_depth,
        engine_score=quality_score,
    )

    out = {
        "breaking_height_ft": breaking_height_ft,
        "surf_regime": regime,
        "quality_rating": quality_score,
        "quality_label": quality_label,
        # The ungated model score stays on the payload even when the gate capped the headline —
        # the cap changes the DISPLAYED verdict, never the physics, and sim_observed.parity
        # compares against this to report `matches_ungated_model_score`.
        "quality_raw": quality_raw,
        "quality_confirmed": quality_confirmed,
        "size_verdict": size_verdict,
        "rideable_ceiling_ft": round(_over_start * 3.28084, 1),
        "conditions_label": get_conditions_label(breaking_height_ft),
        "wind_class": wind_label,
        "swell_alignment_pct": round(swell_alignment * 100, 0),
        "shore_normal_deg": shore_normal,
        "shore_normal_source": geo.shore_normal_src if geo is not None else "catalog_fallback",
    }
    if explanation:
        out["why"] = explanation
        summary = sim_explain.summarize(explanation)
        if summary:
            out["why_summary"] = summary
    return out


def geometry_payload(spot: Dict[str, Any]) -> Dict[str, Any]:
    """The resolved bathymetry for a spot — what makes the estimate spot-specific.

    ★ Carries the READINESS VERDICT, not just the raw fields. Listing `shore_normal_source:
    "coarse"` next to a bearing quoted to a decimal place still leaves the caller to know that
    "coarse" means median 22.3° off and a rating LEVEL that differs on 45.8% of evaluations. The
    verdict says it outright, from the same grader every other surface now uses."""
    geo = spot_geometry(spot)
    if geo is None:
        return {"resolved": False, "shore_normal_deg": shore_normal_for(spot),
                "shore_normal_source": "catalog_fallback",
                "readiness": "blind", "readiness_note": (
                    "No bathymetry could be resolved, so every swell direction scores the same.")}
    _rd = {}
    try:
        from services.weather_pipeline.spot_geometry_readiness import assess_geometry, summarize
        _a = assess_geometry(geo)
        _rd = {"readiness": _a.get("verdict"), "readiness_missing": _a.get("missing") or None,
               "readiness_note": summarize(_a)}
    except Exception as e:                       # a diagnostic must never cost the payload
        logger.debug(f"readiness assessment failed for {spot.get('name')}: {e}")
    return {
        **_rd,
        "resolved": True,
        "shore_normal_deg": geo.shore_normal_deg,
        "shore_normal_source": geo.shore_normal_src,
        "shelf_depth_m": geo.depth_m,
        "shelf_width_km": round(geo.shelf_width_km, 2) if geo.shelf_width_km else geo.shelf_width_km,
        "break_depth_m": geo.break_depth_m,
        "coastal": geo.coastal,
        "nearshore": geo.nearshore,
        "magnet_factor": geo.magnet_factor,
    }
