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
    shore_normal_src: str              # 'coarse' | 'etopo' | 'override:<name>' | 'none'
    magnet_factor: float
    magnet_name: Optional[str]
    break_depth_m: Optional[float]     # ETOPO nearshore depth — the BREAKING CAP only
    nearshore: Optional[bool]          # land within ~1 cell (display gate)


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
    normal, src = None, "none"
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
        from services.weather_pipeline.shore_normal_asset import shore_normal_at as _asset_normal_at
        _fine, _spread = _asset_normal_at(lat, lng)
        if _fine is not None:
            normal, src = _fine, "etopo"
            logger.debug(f"[Surf] ETOPO shore normal {_fine} deg (spread {_spread} deg) at ({lat},{lng})")
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

    return SurfGeometry(depth_m=depth, shelf_width_km=width, coastal=coastal,
                        shore_normal_deg=normal, shore_normal_src=src,
                        magnet_factor=magnet, magnet_name=magnet_name,
                        break_depth_m=break_depth, nearshore=nearshore)


def estimate_surf_at(lat: float, lng: float, Hs_m, Tp_s, swell_from_deg=None,
                     geometry: Optional[SurfGeometry] = None):
    """Breaking surf height (m) + regime at a coordinate, from offshore Hs/Tp/direction.

    The full production chain. Pass a pre-resolved ``geometry`` to avoid repeating the lookups when
    simulating many scenarios at one spot. Returns ``(surf_height_m|None, regime)``."""
    from services.weather_pipeline.surf_transform import estimate_surf
    g = geometry if geometry is not None else resolve_surf_geometry(lat, lng)
    return estimate_surf(
        Hs_m, Tp_s, g.depth_m,
        coastal=g.coastal,
        shelf_width_km=g.shelf_width_km,
        swell_from_deg=swell_from_deg,
        shore_normal_deg=g.shore_normal_deg,
        magnet_factor=g.magnet_factor,
        break_depth_m=g.break_depth_m,
    )
