"""12.2 REFUTATION PROBE 3: can the PRODUCTION width_fn/wind_fn raise on a SCHEMA-VALID vector?

GridVector.lat / .lng are NON-OPTIONAL floats (schemas.py:12-13). So the only inputs that made
shelf_width_km raise in probe 1 (None / non-numeric) cannot exist on a validated vector.
This sweeps finite coordinates over the whole globe, plus the pathological finite edges.
READ-ONLY.
"""
import random, math, sys
from services.weather_pipeline.bathymetry import shelf_width_km
from services.weather_pipeline.schemas import GridVector

print("== schema gate ==")
for bad in [None, float("nan"), float("inf")]:
    try:
        v = GridVector(lat=bad, lng=0.0, speed=1.0)
        print("  GridVector ACCEPTED lat=%r -> %r" % (bad, v.lat))
    except Exception as e:
        print("  GridVector REJECTED lat=%r -> %s" % (bad, type(e).__name__))

print("\n== shelf_width_km sweep over FINITE coords ==")
random.seed(12)
coords = [(random.uniform(-90, 90), random.uniform(-180, 180)) for _ in range(20000)]
coords += [(90.0, 180.0), (-90.0, -180.0), (0.0, 0.0), (89.999, 179.999),
           (-89.999, -179.999), (0.0, 360.0), (0.0, -360.0), (45.0, 1e12), (1e12, 45.0),
           (-1e12, -1e12), (0.0, 1e-300), (1e-300, 0.0)]
raises = 0
examples = []
for la, ln in coords:
    try:
        shelf_width_km(la, ln)
    except Exception as e:
        raises += 1
        if len(examples) < 5:
            examples.append((la, ln, type(e).__name__, str(e)))
print("  n = %d  raises = %d" % (len(coords), raises))
for e in examples:
    print("   ", e)

print("\n== POSITIVE CONTROL (the sweep can detect a raise) ==")
try:
    shelf_width_km(None, 0.0)
    print("  control FAILED - None did not raise")
except Exception as e:
    print("  control OK - None raises %s" % type(e).__name__)
