"""V1 EXTRA -- which FUNCTIONS actually execute inside the renamed test and the NEW band test?

Method: sys.settrace over one parametrisation of each, counting calls per (file, function).
Run from backend/. ASCII output only.
"""
import os
import sys

sys.path.insert(0, ".")
sys.path.insert(0, "tests")

import test_rating_composition_parity as T   # noqa: E402

WATCH = ("surf_rating.py", "spot_ratings.py", "spot_conditions.py", "sim_rating.py",
         "grid_resolver_surf.py", "shore_normal_asset.py", "surf_transform.py")


def trace_run(fn, *args):
    hits = {}
    funcs = set()

    def tracer(frame, event, arg):
        if event != "call":
            return None
        fname = os.path.basename(frame.f_code.co_filename)
        if fname in WATCH:
            hits[fname] = hits.get(fname, 0) + 1
            funcs.add((fname, frame.f_code.co_name))
        return None

    sys.settrace(tracer)
    try:
        fn(*args)
    finally:
        sys.settrace(None)
    return hits, funcs


CASES = [
    ("test_the_three_POINT_surfaces_agree_exactly_with_flags_off[Cocoa]",
     T.test_the_three_POINT_surfaces_agree_exactly_with_flags_off,
     ("Cocoa Beach Pier", 28.3676, -80.6012, 99.1)),
    ("test_the_band_diverges_from_the_glyph_and_by_how_much",
     T.test_the_band_diverges_from_the_glyph_and_by_how_much, ()),
]

for label, fn, args in CASES:
    hits, funcs = trace_run(fn, *args)
    print("=== %s" % label)
    for f in WATCH:
        print("    %-24s %s" % (f, hits.get(f, "EXECUTED = False")))
    print("    surf_rating functions entered: %s" % sorted(
        n for (f, n) in funcs if f == "surf_rating.py"))
    print("    rating_transform_grid entered: %s" % (("surf_rating.py", "rating_transform_grid") in funcs))
    print()
