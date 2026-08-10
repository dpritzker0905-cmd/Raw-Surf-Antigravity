"""RED-TEAM CONTROL for finding A2-09 (queue E#1).

The original sweep (backend/scripts/band_glyph_lane_sweep.py) compared the band at the
NEAREST RATED CELL (0.10-0.12 deg away) against the glyph AT THE SPOT. That conflates
two variables: (1) the COORDINATE, (2) the COMPOSITION.

This script holds the COORDINATE fixed and varies ONLY the composition, so whatever it
shows is attributable to composition alone. Read-only, offline (bundled bathymetry).

LANE A  = the band's composition, transcribed from surf_rating.rating_transform_grid:738/768
LANE B  = the glyph's composition, transcribed from surf_point.estimate_surf_at + spot_ratings
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from services.weather_pipeline.bathymetry import (
    shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at)
from services.weather_pipeline.shore_normal_asset import break_depth_at
from services.weather_pipeline.surf_transform import estimate_surf
from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
from services.weather_pipeline.surf_rating import compute_surf_rating

SPOTS = [
    ("Pipeline", 21.6650, -158.0533),
    ("Sebastian Inlet", 27.8608, -80.4464),
    ("Mavericks", 37.4956, -122.5011),
]

# One sea state, held constant. Wind held constant and IDENTICAL in both lanes so that
# the per-cell-wind term (the author's other candidate) is forced to zero.
HS, TP, SWELL_FROM = 1.55, 12.0, 315.0
WIND_MS, WIND_FROM = 3.0, 45.0


def band_lane(lat, lng, ref):
    """Transcribed from rating_transform_grid: estimate_surf gets ONLY (Hs, Tp, shelf depth,
    coastal, shelf_width). No swell_from_deg, no shore_normal_deg, no break_depth_m."""
    depth = shelf_depth_at(lat, lng)
    width = shelf_width_km(lat, lng) or 0.0
    sn = shore_normal_at(lat, lng)
    surf, regime = estimate_surf(HS, TP, depth, coastal=True, shelf_width_km=width)
    score, level = compute_surf_rating(surf, TP, WIND_MS, WIND_FROM, sn, SWELL_FROM,
                                       reference_size_m=ref)
    return surf, regime, score, level, depth, width, sn


def glyph_lane(lat, lng, ref):
    """Transcribed from estimate_surf_at + rate_one_spot: full geometry + break_depth_m."""
    g = resolve_surf_geometry(lat, lng)
    surf, regime = estimate_surf_at(lat, lng, HS, TP, SWELL_FROM, geometry=g)
    bd = break_depth_at(lat, lng)
    score, level = compute_surf_rating(surf, TP, WIND_MS, WIND_FROM, g.shore_normal_deg,
                                       SWELL_FROM, reference_size_m=ref, break_depth_m=bd)
    return surf, regime, score, level, g, bd


def run(tag):
    print("=" * 92)
    print("ARM: " + tag)
    print("  Hs=%.2f m  Tp=%.1f s  swell_from=%.0f  wind=%.1f m/s from %.0f (IDENTICAL both lanes)"
          % (HS, TP, SWELL_FROM, WIND_MS, WIND_FROM))
    print("=" * 92)
    for name, lat, lng in SPOTS:
        b_surf, b_reg, b_score, b_lvl, b_depth, b_width, b_sn = band_lane(lat, lng, None)
        g_surf, g_reg, g_score, g_lvl, g, g_bd = glyph_lane(lat, lng, None)
        print("\n%s  (%.4f, %.4f)  SAME COORDINATE" % (name, lat, lng))
        print("  geometry: shelf_depth=%s m  shelf_width=%s km  shore_normal(coarse)=%s  "
              "shore_normal(resolved)=%s  break_depth=%s m"
              % (fmt(b_depth), fmt(b_width), fmt(b_sn), fmt(g.shore_normal_deg), fmt(g_bd)))
        print("  BAND  height=%s m  regime=%-9s  score=%s  level=%s"
              % (fmt(b_surf), b_reg, fmt(b_score), b_lvl))
        print("  GLYPH height=%s m  regime=%-9s  score=%s  level=%s"
              % (fmt(g_surf), g_reg, fmt(g_score), g_lvl))
        if g_surf and b_surf:
            print("  RATIO height band/glyph = %.3fx" % (b_surf / g_surf))
        if g_score and b_score:
            print("  RATIO score  band/glyph = %.3fx   (band - glyph = %+.1f pts)"
                  % (b_score / g_score, b_score - g_score))


def fmt(x):
    if x is None:
        return "None"
    if isinstance(x, float):
        return "%.4f" % x
    return str(x)


def ablate():
    """Which DROPPED ARGUMENT carries the height gap? Add them back one at a time."""
    print()
    print("=" * 92)
    print("ABLATION: start from the BAND call, add back one dropped argument at a time")
    print("=" * 92)
    for name, lat, lng in SPOTS:
        g = resolve_surf_geometry(lat, lng)
        depth = shelf_depth_at(lat, lng)
        width = shelf_width_km(lat, lng) or 0.0
        base, _ = estimate_surf(HS, TP, depth, coastal=True, shelf_width_km=width)
        variants = [
            ("band as-coded                 ", dict()),
            ("+ swell_from & shore_normal   ", dict(swell_from_deg=SWELL_FROM,
                                                    shore_normal_deg=g.shore_normal_deg)),
            ("+ break_depth_m               ", dict(break_depth_m=g.break_depth_m)),
            ("+ magnet_factor               ", dict(magnet_factor=g.magnet_factor)),
            ("ALL THREE (= glyph)           ", dict(swell_from_deg=SWELL_FROM,
                                                    shore_normal_deg=g.shore_normal_deg,
                                                    break_depth_m=g.break_depth_m,
                                                    magnet_factor=g.magnet_factor)),
        ]
        print("\n%s" % name)
        for label, kw in variants:
            h, reg = estimate_surf(HS, TP, depth, coastal=True, shelf_width_km=width, **kw)
            ratio = (base / h) if h else float("nan")
            print("   %s h=%s m  regime=%-9s  band/this=%.3fx" % (label, fmt(h), reg, ratio))


if __name__ == "__main__":
    run("production defaults, reference_size_m=None in BOTH lanes (isolates composition)")
    ablate()
