"""RED TEAM G - independent control for finding E1-03. READ-ONLY, computes only.

Discriminating tests:
  T1  Negative control: SURF_HEIGHT_H110=0 -> is the cap respected and the sweep monotonic?
      If YES, the H110 conversion is the cause. If NO, some other term is.
  T2  Alternative cause: is estimate_surf non-monotonic for a reason other than the seam
      (Komar jack_max switch, shelf_dissipation, exposure)? Sweep with H110 off, fine grid.
  T3  Is the probe's recomputed `cap` the SAME number the code uses? The 'breaking' branch
      RETURNS the cap, so the emitted breaking value is the cap by construction. Compare.
  T4  Analytic bound: sup over-ceiling as H -> cap- should be exactly H110_OVER_HS - 1 = 27.0%,
      not the 25.0% a 0.25 m grid happens to sample. Bisect the seam to show it.
  T5  BLAST RADIUS proxy: what fraction of a plausible Hs range lands in the violating band
      H in (cap/1.27, cap] versus below it, per spot.

Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe \
    C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes/redteam_G_E1_03_control.py
"""
import os

FT = 3.28084
SPOTS = [("Pipeline", 21.665, -158.053), ("Trestles", 33.3830, -117.5890),
         ("CocoaBeach", 28.3200, -80.6076), ("Mavericks", 37.4952, -122.5028)]


def sweep(surf_point, la, ln, g, sd, lo=0.5, hi=20.0, step=0.05):
    rows = []
    hs = lo
    while hs <= hi + 1e-9:
        h, reg = surf_point.estimate_surf_at(la, ln, hs, 14.0, swell_from_deg=sd, geometry=g)
        rows.append((round(hs, 4), h, reg))
        hs = round(hs + step, 6)
    return rows


def report(tag, surf_point, breaker_index):
    print("== %s ==" % tag)
    for name, la, ln in SPOTS:
        g = surf_point.resolve_surf_geometry(la, ln)
        sd = g.shore_normal_deg
        slope = (g.depth_m / (g.shelf_width_km * 1000.0)) if g.shelf_width_km else None
        gam = breaker_index(14.0, slope=slope)
        cap_m = gam * (g.break_depth_m if g.break_depth_m else g.depth_m)
        rows = sweep(surf_point, la, ln, g, sd)
        mx = max(r[1] for r in rows)
        brk = [r[1] for r in rows if r[2] == "breaking"]
        drops = [(rows[i - 1], rows[i]) for i in range(1, len(rows))
                 if rows[i][1] < rows[i - 1][1] - 1e-12]
        # T3: the value the code RETURNS on the breaking branch IS the cap.
        emitted_cap = brk[0] if brk else None
        print("  %-11s cap_recomputed=%.4f m  cap_emitted_by_code=%s  match=%s"
              % (name, cap_m,
                 ("%.4f m" % emitted_cap) if emitted_cap is not None else "(never breaks)",
                 "YES" if (emitted_cap is not None and abs(emitted_cap - cap_m) < 1e-6) else
                 ("n/a" if emitted_cap is None else "NO")))
        print("      max emitted %.4f m (%.2f ft) = %.4fx cap ; over-cap samples %d/%d ; "
              "descending steps %d"
              % (mx, mx * FT, mx / cap_m,
                 sum(1 for r in rows if r[1] > cap_m + 1e-9), len(rows), len(drops)))
        if drops:
            a, b = drops[0]
            print("      first fall: Hs %.2f->%.2f m, %.3f->%.3f m (%s->%s), %.1f%%"
                  % (a[0], b[0], a[1], b[1], a[2], b[2], 100.0 * (b[1] / a[1] - 1.0)))
    print()


def main():
    from services.weather_pipeline import surf_point, surf_height_convention as HC
    from services.weather_pipeline.surf_transform import breaker_index

    print("T0 flag state: enabled()=%s  factor=%s  env=%r"
          % (HC.enabled(), HC.H110_OVER_HS, os.environ.get("SURF_HEIGHT_H110", "(unset)")))
    print("    SURF_PARTITIONS=%r  SURF_BREAK_DEPTH=%r  SURF_TIDE_DEPTH=%r  SURF_REFRACTION_KR=%r"
          % (os.environ.get("SURF_PARTITIONS", "(unset->0)"),
             os.environ.get("SURF_BREAK_DEPTH", "(unset->1)"),
             os.environ.get("SURF_TIDE_DEPTH", "(unset->0)"),
             os.environ.get("SURF_REFRACTION_KR", "(unset->default)")))
    print()

    report("T1/T2/T3  BASELINE (H110 default = ON), fine 0.05 m grid",
           surf_point, breaker_index)

    os.environ["SURF_HEIGHT_H110"] = "0"
    print("T1 NEGATIVE CONTROL: SURF_HEIGHT_H110=0 -> enabled()=%s" % HC.enabled())
    report("T1  H110 OFF, same sweep", surf_point, breaker_index)
    del os.environ["SURF_HEIGHT_H110"]

    # T4: analytic sup of the over-ceiling ratio, by bisecting the seam.
    print("T4 SEAM BISECTION (H110 back ON = %s) -- sup over-ceiling should -> 1.27" % HC.enabled())
    for name, la, ln in SPOTS[:3]:
        g = surf_point.resolve_surf_geometry(la, ln)
        sd = g.shore_normal_deg
        slope = (g.depth_m / (g.shelf_width_km * 1000.0)) if g.shelf_width_km else None
        cap_m = breaker_index(14.0, slope=slope) * (g.break_depth_m or g.depth_m)
        lo, hi = 0.5, 30.0
        for _ in range(80):
            mid = 0.5 * (lo + hi)
            _h, reg = surf_point.estimate_surf_at(la, ln, mid, 14.0, swell_from_deg=sd, geometry=g)
            if reg == "breaking":
                hi = mid
            else:
                lo = mid
        h_lo, r_lo = surf_point.estimate_surf_at(la, ln, lo, 14.0, swell_from_deg=sd, geometry=g)
        h_hi, r_hi = surf_point.estimate_surf_at(la, ln, hi, 14.0, swell_from_deg=sd, geometry=g)
        print("   %-11s Hs*=%.9f m | just below: %.4f m (%s) = %.4fx cap | just above: %.4f m (%s)"
              % (name, lo, h_lo, r_lo, h_lo / cap_m, h_hi, r_hi))
        print("               DISCONTINUITY at the seam: %.4f -> %.4f m = %+.2f%%"
              % (h_lo, h_hi, 100.0 * (h_hi / h_lo - 1.0)))
    print()

    # T5: how wide is the violating band in offshore-Hs terms?
    print("T5 VIOLATING BAND WIDTH in offshore Hs (H_pre in (cap/1.27, cap])")
    for name, la, ln in SPOTS[:3]:
        g = surf_point.resolve_surf_geometry(la, ln)
        sd = g.shore_normal_deg
        slope = (g.depth_m / (g.shelf_width_km * 1000.0)) if g.shelf_width_km else None
        cap_m = breaker_index(14.0, slope=slope) * (g.break_depth_m or g.depth_m)
        rows = sweep(surf_point, la, ln, g, sd, 0.5, 30.0, 0.05)
        over = [r[0] for r in rows if r[1] > cap_m + 1e-9]
        if over:
            print("   %-11s offshore Hs producing an OVER-CAP served height: %.2f .. %.2f m "
                  "(%d of %d grid samples in 0.5-30 m)"
                  % (name, min(over), max(over), len(over), len(rows)))
        else:
            print("   %-11s no over-cap samples" % name)


if __name__ == "__main__":
    main()
