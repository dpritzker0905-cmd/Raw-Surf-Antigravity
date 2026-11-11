"""band_chain.py - the map rating BAND's breaking height through the one chain (Fable audit CMP-1, 2026-11-10).

`surf_rating.rating_transform_grid` computed each coastal cell's breaking height with bare `surf_transform.estimate_surf`:
no swell-angle exposure, no break-depth cap, no sub-grid magnet, and it rated without `break_depth_m`. That is a second
height path (ONE FORECAST COMPOSITION). Measured by the audit (probe_band.py, 12 s, 4 kt, same shore normal):
  Cocoa Hs 6 m head-on, ref 1.5 m: glyph 4.78 m 83.0 good   vs band 7.69 m 45.2 fair  (-37.8 points)
  Jeffreys Bay 3 m, ref 1.5 m:     glyph 63.5 fair_good     vs band 83.0 good        (+19.5)
  height ratio band/point at 2 m / 13 s: 1.25 at 60 deg off-normal (no exposure) at 6 of 7 spots.

THE FIX. Per cell, resolve the production geometry ONCE (`surf_point.resolve_surf_geometry`, cached per rounded cell
here, so a viewport's cells and every later frame on the same lattice reuse it: the correction is arithmetic, the
lookups are the cost) and take the height from `surf_point.estimate_surf_at` with the cell's own swell bearing. The
rating then gets the geometry's `break_depth_m` (the nearshore break depth, the quantity the oversize gate is written
for; the shelf depth the old comment rightly refused to pass is a different number).

NOT included, and named: the hour's tide and the MOP nearshore sea (CMP-2's per-hour inputs). They are per-coordinate
I/O; a frame is thousands of cells. The band is the glyph's chain at eta = 0, parametric. The glyph keeps both.

Flag RATING_BAND_ONE_CHAIN (GUARDED, code default ON, D-065); '0' is the bare-estimate band, byte for byte.
"""
import logging
import os
from functools import lru_cache
from typing import Optional, Tuple

from services import runtime_flags as _rf

logger = logging.getLogger(__name__)

FLAG = "RATING_BAND_ONE_CHAIN"
CODE_DEFAULT = "1"


def enabled() -> bool:
    """Read once per grid transform, not per cell. Also re-checks the flag state the cached geometry was built under."""
    sync_flag_state()
    try:
        return _rf.flag(FLAG) == "1"
    except Exception:
        return CODE_DEFAULT == "1"


# The geometry reads flags (SHORE_NORMAL_ASSET, SURF_COASTAL_FROM_LAND_BIT, SURF_V3_NORMAL_OVERRIDES, the guarded flags via the
# runtime manifest, ...). A process-lifetime cache keyed on (lat, lng) alone would keep the OLD normals and depths after a
# runtime kill or flip (the live guardrail's auto-disable included) while the glyph follows at once: band != glyph and an
# incomplete kill (verifier, #776 review). So the cache is valid for ONE flag state: every guarded flag's effective value
# (env > manifest > default) plus every env value under the chain's prefixes, read once per transform.
_ENV_PREFIXES = ("SURF_", "SHORE_NORMAL_", "RATING_", "COPERNICUS_", "POINT_RES_")
_built_under = {"state": None}


def flag_state():
    guarded = tuple((n, _rf.flag(n)) for n in sorted(_rf.GUARDED))
    env = tuple(sorted((k, v) for k, v in os.environ.items() if k.startswith(_ENV_PREFIXES)))
    return guarded, env


def sync_flag_state() -> None:
    """Clear the geometry cache when the flag state differs from the one it was built under. Unreadable state: clear
    (correct, only slower)."""
    try:
        state = flag_state()
    except Exception as e:
        logger.debug(f"[Band Chain] flag state unreadable, clearing the geometry cache: {e}")
        state = None
    if state is None or state != _built_under["state"]:
        _geometry.cache_clear()
        _built_under["state"] = state


@lru_cache(maxsize=200_000)
def _geometry(lat_r: float, lng_r: float):
    from services.weather_pipeline.surf_point import resolve_surf_geometry
    return resolve_surf_geometry(lat_r, lng_r)


def geometry_at(lat, lng):
    """The production geometry for a band cell, cached by the cell's EXACT coordinate (a lattice repeats the same floats
    on every frame, and an exact key keeps the bearing bit-identical to `chain_shore_normal_at`). None if unusable."""
    try:
        return _geometry(float(lat), float(lng))
    except Exception as e:
        logger.debug(f"[Band Chain] geometry unavailable at ({lat},{lng}): {e}")
        return None


def surf_at(lat, lng, hs_m, period_s, swell_from_deg) -> Tuple[Optional[float], str, Optional[float]]:
    """(breaking height m, regime, break_depth_m) for one band cell through `estimate_surf_at`, or (None, 'unknown', None)
    when the geometry or the chain fails (the cell is then left unrated, never given the bare estimate)."""
    geo = geometry_at(lat, lng)
    if geo is None:
        return None, "unknown", None
    try:
        from services.weather_pipeline.surf_point import estimate_surf_at
        # water_level_m=0.0 and no nearshore sea, DECLARED (see the module docstring): per-cell tide/MOP is I/O per cell.
        h, regime = estimate_surf_at(float(lat), float(lng), hs_m, period_s, swell_from_deg=swell_from_deg, geometry=geo,
                                     water_level_m=0.0)
    except Exception as e:
        logger.debug(f"[Band Chain] chain failed at ({lat},{lng}): {e}")
        return None, "unknown", None
    return h, regime, getattr(geo, "break_depth_m", None)


def shore_normal_at(lat, lng):
    """The band's `shore_normal_fn` under the one chain: the cached geometry's bearing, which IS `chain_shore_normal_at`
    (same `_shore_normal_precedence`, pinned by test). Without this the band computed that bearing once for the rating
    and the geometry computed it again for the height: the duplicate lookup is most of the chain's extra cold cost."""
    geo = geometry_at(lat, lng)
    return getattr(geo, "shore_normal_deg", None) if geo is not None else None


def clear_cache() -> None:
    _geometry.cache_clear()
    _built_under["state"] = None
