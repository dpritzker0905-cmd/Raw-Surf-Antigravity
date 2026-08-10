"""AGENT G RED TEAM -- E1-01 denominator test.

The E1-01 probe measured band-vs-point divergence AT SIX CATALOGUE SPOT COORDINATES.
Those are exactly the coordinates where the ETOPO shore-normal asset has an entry, so
resolve_surf_geometry can return a FINE normal + a break_depth. The band, however, never
runs at a spot coordinate: it runs on MARINE GRID CELLS, whose resolution FLOORS AT 0.25 deg
(route_helpers.choose_adaptive_resolution:124-125), i.e. ~28 km spacing, while
shore_normal_asset.MATCH_RADIUS_KM = 1.0 (break depth) and BEARING_RADIUS_KM = 3.0 (bearing).

So the question the finding did not ask: over the population of cells the band actually
rates, HOW OFTEN does the mandated chain supply anything the band lacks?

READ-ONLY. Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe <this file>
"""
import math

from services.weather_pipeline import surf_point, surf_rating as SR
from services.weather_pipeline.bathymetry import (is_coastal, shelf_depth_at, shelf_width_km,
                                                  shore_normal_at)
from services.weather_pipeline.surf_transform import estimate_surf

FT = 3.28084

# Close-zoom viewports centred on the six probe spots (about +/- 1.5 deg, a realistic
# close-zoom bbox), sampled on the 0.25 deg lattice the marine grid actually uses.
REGIONS = [
    ("Oahu",        21.665,  -158.053),
    ("NorCal",      37.4952, -122.5028),
    ("SoCal",       33.3830, -117.5890),
    ("FloridaE",    28.3200,  -80.6076),
    ("SouthAfrica", -34.049,   24.919),
    ("Portugal",    39.6050,   -9.0850),
]
HALF_DEG = 1.5
RES = 0.25

SEAS = [(1.5, 14.0, 0.0), (1.5, 14.0, 60.0), (3.0, 16.0, 0.0), (6.0, 16.0, 0.0)]
WIND_MS, WIND_FROM_OFFSET = 4.0, 180.0


def snap(x, res):
    return round(round(x / res) * res, 6)


def band_arm(lat, lng, hs, tp, swell_from, wind_ms, wind_from):
    depth = shelf_depth_at(lat, lng)
    width = shelf_width_km(lat, lng) or 0.0
    surf, regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    if surf is None or regime in ("open_ocean", "calm", "unknown"):
        return None, None, regime
    sn = shore_normal_at(lat, lng)
    score, _ = SR.compute_surf_rating(surf, tp, wind_ms, wind_from, sn, swell_from,
                                      reference_size_m=None)
    return surf, score, regime


def point_arm(lat, lng, hs, tp, swell_from, wind_ms, wind_from, geo):
    surf, regime = surf_point.estimate_surf_at(lat, lng, hs, tp, swell_from_deg=swell_from,
                                               geometry=geo)
    if surf is None:
        return None, None, regime
    score, _ = SR.compute_surf_rating(surf, tp, wind_ms, wind_from_deg=wind_from,
                                      shore_normal_deg=geo.shore_normal_deg,
                                      swell_from_deg=swell_from, reference_size_m=None,
                                      break_depth_m=geo.break_depth_m)
    return surf, score, regime


def main():
    print("== G/E1-01 DENOMINATOR: band vs point over the 0.25 deg CELL lattice ==")
    print("res=%.2f deg   half-window=%.1f deg   n_regions=%d" % (RES, HALF_DEG, len(REGIONS)))
    print()

    cells = []
    for _rname, clat, clng in REGIONS:
        la = snap(clat - HALF_DEG, RES)
        while la <= clat + HALF_DEG + 1e-9:
            ln = snap(clng - HALF_DEG, RES)
            while ln <= clng + HALF_DEG + 1e-9:
                cells.append((_rname, round(la, 4), round(ln, 4)))
                ln = round(ln + RES, 6)
            la = round(la + RES, 6)

    n_all = len(cells)
    coastal_cells = []
    for rname, la, ln in cells:
        try:
            if bool(is_coastal(la, ln)):
                coastal_cells.append((rname, la, ln))
        except Exception:
            pass
    print("lattice cells: %d   coastal (band would RATE these): %d" % (n_all, len(coastal_cells)))

    # --- Geometry provenance over the RATED cell population ---
    n_fine = n_bd = n_magnet = 0
    src_counts = {}
    geos = {}
    for rname, la, ln in coastal_cells:
        g = surf_point.resolve_surf_geometry(la, ln)
        geos[(la, ln)] = g
        src_counts[g.shore_normal_src] = src_counts.get(g.shore_normal_src, 0) + 1
        if g.shore_normal_src not in ("coarse", "none"):
            n_fine += 1
        if g.break_depth_m is not None:
            n_bd += 1
        if g.magnet_factor and g.magnet_factor != 1.0:
            n_magnet += 1
    nrc = len(coastal_cells) or 1
    print()
    print("GEOMETRY THE MANDATED CHAIN WOULD ADD, over the RATED cells:")
    print("  shore_normal_src histogram: %s" % src_counts)
    print("  non-coarse normal : %d/%d = %.2f%%" % (n_fine, nrc, 100.0 * n_fine / nrc))
    print("  break_depth_m     : %d/%d = %.2f%%" % (n_bd, nrc, 100.0 * n_bd / nrc))
    print("  magnet_factor != 1: %d/%d = %.2f%%" % (n_magnet, nrc, 100.0 * n_magnet / nrc))

    # --- Actual band vs point divergence over the RATED cell population ---
    print()
    print("BAND vs POINT over the RATED cells x %d sea states:" % len(SEAS))
    n_pairs = 0
    n_h_diff = n_q_diff = 0
    worst_ratio = 1.0
    worst_dq = 0.0
    worst_ratio_at = worst_dq_at = None
    dq_hist = {"0": 0, "<=1": 0, "<=5": 0, "<=20": 0, ">20": 0}
    for rname, la, ln in coastal_cells:
        g = geos[(la, ln)]
        sn = g.shore_normal_deg if g.shore_normal_deg is not None else 270.0
        for hs, tp, doff in SEAS:
            sd = (sn + doff) % 360.0
            wf = (sn + WIND_FROM_OFFSET) % 360.0
            bh, bq, _ = band_arm(la, ln, hs, tp, sd, WIND_MS, wf)
            ph, pq, _ = point_arm(la, ln, hs, tp, sd, WIND_MS, wf, g)
            if bh is None or ph is None or not ph:
                continue
            n_pairs += 1
            r = bh / ph
            dq = abs((bq or 0) - (pq or 0))
            if abs(r - 1.0) > 1e-9:
                n_h_diff += 1
            if dq > 1e-9:
                n_q_diff += 1
            if r > worst_ratio:
                worst_ratio, worst_ratio_at = r, (rname, la, ln, hs, tp, doff, bh * FT, ph * FT)
            if dq > worst_dq:
                worst_dq, worst_dq_at = dq, (rname, la, ln, hs, tp, doff, bq, pq)
            if dq == 0:
                dq_hist["0"] += 1
            elif dq <= 1:
                dq_hist["<=1"] += 1
            elif dq <= 5:
                dq_hist["<=5"] += 1
            elif dq <= 20:
                dq_hist["<=20"] += 1
            else:
                dq_hist[">20"] += 1
    npp = n_pairs or 1
    print("  comparable (cell, sea) pairs: %d" % n_pairs)
    print("  height differs at all : %d/%d = %.2f%%" % (n_h_diff, npp, 100.0 * n_h_diff / npp))
    print("  rating differs at all : %d/%d = %.2f%%" % (n_q_diff, npp, 100.0 * n_q_diff / npp))
    print("  |dQ| histogram: %s" % dq_hist)
    print("  worst height ratio: %.3f at %s" % (worst_ratio, worst_ratio_at))
    print("  worst |dQ|        : %.1f at %s" % (worst_dq, worst_dq_at))

    # --- How close is the nearest lattice cell to each probe spot? ---
    print()
    print("DISTANCE from each E1 probe SPOT to the nearest 0.25 deg lattice cell:")
    for name, la, ln in [("Pipeline", 21.665, -158.053), ("Mavericks", 37.4952, -122.5028),
                         ("Trestles", 33.3830, -117.5890), ("CocoaBeach", 28.3200, -80.6076),
                         ("JeffreysBay", -34.049, 24.919), ("Nazare", 39.6050, -9.0850)]:
        cla, cln = snap(la, RES), snap(ln, RES)
        dkm = math.hypot((cla - la) * 111.32, (cln - ln) * 111.32 * math.cos(math.radians(la)))
        print("  %-12s spot(%.4f,%.4f) -> cell(%.2f,%.2f)  %.2f km   "
              "(bearing radius 3.0 km, depth radius 1.0 km)" % (name, la, ln, cla, cln, dkm))


if __name__ == "__main__":
    main()
