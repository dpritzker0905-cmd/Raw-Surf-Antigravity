"""V1 Q4 -- INDEPENDENT mutation testing of the enrolled band entry.

The repo is READ-ONLY for this audit, so mutations are applied to the LIVE registry dict in memory
(every test reads `SURFACES` at call time, so this is equivalent to editing the literal) and, for
the product-side mutations, to an imported COPY of surf_rating.py written to a scratch file.
The test functions themselves are the REAL ones imported from backend/tests.

Run from backend/. ASCII output only.
"""
import copy
import importlib.util
import os
import sys
import traceback

sys.path.insert(0, ".")
sys.path.insert(0, "tests")

import test_rating_composition_parity as T   # noqa: E402

SCRATCH = os.environ.get("V1_SCRATCH", ".")
BAND = "rating_transform_grid (the on-map RATING BAND)"
LONG = ("A waiver long enough to clear the 60-character floor that the file asserts, so that this "
        "mutation tests the SUPPLIED/waived logic and not the length gate.")


def _load_mutant_surf_rating(replacements, tag):
    """Import a COPY of surf_rating.py with textual replacements applied. Never touches the repo."""
    src_path = os.path.join("services", "weather_pipeline", "surf_rating.py")
    with open(src_path, "r", encoding="utf-8") as f:
        src = f.read()
    for old, new in replacements:
        assert old in src, "mutation anchor not found: %r" % old[:60]
        src = src.replace(old, new, 1)
    out = os.path.join(SCRATCH, "mutant_surf_rating_%s.py" % tag)
    with open(out, "w", encoding="utf-8") as f:
        f.write(src)
    spec = importlib.util.spec_from_file_location("mutant_surf_rating_%s" % tag, out)
    mod = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(mod)
    return mod


def run(label, fn, *args):
    try:
        fn(*args)
        return ("GREEN", "")
    except AssertionError as e:
        return ("RED", str(e).strip().splitlines()[0][:120])
    except Exception as e:
        return ("RED(exc)", "%s: %s" % (type(e).__name__, str(e)[:100]))


SUITE = [
    ("declared_position[band]", T.test_every_optional_factor_has_a_declared_position, BAND),
    ("registry_matches[band]", T.test_the_registry_matches_what_the_code_actually_passes, BAND),
    ("reference_supplies_most", T.test_the_reference_surface_supplies_the_most),
    ("band_divergence_pin", T.test_the_band_diverges_from_the_glyph_and_by_how_much),
]

_PRISTINE = copy.copy(T.SURFACES)
_PRISTINE_ENTRIES = {k: dict(v) for k, v in T.SURFACES.items()}
_PRISTINE_FACTORS = {k: dict(v["factors"]) for k, v in T.SURFACES.items()}


def restore():
    T.SURFACES.clear()
    T.SURFACES.update({k: dict(_PRISTINE_ENTRIES[k]) for k in _PRISTINE})
    for k in T.SURFACES:
        T.SURFACES[k]["factors"] = dict(_PRISTINE_FACTORS[k])
    T.rating_score = _RS0
    T._REQUIRED = _REQ0


_RS0 = T.rating_score
_REQ0 = T._REQUIRED


def m0_control():
    pass


def m1_declare_a_lie():
    """Commit's M1: declare a WAIVED factor as SUPPLIED."""
    T.SURFACES[BAND]["factors"]["break_depth_m"] = T.SUPPLIED


def m2_drop_a_factor():
    """Commit's M2: delete a factor from the band's registry entry."""
    del T.SURFACES[BAND]["factors"]["partitions"]


def m3_waive_a_supplied_one():
    """Commit's M3: waive a factor the band actually supplies."""
    T.SURFACES[BAND]["factors"]["reference_size_m"] = LONG


def m4_remove_the_scoping():
    """Commit's M4: remove `function` -> the whole-module walk sees two disagreeing call sites."""
    del T.SURFACES[BAND]["function"]


def m5_function_renamed():
    """AUDIT EXTRA: registry points at an entry point that no longer exists."""
    T.SURFACES[BAND]["function"] = "rating_transform_grid_v2"


def m6_short_waiver():
    """AUDIT EXTRA: a waiver that does not say why (<= 60 chars)."""
    T.SURFACES[BAND]["factors"]["tide_norm"] = "no tide here"


def m7_seealso_to_nowhere():
    """AUDIT EXTRA: SeeAlso pointing at a factor nobody ever justified."""
    T.SURFACES[BAND]["factors"]["breaker_xi"] = T.SeeAlso("no_such_factor")


def m8_band_starts_passing_break_depth():
    """AUDIT EXTRA, PRODUCT SIDE: the band's call gains break_depth_m while the waiver stays."""
    mod = _load_mutant_surf_rating(
        [("reference_size_m=reference)", "reference_size_m=reference, break_depth_m=depth)")], "m8")
    T.SURFACES[BAND]["module"] = mod


def m9_band_stops_passing_reference():
    """AUDIT EXTRA, PRODUCT SIDE: the band silently drops a factor it DECLARES it supplies."""
    mod = _load_mutant_surf_rating(
        [("reference_size_m=reference)", ")")], "m9")
    T.SURFACES[BAND]["module"] = mod


def m10_new_engine_factor():
    """AUDIT EXTRA, THE GUARD'S RAISON D'ETRE: a NEW optional factor reaches `rating_score`.
    Every surface -- INCLUDING the newly enrolled band -- must go red until it declares."""
    mod = _load_mutant_surf_rating(
        [("def rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None,",
          "def rating_score(surf_h_m, tp_s, wind_speed_ms, wind_from_deg=None, shore_normal_deg=None, swell_from_deg=None, brand_new_factor=None,")],
        "m10")
    T.rating_score = mod.rating_score


MUTATIONS = [("M0 CONTROL (no mutation)", m0_control),
             ("M1 declare a waived factor SUPPLIED", m1_declare_a_lie),
             ("M2 delete a factor from the entry", m2_drop_a_factor),
             ("M3 waive a factor it does supply", m3_waive_a_supplied_one),
             ("M4 remove `function` (the scoping)", m4_remove_the_scoping),
             ("M5 `function` points at a dead name", m5_function_renamed),
             ("M6 waiver shorter than 60 chars", m6_short_waiver),
             ("M7 SeeAlso -> nonexistent waiver", m7_seealso_to_nowhere),
             ("M8 PRODUCT: band starts passing break_depth_m", m8_band_starts_passing_break_depth),
             ("M9 PRODUCT: band stops passing reference_size_m", m9_band_stops_passing_reference),
             ("M10 PRODUCT: a NEW optional factor on rating_score", m10_new_engine_factor)]

print("=== Q4 MUTATION MATRIX (band entry) ===")
print("%-46s %-24s %-24s %-24s %s" % ("mutation", "declared_position", "registry_matches",
                                      "reference_supplies_most", "divergence_pin"))
for name, mut in MUTATIONS:
    restore()
    try:
        mut()
    except Exception:
        print("%-46s SETUP FAILED" % name)
        traceback.print_exc()
        continue
    cells = []
    detail = []
    for tname, fn, *args in SUITE:
        st, msg = run(tname, fn, *args)
        cells.append(st)
        if st != "GREEN":
            detail.append("      %-24s -> %s" % (tname, msg))
    verdict = "ALL GREEN" if all(c == "GREEN" for c in cells) else "caught"
    print("%-46s %-24s %-24s %-24s %s   [%s]" % (name, cells[0], cells[1], cells[2], cells[3], verdict))
    for d in detail:
        print(d)
restore()

# ---- M10 across ALL FOUR surfaces: does the band actually participate? -----------------------
print()
print("=== Q4b: M10 (new engine factor) across all four surfaces ===")
restore()
m10_new_engine_factor()
for label in sorted(T.SURFACES):
    st, msg = run(label, T.test_every_optional_factor_has_a_declared_position, label)
    print("  %-52s %-9s %s" % (label[:52], st, msg[:70]))
restore()
print()
print("=== control: pristine registry re-verified ===")
for tname, fn, *args in SUITE:
    print("  %-26s %s" % (tname, run(tname, fn, *args)[0]))
