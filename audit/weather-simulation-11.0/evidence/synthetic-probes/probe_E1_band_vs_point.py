"""E1 probe 2: the MAP RATING BAND composition vs the ONE FORECAST COMPOSITION, at the
SAME coordinate (so the per-cell sampling term is held out and only the COMPOSITION differs).

Band path, verbatim from grid_resolver_surf.apply_surf_overlay ->
  surf_rating.rating_transform_grid(vectors, shelf_depth_at, is_coastal, shelf_width_km,
                                    wind_fn, shore_normal_at, ...)
which internally calls:
  estimate_surf(sp, period, depth_fn(lat,lng), coastal=True, shelf_width_km=width_fn(lat,lng))
  compute_surf_rating(surf, period, wind_speed, wind_from, shore_normal, swell_from,
                      reference_size_m=reference)
i.e. NO swell_from_deg / shore_normal_deg / break_depth_m / magnet_factor on the HEIGHT.

Point path (the mandated chain):
  resolve_surf_geometry -> estimate_surf_at -> compute_surf_rating(..., break_depth_m=...)

READ-ONLY. Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe \
    C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes/probe_E1_band_vs_point.py
"""
from services.weather_pipeline import surf_point, surf_rating as SR
from services.weather_pipeline.bathymetry import (is_coastal, shelf_depth_at, shelf_width_km,
                                                  shore_normal_at)
from services.weather_pipeline.surf_transform import estimate_surf

FT = 3.28084

SPOTS = [
    ("Pipeline",    21.665,  -158.053),
    ("Mavericks",   37.4952, -122.5028),
    ("Trestles",    33.3830, -117.5890),
    ("CocoaBeach",  28.3200,  -80.6076),
    ("JeffreysBay", -34.049,   24.919),
    ("Nazare",      39.6050,   -9.0850),
]

# (Hs offshore m, Tp s, swell FROM deg offset from the spot's own shore normal)
SEAS = [(1.5, 14.0, 0.0), (1.5, 14.0, 60.0), (1.5, 14.0, 120.0),
        (3.0, 16.0, 0.0), (3.0, 16.0, 60.0), (6.0, 16.0, 0.0)]

WIND_MS, WIND_FROM_OFFSET = 4.0, 180.0   # light offshore, same for both arms


def band_arm(lat, lng, hs, tp, swell_from, wind_ms, wind_from):
    """EXACTLY what rating_transform_grid does per cell."""
    coastal = bool(is_coastal(lat, lng))
    if not coastal:
        return None, None, "masked"
    depth = shelf_depth_at(lat, lng)
    width = shelf_width_km(lat, lng) or 0.0
    surf, regime = estimate_surf(hs, tp, depth, coastal=True, shelf_width_km=width)
    if surf is None or regime in ("open_ocean", "calm", "unknown"):
        return None, None, regime
    sn = shore_normal_at(lat, lng)
    score, _lvl = SR.compute_surf_rating(surf, tp, wind_ms, wind_from, sn, swell_from,
                                         reference_size_m=None)
    return surf, score, regime


def point_arm(lat, lng, hs, tp, swell_from, wind_ms, wind_from, geo):
    surf, regime = surf_point.estimate_surf_at(lat, lng, hs, tp, swell_from_deg=swell_from,
                                               geometry=geo)
    if surf is None:
        return None, None, regime
    score, _lvl = SR.compute_surf_rating(surf, tp, wind_ms,
                                         wind_from_deg=wind_from,
                                         shore_normal_deg=geo.shore_normal_deg,
                                         swell_from_deg=swell_from,
                                         reference_size_m=None,
                                         break_depth_m=geo.break_depth_m)
    return surf, score, regime


def main():
    print("BAND (rating_transform_grid) vs POINT (ONE FORECAST COMPOSITION), same coordinate")
    print("band height omits: swell_from_deg, shore_normal_deg, break_depth_m, magnet_factor")
    print()
    hdr = ("{:<12} {:>5} {:>5} {:>6} {:>9} {:>9} {:>7} {:>8} {:>8} {:>7}"
           .format("spot", "Hs", "Tp", "d_off", "bandFt", "pointFt", "ratio",
                   "bandQ", "pointQ", "dQ"))
    print(hdr)
    worst_h, worst_q = 0.0, 0.0
    for name, la, ln in SPOTS:
        geo = surf_point.resolve_surf_geometry(la, ln)
        sn = geo.shore_normal_deg if geo.shore_normal_deg is not None else 270.0
        for hs, tp, doff in SEAS:
            sd = (sn + doff) % 360.0
            wf = (sn + WIND_FROM_OFFSET) % 360.0
            bh, bq, breg = band_arm(la, ln, hs, tp, sd, WIND_MS, wf)
            ph, pq, preg = point_arm(la, ln, hs, tp, sd, WIND_MS, wf, geo)
            if bh is None or ph is None:
                print("{:<12} {:>5} {:>5} {:>6} band={} point={}".format(
                    name, hs, tp, doff, breg, preg))
                continue
            ratio = bh / ph if ph else float("nan")
            worst_h = max(worst_h, ratio)
            worst_q = max(worst_q, abs(bq - pq))
            print("{:<12} {:>5} {:>5} {:>6} {:>9.2f} {:>9.2f} {:>7.3f} {:>8.1f} {:>8.1f} {:>7.1f}"
                  .format(name, hs, tp, doff, bh * FT, ph * FT, ratio, bq, pq, bq - pq))
    print()
    print("MAX band/point height ratio: %.3f    MAX |band-point| rating points: %.1f"
          % (worst_h, worst_q))
    print()

    # Isolate WHICH omitted argument carries the difference, at one spot.
    print("== TERM ISOLATION at Pipeline, Hs=3.0 Tp=16.0, swell 60 deg off normal ==")
    la, ln = 21.665, -158.053
    geo = surf_point.resolve_surf_geometry(la, ln)
    sd = (geo.shore_normal_deg + 60.0) % 360.0
    d_shelf = shelf_depth_at(la, ln)
    w = shelf_width_km(la, ln) or 0.0
    combos = [
        ("band  (no dir, no break_depth)", dict()),
        ("+ direction only", dict(swell_from_deg=sd, shore_normal_deg=geo.shore_normal_deg)),
        ("+ break_depth only", dict(break_depth_m=geo.break_depth_m)),
        ("+ both (== point path)", dict(swell_from_deg=sd, shore_normal_deg=geo.shore_normal_deg,
                                        break_depth_m=geo.break_depth_m)),
    ]
    for label, kw in combos:
        h, reg = estimate_surf(3.0, 16.0, d_shelf, coastal=True, shelf_width_km=w, **kw)
        print("  %-32s %8.2f ft  regime=%s" % (label, h * FT, reg))
    print("  shelf_depth_m=%.1f  break_depth_m=%s  shelf_width_km=%.1f  shore_normal=%.1f"
          % (d_shelf, geo.break_depth_m, w, geo.shore_normal_deg))


if __name__ == "__main__":
    main()
