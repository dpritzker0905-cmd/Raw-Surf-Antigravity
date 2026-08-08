"""The registry's coverage contract, implemented. It was prose, and prose is not checkable.

THE DEFECT (measured 2026-08-08). `science_registry.py`'s module docstring states:

    "Adding a constant: add a `Constant(...)` below. The guard FAILS if a module defines a science
     constant that is not registered -- that is deliberate."

No such guard existed. `test_science_registry.py` verifies registry-vs-module agreement for the six
names in its hand-kept `WIRED` map and walks the registry outward; **nothing walked a MODULE inward
looking for constants the registry had never heard of.** Proven by mutation rather than by reading:
two unregistered constants planted at module level in `surf_transform.py` -- one of them physically
absurd (`SURF_ZONE_ROLLER_FRACTION = 9.99`) -- left the suite at **9 passed, green**.

⭐ THE REGISTRY EXISTS BECAUSE PROVENANCE IN PROSE IS NOT CHECKABLE (`GAMMA_MAX_STEEP` sat 54% above
every field observation for weeks behind two real citations). Its own coverage claim was in prose.
    ***  A CITATION IS NOT A RANGE CHECK -- AND A COVERAGE CLAIM IS NOT A COVERAGE SCAN.  ***

⛔⛔ WHY `CHAIN_MODULES` IS DECLARED AND NOT DERIVED. The obvious implementation scopes the scan to
"the modules the registry mentions". That is circular, and the circularity is not academic here:

    registry-named modules : surf_transform (9), surf_height_convention (1), a script (1)
    surf_rating.py         : 0 registered ... and 24 unregistered constants, the most of any module

A scope derived from existing coverage puts the worst-covered module permanently out of reach --
the same shape as a surface list that named a producer file, or a guard whose fixture could not
enter the branch it guarded. So the chain is declared explicitly, and
`test_no_registry_module_falls_out_of_scope` pins the safe direction: a module the registry already
names can never quietly leave the scan.

WHAT COUNTS. A module-level assignment of an UPPER_CASE name to a plain numeric literal (or its
negation). Two deliberate exclusions, stated rather than left implicit:
  * DERIVED values (`_OVERSIZE_TAPER_SPAN = OVERSIZE_FLOOR_MULT / OVERSIZE_START_MULT`) cannot drift
    independently of their inputs, so registering them would double-count.
  * FUNCTION-LOCAL constants are out of scope. That is a real gap; it is named here so a successor
    can close it deliberately rather than discover it.

HOW THE RATCHET WORKS -- exactly like the sibling `KNOWN_OUT_OF_RANGE` ratchet, which paid for
itself when `GAMMA_MAX_STEEP` 1.25 -> 0.81 emptied it. Name the debt, freeze it, fail anything NEW.
`GRANDFATHERED` is shrink-only: an entry that gets registered (or deleted) must LEAVE, so the set
cannot rot into a dumping ground. Categories are documentation, not enforcement -- misfiling one
does not weaken the ratchet, it just misdescribes the debt.

THE DEBT AT THE MOMENT OF FREEZING: 42 unregistered vs 11 registered across 6 chain modules.
⭐ It contains precisely the constants at the heart of the 2026-08-08 calibration-census failure --
`REF_PERCENTILE` (whose 0.80 -> 0.50 change orphaned two dependent calibrations) and
`OVERSIZE_START_MULT` / `OVERSIZE_FLOOR_MULT` (which were chosen against the p80 quantity and never
re-derived). Had this scan existed, the multiplier could not have silently outlived its input.
Detail: docs/runbooks/HANDOFF-2026-08-08-E-the-yardstick-was-being-replaced-underneath.md
"""
import ast
import pathlib

import pytest

from services.weather_pipeline import science_registry as SR

_BACKEND = pathlib.Path(__file__).resolve().parents[1]

# --- categories (documentation only; the ratchet is the frozen SET) -----------------------------
DEBT = "debt"              # a measured/calibrated quantity with no provenance record -- register it
STRUCTURAL = "structural"  # a representation or engineering choice, not a measured quantity
EXACT = "exact"            # a definitional conversion or identity; nothing to source

SURF_TRANSFORM = "services/weather_pipeline/surf_transform.py"
SURF_RATING = "services/weather_pipeline/surf_rating.py"
CLIMATOLOGY = "services/weather_pipeline/spot_size_climatology.py"
WAVE_PHYSICS = "services/weather_pipeline/wave_physics.py"

# ⚠️ MUST include every module the registry names (pinned by a test below) AND the chain modules it
# does not -- that asymmetry is the whole point.
CHAIN_MODULES = [
    SURF_TRANSFORM,
    SURF_RATING,
    "services/weather_pipeline/surf_point.py",
    "services/weather_pipeline/surf_height_convention.py",
    CLIMATOLOGY,
    WAVE_PHYSICS,
]

# (module, name) -> (category, why). SHRINK-ONLY. Frozen 2026-08-08 at 42 entries.
#
# ⚠️ KEYED BY (MODULE, NAME), NOT BY NAME. `_HMIN_RIDEABLE_M` is defined in BOTH surf_rating.py and
# spot_size_climatology.py -- a name is not unique across the chain. The first draft of this file
# was keyed by name alone, and the only way to hold both entries was to give one a trailing space.
# `test_the_grandfather_set_is_shrink_only` caught that hack on its first run, which is the whole
# argument for the shrink-only test existing at all.
GRANDFATHERED = {
    # -- surf_transform: the physics that is not yet sourced ------------------------------------
    (SURF_TRANSFORM, "DEEP_RATIO"): (DEBT, "d/L0 deep-water cutoff; linear wave theory, unsourced"),
    (SURF_TRANSFORM, "SHELF_CF"): (DEBT, "shelf friction coefficient, no source recorded"),
    (SURF_TRANSFORM, "SHELF_FRICTION_CF"): (DEBT, "second friction coefficient, no source recorded"),
    # ✅ SHELF_KF_FLOOR left this set on 2026-08-08 -- REGISTERED with its primary source. It was
    # the ripest entry precisely because its comment already named one, and going to that source
    # showed the comment's figure was wrong (90% vs the paper's 93%). The ratchet forced this
    # deletion on its first real use: registering the constant turned the grandfather entry stale
    # and `test_the_grandfather_set_is_shrink_only` failed until it was removed.
    (SURF_TRANSFORM, "PARTITION_MIN_QUAD_FRAC"): (DEBT, "swell-partition quadrant heuristic"),
    (SURF_TRANSFORM, "PARTITION_MAX_TP_RATIO"): (DEBT, "swell-partition period-ratio heuristic"),
    (SURF_TRANSFORM, "_CELL_KM"): (EXACT, "0.25 deg in km -- geometry, not a measurement"),
    (SURF_TRANSFORM, "_MIN_CAP_DEPTH_M"): (STRUCTURAL, "floor so the depth cap cannot go <= 0"),
    # -- surf_rating: 24 constants, ZERO registered ----------------------------------------------
    (SURF_RATING, "MS_TO_KT"): (EXACT, "unit conversion"),
    (SURF_RATING, "W_WIND"): (DEBT, "wind/period blend weight -- owner calibration, unsourced"),
    (SURF_RATING, "W_PERIOD"): (DEBT, "wind/period blend weight -- owner calibration, unsourced"),
    (SURF_RATING, "_HMIN_RIDEABLE_M"): (DEBT, "rideability floor; DUPLICATED in "
                                              "spot_size_climatology and kept in sync by a comment"),
    (SURF_RATING, "_DEFAULT_REF_SIZE_M"): (DEBT, "global fallback yardstick when a spot has none"),
    (SURF_RATING, "_REF_ANCHOR_SCORE"): (DEBT, "size_score at the reference -- shapes the curve"),
    (SURF_RATING, "_REF_SAT_MULT"): (DEBT, "size_score saturates at this multiple of the reference"),
    (SURF_RATING, "WIND_GATE_START_KT"): (DEBT, "onshore speed at which the veto begins"),
    (SURF_RATING, "WIND_GATE_ZERO_KT"): (DEBT, "onshore speed at which the day is fully vetoed"),
    (SURF_RATING, "_WIND_GATE_MIN_ONSHORE"): (DEBT, "onshore-component floor for the wind veto"),
    (SURF_RATING, "OVERSIZE_START_MULT"): (DEBT, "⭐ chosen against the p80 'good day'; "
                                                 "REF_PERCENTILE became p50 on 2026-07-30 (e3aedb06) "
                                                 "and this was never re-derived"),
    (SURF_RATING, "OVERSIZE_FLOOR_MULT"): (DEBT, "⭐ same p80 provenance as OVERSIZE_START_MULT"),
    (SURF_RATING, "OVERSIZE_ABS_START_M"): (DEBT, "tier-3 absolute taper start (~26 ft)"),
    (SURF_RATING, "OVERSIZE_ABS_FLOOR_M"): (DEBT, "tier-3 absolute taper floor (~46 ft)"),
    (SURF_RATING, "OVERSIZE_FLOOR"): (STRUCTURAL, "never 0 -- a zeroing veto erases the map band"),
    (SURF_RATING, "OVERSIZE_GAMMA"): (DEBT, "mirrors surf_transform.GAMMA, which IS registered; a "
                                            "test pins them together but only one has provenance"),
    (SURF_RATING, "OVERSIZE_CAPACITY_MULT"): (DEBT, "people stop riding below the physical maximum"),
    (SURF_RATING, "OVERSIZE_MAX_BREAK_DEPTH_M"): (DEBT, "clamp for a depth sample that missed the reef"),
    (SURF_RATING, "OVERSIZE_MIN_START_M"): (DEBT, "never claim 'too big' below ~13 ft on bathymetry"),
    (SURF_RATING, "PERIOD_GATE_FULL_S"): (DEBT, "period at/above which the veto is inert"),
    (SURF_RATING, "PERIOD_GATE_FLOOR_S"): (DEBT, "period at/below which nothing is rideable"),
    (SURF_RATING, "PERIOD_GATE_FLOOR"): (STRUCTURAL, "never 0 (band-hole guard)"),
    (SURF_RATING, "SEA_CLEAN_K"): (DEBT, "windsea-fraction penalty slope"),
    (SURF_RATING, "SEA_CLEAN_FLOOR"): (DEBT, "floor of the windsea refinement"),
    # -- spot_size_climatology: the yardstick every rating is graded against ----------------------
    (CLIMATOLOGY, "REF_PERCENTILE"): (DEBT, "⭐⭐ 0.80 -> 0.50 on 2026-07-30 (e3aedb06) orphaned BOTH "
                                            "the oversize multipliers AND the SANITY_EXEMPLARS bounds"),
    (CLIMATOLOGY, "REF_CLAMP_MIN_M"): (DEBT, "reference floor; measured binding on every census run"),
    (CLIMATOLOGY, "REF_CLAMP_MAX_M"): (DEBT, "reference ceiling; measured binding on none"),
    (CLIMATOLOGY, "_HMIN_RIDEABLE_M"): (DEBT, "the duplicate of surf_rating's, by design"),
    (CLIMATOLOGY, "BIN_WIDTH_M"): (STRUCTURAL, "histogram resolution; with N_BINS it caps any "
                                               "reference at 5.0 m regardless of REF_CLAMP_MAX_M"),
    (CLIMATOLOGY, "N_BINS"): (STRUCTURAL, "histogram width -- see BIN_WIDTH_M"),
    (CLIMATOLOGY, "MIN_SAMPLES"): (STRUCTURAL, "bootstrap threshold before a spot has a reference"),
    (CLIMATOLOGY, "SCHEMA_VERSION"): (STRUCTURAL, "blob schema version"),
    (CLIMATOLOGY, "_MERGED_BATCH_IDS_KEEP"): (STRUCTURAL, "dedupe cap for consumed inbox batches"),
    # -- wave_physics ----------------------------------------------------------------------------
    (WAVE_PHYSICS, "DIRECTIONAL_CONFLICT_MIN"): (DEBT, "swell-conflict threshold, unsourced"),
}


def _numeric_module_constants(path: pathlib.Path):
    """[(lineno, name, value)] for module-level UPPER_CASE = <numeric literal>.

    AST, never a substring scan: `"OVERSIZE" in src` matches this file's own docstring. The needle
    is a structural one only the real thing produces -- an ast.Assign at module scope whose single
    target is an upper-case Name and whose value is a numeric Constant.
    """
    tree = ast.parse(path.read_text(encoding="utf-8", errors="replace"))
    out = []
    for node in tree.body:                        # module scope only -- see the docstring's note
        if not isinstance(node, ast.Assign) or len(node.targets) != 1:
            continue
        target = node.targets[0]
        if not isinstance(target, ast.Name):
            continue
        name = target.id
        if len(name.lstrip("_")) < 3 or not name.lstrip("_").isupper():
            continue
        v = node.value
        if isinstance(v, ast.Constant) and isinstance(v.value, (int, float)) \
                and not isinstance(v.value, bool):
            out.append((node.lineno, name, v.value))
        elif (isinstance(v, ast.UnaryOp) and isinstance(v.op, ast.USub)
              and isinstance(v.operand, ast.Constant)
              and isinstance(v.operand.value, (int, float))
              and not isinstance(v.operand.value, bool)):
            out.append((node.lineno, name, -v.operand.value))
    return out


def _scan():
    """[(module, lineno, name, value, registered)] across the declared chain."""
    registered = set(SR.all_constants())
    rows = []
    for rel in CHAIN_MODULES:
        path = _BACKEND / rel
        if not path.exists():
            continue
        for lineno, name, value in _numeric_module_constants(path):
            is_reg = name in registered or name.lstrip("_") in registered
            rows.append((rel, lineno, name, value, is_reg))
    return rows


# --- the controls, first: a guard that cannot see its subject must refuse ------------------------

def test_the_scan_can_see_its_own_subject():
    """Three positive controls. Without these a green result could mean 'not sampled'."""
    rows = _scan()
    assert len(rows) >= 40, f"the chain scan found only {len(rows)} constants -- it has gone blind"
    modules_hit = {r[0] for r in rows}
    assert len(modules_hit) >= 4, f"only {modules_hit} produced any hit"
    assert any(r[4] for r in rows), "the scan matched NO registered constant -- name matching broke"


def test_the_detector_discriminates(tmp_path):
    """It must fire on a planted constant and stay silent on the shapes that are legitimately out
    of scope -- derived values, function-locals, lower-case names and non-numerics."""
    sample = tmp_path / "planted.py"
    sample.write_text(
        "PLANTED_COEFFICIENT = 0.42\n"          # hit
        "PLANTED_NEGATIVE = -1.5\n"             # hit
        "DERIVED_VALUE = PLANTED_COEFFICIENT * 2\n"   # not a literal -> skip
        "L2_KEY = 'spot_ratings/x.json'\n"      # not numeric -> skip
        "ENABLED = True\n"                      # bool -> skip
        "lower_case = 3.5\n"                    # not a constant name -> skip
        "def f():\n"
        "    INSIDE_A_FUNCTION = 9.99\n"        # function-local -> skip (documented gap)
        "    return INSIDE_A_FUNCTION\n",
        encoding="utf-8")
    names = [n for _, n, _ in _numeric_module_constants(sample)]
    assert names == ["PLANTED_COEFFICIENT", "PLANTED_NEGATIVE"], names


def test_no_registry_module_falls_out_of_scope():
    """⛔ THE CIRCULARITY GUARD. Scope must not be derived from coverage -- but a module the registry
    ALREADY names must never quietly leave the scan, which is the safe direction to pin."""
    named = {c.module for c in SR.all_constants().values()
             if c.module.startswith("services.weather_pipeline.")}
    in_scope = {rel[len("services/"):].replace("/", ".")[:-3] for rel in CHAIN_MODULES}
    in_scope = {"services." + m for m in in_scope}
    missing = sorted(named - in_scope)
    assert not missing, f"the registry names these modules but the scan does not cover them: {missing}"


def test_scope_is_not_derived_from_coverage():
    """And the unsafe direction, as an assertion rather than a comment.

    ⚠️ NAMED, NOT COUNTED. An earlier draft asserted only "at least one chain module has zero
    registered constants". Four modules satisfy that, so dropping `surf_rating.py` -- the single
    module a coverage-derived scope would most damagingly miss (24 unregistered, 0 registered) --
    left the assertion green. A mutation revealed it. Pin the module that actually matters.
    """
    assert SURF_RATING in CHAIN_MODULES, "the worst-covered module has left the scan's scope"
    registered_modules = {c.module for c in SR.all_constants().values()}
    assert "services.weather_pipeline.surf_rating" not in registered_modules, (
        "surf_rating now has a registered constant -- good, but this test's premise is stale: "
        "re-point it at whichever chain module still has zero registry coverage")
    scanned = {rel for rel, _, _, _, _ in _scan()}
    assert SURF_RATING in scanned, "surf_rating is in CHAIN_MODULES but produced no scan hit"


# --- the ratchet --------------------------------------------------------------------------------

def test_every_chain_constant_is_registered_or_explicitly_grandfathered():
    """THE RULE. A new science constant must be registered with a real source, or the author must
    consciously add it to the frozen set above and say why."""
    offenders = []
    for rel, lineno, name, value, is_reg in _scan():
        if is_reg or (rel, name) in GRANDFATHERED:
            continue
        offenders.append(f"{rel}:{lineno}  {name} = {value}")
    assert not offenders, (
        "these module-level constants are neither in science_registry.py nor in this file's "
        "GRANDFATHERED set. Register them with a real source and published range, or -- if the "
        "value is structural rather than measured -- grandfather them with a one-line reason:\n  "
        + "\n  ".join(sorted(offenders)))


def test_the_grandfather_set_is_shrink_only():
    """A ratchet, not a dumping ground: an entry that has since been registered or deleted must
    LEAVE the set. Without this the set only ever grows and the guard decays into a no-op."""
    live = {(rel, name) for rel, _, name, _, _ in _scan()}
    registered = set(SR.all_constants())
    stale = []
    for (module, name) in sorted(GRANDFATHERED):
        if name in registered or name.lstrip("_") in registered:
            stale.append(f"{module}:{name} is now REGISTERED -- remove it from GRANDFATHERED")
        elif (module, name) not in live:
            stale.append(f"{module}:{name} no longer exists there -- remove it from GRANDFATHERED")
    assert not stale, "\n  ".join([""] + stale)


def test_the_grandfathered_debt_is_reported_not_hidden():
    """The set exists to make the debt legible. Every entry carries a module, a known category and a
    non-empty reason, and the DEBT total is asserted so a successor sees it move."""
    bad = [k for k, (c, w) in GRANDFATHERED.items()
           if c not in (DEBT, STRUCTURAL, EXACT) or not w.strip() or k[0] not in CHAIN_MODULES]
    assert not bad, f"malformed grandfather entries: {bad}"
    debt = sorted(f"{m.rsplit('/', 1)[-1]}:{n}" for (m, n), (c, _w) in GRANDFATHERED.items()
                  if c == DEBT)
    # Frozen at the 2026-08-08 measurement: 32 DEBT of 42 grandfathered, against 11 registered.
    # ⚠️ 32, not 31 -- `_HMIN_RIDEABLE_M` counts ONCE PER MODULE because the two copies are separate
    # constants that can drift apart (they are kept equal by a comment, not by code). Counting them
    # as one is what made this assertion fail on its first run.
    # ✅ RATCHETED 32 -> 31 the same day: SHELF_KF_FLOOR was registered against Ardhuin et al. (2003).
    # It may SHRINK freely; a rise means new unsourced calibration entered the chain, which should be
    # a deliberate and visible decision rather than a quiet one.
    assert len(debt) <= 31, (
        f"unsourced-calibration debt has GROWN to {len(debt)} (was 31 after SHELF_KF_FLOOR was "
        f"registered on 2026-08-08): {debt}. Register the new constant with a real source instead "
        f"of extending the ratchet.")


@pytest.mark.parametrize("name", ["REF_PERCENTILE", "OVERSIZE_START_MULT", "OVERSIZE_FLOOR_MULT"])
def test_the_constants_from_the_08_08_census_failure_are_tracked(name):
    """These three are why this file exists: `REF_PERCENTILE` moved 0.80 -> 0.50 and neither
    dependent calibration was re-derived. If one is ever registered this test's sibling
    (shrink-only) forces the grandfather entry out -- so this is a floor, not a freeze."""
    tracked = {n for (_m, n) in GRANDFATHERED}
    assert name in tracked or name in SR.all_constants(), (
        f"{name} is neither tracked nor registered -- the defect this file was written for has "
        f"become invisible again")
