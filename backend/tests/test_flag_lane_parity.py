"""The flag registry must describe reality, and the two ingest lanes must agree.

WHY THIS EXISTS
---------------
`_RATING_FLAGS` in `routes/admin/surf_forecast.py` documents, for every science flag, its default,
what it controls, and WHERE TO FLIP IT. Nothing checked that column, and it had already drifted:

  * `RATING_TIDE` was listed as "Render env" while BOTH ingest lanes had set it to '1' since
    2026-07-18 and the code default is '0'. Anyone reading the table would conclude tide was off
    unless Render enabled it, when in fact every precomputed frame already had it baked in.
    Measured divergence when that flag moves: 41.0% of levels.
  * `RATING_LOCAL_SIZE` was listed as "Render env AND precompute.yml env" and was absent from
    precompute.yml, so the documented precondition for the rollout could not be satisfied. That
    flag then sat at 0 for 18 days while three separate audit failures traced back to it.

Lane drift is not hypothetical here. The `POINT_CACHE_MAX` comment in `forecast-ingest.yml` records
the 07-08 cron-hang: precompute.yml set it, forecast-ingest.yml did not, and the resulting ~100-min
ratings tail pushed runs past the 165-min timeout.

★ These tests read the WORKFLOW FILES and the REGISTRY SOURCE — no imports of the FastAPI app, no
network, no credentials. The registry is parsed with `ast` rather than imported, both to avoid
dragging in route dependencies and because a literal table should be verified as a literal.

⚠️ Render's environment is not in git and CANNOT be checked here. That is precisely why the flip
instructions have to be trustworthy: this guard makes the git-visible half honest so the operator
only has to remember the one lane nobody can see.
"""
import ast
import os
import re

import pytest

REPO = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
REGISTRY_SRC = os.path.join(REPO, "backend", "routes", "admin", "surf_forecast.py")
WORKFLOWS = os.path.join(REPO, ".github", "workflows")

# Both of these run the ingest that WRITES spot ratings, so a flag affecting the rating must match.
INGEST_LANES = ("forecast-ingest.yml", "precompute.yml")

# ⚠️⚠️ TWO SCOPES, NAMED — because they were the SAME LITERAL IN THREE PLACES and the difference
# between them was accidental, not designed. `_workflow_flags` COLLECTS four prefixes; every
# comparator below used to narrow to ("RATING_", "SURF_"), so 4 of the 8 flags the two guarded lanes
# actually set were gathered and then silently discarded by the guard built to catch lane drift.
#
# ★ PROVEN BLIND BY MUTATION (2026-08-01, audit): setting
#       precompute.yml  SPOT_RATINGS_PRECOMPUTE_MODELS: 'GFS'
#   while forecast-ingest.yml keeps 'GFS,EURO,ICON' makes the two lanes rate DIFFERENT MODEL SETS —
#   both write spot ratings to the same L2 object, so the frames disagree about which models exist.
#   Before this change that mutation left the suite at **8 passed**. It is now caught.
#
# DRIFT scope = "these two lanes must agree with each other". Operational knobs belong here: a batch
#   size or model list that differs between two lanes that BOTH write ratings is exactly the 07-08
#   cron-hang shape, even though it is not a composition flag.
# COMPOSITION scope = "this flag changes how a number is computed". Narrower on purpose: the
#   registry (`_RATING_FLAGS`) documents science flags, and the parity monitor must grade with the
#   same COMPOSITION production serves — it does not run a precompute, so it has no business
#   declaring SPOT_RATINGS_PRECOMPUTE_*.
DRIFT_PREFIXES = ("RATING_", "SURF_", "MARINE_", "SPOT_RATINGS_")
COMPOSITION_PREFIXES = ("RATING_", "SURF_")

# Flags whose value legitimately differs between the two lanes, with the reason. Empty by default:
# an entry here is a documented exception, not a place to silence a real drift.
LANE_EXCEPTIONS: dict = {
    # Set only by forecast-ingest.yml, and correctly so: it tells the EPHEMERAL ingest runner to
    # ingest BOTH EURO and ICON marine in one pass (no alternation) so the manifest is complete.
    # precompute.yml ingests no marine at all, so the flag has nothing to mean there. Absence is the
    # right value, not a drift. ⚠️ If precompute ever gains a marine ingest, DELETE this entry.
    "MARINE_INGEST_ALL": "ingest-only: precompute.yml runs no marine ingest, so the flag is inert there",
}


def _load_registry():
    """`_RATING_FLAGS` as {name: (default, description, where_to_flip)}, parsed not imported."""
    with open(REGISTRY_SRC, encoding="utf-8") as fh:
        tree = ast.parse(fh.read())
    for node in ast.walk(tree):
        if isinstance(node, ast.Assign):
            names = [t.id for t in node.targets if isinstance(t, ast.Name)]
            if "_RATING_FLAGS" in names:
                return {k: tuple(v) for k, v in ast.literal_eval(node.value).items()}
    raise AssertionError(f"_RATING_FLAGS not found in {REGISTRY_SRC}")


def _workflow_flags(filename):
    """Science flags a workflow sets, as {FLAG: 'value'}. Regex, because that is how a human greps
    these files and the comments in them are longer than the YAML."""
    path = os.path.join(WORKFLOWS, filename)
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(r"\s+((?:RATING_|SURF_|MARINE_|SPOT_RATINGS_)[A-Z0-9_]+):\s*'([^']*)'", line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


REGISTRY = _load_registry()
ALL_LANE_FLAGS = {f: _workflow_flags(f) for f in INGEST_LANES}


def test_registry_parses_and_is_not_empty():
    assert len(REGISTRY) >= 10, f"registry looks truncated: {sorted(REGISTRY)}"
    for name, entry in REGISTRY.items():
        assert len(entry) == 3, f"{name} should be (default, description, where_to_flip)"
        assert entry[0] in ("0", "1"), f"{name} default should be '0' or '1', got {entry[0]!r}"
        assert entry[2], f"{name} has no 'where to flip' guidance"


@pytest.mark.parametrize("lane", INGEST_LANES)
def test_a_workflow_that_overrides_a_default_is_declared_in_the_registry(lane):
    """THE defect this file was written for.

    If a workflow sets a flag to something other than its code default, the registry's 'where to
    flip' column must name that workflow — otherwise the table actively misleads about what the
    ingest lanes produce, which is what happened with RATING_TIDE for eleven days."""
    undeclared = []
    for flag, value in ALL_LANE_FLAGS[lane].items():
        entry = REGISTRY.get(flag)
        if entry is None:
            continue                     # covered by the next test
        default, _desc, where = entry
        if value != default and lane not in where:
            # ASCII only: a failure message is read on whatever console the operator has, and a
            # non-ASCII character here renders as a replacement glyph in pytest output.
            undeclared.append(f"{flag}={value!r} (default {default!r}) -> 'where to flip' says {where!r}")
    assert not undeclared, (
        f"{lane} overrides these flags but the registry does not name it:\n  "
        + "\n  ".join(undeclared)
    )


@pytest.mark.parametrize("lane", INGEST_LANES)
def test_every_science_flag_a_workflow_sets_is_declared_at_all(lane):
    """An undeclared flag is invisible to the one surface that is supposed to list them."""
    known = set(REGISTRY)
    # Operational knobs (batch sizes, model lists, hour selection) are not science flags and are out
    # of the registry's scope by design. Only RATING_*/SURF_* change the forecast composition.
    science = {f for f in ALL_LANE_FLAGS[lane] if f.startswith(COMPOSITION_PREFIXES)}
    missing = sorted(science - known)
    assert not missing, f"{lane} sets science flags absent from _RATING_FLAGS: {missing}"


def test_the_two_ingest_lanes_agree():
    """Both lanes write spot ratings. A flag set in one and not the other makes them produce
    inconsistent frames — the 07-08 cron-hang shape, recorded at POINT_CACHE_MAX in
    forecast-ingest.yml."""
    a, b = ALL_LANE_FLAGS[INGEST_LANES[0]], ALL_LANE_FLAGS[INGEST_LANES[1]]
    # DRIFT scope, not COMPOSITION scope — see the block above. Both lanes write spot ratings, so an
    # operational knob that differs between them is as damaging as a science flag that does.
    science = {f for f in set(a) | set(b) if f.startswith(DRIFT_PREFIXES)}
    drift = []
    for flag in sorted(science):
        va, vb = a.get(flag), b.get(flag)
        if va == vb or flag in LANE_EXCEPTIONS:
            continue
        # Absent means "code default", which only differs if the other lane overrode it.
        default = REGISTRY.get(flag, (None,))[0]
        if (va if va is not None else default) != (vb if vb is not None else default):
            drift.append(f"{flag}: {INGEST_LANES[0]}={va!r} vs {INGEST_LANES[1]}={vb!r}")
    assert not drift, "the two ingest lanes disagree on science flags:\n  " + "\n  ".join(drift)


def test_local_size_is_present_in_both_lanes_so_the_rollout_is_atomic():
    """`RATING_LOCAL_SIZE` is the fix for all three current science-audit failures (the owner's
    '4 ft is not epic' anchor, size_score saturating so 4/6/8/10/12 ft all score 84.0, and the
    H1/10 statistic which must flip WITH a re-solved reference).

    It must be PRESENT in both lanes even while it is '0'. Absent, flipping Render env alone changes
    the live band while the precomputed glyphs keep the global reference — two surfaces disagreeing
    on quality, which is the ONE FORECAST COMPOSITION rule broken by a config gap rather than code.
    Present at its default, the flip is one grep and one edit per lane."""
    for lane in INGEST_LANES:
        assert "RATING_LOCAL_SIZE" in ALL_LANE_FLAGS[lane], (
            f"RATING_LOCAL_SIZE missing from {lane}; flipping it in Render env alone would split "
            f"the live band from the precomputed glyphs"
        )
    values = {ALL_LANE_FLAGS[lane]["RATING_LOCAL_SIZE"] for lane in INGEST_LANES}
    assert len(values) == 1, f"the lanes disagree on RATING_LOCAL_SIZE: {values}"


# ── THE PARITY MONITOR IS A THIRD LANE, AND IT MEASURES RATHER THAN WRITES ──────────────────────
# sim-parity-monitor.yml runs the SIM in a GitHub runner and compares it to what the serve box
# PRECOMPUTED. Science flags are read per-process from the environment (sim_rating.py:91 for local
# size), so a flag set in the ingest lanes and unset in the monitor makes the two sides grade with
# DIFFERENT COMPOSITIONS — and the monitor then reports a divergence that is entirely its own.
#
# ★★ THIS IS WORSE THAN AN ORDINARY DRIFT. A wrong ingest flag produces wrong ratings, which is
# visible. A wrong MONITOR flag produces a false alarm on correct ratings, which teaches everyone to
# ignore the alarm — and the next real divergence is waved off with it.
#
# Caught on 2026-08-01 the same hour RATING_LOCAL_SIZE flipped: the monitor set NONE of the four
# science flags the ingest lanes set, so its sim would have graded on the global 1.2 m reference
# while production served the local one — a median -4.9 and up to -58.1 point gap, paging every run.
MONITOR_LANE = "sim-parity-monitor.yml"

# The WORLDWIDE coastal pilot lane. It runs its own ingest on its own cron (`45 3,11,19`) and the
# registry names it as the flip target for three flags, so it is a science lane — but until
# 2026-08-01 no test in this repo opened it. It sets ZERO matching flags today, which is exactly why
# guarding it now is cheap: the guard is vacuously green until someone follows the registry's
# instruction, and load-bearing from that moment.
PILOT_LANE = "forecast-ingest-pilots.yml"
PILOT_FLAGS = _workflow_flags(PILOT_LANE)


def test_every_science_flag_the_pilot_lane_sets_is_declared_in_the_registry():
    """Same contract as the ingest lanes: an undeclared flag is invisible to the admin surface."""
    missing = sorted({f for f in PILOT_FLAGS if f.startswith(COMPOSITION_PREFIXES)} - set(REGISTRY))
    assert not missing, f"{PILOT_LANE} sets science flags absent from _RATING_FLAGS: {missing}"


def test_the_pilot_lane_does_not_contradict_the_ingest_lanes():
    """The pilots lane ingests the worldwide coastal regions the other lanes then RATE. A flag they
    share must not disagree, or the same coast is ingested under one composition and rated under
    another — the ONE FORECAST COMPOSITION rule broken by a config gap rather than by code."""
    drift = []
    for lane in INGEST_LANES:
        other = ALL_LANE_FLAGS[lane]
        for flag in sorted(set(PILOT_FLAGS) & set(other)):
            if flag in LANE_EXCEPTIONS or not flag.startswith(DRIFT_PREFIXES):
                continue
            if PILOT_FLAGS[flag] != other[flag]:
                drift.append(f"{flag}: {PILOT_LANE}={PILOT_FLAGS[flag]!r} vs {lane}={other[flag]!r}")
    assert not drift, "the pilot lane disagrees with an ingest lane:\n  " + "\n  ".join(drift)


def test_the_parity_monitor_grades_with_the_same_composition_it_measures():
    monitor = _workflow_flags(MONITOR_LANE)
    assert monitor, (
        f"{MONITOR_LANE} declares no science flags at all; it would grade the sim with code "
        f"defaults while production serves the ingest lanes' composition"
    )
    ingest = ALL_LANE_FLAGS[INGEST_LANES[0]]
    drift = []
    for flag, value in sorted(ingest.items()):
        # COMPOSITION scope: the monitor grades, it does not precompute. See the block at the top.
        if not flag.startswith(COMPOSITION_PREFIXES):
            continue
        if monitor.get(flag) != value:
            drift.append(f"{flag}: ingest={value!r} vs monitor={monitor.get(flag)!r}")
    assert not drift, (
        "the sim parity monitor would grade with a different composition than production serves, "
        "so it would page on its own configuration:\n  " + "\n  ".join(drift)
    )


# ── THE REGISTRY MUST NOT SEND AN OPERATOR TO A LANE NOBODY GUARDS ──────────────────────────────
# Measured 2026-08-01: THREE registry entries name the pilots workflow as their flip lane —
# `RATING_GRID_SIZE_CLIMATOLOGY` (a COMPOSITION flag), `EURO_MARINE_MID_ECMWF` and
# `EURO_MARINE_MID_RES_INGEST` — while `INGEST_LANES` above reads only forecast-ingest.yml and
# precompute.yml, and `MONITOR_LANE` only sim-parity-monitor.yml. So the admin panel tells an
# operator to flip a science flag in a file no test in this repo opens.
#
# ★ THE INVARIANT IS DERIVED, NOT LISTED. Hardcoding "also check the pilots lane" would rot the
# moment a fourth lane is named — the exact staleness class this suite exists to prevent. Instead
# the lane set is READ OUT OF THE REGISTRY, so adding a new flip lane to `_RATING_FLAGS` fails this
# test until a guard actually reads that lane. A registry is a claim of completeness; this is what
# makes the claim checkable.
_LANE_FILES = {
    "pilots": PILOT_LANE,
    "forecast-ingest": "forecast-ingest.yml",
    "precompute": "precompute.yml",
    "sim-parity-monitor": "sim-parity-monitor.yml",
}
# Lanes this module actually reads and compares. Render env is deliberately out of scope: it is not
# in git, which is itself recorded as a gap (render.yaml describes no deployed service).
GUARDED_LANES = set(INGEST_LANES) | {MONITOR_LANE, PILOT_LANE}


# ── EVERY SCIENCE SWITCH A RATING SURFACE READS MUST BE DECLARED ────────────────────────────────
# Measured 2026-08-01: the rating surfaces read 17 RATING_/SURF_/SPOT_HUB_ flags and NINE were
# absent from `_RATING_FLAGS` — including all THREE multiplicative vetoes (`RATING_WIND_GATE`,
# `RATING_OVERSIZE`, `RATING_PERIOD_GATE`), each of which exists to close a measured defect, and
# `SPOT_HUB_SURF_TRANSFORM`, a SECOND kill switch for the same transform that `SURF_TRANSFORM`
# gates. An operator pulling the documented switch left the hub transforming.
#
# ★ DERIVED, NOT LISTED — the same shape as the lane test below. The flag set is READ OUT OF THE
# SOURCE, so a new switch added to any rating surface fails this test until it is declared. A
# hardcoded list would go stale exactly the way the registry did.
_RATING_SURFACES = (
    "services/weather_pipeline/spot_ratings.py",
    "services/weather_pipeline/spot_conditions.py",
    "services/weather_pipeline/sim_rating.py",
    "services/weather_pipeline/grid_resolver_surf.py",
    "services/weather_pipeline/point_surf_augment.py",
    "services/weather_pipeline/surf_rating.py",
    "services/weather_pipeline/surf_transform.py",
    "routes/weather.py",
)
_SCIENCE_PREFIXES = ("RATING_", "SURF_", "SPOT_HUB_")
# NAMED exemptions with reasons — not a silencer. Each entry states why the registry is the wrong
# home for that flag, so removing an exemption is a deliberate act visible in a diff.
_REGISTRY_EXEMPT = {
    # The registry's own contract is a boolean default (`test_registry_parses_and_is_not_empty`
    # asserts entry[0] in ("0","1")). These two are CALIBRATION SCALARS, not switches; declaring
    # them would force widening that contract for every flag. They belong with the physics.
    "SURF_SHELF_CF_SCALE": "calibration scalar (default '0.25'), not a boolean switch",
    "SURF_V3_JACK_MAX": "calibration scalar (default '2.0'), not a boolean switch",
}


def test_every_science_switch_a_rating_surface_reads_is_declared_in_the_registry():
    """An undeclared switch is invisible to the admin panel AND to every guard in this file — so it
    can be flipped in one lane and drift with nothing to catch it."""
    import re
    pat = re.compile(r'os\.environ\.get\(\s*["\']([A-Z][A-Z0-9_]{3,})["\']')
    read = {}
    for rel in _RATING_SURFACES:
        path = os.path.join(REPO, "backend", rel)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            for m in pat.finditer(fh.read()):
                if m.group(1).startswith(_SCIENCE_PREFIXES):
                    read.setdefault(m.group(1), set()).add(os.path.basename(rel))
    assert read, "found no science flags at all — the scan broke, which would pass vacuously"
    missing = {f: sorted(s) for f, s in read.items()
               if f not in REGISTRY and f not in _REGISTRY_EXEMPT}
    assert not missing, (
        "a rating surface reads a science switch that _RATING_FLAGS does not declare, so it is "
        "invisible to the admin panel and to every lane guard here:\n  "
        + "\n  ".join(f"{f} (read by {', '.join(w)})" for f, w in sorted(missing.items()))
        + "\n\nDeclare it in routes/admin/surf_forecast.py, or add a NAMED exemption with the "
          "reason it does not belong there."
    )


def test_no_exemption_outlives_the_flag_it_excuses():
    """A stale exemption is a silencer. If the flag is gone, or has since been declared, the
    exemption must go with it — otherwise the list slowly becomes a place to hide new flags."""
    import re
    pat = re.compile(r'os\.environ\.get\(\s*["\']([A-Z][A-Z0-9_]{3,})["\']')
    read = set()
    for rel in _RATING_SURFACES:
        path = os.path.join(REPO, "backend", rel)
        if os.path.exists(path):
            with open(path, encoding="utf-8") as fh:
                read |= set(pat.findall(fh.read()))
    for flag in _REGISTRY_EXEMPT:
        assert flag in read, f"exemption for {flag} outlived the flag; delete it"
        assert flag not in REGISTRY, f"{flag} is now declared — delete its exemption"


def test_every_workflow_lane_the_registry_names_is_a_lane_this_suite_reads():
    """A flag whose documented flip target is an unguarded workflow can drift with nothing to catch
    it — and the operator was following the registry's own instruction when they flipped it."""
    unguarded = {}
    for flag, (_default, _desc, where) in sorted(REGISTRY.items()):
        text = str(where).lower()
        if "workflow" not in text and ".yml" not in text:
            continue                       # Render env / code default — not a workflow lane
        for key, filename in _LANE_FILES.items():
            if key in text and filename not in GUARDED_LANES:
                unguarded.setdefault(filename, []).append(flag)
    assert not unguarded, (
        "_RATING_FLAGS sends an operator to a workflow lane no test in this suite reads, so a flag "
        "flipped there drifts unguarded:\n  "
        + "\n  ".join(f"{lane}: {sorted(flags)}" for lane, flags in sorted(unguarded.items()))
        + "\n\nFix by adding the lane to INGEST_LANES/GUARDED_LANES (and comparing it), or by "
          "correcting the registry's 'where to flip' if that lane is no longer the right target."
    )
