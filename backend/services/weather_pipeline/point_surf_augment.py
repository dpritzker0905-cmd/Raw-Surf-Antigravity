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
