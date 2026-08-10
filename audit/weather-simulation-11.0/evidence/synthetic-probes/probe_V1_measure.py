"""V1 Q5/Q6 -- independent re-measurement of the band-vs-glyph pin and the breaker_xi waiver.

Run from backend/. ASCII output only.
"""
import inspect
import os
import sys

sys.path.insert(0, ".")

from services.weather_pipeline.surf_rating import compute_surf_rating, breaker_type_quality
from services.weather_pipeline.shore_normal_asset import break_depth_at
from services.weather_pipeline import bathymetry
from services.weather_pipeline.surf_transform import iribarren

SPOTS = [("Mavericks", 37.4915, -122.5083, 225.1),
         ("Lower Trestles", 33.3819, -117.5885, 219.0),
         ("Pipeline", 21.6637, -158.0515, 308.1),
         ("Cocoa Beach Pier", 28.3676, -80.6012, 99.1)]
HS = (0.4, 0.8, 1.5, 2.5, 4.0, 6.0)
TPS = (6.0, 9.0, 12.0, 16.0, 20.0)

print("=== Q5: band vs glyph, n = %d x %d x %d = %d ===" % (len(SPOTS), len(HS), len(TPS),
                                                            len(SPOTS) * len(HS) * len(TPS)))
print("env RATING_LOCAL_SIZE=%r RATING_TIDE=%r RATING_BREAKER_TYPE=%r SURF_PARTITIONS=%r" % (
    os.environ.get("RATING_LOCAL_SIZE"), os.environ.get("RATING_TIDE"),
    os.environ.get("RATING_BREAKER_TYPE"), os.environ.get("SURF_PARTITIONS")))
total = nonzero = level_differs = 0
worst = 0.0
worst_case = None
deltas = []
for name, lat, lng, normal in SPOTS:
    bd = break_depth_at(lat, lng)
    s_nz = s_lvl = 0
    s_worst = 0.0
    s_case = None
    for h in HS:
        for tp in TPS:
            glyph = compute_surf_rating(h, tp, 4.0, normal, normal, normal,
                                        None, None, None, None, break_depth_m=bd)
            band = compute_surf_rating(h, tp, 4.0, normal, normal, normal,
                                       reference_size_m=None)
            d = band[0] - glyph[0]
            deltas.append(d)
            total += 1
            if abs(d) > 1e-9:
                nonzero += 1
                s_nz += 1
            if band[1] != glyph[1]:
                level_differs += 1
                s_lvl += 1
            if abs(d) > s_worst:
                s_worst = abs(d)
                s_case = (h, tp, glyph, band, d)
            if abs(d) > worst:
                worst = abs(d)
                worst_case = (name, h, tp, glyph, band, d)
    print("  %-18s break_depth=%-8s nonzero %2d/30  level %2d/30  max |d| %6.2f  %s" % (
        name, ("%.2f" % bd) if bd is not None else "None", s_nz, s_lvl, s_worst,
        ("at %.1f m / %.1f s: glyph %.1f %s vs band %.1f %s (d=%+.2f)" %
         (s_case[0], s_case[1], s_case[2][0], s_case[2][1], s_case[3][0], s_case[3][1], s_case[4]))
        if s_case else ""))
sd = sorted(deltas)
median = sd[len(sd) // 2] if len(sd) % 2 else (sd[len(sd) // 2 - 1] + sd[len(sd) // 2]) / 2.0
print("  ALL: median %+0.2f, nonzero %d/%d, LEVEL differs %d/%d (%.1f%%)" % (
    median, nonzero, total, level_differs, total, 100.0 * level_differs / total))
print("  WORST: %s %.1f m / %.1f s -> glyph %.1f %s vs band %.1f %s  delta %+0.2f" % (
    worst_case[0], worst_case[1], worst_case[2], worst_case[3][0], worst_case[3][1],
    worst_case[4][0], worst_case[4][1], worst_case[5]))
print("  MAX |delta| = %.2f   in (20,45)? %s   commit claims 32.50 -> MATCH: %s" % (
    worst, 20.0 < worst < 45.0, abs(worst - 32.50) < 0.005))
print("  min delta %+0.2f  max delta %+0.2f  (any NEGATIVE, i.e. band reads LOW? %s)" % (
    min(deltas), max(deltas), any(d < -1e-9 for d in deltas)))
print()

print("=== Q6: breaker_xi waiver, executed ===")
print("  slope_available() =", bathymetry.slope_available())
WSPOTS = [("Teahupo'o", -17.8483, -149.2667), ("Nazare", 39.6053, -9.0806),
          ("Trestles", 33.3819, -117.5885), ("Pipeline", 21.6637, -158.0515),
          ("J-Bay", -34.0507, 24.9307), ("Hossegor", 43.6647, -1.4437),
          ("Mavericks", 37.4915, -122.5083), ("Cocoa Beach", 28.3676, -80.6012)]
answered = 0
qs = []
for nm, la, ln in WSPOTS:
    s = bathymetry.bed_slope_at(la, ln)
    if s is not None:
        answered += 1
    xi = iribarren(s, 2.0, 12.0)
    q = breaker_type_quality(xi)
    qs.append(q)
    print("  %-12s slope=%-10s xi=%-10s q=%.4f" % (
        nm, ("%.4f" % s) if s is not None else "None",
        ("%.4f" % xi) if xi is not None else "None", q))
print("  answered %d/8 ; q span %.4f-%.4f ; NON-neutral (q<1.0) at %d of 8" % (
    answered, min(qs), max(qs), sum(1 for q in qs if q < 1.0 - 1e-12)))
print("  waiver-claimed span 0.854-1.000 -> min matches 0.854? %s" % (abs(min(qs) - 0.854) < 0.0005))
print("  cost if flipped: 1 - min(q) = %.1f%%" % (100.0 * (1.0 - min(qs))))
