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
    # wave_height, but after a surf=1 hit the same bbox surf=0 returned surf_rating.
    # ★ COPY WHAT THE BRANCH MUTATES (2026-08-09, was an unconditional copy.deepcopy HERE, before the
    # skip decision below — +119 ms median per world frame in production, 100% of it before learning
    # the frame would skip). The SKIP branch touches only diagnostics → shallow product+grid copies
    # with a REPLACED (never mutated — store.py returns shallow model_copy()s, the dict is shared
    # with the cache) diagnostics dict: bench 0.01 ms. The TRANSFORM branch mutates vector fields →
    # per-vector model_copy (bench 48.9 ms vs deepcopy's 130.9 at 15,023 vectors), the pattern
    # proven at route_helpers.filter_grid_to_bbox. Containment is pinned by
    # tests/test_grid_surf_overlay_copies.py in BOTH branches plus the pre-copy exception path.
    def _shallow_with_own_diagnostics(p):
        p = p.model_copy()
        p.grid = p.grid.model_copy()
        p.grid.diagnostics = dict(p.grid.diagnostics or {})
        return p

    _copied = False
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
            product = _shallow_with_own_diagnostics(product)
            _copied = True
            product.grid.diagnostics["surf_transform"] = {"skipped": "mid_res_tier" if _is_mid_res else "coarse_extent"}
            logger.info(f"[Grid Route] Surf rating skipped on {'mid-res' if _is_mid_res else 'global/coarse'} extent ({_span:.0f}°) — honest swell served for {model} {layer}.")
        else:
            product = _shallow_with_own_diagnostics(product)
            product.grid.vectors = [v.model_copy() for v in product.grid.vectors]
            _copied = True
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
                        # ⛔ OFF THE EVENT LOOP — a `requests.get(timeout=10)` to Supabase behind a
                        # 600 s TTL. Bare, it blocked the single worker's loop for the whole round
                        # trip once per TTL per process. Same class as `ebc2b5b4`.
                        _clim = await asyncio.to_thread(load_grid_size_climatology_l2_cached)
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
                        # ⛔ OFF THE EVENT LOOP — this reaches `load_spot_ratings_l2_cached`, another
                        # `requests.get(timeout=10)` behind a 300 s TTL. The audit offloaded that
                        # loader's two siblings in `routes/weather.py` and missed this caller.
                        gate_fn = await asyncio.to_thread(_build_observation_gate, target_dt)
                    except Exception as _oge:
                        logger.warning(f"[Grid Route] observation gate unavailable (capped default): {_oge}")
                # ⛔⛔ OFF THE EVENT LOOP — THE ONE THE MEASUREMENT ACTUALLY CONDEMNED. This is a
                # per-cell loop, and 99.1% of its cold cost is bathymetry lookups (measured at HEAD:
                # 14.087 s of lookups vs 0.130 s of math over 19,600 fresh coords), not physics.
                # Bare on the loop it stalls EVERYTHING: at 7,081 cells — the largest RATED frame
                # production was observed to serve — a co-tenant coroutine got **0 of ~426 ticks
                # (0%)** for 4.27 s. Offloaded, 64% of ticks survive. ⚠️ Even the WARM 0.10 s case
                # took 0 of ~10 ticks: the stall is proportional to duration, not to grid size, so
                # there is no "small enough" frame that makes this safe.
                # ★ The fix is the thread, NOT vectorising the lookups: `lru_cache(maxsize=200_000)`
                # already makes the steady state ~4.8 µs/cell (23–43× the cold path), so the
                # remaining cost is a cold-start tax, not a hot loop.
                n_t, n_masked = await asyncio.to_thread(
                    rating_transform_grid,
                    product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km, wind_fn, shore_normal_at,
                    reference_fn=reference_fn, gate_fn=gate_fn)
                tag = {"rated": n_t, "masked": n_masked, "value_kind": "surf_rating", "wind": bool(wind_fn),
                       "local_size": bool(reference_fn), "obs_gate": bool(gate_fn)}
                label = "RATING overlay"
            else:
                from services.weather_pipeline.surf_transform import surf_transform_grid
                # The height-band sibling — same per-cell shape over the same cold lookups, so it
                # gets the same thread. Fixing only the rating branch would leave the WORLD frame
                # (15,023 cells, measured live) blocking the loop, and that is the biggest one.
                n_t, n_masked = await asyncio.to_thread(
                    surf_transform_grid, product.grid.vectors, shelf_depth_at, is_coastal, shelf_width_km)
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
                if not _copied:
                    # The failure may predate the branch copy — stamping the SHARED cached
                    # product would poison the cache with a skip_reason, so copy first.
                    product = _shallow_with_own_diagnostics(product)
                    _copied = True
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


def _make_nearest_sampler(vex):
    """``(lat, lng) -> (speed_ms, from_deg)`` nearest-cell sampler over pre-extracted numpy arrays.

    ★ REPLACES a per-call pure-Python O(M) scan (2026-08-09). `rating_transform_grid` calls this
    once PER RATED CELL and the scan was 8.9x the entire warm cost of everything else in that loop
    (MASTER-AUDIT-11.0 §3.4, two independent measurements) — the module note blaming cold
    bathymetry was refuted by the warm control arm. Bench on this box: 569 ms -> sub-ms per
    2,533-cell frame at M=629.

    BIT-IDENTICAL to the scan it replaced: same elementwise IEEE-double ops (abs/sub/mul/add), and
    `np.argmin` returns the FIRST minimum exactly as the strict `d < best_d` scan kept the first
    winner — pinned by a verbatim-old differential in tests/test_grid_surf_overlay_copies.py.
    ⚠️ NOT a locally re-typed knots constant — read `surf_rating.KT_TO_MS` (the owner). A
    six-digit truncation's round-trip lands just below the knots it started from, which flips
    `wind_quality`'s STRICT `< 3.0` glassy branch at exactly 3.00 kt; `test_wind_unit_constant
    _parity` scans non-comment source for any such digits, which is why this docstring names no
    number."""
    import numpy as np
    from services.weather_pipeline import surf_rating as SR
    lats = np.array([v.lat for v in vex], dtype=np.float64)
    lngs = np.array([v.lng for v in vex], dtype=np.float64)

    def sampler(lat, lng):
        if lat is None or lng is None:
            return None
        dlng = np.abs(lngs - lng)
        dlng = np.where(dlng > 180, 360 - dlng, dlng)
        dlat = lats - lat
        i = int(np.argmin(dlat * dlat + dlng * dlng))
        best_v = vex[i]
        return (best_v.speed * SR.KT_TO_MS, getattr(best_v, "direction", None))

    return sampler


async def _build_wind_sampler(store, manifest, model, target_dt):
    """Return a ``(lat, lng) -> (speed_ms, from_deg) | None`` sampler over the model's wind product nearest
    ``target_dt`` (within 3h), for the surf-rating's offshore/onshore wind factor. The wind product stores
    speed in KNOTS (value_unit=kn) -> converted to m/s; ``direction`` is the meteorological FROM bearing.
    Nearest-cell by lat/lng (robust to grid ordering; the wind grid is small/coarse). None if no product."""
    try:
        from services.weather_pipeline.manifest_view import products_for
        cands = [
            p for p in products_for(manifest, model, "wind", "wind")
            if abs((p.valid_time_start - target_dt).total_seconds()) <= 3 * 3600
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
        return _make_nearest_sampler(vex)
    except Exception:
        return None
