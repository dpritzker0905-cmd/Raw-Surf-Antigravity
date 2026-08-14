"""12.2 REFUTATION PROBE: are the two silent excepts in rating_transform_grid REACHABLE?

The claim: `except Exception: width = 0.0` (surf_rating.py:732-736) and
`except Exception: pass` around wind_fn (:743-748) silently substitute values.
Reachability test: drive the PRODUCTION injected fns (bathymetry.shelf_width_km,
grid_resolver_surf._make_nearest_sampler) with hostile inputs and see if either RAISES.
READ-ONLY. Writes nothing outside this evidence dir.
"""
import sys, os, math
sys.path.insert(0, os.path.abspath("backend"))

from services.weather_pipeline.bathymetry import shelf_width_km, is_available
print("bathymetry.is_available():", is_available())

CASES = [
    ("normal coastal (Trestles)", 33.3853, -117.5931),
    ("normal coastal (Pipeline)", 21.6650, -158.0530),
    ("out of bounds lat", 999.0, 0.0),
    ("lng wrap +540", 33.0, 540.0),
    ("None lat", None, -117.0),
    ("None lng", 33.0, None),
    ("nan lat", float("nan"), -117.0),
    ("inf lng", 33.0, float("inf")),
    ("string lat", "33.0", -117.0),
    ("string junk lat", "abc", -117.0),
]
print("\n== shelf_width_km (the production width_fn) ==")
for name, la, ln in CASES:
    try:
        v = shelf_width_km(la, ln)
        print("  RETURNED %-28s -> %r" % (name, v))
    except Exception as e:
        print("  RAISED   %-28s -> %s: %s" % (name, type(e).__name__, e))

print("\n== _make_nearest_sampler closure (the production wind_fn) ==")
from services.weather_pipeline.grid_resolver_surf import _make_nearest_sampler
class V:
    def __init__(s, lat, lng, speed, direction): s.lat, s.lng, s.speed, s.direction = lat, lng, speed, direction
samp = _make_nearest_sampler([V(33.0, -117.0, 10.0, 270.0), V(34.0, -118.0, 5.0, 90.0)])
for name, la, ln in CASES:
    try:
        v = samp(la, ln)
        print("  RETURNED %-28s -> %r" % (name, v))
    except Exception as e:
        print("  RAISED   %-28s -> %s: %s" % (name, type(e).__name__, e))

print("\n== POSITIVE CONTROL: a width_fn that DOES raise proves the except is live code ==")
from services.weather_pipeline.surf_rating import rating_transform_grid
class Vec:
    def __init__(s): s.lat, s.lng, s.speed, s.period, s.direction = 33.0, -117.0, 2.0, 14.0, 300.0; s.is_valid=True; s.phys_speed=None; s.rating_level=None
def boom(lat, lng): raise RuntimeError("injected")
a = [Vec()]; b = [Vec()]
n1, _ = rating_transform_grid(a, lambda la, ln: 12.0, lambda la, ln: True, boom, None, None)
n2, _ = rating_transform_grid(b, lambda la, ln: 12.0, lambda la, ln: True, lambda la, ln: 0.0, None, None)
print("  raising width_fn  -> rated=%d score_channel=%r" % (n1, a[0].speed))
print("  width_fn -> 0.0    -> rated=%d score_channel=%r" % (n2, b[0].speed))
print("  IDENTICAL:", a[0].speed == b[0].speed)
