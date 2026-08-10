"""V1 Q6 follow-up: is the waiver's J-Bay slope (0.0093) reproducible, or coordinate-sensitive?"""
import sys
sys.path.insert(0, ".")
from services.weather_pipeline import bathymetry
from services.weather_pipeline.surf_transform import iribarren
from services.weather_pipeline.surf_rating import breaker_type_quality

CANDS = [("audit guess", -34.0507, 24.9307),
         ("capture_marine_card_matrix.py:43", -34.049, 24.928),
         ("expand_... Supertubes", -34.0500, 24.9333),
         ("expand_... The Point", -34.0550, 24.9267),
         ("expand_... Tubes", -34.0517, 24.9300)]
for nm, la, ln in CANDS:
    s = bathymetry.bed_slope_at(la, ln)
    xi = iribarren(s, 2.0, 12.0)
    print("  %-34s (%.4f,%.4f) slope=%-9s q=%.4f" % (
        nm, la, ln, ("%.4f" % s) if s is not None else "None", breaker_type_quality(xi)))
