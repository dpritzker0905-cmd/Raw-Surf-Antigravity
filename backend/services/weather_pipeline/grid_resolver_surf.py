"""
grid_resolver_surf.py

The Option-2 surf/rating overlay tail of grid_resolver.resolve_grid + its wind sampler,
extracted VERBATIM (2026-07-11 split — grid_resolver sat at 786/800 LOC). Pure extraction:
behavior is identical; resolve_grid calls apply_surf_overlay(product, ...) as its last step.
"""
import asyncio
import os
import logging

from services.weather_pipeline.schemas import NormalizedProduct

logger = logging.getLogger(__name__)


async def apply_surf_overlay(product, *, store, manifest, model, domain, layer, surf, target_dt):
    """── Option-2 Swell<->Surf toggle: when surf mode is requested, render a COASTAL SURF BAND. Each coastal
    cell's offshore wave HEIGHT is replaced with its bathymetry breaker estimate (per-cell shelf depth +
    Komar shoaling / friction / depth-limited breaking; can be bigger at steep reefs, smaller on shallow
    shelves), u/v scaled to keep direction; every OPEN-OCEAN cell is transparency-masked (is_valid=False)
    because surf is a coastline property, not an open-ocean field. Additive + gated; serve-only safe
    (bundled bathymetry + cheap cached math). Marine height-layers only. Kill switch SURF_TRANSFORM=0."""
    if not (
        surf
        and domain.lower() == "marine"
        and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        and isinstance(product, NormalizedProduct)
        and product.grid and product.grid.vectors
        and os.environ.get("SURF_TRANSFORM", "1") != "0"
    ):
        return product

    # CACHE SAFETY (critical): the surf/rating transform mutates grid vectors IN PLACE (speed→score/10,
    # u/v→0) and stamps diagnostics. `product` here is the SHARED CACHED dynamic product, so mutating it
    # corrupts the cache for the OTHER surf state — a surf=1 request would rewrite the cached grid to ratings,
    # then a surf=0 (Swell) request gets that rating grid (and vice-versa). Live-proven: fresh bbox surf=0 →
    # wave_height, but after a surf=1 hit the same bbox surf=0 returned surf_rating. Deep-copy first so the
    # cached base grid stays pristine and surf=0/surf=1 never cross-contaminate. (Only on surf requests.)
    import copy as _copy
    product = _copy.deepcopy(product)
    try:
        from services.weather_pipeline.bathymetry import shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at
        # Keep the AMBIENT field honest at global/coarse zoom (rating plan §1): a ~10° coarse frame can't
        # resolve a trustworthy shore-normal / exposure, surf is a coastline property, and a blocky
        # world-zoom rating band isn't the experience — the per-spot rating GLYPHS (P1) are the accuracy
        # path. So on a global-extent grid we DON'T transform; the frontend Option-A gate then shows the
        # honest swell field. (This was happening accidentally via an OverflowError on a coastal-classified
        # deep cell; now it's intentional + the math is also hardened in shoaling_coefficient.)
        _b = product.grid.bounds
        _span = ((_b.east - _b.west) if (_b and _b.east >= _b.west) else ((_b.east + 360.0 - _b.west) if _b else 0.0))
        # The mid-res tier (Step 3.6) is served clipped so span<350; its ~2° cells give a COARSE
        # shore-normal. Originally skipped ("honest swell"), but 2026-07-12 the product decision
        # flipped: the band should show SOME rating (very poor on trace swell) at overview zooms
        # rather than vanish — the per-spot glyphs carry the precise numbers on top, and the
        # dynamic lane already rates comparable resolutions at these spans (consistency across
        # lanes). Kill: MARINE_MID_RES_RATING=0 restores the mid-res skip.
        _is_mid_res = bool(product.grid.diagnostics and product.grid.diagnostics.get("mid_res_tier"))
        _mid_skip = _is_mid_res and os.environ.get("MARINE_MID_RES_RATING", "1") == "0"
        if (_b is not None and _span >= 350.0) or _mid_skip:
            if product.grid.diagnostics is None:
                product.grid.diagnostics = {}
            product.grid.diagnostics["surf_transform"] = {"skipped": "mid_res_tier" if _is_mid_res else "coarse_extent"}
            logger.info(f"[Grid Route] Surf rating skipped on {'mid-res' if _is_mid_res else 'global/coarse'} extent ({_span:.0f}°) — honest swell served for {model} {layer}.")
        else:
            # The "surf" toggle renders a SURF-QUALITY RATING overlay: per coastal cell compute the 0-100
            # rating (size + period + wind offshore/onshore via shore_normal) and store score/10 in the
            # height channel (the shader colours it via getRatingColor); open-ocean cells are masked. Wind
            # is co-sampled from the model's own wind product. Kill switch SURF_RATING=0 falls back to the
            # surf-HEIGHT band (the prior surf_transform_grid behaviour) for rollback.
            if os.environ.get("SURF_RATING", "1") != "0":
                from services.weather_pipeline.surf_rating import rating_transform_grid
                wind_fn = await _build_wind_sampler(store, manifest, model, target_dt)
                # LOCAL SIZE CALIBRATION (P-local, band half): the size gate saturates at THIS coast's own
                # good-day breaking height (gridded p80 climatology) instead of the global 1.2 m — the SAME
                # RATING_LOCAL_SIZE flag as the glyph path (spot_ratings), so band and glyphs flip TOGETHER
                # (enabling one without the other is the documented divergence trap). Never fatal; a missing
                # blob/cell simply keeps the global default per cell.
                reference_fn = None
                if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
                    try:
                        from services.weather_pipeline.grid_size_climatology import (
                            load_grid_size_climatology_l2_cached, reference_for)
                        _clim = load_grid_size_climatology_l2_cached()
                        if _clim:
                            reference_fn = lambda _la, _ln: reference_for(_clim, _la, _ln)
                    except Exception as _rle:
                        logger.warning(f"[Grid Route] local size reference unavailable (global default): {_rle}")
                # OBSERVATION GATE for the band (RATING_OBS_GATE, Surfline hybrid): cells cap at the
                # fair_good ceiling unless a CONFIRMED spot (>=2-model agreement or a fresh user report,
                # both stamped into the spot-ratings L2 blob by the precompute) sits within ~35 km —
                # good/epic ribbons paint only around confirmed breaks, exactly like Surfline's
                # forecaster-verified purple. Never fatal; no blob = everything capped (honest default).
                gate_fn = None
                if os.environ.get("RATING_OBS_GATE", "0") == "1":
                    try:
                        gate_fn = _build_observation_gate(target_dt)
                    except Exception as _oge:
                        logger.warning(f"[Grid Route] observation gate unavailable (capped default): {_oge}")
                n_t, n_masked = rating_transform_grid(
                    product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km, wind_fn, shore_normal_at,
                    reference_fn=reference_fn, gate_fn=gate_fn)
                tag = {"rated": n_t, "masked": n_masked, "value_kind": "surf_rating", "wind": bool(wind_fn),
                       "local_size": bool(reference_fn), "obs_gate": bool(gate_fn)}
                label = "RATING overlay"
            else:
                from services.weather_pipeline.surf_transform import surf_transform_grid
                n_t, n_masked = surf_transform_grid(product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km)
                tag = {"transformed": n_t, "masked": n_masked}
                label = "height band"
            product.is_estimated = True
            if product.grid.diagnostics is None:
                product.grid.diagnostics = {}
            product.grid.diagnostics["surf_transform"] = tag
            logger.info(f"[Grid Route] Surf {label}: {n_t} coastal cells, {n_masked} open-ocean masked, for {model} {layer}.")
    except Exception as _se:
        logger.warning(f"[Grid Route] Surf overlay skipped: {_se}")
        # Forensic instrumentation (rating plan §8 #3): the global-coarse frame returns surf_transform:None
        # and the Render exception isn't capturable locally. Stash the exception type+message into the
        # response diagnostics so the NEXT live `/grid?surf=true` on the global frame reveals WHY the
        # transform was skipped (a throw vs a no-op) — forensics over guessing. Purely additive; the
        # frontend Option-A gate already renders the honest swell field when no rating grid exists.
        try:
            if product is not None and getattr(product, "grid", None) is not None:
                if product.grid.diagnostics is None:
                    product.grid.diagnostics = {}
                product.grid.diagnostics["surf_skip_reason"] = f"{type(_se).__name__}: {_se}"
        except Exception:
            pass

    return product


def _build_observation_gate(target_dt):
    """Build the band's ``gate_fn(lat, lng, score) -> gated_score`` from the spot-ratings L2 blob: the
    precompute stamps per-spot ``confirmed`` levels ('good'/'epic' via >=2-model agreement or a fresh
    user report); cells within ~0.35 deg (~35 km) of a confirmed spot inherit its unlock, everything
    else caps at the fair_good ceiling (observation_gate(None)). The confirmed set is tiny (only
    confirmed spots), so the per-cell nearest scan is cheap. Returns a callable, or a cap-everything
    callable when no blob/frames exist (honest default — good/epic need evidence)."""
    from services.weather_pipeline.rating_confirmation import observation_gate
    from services.weather_pipeline.spot_ratings import load_spot_ratings_l2_cached, _parse_dt

    RADIUS_DEG = 0.35
    confirmed = []                                     # (lat, lng, level)
    try:
        blob = load_spot_ratings_l2_cached()
        for fr in (blob or {}).get("frames", []):
            fr_dt = _parse_dt(fr.get("valid_time"))
            if target_dt is not None and fr_dt is not None:
                if abs((fr_dt - target_dt).total_seconds()) > 3 * 3600:
                    continue                           # confirmations speak for their own hours
            for sp in fr.get("spots") or []:
                lvl = sp.get("confirmed")
                la, ln = sp.get("latitude"), sp.get("longitude")
                if lvl in ("good", "epic") and la is not None and ln is not None:
                    confirmed.append((la, ln, lvl))
    except Exception:
        confirmed = []

    def gate_fn(lat, lng, score):
        best = None
        for la, ln, lvl in confirmed:
            dlng = abs(ln - lng)
            if dlng > 180.0:
                dlng = 360.0 - dlng
            if abs(la - lat) <= RADIUS_DEG and dlng <= RADIUS_DEG:
                if lvl == "epic":
                    return observation_gate(score, "epic")
                best = "good"
        return observation_gate(score, best)

    return gate_fn


async def _build_wind_sampler(store, manifest, model, target_dt):
    """Return a ``(lat, lng) -> (speed_ms, from_deg) | None`` sampler over the model's wind product nearest
    ``target_dt`` (within 3h), for the surf-rating's offshore/onshore wind factor. The wind product stores
    speed in KNOTS (value_unit=kn) -> converted to m/s; ``direction`` is the meteorological FROM bearing.
    Nearest-cell by lat/lng (robust to grid ordering; the wind grid is small/coarse). None if no product."""
    try:
        cands = [
            p for p in manifest.products
            if p.model.upper() == model.upper() and p.domain.lower() == "wind" and p.layer.lower() == "wind"
            and abs((p.valid_time_start - target_dt).total_seconds()) <= 3 * 3600
        ]
        if not cands:
            return None
        best = min(cands, key=lambda p: abs((p.valid_time_start - target_dt).total_seconds()))
        wp = await asyncio.to_thread(store.load_product, best.filename)
        if not wp or not wp.grid or not wp.grid.vectors:
            return None
        vex = [v for v in wp.grid.vectors
               if getattr(v, "lat", None) is not None and getattr(v, "lng", None) is not None
               and getattr(v, "speed", None) is not None]
        if not vex:
            return None
        KT_TO_MS = 0.514444

        def sampler(lat, lng):
            if lat is None or lng is None:
                return None
            best_v = None
            best_d = None
            for v in vex:
                dlng = abs(v.lng - lng)
                if dlng > 180:
                    dlng = 360 - dlng
                d = (v.lat - lat) ** 2 + dlng ** 2
                if best_d is None or d < best_d:
                    best_d = d
                    best_v = v
            if best_v is None:
                return None
            return (best_v.speed * KT_TO_MS, getattr(best_v, "direction", None))

        return sampler
    except Exception:
        return None
