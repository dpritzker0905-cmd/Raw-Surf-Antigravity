"""AGENT G red-team: independent reproduction of E1-04's period-sensitivity claim.

Read-only. Calls the production chain directly:
  surf_point.resolve_surf_geometry + estimate_surf_at  -> breaking height
  surf_rating.compute_surf_rating                       -> 0-100 quality

Varies ONLY the period, holding Hs / swell dir / wind constant, to price what
happens when a MEAN-class period is fed where the consumer documents a PEAK.
ASCII output only (stdout is cp1252).
"""
import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "backend"))

from services.weather_pipeline.surf_point import estimate_surf_at, resolve_surf_geometry
from services.weather_pipeline import surf_rating as SR

M_TO_FT = 3.28084

SPOTS = [
    ("Pipeline",    21.6650, -158.0505),
    ("Mavericks",   37.4952, -122.5028),
    ("CocoaBeach",  28.3200,  -80.6070),
]

# Hs held constant; wind 5 kt offshore-ish. Periods: the served "peak", then the
# same sea reported as a mean at the literature ratios AND at the repo's own
# measured Sebastian ratio (7.9 -> 4.9 s = 1.61x).
HS_M = 1.5
WIND_MS = 5.0 * 0.514444


def run(name, lat, lng, tp_base):
    geo = resolve_surf_geometry(lat, lng)
    shore_normal = getattr(geo, "shore_normal_deg", None)
    # head-on swell: come FROM the seaward bearing
    swell_from = shore_normal if shore_normal is not None else 270.0
    wind_from = swell_from  # offshore-ish reference
    print("\n%s  (lat %.4f lng %.4f)  shore_normal=%s" % (name, lat, lng, shore_normal))
    print("  %-22s %10s %10s %8s" % ("period fed", "Tp (s)", "surf (ft)", "score"))
    base_h = base_s = None
    for label, div in (("served peak", 1.0), ("mean Tm/Tp=1.10", 1.10),
                       ("mean Tm/Tp=1.20", 1.20), ("repo-measured 1.61x", 1.61)):
        tp = tp_base / div
        try:
            surf, regime = estimate_surf_at(lat, lng, HS_M, tp, swell_from_deg=swell_from)
        except Exception as e:
            print("  %-22s  estimate_surf_at FAILED: %r" % (label, e))
            continue
        if surf is None:
            print("  %-22s  surf=None" % label)
            continue
        score, level = SR.compute_surf_rating(
            surf, tp, WIND_MS, wind_from_deg=wind_from,
            shore_normal_deg=shore_normal, swell_from_deg=swell_from)
        ft = surf * M_TO_FT
        if base_h is None:
            base_h, base_s = ft, score
            delta = ""
        else:
            delta = "   dH %+.1f%%  dScore %+.1f" % (100.0 * (ft - base_h) / base_h,
                                                     (score - base_s) if score is not None else float("nan"))
        print("  %-22s %10.2f %10.2f %8s%s" % (label, tp, ft, ("%.1f" % score) if score is not None else "None", delta))


if __name__ == "__main__":
    print("HS_M=%.2f  wind=%.2f m/s (5 kt)" % (HS_M, WIND_MS))
    for name, lat, lng in SPOTS:
        tp = 10.0 if name == "CocoaBeach" else 14.0
        run(name, lat, lng, tp)
