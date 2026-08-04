"""point_surf_augment.py — the surf augmentation applied to every resolved marine point.

Extracted from `point_resolution.resolve_point` on 2026-07-30: that file hit 801 of the 800-line
ratchet, and this block is the cohesive piece — it is the COMPOSITION layer (geometry in, breaking
height + provenance out), which `surf_point.py` already owns the geometry half of. Behaviour is
unchanged; the block moved verbatim.

★ It stays the SINGLE INJECTION POINT. `surf_height_m` is produced here and nowhere else, which is
what lets the map glyphs, the spot hub and the weather sim inherit one breaking height, one set of
spectral partitions and one geometry-readiness verdict instead of each deriving its own. Adding a
second place that computes any of those is the defect CLAUDE.md's ONE FORECAST COMPOSITION rule
exists to prevent (`902f47a9` served the offshore height as surf; `9b808d05` dropped per-spot
capacity at one surface only).

`resolve_partitions` is INJECTED rather than imported so this module has no dependency on the
service — and so the re-entrancy guard stays where it belongs: the caller passes
`self._resolve_partitions`, which goes through `_resolve_point_internal` and therefore cannot
recurse back into this augmentation.
"""
import logging
import os

from services.weather_pipeline.schemas import NormalizedPointResponse

logger = logging.getLogger(__name__)


async def augment_with_surf(response, model, domain, layer, lat, lng, valid_time_str,
                            resolve_partitions):
    """Add the bathymetry-derived surf height + its provenance to a marine point response.

    Returns the same response object (mutated), so a caller can keep `return await
    augment_with_surf(...)`. Never raises — a surf estimate is an ENRICHMENT and must never cost
    the caller its point."""
    # ── Option-2 surf transform: augment a successful MARINE point with a bathymetry-derived surf
    # height (additive — the offshore height/period in `point` are untouched). SINGLE injection point,
    # so it covers every resolution path without touching their fetch/sample logic (the regression-safe
    # pattern; the infobox 2-month history is all about fetch deps / flooding / unmount — none of which
    # this touches). Pure in-process compute (bundled bathymetry), serve-only safe. Kill switch SURF_TRANSFORM=0.
    if (
        domain.lower() == "marine"
        and layer.lower() in ("waves", "swell_1", "swell_2", "wind_waves")
        and isinstance(response, NormalizedPointResponse)
        and response.point is not None
        and os.environ.get("SURF_TRANSFORM", "1") != "0"
    ):
        try:
            # ── The geometry chain lives in surf_point.resolve_surf_geometry (extracted
            # 2026-07-27), NOT here. It resolves, in production precedence: the shelf depth
            # (cross-shelf friction — a wide shallow shelf like Florida yields surf MUCH smaller
            # than the offshore swell), the GEOGRAPHY-only coastal gate (model-independent, so
            # the surf row shows at the same points for GFS/EURO/ICON), the shelf width, the
            # seaward shore normal (coarse bathymetry -> ETOPO 15s asset -> hand-audited
            # override), the sub-grid magnet factor, and the ETOPO nearshore break depth.
            #
            # It was extracted because this block was the ONLY copy, so the weather-sim MCP had
            # re-implemented it and drifted — measured 19.1% median / 39.2% max over-read against
            # what this lane serves, on a shore normal 44.9 deg off. One function, every caller.
            # Behaviour here is unchanged; test_surf_point_parity.py pins that.
            from services.weather_pipeline.surf_point import resolve_surf_geometry, estimate_surf_at
            _geo = resolve_surf_geometry(lat, lng)
            # The frontend pairs the shore normal with the already-fetched wind point + surf
            # height/period to compute the rating badge ([[surf_rating]]).
            response.shore_normal_deg = _geo.shore_normal_deg
            # ...and, since 2026-08-01, the LOCAL SIZE REFERENCE it must grade against. Without it
            # the badge keeps the global 1.2 m curve while the glyph uses the spot's own good day —
            # the ONE FORECAST COMPOSITION split that flipping RATING_LOCAL_SIZE would otherwise
            # have opened on a surface the frontend renders beside the glyph.
            # ⚠️ Its own try, for the recorded reason the partitions block has one: this whole
            # geometry chain sits under a broad `except`, so an error here would silently disable
            # `surf_height_m` ENTIRELY rather than merely drop the reference. Fail-open by
            # contract — no reference means the global curve, which is exactly the pre-flip
            # behaviour and never a wrong NUMBER, only a less local one.
            # ★ THE CELL BLOB IS THE FALLBACK, NOT THE ANSWER — CORRECTED 2026-08-01 (queue E#1).
            # This endpoint is keyed by a COORDINATE, so it took the per-cell reference
            # `grid_resolver_surf` gives the BAND at that coordinate. The justification was a
            # docstring — grid_size_climatology.reference_for says "band and glyph saturate
            # identically where they overlap" — and that sentence is about the FORMULA (same
            # percentile, min-samples, clamps), NOT the VALUES. It was never measured. When it was,
            # a 0.25 deg cell aggregates many spots and the two disagree:
            #     |cell - spot| reference: median 21.3%, max 52.5%, 4 of 10 over 25%
            #     score impact at the badge: -11.4 to +9.6 points, LEVEL differs at 2 of 6
            # ⇒ AT A CATALOGUED SPOT THE PER-SPOT REFERENCE WINS, because that is the number the
            # glyph rendered beside this box graded with, and the two must be ONE composition.
            # Away from a catalogued spot the cell value is still right — there is no glyph there to
            # disagree with — so the fallback is kept, not replaced.
            # ⚠️ NOT a "second forecast path for one screen" (the old comment's objection): it is
            # the SAME per-spot reference the glyph and hub already use, reached by the SAME 2 km
            # proximity tolerance `rating_confirmation.confirmation_for` uses on this very lane.
            # ⚠️ spot_size_climatology has NO `reference_for` — only `reference_map(clim)` /
            # `reference_for_spot(id)` / `reference_for_coordinate(lat,lng)`. A first pass imported
            # the wrong name anyway; the ImportError would have been swallowed by this very except,
            # leaving the badge silently on the global curve with the fix apparently shipped.
            # Fail-open hides its own failure — verify the symbol exists.
            if os.environ.get("RATING_LOCAL_SIZE", "0") == "1":
                try:
                    from services.weather_pipeline.grid_size_climatology import (
                        load_grid_size_climatology_l2_cached, reference_for)
                    from services.weather_pipeline.spot_size_climatology import (
                        reference_for_coordinate)
                    # Spot first; None (no blob, no coordinates yet, nothing within 2 km, or too
                    # little climatology) falls through to the cell value, which is the behaviour
                    # this lane shipped with. That is why this can land BEFORE the precompute has
                    # written coordinates into the blob: inert until the data arrives.
                    response.reference_size_m = (
                        reference_for_coordinate(lat, lng)
                        or reference_for(load_grid_size_climatology_l2_cached(), lat, lng))
                except Exception as _ref_err:
                    logger.debug(f"[point-surf] local size reference unavailable: {_ref_err}")
            # SPECTRAL (opt-in): transform each swell train on its own period instead of shoaling
            # one blended field. Resolved HERE, at the single injection point, because
            # `surf_height_m` is produced here — computing it anywhere else would give the spot
            # hub and the sim a different height from the map glyphs, which is the divergence
            # CLAUDE.md's ONE FORECAST COMPOSITION rule exists to prevent. See
            # `_resolve_partitions` for the cost and the re-entrancy guard.
            # ⚠️ ITS OWN try, and that is deliberate. The enclosing `except Exception` (below)
            # covers the whole geometry chain, so ANY error raised here — including a mere
            # signature mismatch, since `resolve_partitions` arrives as an injected callable and
            # arity is not checked until call time — would silently disable `surf_height_m`
            # ENTIRELY, not merely drop the partitions. That is the recorded landmine: a broad
            # `except` once disabled the surf transform and nothing said so. Partitions are OPT-IN
            # and fail-open by contract, so a failure here must cost only the spectral refinement.
            try:
                _parts = await resolve_partitions(
                    model, layer, lat, lng, valid_time_str, response.point.speed,
                    response.point.period)
            except Exception as _pe:
                logger.warning(
                    f"[Surf v3] partition resolution failed at ({lat},{lng}); falling back to the "
                    f"total field. surf_height_m is UNAFFECTED: {_pe!r}")
                _parts = None
            # ── M4: ECMWF PERIOD BANDS AS A SECOND, CHEAPER SOURCE (2026-08-02) ──────────────
            # ⚠️ ONLY when the resolver above produced nothing. That lane is the reconciled CMEMS
            # split and is AUTHORITATIVE; two partition sources feeding one sea state is the ONE
            # FORECAST COMPOSITION rule broken, so this can never displace it — it fills the gap
            # where `SURF_PARTITIONS` is off (its default) or the extra layers did not answer.
            # ★ COST IS WHY THIS EXISTS. `_resolve_partitions` samples three MORE layers per point
            # (4x, 0.17-0.77 s each) — the reason it is off by default on a 1-CPU box with a
            # three-incident melt history. The bands arrive in the SAME wave product as the total,
            # so this costs ZERO extra point resolutions for the same spectral benefit.
            # ⚠️ Its own try, for the reason the block above documents: a failure here must cost
            # the spectral refinement and NOTHING else. `surf_height_m` is unaffected either way.
            if not _parts:
                try:
                    _bands = getattr(response.point, "wave_bands", None)
                    if _bands:
                        from services.weather_pipeline.period_bands import bands_to_partitions
                        _bp, _bdiag = bands_to_partitions(
                            _bands, total_h_m=response.point.speed,
                            mean_dir_deg=response.point.direction,
                            mean_period_s=response.point.period)
                        if _bp:
                            _parts = _bp
                            logger.debug(f"[Surf v3] {len(_bp)} partitions from ECMWF period bands "
                                         f"at ({lat},{lng}); diag={_bdiag}")
                except Exception as _be:
                    logger.warning(
                        f"[Surf v3] period-band composition failed at ({lat},{lng}); falling back "
                        f"to the total field. surf_height_m is UNAFFECTED: {_be!r}")
            surf, regime = estimate_surf_at(lat, lng, response.point.speed, response.point.period,
                                            swell_from_deg=response.point.direction, geometry=_geo,
                                            partitions=_parts)
            # The rating half reads the SAME reconciled trains the height ran on. Carried on the
            # response so `rate_one_spot`, the hub and the sim's live lane cannot resolve a second,
            # disagreeing sea state for the same point (None when the flag is off / nothing usable).
            response.partitions = _parts
            if _geo.magnet_name and surf is not None:
                logger.debug(f"[Surf v3] magnet '{_geo.magnet_name}' x{_geo.magnet_factor} at ({lat},{lng})")
            response.surf_height_m = round(surf, 4) if surf is not None else None
            response.surf_regime = regime
            response.shelf_depth_m = round(_geo.depth_m, 1) if _geo.depth_m is not None else None
            # ── SAY WHAT THIS NUMBER IS STANDING ON ────────────────────────────────────────
            # The geometry is already resolved and already gradeable; both were being dropped,
            # so a spot running on the coarse 0.25° grid looked exactly like a measured one.
            # Stamped HERE for the same reason the partitions are resolved here: this is the
            # one place `surf_height_m` is produced, so the glyphs, the hub and the sim all
            # inherit the same verdict instead of each growing its own idea of "trustworthy".
            # Diagnostic only — nothing in the rating chain branches on it. Never fatal.
            response.shore_normal_source = _geo.shore_normal_src
            response.break_depth_m = _geo.break_depth_m
            # ── AND SAY WHEN THAT NUMBER CONTRADICTS ITS OWN QUALITY SCORE ────────────────────
            # The height just computed used `_height_exposure_factor` (floor 0.595 => 0.354 of the
            # energy); the quality chain will use `swell_exposure` (floor 0.100) on the SAME
            # bearing. Off-angle those disagree by up to 3.54x, and the payload said nothing.
            # Stamped at the height's own birthplace so the caveat can never describe a different
            # number than the one served. Absent unless it binds (dtheta >= 75.73 deg).
            # ⚠️ Diagnostic only — NOTHING in the rating chain branches on it, exactly like
            # `geometry_readiness`. A caveat that changes the physics is not a caveat.
            # Kill: RATING_DIRECTIONAL_CONFLICT=0.
            if os.environ.get("RATING_DIRECTIONAL_CONFLICT", "1") != "0":
                try:
                    from services.weather_pipeline import wave_physics
                    response.directional_conflict = wave_physics.directional_conflict(
                        response.point.direction, _geo.shore_normal_deg)
                except Exception as _dc:
                    logger.debug(f"[Surf v3] directional conflict unavailable at ({lat},{lng}): {_dc!r}")
            try:
                from services.weather_pipeline.spot_geometry_readiness import assess_geometry
                _rd = assess_geometry(_geo)
                response.geometry_readiness = _rd.get("verdict")
                # The short list only. The `impact` strings are a paragraph each and this
                # payload is sampled per spot per hour — a 93.5 KB response is one a client
                # REJECTS rather than displays.
                response.geometry_missing = _rd.get("missing") or None
            except Exception as _re:
                logger.debug(f"[Surf readiness] skipped at ({lat},{lng}): {_re}")
            # NEARSHORE display tag (see schemas.surf_nearshore): land within ~±0.25° — the
            # frontend hides the Surf (est.) row for markers farther offshore than that.
            response.surf_nearshore = _geo.nearshore
        except Exception as _se:
            # ⚠️ THIS BROAD EXCEPT HIDES CODING ERRORS, NOT JUST DATA ONES. It exists so a surf
            # estimate can never cost the caller its point — but during the 2026-07-30 extraction
            # it swallowed a NameError (`self` no longer in scope) as a quiet debug line, silently
            # disabling the whole transform while every response still validated. Only
            # `test_resolve_point_attaches_surf_for_marine` caught it. If you change this block,
            # RUN THAT TEST — a green suite minus that one test looks identical to a working one.
            logger.debug(f"[Surf Transform] skipped for ({lat},{lng}): {_se}")

    return response
