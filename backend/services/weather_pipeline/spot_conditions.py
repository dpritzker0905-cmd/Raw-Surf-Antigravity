"""spot_conditions.py — the forecast the SPOT HUB and the infoboxes show.

⚠️⚠️ THIS FILE USED TO BE A SECOND, CRUDER FORECAST COMPOSITION.
It sampled the marine grid directly (`sampler.sample_point`) and reported `point.speed` — the
**OFFSHORE significant wave height** — as the spot's surf height, then labelled it with the size
ladder. Every other surface (the map's spot ratings, `/api/weather/point`, the weather sim) runs
that same offshore number through `surf_point` to get the NEARSHORE BREAKING height first.

Measured 2026-07-28 against the live app, offshore vs breaking at the same coordinate and hour:

    Trestles           2.4 ft offshore  ->   4.6 ft breaking   +92.7%
    Teahupo'o          5.0                   7.4               +47.6%
    Cocoa Beach Pier   1.8                   2.6               +41.7%
    Supertubos         4.1                   5.0               +23.3%
    Mavericks          5.7                   6.0                +5.8%
    Pipeline           5.8                   5.1               -11.9%
    Jeffreys Bay      10.3                   8.3               -18.7%

★ The error is SIGNED BOTH WAYS (shoaling amplifies, a wide shelf damps), so no constant could
have corrected it — the geometry has to be in the chain. Trestles reading "2.4 ft" when it is
actually chest-high is the difference between going and not going.

This is the same defect `cf2efb48` fixed in the weather sim: delegating the FUNCTIONS but not the
COMPOSITION. The composition lives in ONE place — `surf_point` — and this now calls it, exactly as
`spot_ratings.rate_one_spot` does.

The hub also had no QUALITY at all: it showed a size and nothing about whether the wind was
destroying it. It now carries the same 0-100 rating the map glyphs use.

PERFORMANCE: geometry is resolved ONCE and reused for all 11 frames, so the correction adds no
network I/O. The daily loop still samples the cached grid — the fix is what the numbers MEAN, not
how many of them are fetched.
"""
import logging
import os
from datetime import datetime, timezone, timedelta
from typing import Dict, Any

# THE canonical size ladder — a 5th byte-identical copy of it lived inline here as
# `get_local_label` and was missed by the 2026-07-26 de-triplication, so it would have silently
# contradicted the corrected 10/15 ft thresholds.
from services.conditions_labels import get_conditions_label

logger = logging.getLogger(__name__)

M_TO_FT = 3.28084
# ⚠️ NOT a local `KT_TO_MS = 0.514444` — see `surf_rating.KT_TO_MS`. The truncated inverse made this
# surface disagree with the sim at exactly 3.00 kt of wind (good 83.0 against epic 92.0). Read the
# engine's constant as an ATTRIBUTE so the knots -> m/s -> knots round trip is exact.
from services.weather_pipeline import surf_rating as SR


def _breaking_ft(lat, lng, offshore_m, period_s, swell_from_deg, geometry, partitions=None):
    """Offshore Hs -> BREAKING height in feet, through the production chain.

    Fails OPEN to the offshore value: a hub that shows a slightly wrong number is worth more than a
    hub that shows nothing, and this is an enrichment of an already-working read. ``partitions``
    (reconciled trains, or None) makes the estimate spectral exactly as `estimate_surf_at` does for
    the point lane — None keeps the total-field transform, byte-identical to before."""
    if not offshore_m:
        return 0.0, "calm"
    try:
        from services.weather_pipeline.surf_point import estimate_surf_at
        breaking_m, regime = estimate_surf_at(
            lat, lng, offshore_m, period_s or 0.0,
            swell_from_deg=swell_from_deg, geometry=geometry, partitions=partitions)
        if breaking_m is not None:
            return round(breaking_m * M_TO_FT, 1), regime
    except Exception as e:
        logger.debug(f"[spot-conditions] surf transform failed at ({lat},{lng}): {e}")
    return round(offshore_m * M_TO_FT, 1), "offshore_estimate"


def hourly_breaking_forecast(lat, lng, hourly, geometry, limit: int = 6):
    """The hourly forecast rows for `/api/conditions/{spot_id}`, through the SAME composition the
    `current` frame uses. Lives HERE, beside `_breaking_ft`, so the route mirrors the one chain
    instead of re-deriving a second one (CLAUDE.md: no second forecast path per screen).

    ⛔ THE DEFECT THIS REPLACES: the route did `height * 3.28084`, serving the OFFSHORE significant
    height under `wave_height_ft` — the same field name `current` uses for the BREAKING height, in
    the same payload. Measured live: Sebastian Inlet 2.90 ft vs 1.10 ft (0.38x, "Knee High" vs
    "Ankle High"), Mavericks 4.80 vs 5.20 (1.08x, "Chest High" vs "Head High"). Signed BOTH ways,
    so no constant could reconcile them — only the geometry.

    ⚠️ `geometry` is a PARAMETER, resolved ONCE by the caller and reused across every hour: the
    correction is arithmetic, not I/O. Re-resolving per hour is the regression this signature
    exists to prevent.
    ⛔ A MISSING height yields `wave_height_ft=None` + `status="no_data"`, never 0. The old
    `if height else 0` made "not sampled" and "flat" identical — and then LABELLED it. A genuine
    0.0 still reports flat (regime "calm"), which is the control that keeps this from over-refusing.
    """
    h = hourly or {}
    times = h.get("time") or []
    heights = h.get("wave_height") or []
    periods = h.get("wave_period") or []
    directions = h.get("wave_direction") or []
    rows = []
    for i, t in enumerate(times[:limit]):
        offshore_m = heights[i] if i < len(heights) else None
        if offshore_m is None:
            rows.append({"time": t, "wave_height_ft": None, "offshore_height_ft": None,
                         "surf_regime": None, "label": None, "status": "no_data"})
            continue
        ft, regime = _breaking_ft(
            lat, lng, offshore_m,
            periods[i] if i < len(periods) else None,
            directions[i] if i < len(directions) else None,
            geometry)
        rows.append({"time": t, "wave_height_ft": ft,
                     # ★ the number this endpoint used to serve as `wave_height_ft`, kept under its
                     #   TRUE name so nothing is lost and the two can never be confused again.
                     "offshore_height_ft": round(offshore_m * M_TO_FT, 1),
                     "surf_regime": regime, "label": get_conditions_label(ft), "status": None})
    return rows


# The same partition layers `point_resolution._resolve_partitions` splits, with the `kind`
# `surf_rating`'s partition-aware factors expect.
_PARTITION_LAYERS = (("swell_1", "swell"), ("swell_2", "swell"), ("wind_waves", "windsea"))


async def _spectral_partitions(self, model, lat, lng, dt, total_h, total_tp=None):
    """The swell/windsea trains at this frame, RECONCILED to the total Hs — or None.

    The hub's marine lane samples LOCALLY CACHED grids rather than `resolve_point`, so it cannot
    read partitions off the point response the way `rate_one_spot` does; this samples the same
    three layers from the same local cache. Gated on the SAME flag as the point lane
    (SURF_PARTITIONS, default OFF — enable everywhere or nowhere: a flag set in one lane and not
    another makes the same spot two different heights depending on which lane answered).

    ⚠️ FAILS OPEN AND NEVER DIALS — STRUCTURALLY. The whole body sits under one umbrella except
    so this helper CANNOT raise (its two call sites are deliberately bare; before this umbrella a
    surf_transform import regression would have cost the caller the ENTIRE conditions read, where
    pre-partitions the same breakage only degraded the height). A partition-layer cache miss
    returns fewer trains or None — it must NOT set the caller's `cache_misses` flag, because that
    flag triggers the upstream point fallback and a partition is an enrichment, never worth an
    upstream fetch."""
    if os.environ.get("SURF_PARTITIONS", "0") != "1":
        return None
    try:
        if not total_h or total_h != total_h or total_h <= 0:
            return None
        parts = []
        for layer, kind in _PARTITION_LAYERS:
            try:
                prod = await self.find_cached_grid_product(model, "marine", layer, lat, lng, dt)
                if not prod:
                    continue
                # ⛔ AUTHENTICITY (same guard as the point lane): a ratio-derived product is the
                # TOTAL field re-weighted under an invented bearing — never a real train.
                _basis = getattr(prod, "estimate_basis", None)
                if isinstance(_basis, dict) and _basis.get("method") == "wave_component_ratio_estimation":
                    continue
                res = self.sampler.sample_point(prod, lat, lng)
                p = getattr(res, "point", None)
                # h=0 AND Tp=0 together are a mask signature, not a calm sea — and ⚠️ NaN passes
                # BOTH `not x` and `x <= 0`, so the self-inequality checks are what actually
                # reject it (a NaN train poisons the rating into score=NaN -> level 'epic').
                # Same guard as the point lane. A NaN direction is nulled, not fatal.
                if (p is None or not p.speed or not p.period
                        or p.speed != p.speed or p.period != p.period
                        or p.speed <= 0 or p.period <= 0):
                    continue
                _dir = p.direction
                if _dir is not None and _dir != _dir:
                    _dir = None
                parts.append({"h": float(p.speed), "tp": float(p.period),
                              "dir": _dir, "kind": kind})
            except Exception as e:
                logger.debug(f"[spot-conditions] partition {layer} at ({lat},{lng}) skipped: {e}")
        if not parts:
            return None
        from services.weather_pipeline.surf_transform import (
            partitions_represent, reconcile_partitions)
        # The REPRESENT gate (shared with the point lane): trains carrying under half the total Hs
        # in quadrature mean the dominant train is missing from the local cache — reconciling the
        # survivors would inflate a minority train to carry ALL the energy at its own period, a sea
        # state neither the blend nor the spectrum describes. Total field instead.
        # total_tp closes the PERIOD half (PARTITION_MAX_TP_RATIO): the height test alone cannot
        # see a MISSING LONG TRAIN, which is the one that dominates energy flux.
        if not partitions_represent(parts, total_h, total_tp):
            return None
        return reconcile_partitions(parts, total_h)
    except Exception as e:
        logger.debug(f"[spot-conditions] partitions unavailable at ({lat},{lng}): {e}")
        return None

def safe_index_get(dict_obj: dict, key: str, index: int, default_val: Any = 0.0) -> Any:
    """Safely retrieves the index element of list from dict_obj, returning default_val if missing or out of bounds."""
    if dict_obj and isinstance(dict_obj.get(key), list) and index < len(dict_obj[key]):
        val = dict_obj[key][index]
        return val if val is not None else default_val
    return default_val

async def resolve_spot_conditions_impl(
    self,
    model: str,
    lat: float,
    lng: float,
    forecast_days: int = 11,
    spot_id: Any = None
) -> Dict[str, Any]:
    """
    Unifies conditions retrieval for a spot, checking local dynamic/manifest
    caches first, and falling back to a single upstream point query on miss.

    ``spot_id`` is OPTIONAL and affects only the rating's LOCAL SIZE REFERENCE (see below). It is a
    coordinate-keyed function otherwise; every caller that has an id should pass it, and a caller
    that genuinely has none gets exactly the previous behaviour.
    """
    # Round current conditions target time to nearest 3 hours
    now_dt = datetime.now(timezone.utc)
    current_hour = round(now_dt.hour / 3.0) * 3
    if current_hour == 24:
        current_dt = (now_dt + timedelta(days=1)).replace(hour=0, minute=0, second=0, microsecond=0)
    else:
        current_dt = now_dt.replace(hour=current_hour, minute=0, second=0, microsecond=0)
        
    # 10 daily forecast days
    forecast_dates = []
    tomorrow_date = now_dt.date() + timedelta(days=1)
    for i in range(10):
        d = tomorrow_date + timedelta(days=i)
        forecast_dates.append(datetime(d.year, d.month, d.day, 12, 0, 0, tzinfo=timezone.utc))
        
    all_dates = [current_dt] + forecast_dates
    
    waves_data = {}
    swell_data = {}
    cache_misses = False
    
    # Try local cache resolution for waves and swell
    for dt in all_dates:
        # Waves
        waves_prod = await self.find_cached_grid_product(model, "marine", "waves", lat, lng, dt)
        if waves_prod:
            res = self.sampler.sample_point(waves_prod, lat, lng)
            waves_data[dt] = {
                "wave_height": res.point.speed,
                "wave_direction": res.point.direction,
                "wave_period": res.point.period
            }
        else:
            cache_misses = True
            
        # Swell
        swell_prod = await self.find_cached_grid_product(model, "marine", "swell_1", lat, lng, dt)
        if swell_prod:
            res = self.sampler.sample_point(swell_prod, lat, lng)
            swell_data[dt] = {
                "swell_height": res.point.speed,
                "swell_direction": res.point.direction
            }
        else:
            cache_misses = True

    # Fallback to direct point query if any target date was a cache miss
    if cache_misses:
        logger.info(f"[Spot conditions] Cache miss for {model} at ({lat}, {lng}). Fetching direct point forecast...")
        try:
            raw_point = await self.provider.fetch_point(
                model=model, domain="marine", layer="all_marine", lat=lat, lng=lng, forecast_days=forecast_days
            )
            if raw_point and "hourly" in raw_point and "time" in raw_point["hourly"]:
                times = raw_point["hourly"]["time"]
                from services.weather_pipeline.normalizer import WeatherNormalizer
                
                for dt in all_dates:
                    idx = WeatherNormalizer.find_closest_time_index(times, dt)
                    if idx is not None:
                        # Parse waves fallback
                        if dt not in waves_data:
                            wave_height = safe_index_get(raw_point["hourly"], "wave_height", idx, 0.0)
                            wave_dir = safe_index_get(raw_point["hourly"], "wave_direction", idx, 0.0)
                            wave_per = safe_index_get(raw_point["hourly"], "wave_period", idx, 0.0)
                            waves_data[dt] = {
                                "wave_height": wave_height,
                                "wave_direction": wave_dir,
                                "wave_period": wave_per
                            }
                        # Parse swell fallback
                        if dt not in swell_data:
                            swell_height = safe_index_get(raw_point["hourly"], "swell_wave_height", idx, 0.0)
                            swell_dir = safe_index_get(raw_point["hourly"], "swell_wave_direction", idx, 0.0)
                            swell_data[dt] = {
                                "swell_height": swell_height,
                                "swell_direction": swell_dir
                            }
        except Exception as e:
            logger.error(f"[Spot conditions] Upstream point fallback failed for {model} at ({lat}, {lng}): {e}")

    # ── THE GEOMETRY, resolved ONCE ───────────────────────────────────────────────────────────
    # Shore normal, shelf depth/width, break depth and sub-grid magnets are properties of the
    # COORDINATE, not of the hour, so 11 frames share one lookup. This is what makes the correction
    # free: the offshore->breaking transform below costs arithmetic, not I/O.
    geometry = None
    if os.environ.get("SPOT_HUB_SURF_TRANSFORM", "1") != "0":
        try:
            from services.weather_pipeline.surf_point import resolve_surf_geometry
            geometry = resolve_surf_geometry(lat, lng)
        except Exception as e:
            logger.warning(f"[spot-conditions] geometry unavailable at ({lat},{lng}): {e}")

    # ── THE LOCAL SIZE REFERENCE, resolved ONCE (same reason as the geometry) ─────────────────
    # `size_score` grades this hour's height against the SPOT'S OWN good day rather than a global
    # 1.2 m curve. Like the geometry it is a property of the SPOT, not of the hour.
    #
    # ⚠️ THIS WAS THE LAST FACTOR THE HUB SAT OUT, and it was the same defect class as `9b808d05`:
    # the reference implementation passed it and the hub did not, so the two surfaces were one flag
    # flip from grading the same spot differently. Measured 2026-07-30, hub vs glyph on identical
    # inputs over 540 spot/size/period/wind combinations:
    #     RATING_LOCAL_SIZE=0 (production before the flip)  |dScore| median  0.0   LEVEL differs  0.0%
    #     RATING_LOCAL_SIZE=1                               |dScore| median 10.5   LEVEL differs 60.6%
    # Latent, not live — until `3263031c` flipped the flag in all three lanes, at which point the
    # hub would have kept the GLOBAL curve while every glyph moved to the local one. ★ And a
    # reference is not a mere calibration: `size_score` switches to a different CURVE SHAPE the
    # moment one is supplied, so a surface sitting the flip out diverges MORE, not less.
    #
    # ⛔ NOT re-derived: `reference_for_spot` IS `reference_map(load_size_climatology_l2_cached())`,
    # the same two symbols `spot_ratings` composes, with the map cached against the loaded blob so a
    # per-spot lane doesn't rebuild ~1,800 percentiles per call. One composition, three lanes.
    # ★ The GATE lives here, at the caller, exactly as it does in `spot_ratings` and `routes/weather`
    # — a flag has a value PER LANE, and burying it in the shared helper would flip all of them at
    # once. Fails open to None (= the global curve = the pre-flip behaviour), and its own try because
    # the rating block below is a broad `except`: a blob-read failure must cost the LOCAL curve, not
    # the whole rating.
    reference_size_m = None
    if spot_id is not None and os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
        try:
            from services.weather_pipeline.spot_size_climatology import reference_for_spot
            reference_size_m = reference_for_spot(spot_id)
        except Exception as e:
            logger.debug(f"[spot-conditions] size reference unavailable for {spot_id}: {e}")

    # Construct current conditions response dict
    current_waves = waves_data.get(current_dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
    current_swell = swell_data.get(current_dt, {"swell_height": 0.0, "swell_direction": 0.0})

    offshore_m = current_waves["wave_height"] or 0.0
    period_s = current_waves["wave_period"] or 0.0
    swell_from = current_waves["wave_direction"]
    # ONE sea state for this frame: the same reconciled trains feed the height transform AND the
    # rating below, so the two cannot disagree about what is in the water (None when the flag is
    # off — production today — or nothing usable is cached).
    current_parts = await _spectral_partitions(self, model, lat, lng, current_dt, offshore_m,
                                               period_s)
    current_wave_height_ft, regime = _breaking_ft(
        lat, lng, offshore_m, period_s, swell_from, geometry, partitions=current_parts)
    current_swell_height_ft = round(current_swell["swell_height"] * M_TO_FT, 1) if current_swell["swell_height"] else 0

    current_conditions = {
        # ⚠️ THIS IS THE BREAKING HEIGHT NOW, not the offshore Hs it used to be. The offshore value
        # is still reported alongside so the two can never be silently conflated again.
        "wave_height_ft": current_wave_height_ft,
        "offshore_height_ft": round(offshore_m * M_TO_FT, 1) if offshore_m else 0,
        "surf_regime": regime,
        "wave_direction": current_waves["wave_direction"],
        "wave_period": current_waves["wave_period"],
        "swell_height_ft": current_swell_height_ft,
        "swell_direction": current_swell["swell_direction"],
        "label": get_conditions_label(current_wave_height_ft),
        "updated_at": datetime.now(timezone.utc).isoformat()
    }

    # ── QUALITY, from the SAME engine the map glyphs use ──────────────────────────────────────
    # The hub showed a size and nothing about whether the wind was destroying it, so a blown-out
    # 6 ft and a groomed 6 ft were indistinguishable. One wind sample buys the whole rating.
    try:
        from services.weather_pipeline.surf_rating import compute_surf_rating
        wind = await self.resolve_point(model=model, domain="wind", layer="wind",
                                        lat=lat, lng=lng, valid_time_str=current_dt.strftime("%Y-%m-%dT%H:00:00Z"))
        wind_pt = getattr(wind, "point", None)
        wind_ms = (getattr(wind_pt, "speed", None) or 0.0) * SR.KT_TO_MS if wind_pt else None
        wind_from = getattr(wind_pt, "direction", None) if wind_pt else None
        # ⚠️ KEYWORDS, NOT POSITION. This call passed TEN positional arguments, which silently
        # stopped at `reference_size_m` and left `break_depth_m` None — while `geometry.break_depth_m`
        # was resolved twenty lines above and sitting in scope. The hub therefore opted out of the
        # oversize gate's per-spot capacity tier that the map glyphs use, and the two surfaces graded
        # the same spot differently. Measured 2026-07-29 at Tp 18 s, light wind, head-on:
        #     Mavericks   45.9 ft   hub 27.3 "poor"      vs glyph 89.6 "epic"       (+62.3)
        #     Trestles    32.8 ft   hub 69.8 "fair_good" vs glyph 27.3 "poor"       (-42.5)
        #     Pipeline    32.8 ft   hub 69.8 "fair_good" vs glyph 51.4 "fair"       (-18.4)
        # Signed BOTH ways — the hub was simultaneously crushing big-wave spots and calling
        # closeouts good. Identical below the oversize regime, so ordinary days are unchanged.
        # A positional call is how a new engine input silently fails to reach a surface; every
        # optional factor is passed by NAME here so the next one cannot repeat it.
        score, level = compute_surf_rating(
            current_wave_height_ft / M_TO_FT, period_s, wind_ms,
            wind_from_deg=wind_from,
            shore_normal_deg=getattr(geometry, "shore_normal_deg", None),
            swell_from_deg=swell_from,
            reference_size_m=reference_size_m,
            partitions=current_parts,
            break_depth_m=getattr(geometry, "break_depth_m", None))
        # ── THE OBSERVATION GATE (#13, owner decision 2026-07-31) ─────────────────────────────
        # The hub is a surface a surfer READS, so it must show what the app shows. Until now the
        # gate ran at the three glyph surfaces and NOT here, so the same spot graded differently
        # depending on which surface you looked at — measured live: Moss Landing served 83.9 'good'
        # on the map while the ungated lanes said 95.9 'epic'.
        # ⚠️ A POST-`rating_score` STEP — invisible to test_rating_composition_parity's AST guard,
        # which inspects the rating CALL's arguments (#14). Its POST-step registry watches this.
        from services.weather_pipeline.rating_confirmation import gate_single_model_surface
        _gated, _glevel, _confirm, _raw = gate_single_model_surface(
            score, lat, lng, current_dt)
        if _gated is not None:
            score, level = _gated, _glevel
        # Raw stays auditable: the cap changes the DISPLAYED verdict, never the physics.
        current_conditions["rating_raw"] = _raw
        current_conditions["rating_confirmed"] = _confirm
        current_conditions["rating"] = score
        current_conditions["rating_level"] = level
        if wind_pt is not None:
            current_conditions["wind_speed_kts"] = round(getattr(wind_pt, "speed", 0.0) or 0.0, 1)
            current_conditions["wind_direction"] = wind_from
    except Exception as e:
        # A rating is an ENRICHMENT — never let it cost the conditions read.
        logger.debug(f"[spot-conditions] rating unavailable at ({lat},{lng}): {e}")

    # Construct forecast response list
    forecast_list = []
    for dt in forecast_dates:
        date_str = dt.strftime("%Y-%m-%d")
        day_waves = waves_data.get(dt, {"wave_height": 0.0, "wave_direction": 0.0, "wave_period": 0.0})
        day_swell = swell_data.get(dt, {"swell_height": 0.0})

        day_offshore = day_waves["wave_height"] or 0.0
        # Spectral per frame for the same reason as the current frame: one payload must not mix a
        # spectral "now" with total-field days. Local cache sampling only; None when the flag is off.
        day_parts = await _spectral_partitions(self, model, lat, lng, dt, day_offshore,
                                               day_waves["wave_period"] or None)
        max_ft, day_regime = _breaking_ft(
            lat, lng, day_offshore, day_waves["wave_period"], day_waves["wave_direction"], geometry,
            partitions=day_parts)
        # ⚠️ `wave_height_min` is a PRESENTATION band around a single modelled value, not a second
        # forecast — it was `max * 0.6` with no comment, which reads like measured spread. Named as
        # what it is, and kept so the existing UI range still renders.
        min_ft = round(max_ft * 0.6, 1)
        swell_max_ft = round(day_swell["swell_height"] * M_TO_FT, 1) if day_swell["swell_height"] else 0

        forecast_list.append({
            "date": date_str,
            "wave_height_min": min_ft,
            "wave_height_max": max_ft,
            "offshore_height_ft": round(day_offshore * M_TO_FT, 1) if day_offshore else 0,
            "surf_regime": day_regime,
            "wave_direction": day_waves["wave_direction"],
            "wave_period": day_waves["wave_period"],
            "swell_height_ft": swell_max_ft,
            "label": get_conditions_label(max_ft)
        })

    return {
        "current_conditions": current_conditions,
        "forecast": forecast_list
    }
