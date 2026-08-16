"""spot_ratings.py — THE reference implementation of "rate a surf spot" (CLAUDE.md's ONE FORECAST
COMPOSITION mandate names this file). Used by BOTH the live `/api/weather/spot-ratings` endpoint and
the cron precompute, so they can never diverge — the parity rule.

★ SPLIT 2026-08-14 (Program 13.0 Mission 2): the precompute + Supabase-L2 persistence lane moved to
`spot_ratings_precompute.py`, which IMPORTS `rate_one_spot` from here. The dependency runs one way
and must keep running one way — ⛔ this file must never import that one. The seam was chosen by an
AST census (two cross-half edges) and so that the ten test files which read THIS path as a source
string keep grading THIS file. Rationale: `docs/research/FINDING-2026-08-14-splitting-the-rating-reference-implementation.md`.

⚠️ This file was at 800/800 LOC when the split was made. It is the mandated reference; keep it
readable and keep the headroom — move rationale to docs rather than deleting it.
"""
import json
import logging
import math
import os
from datetime import datetime, timezone
from typing import Optional

from services.weather_pipeline.schemas import NormalizedPointResponse
from services.weather_pipeline.surf_rating import compute_surf_rating

logger = logging.getLogger(__name__)

# ⚠️ NOT a local `KT_TO_MS = 0.514444`. That is 1/1.943844 truncated, and it made this surface and
# the sim reach different verdicts at exactly 3.00 kt of wind (`surf_rating.KT_TO_MS`). Read the
# engine's own constant as an ATTRIBUTE so the round trip stays exact.
from services.weather_pipeline import surf_rating as SR
# CDN lane (2026-07-14, queue #2, USER-APPROVED scoped-RLS design): this one object is anonymously
# READABLE via a storage RLS policy pinned to exactly this key (migration
# anon_read_spot_ratings_latest_only; bucket stays private, every sibling stays service-role-only).
# The frontend fetches it straight off the Supabase CDN (spotRatingsCdn.js) — zero serve-box
# involvement on the precomputed path. RENAMING THIS KEY silently breaks that policy + the frontend.
SPOT_RATINGS_L2_KEY = "spot_ratings/latest.json"
SPOT_RATINGS_SCHEMA_VERSION = 1


def spot_confidence(accuracy_flag, is_verified_peak) -> str:
    """Rating confidence from the spot's location-accuracy metadata (bathymetry factors are only as good as
    the pin). verified/verified-peak -> high; low_accuracy/crowdsourced -> low; else medium."""
    flag = (accuracy_flag or "").lower()
    if is_verified_peak or flag == "verified":
        return "high"
    if flag in ("low_accuracy", "crowdsourced"):
        return "low"
    return "medium"


def rating_why(level, surf_h_m, period_s, wind_ms, wind_from, shore_normal) -> Optional[str]:
    """Compact explainability string. None when there's nothing to rate."""
    if level == "unknown" or surf_h_m is None:
        return None
    parts = [f"~{surf_h_m * 3.281:.1f} ft surf"]
    if period_s:
        parts.append(f"{period_s:.0f}s period")
    if wind_ms is not None:
        kt = wind_ms * SR.MS_TO_KT
        if wind_from is not None and shore_normal is not None:
            off = -math.cos(math.radians(wind_from - shore_normal))  # +1 offshore .. -1 onshore
            wd = "offshore" if off > 0.34 else ("onshore" if off < -0.34 else "cross-shore")
            parts.append(f"{kt:.0f}kt {wd} wind")
        else:
            parts.append(f"{kt:.0f}kt wind")
    return ", ".join(parts)


def _persist_inputs(spot_id: str, surf_height_m=None) -> bool:
    """Does THIS spot carry its rating inputs? (see the `inputs` block below, and the FINDING doc)

    ⚠️ md5, NOT hash(): PYTHONHASHSEED randomises str hashing per process and >1 worker writes this
    blob, so hash() would give them different samples. Deterministic ⇒ stable across cycles too.

    ⭐ Big surf is sampled UNCONDITIONALLY on top of the uniform draw: the estate reaches 3.66 m
    while a 5% uniform sample topped out at 1.93 m, so the tail — the only regime the depth cap
    binds in — was never observable. ⚠️ The sample is therefore non-representative ON PURPOSE:
    "N% of rows moved" is no longer a population rate, and a replay wanting one must stratify.
    Measurements, cost (~+0.6% blob) and the disclosure this owes readers:
    docs/research/FINDING-2026-08-12-the-uniform-sample-is-blind-to-the-tail.md"""
    pct = int(os.environ.get("SPOT_RATINGS_INPUTS_SAMPLE_PCT", "5") or 0)
    if pct >= 100:
        return True
    if pct <= 0:
        return False  # a full opt-out must still ship nothing, or the kill switch stops killing
    try:
        tail_m = float(os.environ.get("SPOT_RATINGS_INPUTS_TAIL_M", "2.5"))
    except (TypeError, ValueError):
        tail_m = 2.5
    if tail_m > 0 and isinstance(surf_height_m, (int, float)) and surf_height_m >= tail_m:
        return True
    import hashlib
    return (int(hashlib.md5(spot_id.encode("utf-8")).hexdigest()[:8], 16) % 100) < pct


async def rate_one_spot(resolver, spot, model, valid_time, reference_size_m=None) -> dict:
    """Resolve a single spot's marine + wind point and compute its rating. `spot` is a dict with
    id/name/latitude/longitude/accuracy_flag/is_verified_peak (from the DB or Supabase REST). `resolver`
    exposes `async resolve_point(model, domain, layer, lat, lng, valid_time_str)` (the live point sampler).
    `reference_size_m` is the spot's LOCAL good-day breaking height (from spot_size_climatology) — None keeps
    the global 1.2 m default, so the rating is unchanged until a spot has enough climatology.
    Returns the rating dict — the SAME shape the endpoint serves and the precompute persists."""
    lat, lng = spot["latitude"], spot["longitude"]
    surf_h = period = swell_from = shore_normal = wind_ms = wind_from = None
    offshore_h = spread_m = None
    geometry_readiness = None
    partitions = None
    run_time = wind_run_time = None
    try:
        marine = await resolver.resolve_point(
            model=model, domain="marine", layer="waves", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(marine, NormalizedPointResponse) and marine.point is not None:
            # ★ WHICH MODEL RUN THIS SCORE IS FROM. `valid_time` says which HOUR it describes and
            # nothing about which FORECAST OF that hour — and the two are routinely far apart,
            # because the point resolver serves REGIONAL products on independent ingest cadences.
            # Measured live 2026-07-31 at one valid_time: Pipeline's marine run was 14:08Z while
            # Sebastian Inlet's was 21:40Z THE PREVIOUS DAY — 17 h older, from
            # `gfs_marine_waves_florida_east_coast` vs `gfs_marine_waves_hawaii`.
            # Without this field a sim↔glyph disagreement could only be attributed by forcing a
            # live re-compute (7.5-8.6 s on the 1-CPU box): 3 of the 4 LEVEL differences the health
            # probe found on 2026-07-31 were exactly this, and proving it cost a live sweep.
            run_time = _iso_z(marine.run_time)
            surf_h = marine.surf_height_m
            period = marine.point.period
            swell_from = marine.point.direction
            shore_normal = marine.shore_normal_deg
            geometry_readiness = marine.geometry_readiness
            # The reconciled trains `surf_height_m` was computed from (None unless SURF_PARTITIONS
            # is on). Read off the response, NEVER re-resolved here — one sea state for the height
            # and the rating, or the two can disagree about the same hour.
            partitions = getattr(marine, "partitions", None)
            # ENSEMBLE SPREAD on the OFFSHORE Hs (marine `point.speed` IS the offshore significant
            # height — the repo's loudest landmine). Paired with that same offshore height below,
            # never with the breaking height, or the ratio inflates by whatever the transform did.
            offshore_h = getattr(marine.point, "speed", None)
            spread_m = getattr(marine.point, "speed_spread", None)
    except Exception as e:
        logger.debug(f"[spot-ratings] marine resolve failed for {spot.get('id')}: {e}")
    try:
        wind = await resolver.resolve_point(
            model=model, domain="wind", layer="wind", lat=lat, lng=lng, valid_time_str=valid_time)
        if isinstance(wind, NormalizedPointResponse) and wind.point is not None:
            # ⚠️ ITS OWN RUN, always. Marine and wind are ingested by different jobs and shared a
            # run at 0 of 4 spots measured 2026-07-31 (Mavericks 07:27 vs 08:10, Bells Beach 04:07
            # vs 14:44). One `run_time` would describe only half the inputs to the score.
            wind_run_time = _iso_z(wind.run_time)
            wind_ms = (wind.point.speed or 0.0) * SR.KT_TO_MS    # wind point speed is knots
            wind_from = wind.point.direction
    except Exception as e:
        logger.debug(f"[spot-ratings] wind resolve failed for {spot.get('id')}: {e}")
    # Tide (global, lat/lng): the tide level + the spot's best_tide prior → tide_fit factor. Gated RATING_TIDE
    # (default off) so it's opt-in; a tide miss leaves tide_norm None → neutral, never breaks the rating.
    tide_norm = None
    tide_state = None
    best_tide = spot.get("best_tide")
    if os.environ.get("RATING_TIDE", "0") == "1":
        try:
            from services.weather_pipeline.tide import tide_norm_at
            tide_state = await tide_norm_at(lat, lng, valid_time)
            if tide_state:
                tide_norm = tide_state.get("norm")
        except Exception as e:
            logger.debug(f"[spot-ratings] tide resolve failed for {spot.get('id')}: {e}")
    # Breaker TYPE (Iribarren): bed slope + swell steepness → plunging/spilling/surging quality. Gated
    # RATING_BREAKER_TYPE (default "0"). ⚠️ 2026-08-09 dropped a FALSE "slope asset unbundled" clause — it ships since `fa86fb53`; only the flag + CONTESTED science gate it. Waiver: parity test.
    breaker_xi = None
    if os.environ.get("RATING_BREAKER_TYPE", "0") == "1":
        try:
            from services.weather_pipeline.bathymetry import bed_slope_at
            from services.weather_pipeline.surf_transform import iribarren
            breaker_xi = iribarren(bed_slope_at(lat, lng), surf_h, period)
        except Exception as e:
            logger.debug(f"[spot-ratings] breaker-type resolve failed for {spot.get('id')}: {e}")
    # Nearshore BREAK depth (not the shelf depth) — the oversize gate's tier-2 capacity signal, so a
    # big-wave spot keeps its ceiling even before it has enough size climatology. Cached asset lookup,
    # no I/O beyond the already-loaded ETOPO shore-normal asset; None simply falls through to the
    # conservative absolute pair. Never let it break the rating.
    break_depth = None
    try:
        from services.weather_pipeline.shore_normal_asset import break_depth_at
        break_depth = break_depth_at(lat, lng)
    except Exception as e:
        logger.debug(f"[spot-ratings] break-depth resolve failed for {spot.get('id')}: {e}")
    # ⚠️ KEYWORDS, NOT POSITION — this is the REFERENCE implementation, and it was the last surface
    # still calling positionally (invariant 2: ten positional args are exactly how `9b808d05`
    # silently stopped one short of `break_depth_m` at the hub).
    score, level = compute_surf_rating(
        surf_h, period, wind_ms,
        wind_from_deg=wind_from,
        shore_normal_deg=shore_normal,
        swell_from_deg=swell_from,
        tide_norm=tide_norm,
        best_tide=best_tide,
        breaker_xi=breaker_xi,
        reference_size_m=reference_size_m,
        partitions=partitions,
        break_depth_m=break_depth)
    # ★ WHICH FACTOR COST THE MOST (2026-08-03). The score is a product of NINE terms in [0,1] and
    # the payload published only the score and a `why` naming height/period/wind — three INPUTS, not
    # factors. Measured that day on the served catalogue (n=199 reconstructed): holding every UNSEEN
    # factor at its BEST gives a strict UPPER BOUND, and the bound exceeded the served score by a
    # MEDIAN OF 31.4 POINTS (max 85.2). 44 spots had an upper bound >= 70 yet served < 70 — they
    # would read 'good' but something invisible removed it. Playa Manzanillo: 1.34 m @ 13 s, 4 kt
    # OFFSHORE, upper bound 94.7, served 21.1. Nobody could say why, including the owner.
    # `limiter` is argmin(factors) — in a product the smallest term removed the most — so the
    # payload now names its own binding constraint. Deliberately two fields, not nine: the full
    # decomposition would cost ~33% on an object every client downloads (cf. the run_time interning
    # note below), and the question is always "what held it back", not "list everything".
    # Recomputed rather than threaded out of compute_surf_rating above so the REFERENCE call stays
    # byte-identical to the mandated chain; it is pure arithmetic on already-resolved inputs (no
    # I/O), and test_rating_factors.py pins that the two agree.
    _lim = _lim_f = None
    if os.environ.get("RATING_LIMITER", "1") != "0":
        try:
            from services.weather_pipeline.surf_rating import rating_factors
            _f = rating_factors(
                surf_h, period, wind_ms,
                wind_from_deg=wind_from,
                shore_normal_deg=shore_normal,
                swell_from_deg=swell_from,
                tide_norm=tide_norm,
                best_tide=best_tide,
                breaker_xi=breaker_xi,
                reference_size_m=reference_size_m,
                partitions=partitions,
                break_depth_m=break_depth)
            _lim, _lim_f = _f["limiter"], _f["limiter_value"]
        except Exception as e:  # an explanation must never break the rating it explains
            logger.debug(f"[spot-ratings] limiter failed for {spot.get('id')}: {e}")
    # The why-text must quote what the rating GRADED: with partitions the engine grades the
    # dominant swell train's period, not the blended mean (a 16 s groundswell under 8 s windsea
    # reads ~11 s blended). `period_s` in the payload stays the sea's blended period.
    why_period = period
    if partitions:
        from services.weather_pipeline.surf_rating import dominant_swell_period
        why_period = dominant_swell_period(partitions) or period
    _fc = None
    try:
        from services.weather_pipeline.forecast_spread import describe as _spread_describe
        _fc = _spread_describe(spread_m, offshore_h)
    except Exception as e:   # a confidence must never break the rating it qualifies
        logger.debug(f"[spot-ratings] forecast spread unavailable for {spot.get('id')}: {e}")
    why = rating_why(level, surf_h, why_period, wind_ms, wind_from, shore_normal)
    if why and tide_state and best_tide:
        why += f", {tide_state.get('trend', '')} tide".rstrip()
    # ★ WHAT THE FORECAST WAS ALLOWED TO KNOW (WS-CAN-0062 / WS-OBJ-207). A VERIFIED pin on BLIND
    # geometry rendered `high conf` beside a `why` BYTE-IDENTICAL to a fully-surveyed spot's — live,
    # n=87: EIGHT `why` strings shared across full AND degraded. ⛔ THE FIX IS NOT TO MAKE
    # `confidence` READ THIS: the two are deliberately orthogonal (see `geometry_readiness` below)
    # and redefining a served field's meaning is the one-quantity-two-meanings class that has
    # WS-CAN-0005 blocked. ABSENT unless it binds — `full` and UNGRADED (None) add nothing, an
    # unassessed spot is not full. Kill: RATING_GEOMETRY_CAVEAT=0 (restores the old string byte-wise).
    # docs/research/FINDING-2026-08-14-the-rating-said-high-conf-on-geometry-it-could-not-resolve.md
    if why and os.environ.get("RATING_GEOMETRY_CAVEAT", "1") != "0":
        try:
            from services.weather_pipeline.spot_geometry_readiness import caveat as _geom_caveat
            _gc = _geom_caveat(geometry_readiness)
            why = f"{why}, {_gc}" if _gc else why
        except Exception as e:  # a caveat must never break the rating it qualifies
            logger.debug(f"[spot-ratings] geometry caveat failed for {spot.get('id')}: {e}")
    # ⛔⛔ THE SIZE AND THE QUALITY DISAGREE ABOUT THE SAME SWELL (MASTER-AUDIT-2.0 §2) — the SAME
    # bearing reduced twice, floors 0.100 (quality) vs 0.595 (height) = 3.54x in energy. ⚠️ DISCLOSES,
    # DOES NOT CORRECT: the height is the likelier overestimate but is right BY CANCELLATION, so the
    # reconciliation is gated on the ERA5 record. ABSENT unless it binds (>= 1.5x, Δθ >= 75.73°).
    # Kill: RATING_DIRECTIONAL_CONFLICT=0. ⭐ FULL DERIVATION + the live 2026-08-04 n=1005 measurement
    # live on `schemas.py`'s `directional_conflict` — a verbatim 2nd copy, EXTRACTED not deleted.
    _conflict = None
    if os.environ.get("RATING_DIRECTIONAL_CONFLICT", "1") != "0":
        try:
            from services.weather_pipeline import wave_physics
            _conflict = wave_physics.directional_conflict(swell_from, shore_normal)
        except Exception as e:  # a caveat must never break the rating it qualifies
            logger.debug(f"[spot-ratings] directional conflict failed for {spot.get('id')}: {e}")
    return {
        "spot_id": str(spot["id"]),
        "name": spot.get("name"),
        "latitude": lat,
        "longitude": lng,
        "score": score,
        "level": level,
        "confidence": spot_confidence(spot.get("accuracy_flag"), spot.get("is_verified_peak")),
        "surf_height_m": round(surf_h, 3) if surf_h is not None else None,
        "period_s": round(period, 1) if period is not None else None,
        # ★ THE TWO BATCH FIELDS (WS-CAN-0064): /conditions/batch now serves from these frames,
        # and its frozen per-spot shape needs the swell bearing and the OFFSHORE height beside
        # the breaking one. MEASURED COST, stated honestly: ~8-10% on a realistic 200-spot frame
        # (test_the_blob_tax_of_the_two_fields_is_measured_and_bounded — the first draft of this
        # comment claimed 2-3% and was WRONG). Accepted deliberately: these are forecast-bearing
        # PRODUCT fields, not instrument telemetry (the +42.8% inputs block the tax rule was
        # written against), and they convert the system's worst route into frame reads.
        "swell_from_deg": round(swell_from, 1) if swell_from is not None else None,
        "offshore_hs_m": round(offshore_h, 3) if offshore_h is not None else None,
        "tide": tide_state,
        "why": why,
        # The binding constraint: which of the nine factors removed the most. See the block above.
        "limiter": _lim,
        "limiter_f": _lim_f,
        # The size/quality contradiction, or ABSENT when there is nothing to say. See block above.
        "directional_conflict": _conflict,
        # ★ GEOMETRY READINESS, carried from the point response (`point_resolution` stamps it where
        # `surf_height_m` is produced). NOT the same thing as `confidence` above: that grades the
        # PIN (accuracy_flag / is_verified_peak), this grades the INPUTS the forecast ran on. A
        # correctly-placed, verified pin can still be scored on a coarse 0.25° bearing that is
        # median 22.3° off — and until now nothing distinguished the two.
        "geometry_readiness": geometry_readiness,
        # ★ A THIRD, ORTHOGONAL CONFIDENCE — and deliberately not a term in `score`.
        # `confidence` grades the PIN, `geometry_readiness` grades the INPUTS, this grades the
        # FORECAST: how much the ensemble members disagree about the sea. ABSENT (not null) on
        # DETERMINISTIC products -- GFS and ICON, measured 0/200 each. PRESENT on EURO: 69/200
        # spots carried it 2026-08-13, basis `ecmwf_waef_member_spread`, `calibrated: false`.
        # ⛔ It does NOT move the rating. Uncertainty is not quality — a high-spread 6 ft is the same
        # wave as a low-spread 6 ft, forecast less confidently, and folding it into the 0-100 would
        # make a groomed swell score lower merely for being five days out. Same verdict the repo
        # reached on RATING_LOCAL_SIZE: a separate axis, not a multiplier.
        **({"forecast_confidence": _fc} if _fc else {}),
        # WHICH FORECAST, not just which hour. Interned per frame before upload — see
        # `intern_frame_runs`; a raw ISO pair on every spot costs +23% on an object every client
        # downloads. The live path keeps them inline (nothing to intern, one request).
        "run_time": run_time,
        "wind_run_time": wind_run_time,
        # WHICH REFERENCE (2026-08-09, parity run 31311733401): the size reference is a MOVING
        # input — each precompute folds new heights in, so a frame rated at build time can carry a
        # different reference than the blob holds an hour later (Pedras Negras 1.279 vs 2.199 = an
        # 18.2-point fake "composition" red on identical runs). `run_time` records the sea's
        # generation; this records the rating config's. Absent (not null) = the global curve graded.
        **({"reference_size_m": round(float(reference_size_m), 4)}
           if reference_size_m is not None else {}),
        # ★ THE RATING'S OWN INPUTS, recorded at use time (the R11-04 provenance rule) — these
        # make a spot-hour REPLAYABLE offline by scripts/science_shadow_ab.py.
        # ⚠️⚠️ SAMPLED (5% default, `SPOT_RATINGS_INPUTS_SAMPLE_PCT`; 0 disables, 100 = all): at
        # 100% it is +42.8% on a blob EVERY CLIENT DOWNLOADS. AN INSTRUMENT MAY NOT TAX THE
        # PRODUCT IT MEASURES — rate table, why md5, and the water-level addition:
        # docs/research/FINDING-2026-08-09-an-instrument-must-not-tax-the-product.md
        **({"inputs": {k: v for k, v in {
            "offshore_hs_m": round(offshore_h, 3) if offshore_h is not None else None,
            "swell_from_deg": round(swell_from, 1) if swell_from is not None else None,
            "wind_ms": round(wind_ms, 3) if wind_ms is not None else None,
            "wind_from_deg": round(wind_from, 1) if wind_from is not None else None,
            "shore_normal_deg": shore_normal,
            "break_depth_m": break_depth,
            # ★ WATER LEVEL: resolved under RATING_TIDE for tide_fit; persisting it is what
            # makes SURF_TIDE_DEPTH measurable offline (0.00 -> 38.10 pts). Replay-only.
            "water_level_m": (round(float(tide_state["height_m"]), 3)
                              if isinstance(tide_state, dict)
                              and tide_state.get("height_m") is not None else None),
        }.items() if v is not None}} if _persist_inputs(str(spot["id"]), surf_h) else {}),
    }


def _iso_z(dt) -> Optional[str]:
    """A datetime as the same `...Z` string the point API serves, or None. Never raises."""
    if dt is None:
        return None
    if isinstance(dt, str):
        return dt
    try:
        if dt.tzinfo is None:
            dt = dt.replace(tzinfo=timezone.utc)
        return dt.astimezone(timezone.utc).isoformat().replace("+00:00", "Z")
    except Exception:
        return None
