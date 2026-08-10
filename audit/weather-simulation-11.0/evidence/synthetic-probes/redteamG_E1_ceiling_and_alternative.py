"""AGENT G RED TEAM -- E1-01, part 2.

(A) CEILING over the SERVED cell population: sweep swell incidence 0..180 deg on the 0.25 deg
    lattice and find the max band/point height ratio and max |dQ| that can actually occur on a
    cell, as opposed to at a catalogue spot coordinate.

(B) ALTERNATIVE CAUSE: the E1 probe holds sampling out by evaluating both arms at the SAME
    coordinate. But the band never runs at a spot coordinate. Decompose the spot-vs-band gap into
      SAMPLING   = point@spot  vs  point@nearest-cell   (same composition, different coordinate)
      COMPOSITION= point@cell  vs  band@cell            (same coordinate, different composition)
    If SAMPLING >= COMPOSITION, composition is not the dominant mechanism for band-vs-glyph.

READ-ONLY.
"""
import math

from services.weather_pipeline import surf_point, surf_rating as SR
from services.weather_pipeline.bathymetry import (is_coastal, shelf_depth_at, shelf_width_km,
                                                  shore_normal_at)
from services.weather_pipeline.surf_transform import estimate_surf

FT = 3.28084
RES = 0.25
WIND_MS, WIND_FROM_OFFSET = 4.0, 180.0

SPOTS = [("Pipeline", 21.665, -158.053), ("Mavericks", 37.4952, -122.5028),
         ("Trestles", 33.3830, -117.5890), ("CocoaBeach", 28.3200, -80.6076),
         ("JeffreysBay", -34.049, 24.919), ("Nazare", 39.6050, -9.0850)]
HALF_DEG = 1.0
ANGLES = [0.0, 30.0, 60.0, 90.0, 120.0, 150.0, 180.0]
HSTP = [(1.0, 12.0), (1.5, 14.0), (3.0, 16.0), (6.0, 16.0)]


def snap(x):
    return round(round(x / RES) * RES, 6)


def band(lat, lng, hs, tp, sd, wf):
    d = shelf_depth_at(lat, lng)
    w = shelf_width_km(lat, lng) or 0.0
    s, reg = estimate_surf(hs, tp, d, coastal=True, shelf_width_km=w)
    if s is None or reg in ("open_ocean", "calm", "unknown"):
        return None, None
    sn = shore_normal_at(lat, lng)
    q, _ = SR.compute_surf_rating(s, tp, WIND_MS, wf, sn, sd, reference_size_m=None)
    return s, q


def point(lat, lng, hs, tp, sd, wf, g):
    s, reg = surf_point.estimate_surf_at(lat, lng, hs, tp, swell_from_deg=sd, geometry=g)
    if s is None:
        return None, None
    q, _ = SR.compute_surf_rating(s, tp, WIND_MS, wind_from_deg=wf,
                                  shore_normal_deg=g.shore_normal_deg, swell_from_deg=sd,
                                  reference_size_m=None, break_depth_m=g.break_depth_m)
    return s, q


def main():
    # ---------- (A) ceiling over the served cell lattice ----------
    cells = set()
    for _n, clat, clng in SPOTS:
        la = snap(clat - HALF_DEG)
        while la <= clat + HALF_DEG + 1e-9:
            ln = snap(clng - HALF_DEG)
            while ln <= clng + HALF_DEG + 1e-9:
                cells.add((round(la, 4), round(ln, 4)))
                ln = round(ln + RES, 6)
            la = round(la + RES, 6)
    coastal = []
    for la, ln in sorted(cells):
        try:
            if bool(is_coastal(la, ln)):
                coastal.append((la, ln))
        except Exception:
            pass
    print("== (A) CEILING over %d coastal 0.25 deg cells x %d angles x %d seas =="
          % (len(coastal), len(ANGLES), len(HSTP)))
    wr, wq, wr_at, wq_at = 1.0, 0.0, None, None
    n = 0
    per_angle = {a: [1.0, 0.0] for a in ANGLES}
    for la, ln in coastal:
        g = surf_point.resolve_surf_geometry(la, ln)
        sn = g.shore_normal_deg if g.shore_normal_deg is not None else 270.0
        wf = (sn + WIND_FROM_OFFSET) % 360.0
        for a in ANGLES:
            sd = (sn + a) % 360.0
            for hs, tp in HSTP:
                bh, bq = band(la, ln, hs, tp, sd, wf)
                ph, pq = point(la, ln, hs, tp, sd, wf, g)
                if bh is None or ph is None or not ph:
                    continue
                n += 1
                r = bh / ph
                dq = abs((bq or 0) - (pq or 0))
                per_angle[a][0] = max(per_angle[a][0], r)
                per_angle[a][1] = max(per_angle[a][1], dq)
                if r > wr:
                    wr, wr_at = r, (la, ln, a, hs, tp, bh * FT, ph * FT)
                if dq > wq:
                    wq, wq_at = dq, (la, ln, a, hs, tp, bq, pq)
    print("  pairs=%d" % n)
    for a in ANGLES:
        print("    incidence %5.0f deg : max height ratio %.3f   max |dQ| %5.1f"
              % (a, per_angle[a][0], per_angle[a][1]))
    print("  CEILING on a served cell -> height ratio %.3f at %s" % (wr, wr_at))
    print("  CEILING on a served cell -> |dQ|         %.1f at %s" % (wq, wq_at))
    print("  (E1-01 claimed 3.037 and 56.9, measured AT SPOT COORDINATES)")

    # ---------- (B) sampling vs composition ----------
    print()
    print("== (B) ALTERNATIVE CAUSE: sampling (spot->cell) vs composition (point->band) ==")
    hdr =("{:<12} {:>6} {:>10} {:>10} {:>10} {:>9} {:>9} {:>9} {:>9}"
           .format("spot", "dkm", "pt@spotFt", "pt@cellFt", "band@cell", "SAMPL_r",
                   "COMPO_r", "dQ_sampl", "dQ_compo"))
    print(hdr)
    for name, la, ln in SPOTS:
        cla, cln = snap(la), snap(ln)
        dkm = math.hypot((cla - la) * 111.32, (cln - ln) * 111.32 * math.cos(math.radians(la)))
        gs = surf_point.resolve_surf_geometry(la, ln)
        gc = surf_point.resolve_surf_geometry(cla, cln)
        sn = gs.shore_normal_deg if gs.shore_normal_deg is not None else 270.0
        for hs, tp, a in [(3.0, 16.0, 0.0), (3.0, 16.0, 60.0)]:
            sd = (sn + a) % 360.0
            wf = (sn + WIND_FROM_OFFSET) % 360.0
            ps, qs = point(la, ln, hs, tp, sd, wf, gs)
            pc, qc = point(cla, cln, hs, tp, sd, wf, gc)
            bc, bq = band(cla, cln, hs, tp, sd, wf)
            if None in (ps, pc, bc):
                print("  %-12s %6.2f  UNCOMPARABLE (pt@spot=%s pt@cell=%s band=%s)"
                      % (name, dkm, ps, pc, bc))
                continue
            sr = max(pc, ps) / min(pc, ps)
            cr = max(bc, pc) / min(bc, pc)
            print("{:<12} {:>6.2f} {:>10.2f} {:>10.2f} {:>10.2f} {:>9.3f} {:>9.3f} {:>9.1f} {:>9.1f}"
                  .format("%s@%.0f" % (name[:8], a), dkm, ps * FT, pc * FT, bc * FT, sr, cr,
                          abs((qc or 0) - (qs or 0)), abs((bq or 0) - (qc or 0))))


if __name__ == "__main__":
    main()
