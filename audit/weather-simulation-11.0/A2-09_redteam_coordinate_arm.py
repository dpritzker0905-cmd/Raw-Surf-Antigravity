"""RED-TEAM ARM 2 for A2-09: how much of the band/glyph gap is the COORDINATE alone?

The sweep reported the band at the NEAREST cell whose `speed` exceeded 0.001, which sat
0.10-0.12 deg from the spot at close zoom. Here the COMPOSITION is held fixed (band lane
everywhere) and only the COORDINATE moves, over the same 0.25 deg native GFS-wave lattice
the close-zoom tier serves. Whatever spread this produces is attributable to coordinate alone.

Also censuses what the sweep's `speed > 0.001` selector would actually have picked, since
rating_transform_grid leaves `speed` in METRES on masked and unrated cells while rated cells
carry score/10 -- both in the same array.
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", "..", "backend"))

from services.weather_pipeline.bathymetry import (
    shelf_depth_at, is_coastal, shelf_width_km, shore_normal_at)
from services.weather_pipeline.surf_transform import estimate_surf
from services.weather_pipeline.surf_rating import compute_surf_rating

SPOTS = [
    ("Pipeline", 21.6650, -158.0533),
    ("Sebastian Inlet", 27.8608, -80.4464),
    ("Mavericks", 37.4956, -122.5011),
]
HS, TP, SWELL_FROM = 1.55, 12.0, 315.0
WIND_MS, WIND_FROM = 3.0, 45.0
STEP = 0.25          # GFS marine wave native cell -- the close-zoom tier in the sweep


def band_cell(lat, lng):
    """Exactly what rating_transform_grid does to one grid cell (surf_rating.py:706-795)."""
    if not bool(is_coastal(lat, lng)):
        return ("MASKED", HS)            # speed left in METRES, is_valid=False
    depth = shelf_depth_at(lat, lng)
    width = shelf_width_km(lat, lng) or 0.0
    sn = shore_normal_at(lat, lng)
    surf, regime = estimate_surf(HS, TP, depth, coastal=True, shelf_width_km=width)
    if surf is None or regime in ("open_ocean", "calm", "unknown"):
        return ("UNRATED:" + regime, HS)  # speed left in METRES, is_valid stays TRUE
    score, level = compute_surf_rating(surf, TP, WIND_MS, WIND_FROM, sn, SWELL_FROM)
    if score is None or score <= 0:
        return ("UNRATED:zero", HS)
    return ("RATED:" + level, round(float(score) / 10.0, 4))


def main():
    print("=" * 96)
    print("ARM 2: COMPOSITION HELD FIXED (band lane), COORDINATE VARIED over the 0.25 deg tier")
    print("  Hs=%.2f Tp=%.1f swell_from=%.0f wind=%.1f/%.0f  -- identical at every cell"
          % (HS, TP, SWELL_FROM, WIND_MS, WIND_FROM))
    print("  `speed` column is the RAW served field. The sweep multiplied it by 10 and called")
    print("  it a score, without ever reading is_valid or the per-cell status.")
    print("=" * 96)
    for name, lat, lng in SPOTS:
        print("\n%s (%.4f, %.4f)" % (name, lat, lng))
        rated_scores = []
        rows = []
        for di in (-1, 0, 1):
            for dj in (-1, 0, 1):
                cl, cg = lat + di * STEP, lng + dj * STEP
                status, speed = band_cell(cl, cg)
                d = ((cl - lat) ** 2 + (cg - lng) ** 2) ** 0.5
                rows.append((d, cl, cg, status, speed))
                if status.startswith("RATED"):
                    rated_scores.append(speed * 10.0)
        rows.sort()
        for d, cl, cg, status, speed in rows:
            asif = speed * 10.0
            print("   d=%.3f deg (%8.4f,%9.4f)  %-18s speed=%.4f  sweep would report %.1f"
                  % (d, cl, cg, status, speed, asif))
        if rated_scores:
            print("   -> RATED cells only: min %.1f  max %.1f  spread %.2fx"
                  % (min(rated_scores), max(rated_scores),
                     (max(rated_scores) / min(rated_scores)) if min(rated_scores) else float("nan")))
        nonrated = [r for r in rows if not r[3].startswith("RATED")]
        print("   -> %d of %d neighbourhood cells are NOT rated; every one still serves speed>0.001"
              % (len(nonrated), len(rows)))
        print("      and so is eligible for the sweep's `speed > 0.001` nearest-cell selector.")


if __name__ == "__main__":
    main()
