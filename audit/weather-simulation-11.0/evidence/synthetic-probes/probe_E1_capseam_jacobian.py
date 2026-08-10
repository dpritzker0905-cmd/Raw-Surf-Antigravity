"""E1 probe 4: the H1/10 CAP SEAM (monotonicity + over-ceiling) and finite-difference Jacobians.
READ-ONLY.

Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe \
    C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes/probe_E1_capseam_jacobian.py
"""
import os

from services.weather_pipeline import surf_point, surf_rating as SR
from services.weather_pipeline import surf_height_convention as HC
from services.weather_pipeline.surf_transform import breaker_index

FT = 3.28084
SPOTS = [("Pipeline", 21.665, -158.053), ("Trestles", 33.3830, -117.5890),
         ("CocoaBeach", 28.3200, -80.6076), ("Mavericks", 37.4952, -122.5028)]


def main():
    print("H110 flag enabled() =", HC.enabled(), " factor =", HC.H110_OVER_HS)
    print("SURF_HEIGHT_H110 env =", os.environ.get("SURF_HEIGHT_H110", "(unset -> default 1)"))
    print()

    print("== CAP SEAM: fine Hs sweep, Tp=14 s, swell head-on ==")
    for name, la, ln in SPOTS:
        g = surf_point.resolve_surf_geometry(la, ln)
        sd = g.shore_normal_deg
        gam = breaker_index(14.0, slope=(g.depth_m / (g.shelf_width_km * 1000.0))
                            if g.shelf_width_km else None)
        cap_m = gam * (g.break_depth_m if g.break_depth_m else g.depth_m)
        print("-- %s  break_depth=%s m  gamma(14s)=%.4f  cap=%.3f m (%.2f ft)"
              % (name, g.break_depth_m, gam, cap_m, cap_m * FT))
        prev = None
        peak = 0.0
        peak_hs = None
        drops = []
        hs = 0.5
        rows = []
        while hs <= 20.0001:
            h, reg = surf_point.estimate_surf_at(la, ln, hs, 14.0, swell_from_deg=sd, geometry=g)
            rows.append((hs, h, reg))
            if h > peak:
                peak, peak_hs = h, hs
            if prev is not None and h < prev[1] - 1e-9:
                drops.append((prev[0], prev[1], prev[2], hs, h, reg))
            prev = (hs, h, reg)
            hs = round(hs + 0.25, 4)
        maxft = max(r[1] for r in rows) * FT
        print("     max emitted %.2f ft at Hs=%.2f m ; depth cap %.2f ft ; OVER-CEILING %+.1f%%"
              % (maxft, peak_hs, cap_m * FT, 100.0 * (maxft / (cap_m * FT) - 1.0)))
        if drops:
            f = drops[0]
            print("     NON-MONOTONIC: Hs %.2f -> %.2f m makes the SURF FALL %.2f ft -> %.2f ft "
                  "(%s -> %s), %d descending steps in the sweep"
                  % (f[0], f[3], f[1] * FT, f[4] * FT, f[2], f[5], len(drops)))
        else:
            print("     monotonic over 0.5..20 m")
    print()

    print("== FINITE-DIFFERENCE JACOBIANS at Pipeline (base Hs=1.5 Tp=12 head-on, wind 5 kt) ==")
    la, ln = 21.665, -158.053
    g = surf_point.resolve_surf_geometry(la, ln)
    sn = g.shore_normal_deg
    base = dict(hs=1.5, tp=12.0, sd=sn, wkt=5.0, wd=(sn + 180.0) % 360.0)

    def ev(hs, tp, sd, wkt, wd):
        h, _ = surf_point.estimate_surf_at(la, ln, hs, tp, swell_from_deg=sd, geometry=g)
        q = SR.rating_score(h, tp, wkt * SR.KT_TO_MS, wind_from_deg=wd,
                            shore_normal_deg=sn, swell_from_deg=sd, break_depth_m=g.break_depth_m)
        return h * FT, q

    b_ft, b_q = ev(**base)
    print("   base: %.3f ft, rating %.2f" % (b_ft, b_q))
    for label, key, eps, unit in [("Hs", "hs", 0.05, "m"), ("Tp", "tp", 0.5, "s"),
                                  ("swell_dir", "sd", 5.0, "deg"),
                                  ("wind_speed", "wkt", 1.0, "kt"),
                                  ("wind_dir", "wd", 5.0, "deg")]:
        lo = dict(base); hi = dict(base)
        lo[key] = base[key] - eps
        hi[key] = base[key] + eps
        lo_ft, lo_q = ev(**lo)
        hi_ft, hi_q = ev(**hi)
        print("   d(ft)/d(%s) = %+9.4f ft/%s   d(rating)/d(%s) = %+9.4f pts/%s"
              % (label, (hi_ft - lo_ft) / (2 * eps), unit,
                 label, (hi_q - lo_q) / (2 * eps), unit))
    print()

    print("== ELASTICITY of breaking height wrt offshore Hs (dlnH/dlnHs), Tp=14 head-on ==")
    for name, la2, ln2 in SPOTS:
        g2 = surf_point.resolve_surf_geometry(la2, ln2)
        sd2 = g2.shore_normal_deg
        out = []
        for hs in (0.5, 1.0, 2.0, 4.0, 8.0, 12.0):
            h1, _ = surf_point.estimate_surf_at(la2, ln2, hs * 0.99, 14.0,
                                                swell_from_deg=sd2, geometry=g2)
            h2, _ = surf_point.estimate_surf_at(la2, ln2, hs * 1.01, 14.0,
                                                swell_from_deg=sd2, geometry=g2)
            el = (h2 - h1) / h1 / 0.02 if h1 else float("nan")
            out.append("%.1fm:%.3f" % (hs, el))
        print("   %-11s %s   (Komar exponent is 0.8; 0.0 = capped; 1.0 = untransformed passthrough)"
              % (name, "  ".join(out)))


if __name__ == "__main__":
    main()
