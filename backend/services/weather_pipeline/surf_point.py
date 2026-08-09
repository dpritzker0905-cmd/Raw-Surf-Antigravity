"""
surf_point.py — THE single composition of "what is the surf at this coordinate?".

`surf_transform.estimate_surf` is the PHYSICS. This module is the GEOMETRY RESOLUTION that feeds
it: the shore-normal precedence chain (coarse bathymetry -> ETOPO 15s asset -> hand-audited
overrides), the per-spot magnet factor, the nearshore break depth, the shelf depth/width, and the
coastal gate — assembled in the one order that is correct.

WHY THIS MODULE EXISTS
----------------------
Until 2026-07-27 that chain lived only inside `point_resolution.resolve_point`, so any other caller
that wanted a surf height had to re-implement it. The weather simulation MCP did, and drifted.

Measured 2026-07-27 across 8 scenarios at the sim's three spots, the sim over-read the height the
app actually serves by a **median 19.1%, max +39.2%** — it called `komar_breaker_height` on the raw
offshore Hs with a HARDCODED shore normal that is **44.9 deg off** the ETOPO value production uses
at the identical coordinate (Mavericks: sim 270 vs asset 225.1, spread 10.5).

This is the same failure `0cae5d74` fixed at the FUNCTION level, recurring at the COMPOSITION
level: delegating the two physics functions still left the caller owning the ORDER they are applied
in and the INPUTS they are given — and that is exactly where production kept moving (shore-normal
asset 2026-07-26 `5a48ad1e`, break depth 2026-07-27 `bf5c76cd`). Distributed correctness leaks; the
invariant has to live in the one function every path calls (the 2026-07-19 wind lesson).

CONTRACT
  * Pure in-process compute over the bundled bathymetry + assets. No network, no DB, no fetch.
  * Every optional input FAILS OPEN: a missing asset, a raising override, an absent break depth all
    degrade to exactly the previous behaviour. Nothing here can make a surf height worse than the
    coarse-bathymetry answer it replaces.
  * `resolve_surf_geometry` propagates errors from the three BASE bathymetry lookups (depth /
    coastal / width) because without them there is no honest estimate — callers already wrap the
    surf block in a try/except and skip. The four ENRICHMENT lookups are individually swallowed.

Kill switches are inherited, not re-invented: SHORE_NORMAL_ASSET=0, SURF_V3_NORMAL_OVERRIDES=0,
SURF_BREAK_DEPTH=0, SURF_V3_MAGNETS=0 all behave here exactly as they do in production.
"""
import logging
import os
from typing import NamedTuple, Optional

logger = logging.getLogger(__name__)


class SurfGeometry(NamedTuple):
    """Everything `estimate_surf` needs about a coordinate, resolved in production precedence."""
    depth_m: Optional[float]          # ~139 km shelf median — cross-shelf FRICTION only
    shelf_width_km: float
    coastal: bool
    shore_normal_deg: Optional[float]  # seaward bearing, best available source
    # ★ 'etopo' means MEASURED AT THIS COORDINATE (within MATCH_RADIUS_KM, the documented
    #   "same break" distance). 'etopo:borrowed' means inferred from a gate-passed NEIGHBOUR out to
    #   BEARING_RADIUS_KM. Those were one label until 2026-08-02 and the difference is real: OSM-
    #   graded, a borrowed bearing is p50 12.6 deg off versus the coarse fallback's 38.7 — good, but
    #   not the same claim as a fit at the spot itself.
    shore_normal_src: str              # 'coarse'|'etopo'|'etopo:borrowed'|'override:<name>'|'none'
    magnet_factor: float
    magnet_name: Optional[str]
    break_depth_m: Optional[float]     # ETOPO nearshore depth — the BREAKING CAP only
    nearshore: Optional[bool]          # land within ~1 cell (display gate)
    # How far the entry that supplied the bearing actually sits, in km. None unless the asset (or
    # overlay) answered. Trailing + defaulted so no existing construction site has to change.
    shore_normal_match_km: Optional[float] = None


def resolve_surf_geometry(lat: float, lng: float) -> SurfGeometry:
    """Resolve every geometric input for a coordinate, in production precedence order.

    Mirrors `point_resolution.resolve_point`'s surf block exactly — it was extracted from there, and
    `test_surf_point_parity.py` pins that the two agree."""
    from services.weather_pipeline.bathymetry import (
        shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at)

    # ── BASE: no honest estimate exists without these, so they are allowed to raise. ──
    depth = shelf_depth_at(lat, lng)
    coastal = bool(is_coastal(lat, lng))
    width = shelf_width_km(lat, lng) or 0.0

    # ── Shore normal, weakest source first; each stronger source overwrites. ──
    normal, src, match_km = None, "none", None
    try:
        normal = shore_normal_at(lat, lng)
        if normal is not None:
            src = "coarse"
    except Exception:
        normal = None

    # ETOPO 2022 15s (~463 m) per-spot normal. The 0.25 deg grid decides which way a beach faces
    # from a 7x7 window 194.6 km across, which is why Pipeline and Sunset both read 0.0 on a coast
    # facing ~325-335. Only gate-passing spots are in the asset, so a hit is already trustworthy and
    # a miss correctly leaves the coarse value in place. Kill: SHORE_NORMAL_ASSET=0.
    try:
        from services.weather_pipeline.shore_normal_asset import (
            MATCH_RADIUS_KM as _SAME_BREAK_KM, match_km_at as _asset_match_km,
            shore_normal_at as _asset_normal_at)
        _fine, _spread = _asset_normal_at(lat, lng)
        if _fine is not None:
            # ★ MEASURED HERE, OR BORROWED FROM A NEIGHBOUR? Since the bearing may now come from up
            # to BEARING_RADIUS_KM away, "the asset answered" is two different facts and the
            # readiness envelope exists precisely to tell them apart. The threshold is
            # MATCH_RADIUS_KM because that is this module's own documented "same break" distance —
            # inside it a click is the same peak sharing its geometry, beyond it we are inferring
            # from the coast next door.
            match_km = _asset_match_km(lat, lng)
            borrowed = match_km is not None and match_km > _SAME_BREAK_KM
            normal, src = _fine, ("etopo:borrowed" if borrowed else "etopo")
            logger.debug(f"[Surf] ETOPO shore normal {_fine} deg (spread {_spread} deg, "
                         f"{'borrowed ' if borrowed else ''}{match_km} km) at ({lat},{lng})")
    except Exception:
        pass

    # Hand-audited per-spot overrides are human ground truth, so they still outrank the derived
    # asset. Kill: SURF_V3_NORMAL_OVERRIDES=0.
    if os.environ.get("SURF_V3_NORMAL_OVERRIDES", "1") != "0":
        try:
            from services.weather_pipeline.surf_magnets import shore_normal_override_at
            _ov, _ov_name = shore_normal_override_at(lat, lng)
            if _ov is not None:
                normal, src = _ov, f"override:{_ov_name}"
        except Exception:
            pass

    # Sub-grid inlet/jetty focusing. Inert unless SURF_V3_MAGNETS is on inside estimate_surf.
    try:
        from services.weather_pipeline.surf_magnets import magnet_factor_at
        magnet, magnet_name = magnet_factor_at(lat, lng)
    except Exception:
        magnet, magnet_name = 1.0, None

    # ETOPO nearshore depth for the depth-limited breaking cap ONLY. `depth` above is a ~139 km
    # shelf median: correct for friction, useless as a breaking depth (measured 2026-07-27 the cap
    # bound on 0 of 395 live spots). Absent -> legacy behaviour unchanged.
    try:
        from services.weather_pipeline.shore_normal_asset import break_depth_at
        break_depth = break_depth_at(lat, lng)
    except Exception:
        break_depth = None

    try:
        nearshore = bool(is_coastal(lat, lng, radius_cells=1))
    except Exception:
        nearshore = None

    # ⭐⭐⭐ A FITTED PER-COORDINATE SHORELINE IS POSITIVE EVIDENCE OF A SHORELINE.
    # `is_coastal` asks a 0.25° (~28 km) land mask whether ANY land sits within ±3 cells (±0.75°,
    # ~83 km). A small island does not fill a 28 km cell, so the mask answers "no land" — and
    # `estimate_surf` then takes `if not coastal: return float(Hs_m), 'open_ocean'`, publishing the
    # OFFSHORE significant height under the surf label. That is CLAUDE.md's first binding rule
    # inverted, and it was live at 18 destination spots (MASTER-AUDIT-10.0 §0b.3 / row G).
    #
    # MEASURED at HEAD over all 1,386 asset coordinates:
    #   • 18 coords (1.30%) had coastal=False, and ALL 18 carry shore_normal_src='etopo'
    #     with match_km = 0.00 — a 463 m fit AT the coordinate. So the fine asset finds a shoreline
    #     at 0 km while the coarse mask finds none within 83 km. The structs disagree about whether
    #     land exists, and the COARSER instrument was winning.
    #   • every one of the 18 has land = 0 of 49 cells in the mask's own window — i.e. the mask is
    #     not wrong about its own grid, it is under-resolved for the question being asked.
    #   • the JACOBIAN is the fingerprint: dFt/dHs was **exactly 3.28 ft/m and CONSTANT** at those
    #     spots — that is the metres→feet conversion, i.e. the identity function, i.e. no transform
    #     ran at all. A coastal control (Pipeline) gives 4.68 → 3.19 ft/m, DECREASING, which is what
    #     shoaling saturating toward a depth cap actually looks like.
    #
    # ⚠️ SCOPE IS BOUNDED BY CONSTRUCTION: this can only promote a coordinate that is already
    # coastal=False AND carries an asset/override bearing. Measured blast radius: exactly the 18,
    # and 0 spots resolve to `etopo:borrowed` in that set today — so including borrowed widens the
    # predicate without changing any served value now, and closes the same hole for a future spot
    # whose shoreline is fitted 1-3 km away rather than at 0 km.
    # ⛔ It does NOT touch `is_coastal` itself: that function has other callers and its 0.25°
    # contract is correct for what it is — under-resolved for THIS question, not wrong.
    # ⚠️ `nearshore` (two lines above) is deliberately left alone. It is the same mask at
    # radius_cells=1 and it is also False at these 18, but it is published only as
    # `schemas.surf_nearshore` and, measured 2026-08-07, that field has **zero consumers**: no
    # frontend reference and no backend branch. Promoting it would be an unmeasured change to a
    # value nothing reads. (It is a small instance of the repo's own "true but reaches nobody"
    # class — recorded here rather than silently "fixed".)
    # Kill: SURF_COASTAL_FROM_SHORE_NORMAL=0 restores the pre-fix geometry exactly.
    if (not coastal and os.environ.get("SURF_COASTAL_FROM_SHORE_NORMAL", "1") != "0"
            and (src.startswith("etopo") or src.startswith("override"))):
        logger.debug(f"[Surf] coastal promoted by shore-normal evidence at ({lat},{lng}): "
                     f"src={src} match_km={match_km} — the 0.25 deg mask cannot resolve this coast")
        coastal = True

    # ⭐ LAND WITHOUT A BEARING (2026-08-09, MASTER-AUDIT-11.0 §3.5 — the SECOND small-island set).
    # 16 more served spots (Maldives passes, Rangiroa, Chuuk, Kwajalein…) were publishing the
    # OFFSHORE Hs because they are absent from the bearing asset: run for them, the fit MEASURED a
    # 463 m shoreline at 0.08–2.11 km but REFUSED the bearing (spreads 46–172° — atoll coasts bend
    # every direction, and forcing a normal would trade one wrong answer for another). Land-present
    # is the weaker claim carried separately: it promotes `coastal` ONLY. `src` stays 'none' — no
    # bearing is claimed, so the exposure factor stays neutral — and the fit's break depth (when it
    # produced one) feeds the cap. The two census coords whose fit found NO shoreline at all
    # (~370 m of water; mis-geocoded) are NOT in the section and correctly stay open_ocean.
    # Kill: SURF_COASTAL_FROM_LAND_BIT=0.
    if not coastal and os.environ.get("SURF_COASTAL_FROM_LAND_BIT", "1") != "0":
        try:
            from services.weather_pipeline.shore_normal_asset import land_present_at
            _land = land_present_at(lat, lng)
            if _land is not None:
                coastal = True
                if break_depth is None and _land[1] is not None:
                    break_depth = float(_land[1])
                logger.debug(f"[Surf] coastal promoted by LAND-PRESENT evidence at ({lat},{lng}): "
                             f"shoreline {_land[0]} km, no bearing claimed")
        except Exception:
            pass

    return SurfGeometry(depth_m=depth, shelf_width_km=width, coastal=coastal,
                        shore_normal_deg=normal, shore_normal_src=src,
                        magnet_factor=magnet, magnet_name=magnet_name,
                        break_depth_m=break_depth, nearshore=nearshore,
                        # None unless the ASSET supplied the bearing — a coarse or overridden
                        # bearing has no match distance, and saying "0 km" would claim a precision
                        # that does not exist.
                        shore_normal_match_km=(match_km if src.startswith("etopo") else None))


def estimate_surf_at(lat: float, lng: float, Hs_m, Tp_s, swell_from_deg=None,
                     geometry: Optional[SurfGeometry] = None, partitions=None,
                     water_level_m: float = 0.0):
    """Breaking surf height (m) + regime at a coordinate, from offshore Hs/Tp/direction.

    The full production chain. Pass a pre-resolved ``geometry`` to avoid repeating the lookups when
    simulating many scenarios at one spot. Returns ``(surf_height_m|None, regime)``.

    ``partitions`` (optional list of {h, tp, dir, kind}) makes the estimate SPECTRAL: each swell
    train is transformed on its own period and bearing, then recombined in quadrature
    (`estimate_surf_partitioned`). This is ONE composition, not a second forecast path — absent or
    unusable partitions fall through to the total-field call below, byte-identical to before. Supply
    them wherever the caller already has swell_1 / swell_2 / wind_waves; see the measured
    contamination in `estimate_surf_partitioned`'s docstring."""
    from services.weather_pipeline.surf_transform import estimate_surf, estimate_surf_partitioned
    g = geometry if geometry is not None else resolve_surf_geometry(lat, lng)
    if partitions:
        h, regime = estimate_surf_partitioned(
            partitions, g.depth_m,
            coastal=g.coastal,
            shelf_width_km=g.shelf_width_km,
            shore_normal_deg=g.shore_normal_deg,
            magnet_factor=g.magnet_factor,
            break_depth_m=g.break_depth_m,
            water_level_m=water_level_m,
        )
        if h is not None:
            return h, regime
    # ★ TIDE, when supplied, reaches the depth-limited cap and nothing else — see the block in
    # `surf_transform.estimate_surf`. Default 0.0 and `SURF_TIDE_DEPTH` default OFF, so every
    # existing caller is byte-identical. ⚠️ NO SERVING-PATH CALLER SUPPLIES IT YET: this is the
    # physics half only, and the wiring (feeding `tide.tide_state_at`'s `height_m` from
    # `rate_one_spot` / `spot_conditions`) is a separate, separately-priced step. Said plainly here
    # so a reader cannot mistake an available parameter for a live one — this repo has shipped
    # "wired but never executed" twice.
    return estimate_surf(
        Hs_m, Tp_s, g.depth_m,
        coastal=g.coastal,
        shelf_width_km=g.shelf_width_km,
        swell_from_deg=swell_from_deg,
        shore_normal_deg=g.shore_normal_deg,
        magnet_factor=g.magnet_factor,
        break_depth_m=g.break_depth_m,
        water_level_m=water_level_m,
    )
