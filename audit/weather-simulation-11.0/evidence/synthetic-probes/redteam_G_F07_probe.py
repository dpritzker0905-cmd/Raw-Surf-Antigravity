"""F-07 red-team probe. READ-ONLY: imports and evaluates, mutates no repo file.

Checks, independently:
  1. the RUNTIME default of SURF_HEIGHT_H110 (env var popped)
  2. the ADMIN REGISTRY declared default, parsed with ast (not imported)
  3. what the admin endpoint's own expression would REPORT when Render does not set the var
  4. whether the multiplier actually reaches a served height via the production chain
ASCII output only (stdout is cp1252).
"""
import ast
import os
import sys

BACKEND = r"C:\Users\dprit\Raw-Surf\backend"
sys.path.insert(0, BACKEND)

# --- 1. runtime authority ---------------------------------------------------
os.environ.pop("SURF_HEIGHT_H110", None)
from services.weather_pipeline import surf_height_convention as SHC

runtime_enabled = SHC.enabled()
print("1. RUNTIME (env var popped)")
print("   enabled()      =", runtime_enabled)
print("   H110_OVER_HS   =", SHC.H110_OVER_HS)
print("   describe()     =", SHC.describe()["surf_height_statistic"],
      "| factor_applied =", SHC.describe()["factor_applied"])

# --- 2. admin registry declared default, parsed not imported ----------------
REG = os.path.join(BACKEND, "routes", "admin", "surf_forecast.py")
tree = ast.parse(open(REG, encoding="utf-8").read())
flags = None
for node in ast.walk(tree):
    if isinstance(node, ast.Assign) and any(
            getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets):
        flags = ast.literal_eval(node.value)
declared_default = flags["SURF_HEIGHT_H110"][0]
print("\n2. ADMIN REGISTRY (_RATING_FLAGS, ast-parsed)")
print("   declared default =", repr(declared_default))

# --- 3. what the endpoint expression REPORTS when Render does not set it -----
# Verbatim from routes/admin/surf_forecast.py:234-235
name, default = "SURF_HEIGHT_H110", declared_default
reported_value = os.environ.get(name, default)
reported_active = os.environ.get(name, default) != "0"
print("\n3. ADMIN PANEL would report (SURF_HEIGHT_H110 unset in Render)")
print("   value  =", repr(reported_value), " active =", reported_active)
print("   TRUTH  = '1'  active = True   (runtime enabled() ->", runtime_enabled, ")")
print("   PANEL MATCHES RUNTIME:", (reported_value == "1") == runtime_enabled)

# --- 4. does the factor reach a served height? ------------------------------
from services.weather_pipeline.surf_transform import estimate_surf

print("\n4. SERVED HEIGHT through production estimate_surf (shoaling/shelf regime)")
for label, val in (("H110 unset (default)", None), ("H110=0 (kill)", "0")):
    if val is None:
        os.environ.pop("SURF_HEIGHT_H110", None)
    else:
        os.environ["SURF_HEIGHT_H110"] = val
    h, regime = estimate_surf(2.0, 14.0, depth_m=30.0, coastal=True,
                              shelf_width_km=40.0, shore_normal_deg=270.0)
    print("   %-22s -> H = %.4f m  regime = %s" % (label, h, regime))
os.environ.pop("SURF_HEIGHT_H110", None)
