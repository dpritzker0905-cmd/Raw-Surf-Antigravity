import sys, os
sys.path.insert(0, os.path.abspath("."))
from services.weather_pipeline.surf_rating import compute_surf_rating

def run(h, tp, dth, wind=None, wdir=None):
    # shore normal 0 deg; swell arrives from dth
    known = compute_surf_rating(h, tp, wind, wdir, 0.0, dth)
    blind = compute_surf_rating(h, tp, wind, wdir, None, dth)
    return known, blind

print("=== ARM A: KNOWN(shore_normal=0) vs BLIND(None), wind=None ===")
for h, tp in ((1.5, 13.0), (2.5, 15.0)):
    for dth in (0, 45, 75, 90, 180):
        k, b = run(h, tp, float(dth))
        print("h=%.1f tp=%.0f dth=%3d  known=(%5.1f,%-9s) blind=(%5.1f,%-9s) delta=%+6.1f"
              % (h, tp, dth, k[0], k[1], b[0], b[1], b[0]-k[0]))
