"""E1 probe: ONE FORECAST COMPOSITION parity + physics Jacobian sweep. READ-ONLY.

Run:
  cd C:/Users/dprit/Raw-Surf/backend
  PYTHONPATH=C:/Users/dprit/Raw-Surf/backend \
    C:/Users/dprit/AppData/Local/Python/bin/python3.exe \
    C:/Users/dprit/Raw-Surf/audit/weather-simulation-11.0/evidence/synthetic-probes/probe_E1_sweep.py
ASCII output only (stdout is cp1252 on this box).
"""
import os
import sys

from services.weather_pipeline import surf_point, surf_rating, sim_rating
from services.weather_pipeline.surf_transform import estimate_surf

M_TO_FT = 3.28084

SPOTS = [
    ("Pipeline",  21.665,  -158.053),
    ("Mavericks", 37.4952, -122.5028),
    ("Trestles",  33.3830, -117.5890),
    ("CocoaBeach", 28.3200, -80.6076),
]


def flags():
    keys = sorted(k for k in os.environ
                  if k.startswith(("SURF_", "RATING_", "SIM_")))
    return {k: os.environ[k] for k in keys}


def prod_chain(lat, lng, hs, tp, sdir, wind_ms, wind_dir, geo=None, ref=None):
    g = geo if geo is not None else surf_point.resolve_surf_geometry(lat, lng)
    h, regime = surf_point.estimate_surf_at(lat, lng, hs, tp,
                                            swell_from_deg=sdir, geometry=g)
    if h is None:
        return None, regime, None, None, g
    score = surf_rating.compute_surf_rating(
        h, tp, wind_ms,
        wind_from_deg=wind_dir,
        shore_normal_deg=g.shore_normal_deg,
        swell_from_deg=sdir,
        reference_size_m=ref,
        break_depth_m=g.break_depth_m,
    )
    return h, regime, score, surf_rating.score_to_level(score["score"] if isinstance(score, dict) else score), g


def main():
    print("== ENV FLAGS VISIBLE TO THIS PROCESS ==")
    f = flags()
    print(f if f else "(none set -- code defaults in force)")
    print()

    print("== compute_surf_rating return shape ==")
    r = surf_rating.compute_surf_rating(1.5, 14.0, 2.57,
                                        wind_from_deg=135.0,
                                        shore_normal_deg=325.0,
                                        swell_from_deg=315.0)
    print(type(r).__name__, r)
    print()

    # ---- Section 5: the CLAUDE.md claim, at Pipeline, 14 s / 315 deg / 5 kt ----
    KT_TO_MS = surf_rating.KT_TO_MS
    lat, lng = 21.665, -158.053
    geo = surf_point.resolve_surf_geometry(lat, lng)
    print("== GEOMETRY Pipeline ==")
    print(geo)
    print()
    print("== CLAUDE.md CLAIM SWEEP: Pipeline, Tp=14 s, swell_from=315, wind 5 kt ==")
    print("   claim: 0.5m->3.3ft/69.7 1m->5.8ft/86.5 4m->17.6ft/86.5 "
          "8m->30.6ft/57.0 12m->29.5ft/61.2")
    hdr = ("{:>6} {:>9} {:>9} {:>11} {:>9} {:>11} {:>9} {:>11}"
           .format("Hs_m", "prodH_m", "prodH_ft", "prodRegime",
                   "prodQ", "prodLevel", "simFt", "simQ"))
    print(hdr)
    for hs in (0.5, 1.0, 4.0, 8.0, 12.0):
        h, regime = surf_point.estimate_surf_at(lat, lng, hs, 14.0,
                                                swell_from_deg=315.0, geometry=geo)
        q = surf_rating.rating_score(h, 14.0, 5.0 * KT_TO_MS,
                                     wind_from_deg=None,
                                     shore_normal_deg=geo.shore_normal_deg,
                                     swell_from_deg=315.0,
                                     break_depth_m=geo.break_depth_m)
        lvl = surf_rating.score_to_level(q)
        spot = {"id": 9001, "name": "Pipeline", "latitude": lat, "longitude": lng,
                "orientation": 325}
        sim = sim_rating.calculate_surf_rating(spot, hs, 14.0, 315.0, 5.0, 135.0)
        print("{:>6} {:>9.4f} {:>9.2f} {:>11} {:>9.1f} {:>11} {:>9} {:>11}"
              .format(hs, h, h * M_TO_FT, regime, q, lvl,
                      sim["breaking_height_ft"], sim["quality_rating"]))
    print()

    # wind_from_deg matters: the claim did not state a wind direction. Sweep it.
    print("== SAME SWEEP, wind direction sensitivity (5 kt) ==")
    print("{:>6} {:>10} {:>10} {:>10} {:>10}".format(
        "Hs_m", "wd=None", "wd=145(off)", "wd=325(on)", "wd=55(cross)"))
    for hs in (0.5, 1.0, 4.0, 8.0, 12.0):
        h, _ = surf_point.estimate_surf_at(lat, lng, hs, 14.0,
                                           swell_from_deg=315.0, geometry=geo)
        row = []
        for wd in (None, 145.0, 325.0, 55.0):
            row.append(surf_rating.rating_score(
                h, 14.0, 5.0 * KT_TO_MS, wind_from_deg=wd,
                shore_normal_deg=geo.shore_normal_deg, swell_from_deg=315.0,
                break_depth_m=geo.break_depth_m))
        print("{:>6} {:>10.1f} {:>10.1f} {:>10.1f} {:>10.1f}".format(hs, *row))
    print()

    # ---- Section 4: production vs sim parity at several coordinates ----
    print("== SECTION 4: PRODUCTION CHAIN vs SIM PATH (same inputs) ==")
    print("{:<11} {:>8} {:>8} {:>8} {:>9} {:>9} {:>9} {:>8} {:>8} {:>8}".format(
        "spot", "Hs", "Tp", "sdir", "prod_ft", "sim_ft", "d_ft", "prod_q",
        "sim_qraw", "d_q"))
    for name, la, ln in SPOTS:
        g = surf_point.resolve_surf_geometry(la, ln)
        for (hs, tp, sd, wspd_kt, wdir) in [(1.5, 14.0, 300.0, 8.0, 120.0),
                                            (3.0, 10.0, 270.0, 15.0, 300.0),
                                            (0.8, 6.0, 200.0, 4.0, 20.0)]:
            h, regime = surf_point.estimate_surf_at(la, ln, hs, tp,
                                                    swell_from_deg=sd, geometry=g)
            q = surf_rating.rating_score(h, tp, wspd_kt * KT_TO_MS,
                                         wind_from_deg=wdir,
                                         shore_normal_deg=g.shore_normal_deg,
                                         swell_from_deg=sd,
                                         break_depth_m=g.break_depth_m)
            spot = {"id": 9002, "name": name, "latitude": la, "longitude": ln,
                    "orientation": 270}
            sim = sim_rating.calculate_surf_rating(spot, hs, tp, sd, wspd_kt, wdir)
            print("{:<11} {:>8} {:>8} {:>8} {:>9.2f} {:>9.2f} {:>9.3f} "
                  "{:>8.1f} {:>8.1f} {:>8.3f}".format(
                      name, hs, tp, sd, h * M_TO_FT, sim["breaking_height_ft"],
                      round(h * M_TO_FT, 1) - sim["breaking_height_ft"],
                      q, sim["quality_raw"], q - sim["quality_raw"]))
    print()

    # ---- Section 5b: full Jacobian at Pipeline + Cocoa Beach ----
    print("== JACOBIAN: d(breaking ft)/d(input), d(rating)/d(input) ==")
    for name, la, ln in SPOTS:
        g = surf_point.resolve_surf_geometry(la, ln)
        base = dict(hs=1.5, tp=12.0, sd=(g.shore_normal_deg
                                         if g.shore_normal_deg is not None else 270.0),
                    wspd=5.0, wdir=None)
        def evalp(hs, tp, sd, wspd, wdir):
            h, _ = surf_point.estimate_surf_at(la, ln, hs, tp,
                                               swell_from_deg=sd, geometry=g)
            if h is None:
                return None, None
            q = surf_rating.rating_score(h, tp, wspd * KT_TO_MS,
                                         wind_from_deg=wdir,
                                         shore_normal_deg=g.shore_normal_deg,
                                         swell_from_deg=sd,
                                         break_depth_m=g.break_depth_m)
            return h * M_TO_FT, q
        print("-- %s  normal=%s src=%s break_depth=%s" %
              (name, g.shore_normal_deg, g.shore_normal_src, g.break_depth_m))
        for label, key, vals in [
                ("Hs_m",   "hs",   [0.5, 1.0, 1.5, 2.0, 3.0, 5.0, 8.0, 12.0]),
                ("Tp_s",   "tp",   [5.0, 8.0, 10.0, 12.0, 14.0, 18.0, 22.0]),
                ("swell_off_deg", "sd", [0, 22.5, 45, 67.5, 90, 135, 180]),
                ("wind_kt", "wspd", [0.0, 5.0, 10.0, 20.0, 30.0, 45.0]),
                ("wind_off_deg", "wdir", [0, 45, 90, 135, 180])]:
            out = []
            for v in vals:
                kw = dict(base)
                if key == "sd":
                    kw["sd"] = (base["sd"] + v) % 360.0
                elif key == "wdir":
                    kw["wdir"] = (base["sd"] + v) % 360.0
                else:
                    kw[key] = v
                ft, q = evalp(kw["hs"], kw["tp"], kw["sd"], kw["wspd"], kw["wdir"])
                out.append("%s:%.2fft/%.1f" % (v, ft, q))
            print("   %-14s %s" % (label, "  ".join(out)))
    print()


if __name__ == "__main__":
    main()
