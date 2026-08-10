import sys, os, statistics
sys.path.insert(0, os.path.abspath("."))
from services.weather_pipeline.surf_rating import compute_surf_rating
h, tp = 2.0, 14.0
# DEGRADED arm: fine normal = truth, coarse normal = truth + err (median 22.3 per module docstring)
print("=== ARM B: DEGRADED (coarse bearing off by E) vs FULL, across 8 swell dirs ===")
for err in (22.3, 38.7, 81.4):
    ds = []
    for dth in range(0, 360, 45):
        full = compute_surf_rating(h, tp, None, None, 0.0, float(dth))
        deg  = compute_surf_rating(h, tp, None, None, err, float(dth))
        ds.append(deg[0]-full[0])
    print("coarse err %5.1f deg: deltas %s" % (err, ["%+.1f"%d for d in ds]))
    print("                     min %+.1f  max %+.1f  median %+.1f  n_flattering %d/8"
          % (min(ds), max(ds), statistics.median(ds), sum(1 for d in ds if d>0)))
print()
print("=== ARM C: BLIND vs FULL across 8 swell dirs (same h/tp) ===")
ds = []
for dth in range(0, 360, 45):
    full = compute_surf_rating(h, tp, None, None, 0.0, float(dth))
    blind = compute_surf_rating(h, tp, None, None, None, float(dth))
    ds.append(blind[0]-full[0])
print("deltas %s" % ["%+.1f"%d for d in ds])
print("min %+.1f max %+.1f median %+.1f  n_flattering %d/8" % (min(ds), max(ds), statistics.median(ds), sum(1 for d in ds if d>0)))
