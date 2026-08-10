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
# ★ `SHORE_NORMAL_` added 2026-08-02. Every switch governing the shore normal — the #1 Jacobian
#   variable, worth 7.4 rating points at the median coarse error and 28.1 at +45° — was invisible
#   to this guard, because none of them starts with any of the four prefixes above and none was
#   declared in a lane at all. Same shape as the nine undeclared science switches in `62691c88`:
#   a flag the drift guard cannot see can hold a different value in each lane, and the same spot
#   then faces two different directions depending on which lane wrote the frame.
DRIFT_PREFIXES = ("RATING_", "SURF_", "MARINE_", "SPOT_RATINGS_", "SHORE_NORMAL_", "ECMWF_")
# ★ `SHORE_NORMAL_` added to COMPOSITION on 2026-08-02 (audit v5 F1), and the distinction is the
#   whole point: it was already in DRIFT, so the two INGEST lanes were compared — but the parity
#   MONITOR's comparator narrows to COMPOSITION, so `SHORE_NORMAL_BEARING_RADIUS_KM` was collected
#   from `sim-parity-monitor.yml` and then silently skipped. Deleting that line outright left this
#   suite at 13 passed. A bearing radius decides WHICH WAY A BEACH FACES for the rating, so by this
#   file's own definition — "COMPOSITION scope = this flag changes how a number is computed" — it
#   belongs here. ⚠️ Adding a prefix here also binds it to the REGISTRY contract below, which is
#   correct and is why both shore-normal kill switches had to be registered in the same change.
# ⚠️ `ECMWF_` is deliberately NOT here. `ECMWF_PERIOD_BANDS` gates a FETCH, not an arithmetic step,
#   and the monitor fetches nothing — it grades what was served. Revisit the moment the composition
#   half is wired, because from then on the flag DOES change a computed number.
COMPOSITION_PREFIXES = ("RATING_", "SURF_", "SHORE_NORMAL_")

# Flags whose value legitimately differs between the two lanes, with the reason. Empty by default:
# an entry here is a documented exception, not a place to silence a real drift.
LANE_EXCEPTIONS: dict = {
    # Set only by forecast-ingest.yml, and correctly so: it tells the EPHEMERAL ingest runner to
    # ingest BOTH EURO and ICON marine in one pass (no alternation) so the manifest is complete.
    # precompute.yml ingests no marine at all, so the flag has nothing to mean there. Absence is the
    # right value, not a drift. ⚠️ If precompute ever gains a marine ingest, DELETE this entry.
    "MARINE_INGEST_ALL": "ingest-only: precompute.yml runs no marine ingest, so the flag is inert there",
    # ★ Same shape, MEASURED not assumed (audit v5 F8). Import-graph walk from each lane's own
    # entrypoint: `scripts/precompute_ci.py` reaches NO ecmwf module across 57 files, while
    # `scripts/ingest_forecast_ci.py` — shared by forecast-ingest.yml AND forecast-ingest-pilots.yml
    # — reaches `services.ecmwf_wave_service` via `euro_marine_coarse_ingestion` and
    # `marine_mid_res_ingestion` across 81. precompute cannot fetch a period band whatever this flag
    # says, so declaring it there was an inert entry of exactly the recorded
    # `WORLDWIDE_REGIONS_PER_CYCLE` kind: a lever documented in a lane that never reads it.
    # ⚠️ I declared it there first, reasoning "the wave service spawns the fetcher as a subprocess,
    # so both lanes can reach it". True of the SERVICE, false of the LANE. Walk the graph.
    "ECMWF_PERIOD_BANDS": "ingest-only: precompute_ci.py imports no ecmwf module (57 files walked), "
                          "so the flag is unreadable there; forecast-ingest.yml and "
                          "forecast-ingest-pilots.yml both carry it",
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


# ★★ DERIVED FROM `DRIFT_PREFIXES`, NOT A SECOND COPY OF IT — and that is the whole point.
# This regex used to hardcode its own list `(RATING_|SURF_|MARINE_|SPOT_RATINGS_)`. Adding
# `SHORE_NORMAL_` to `DRIFT_PREFIXES` on 2026-08-02 therefore changed NOTHING: the comparator knew
# five prefixes while the collector still gathered four, so the new flag was compared against a set
# it was never collected into. Proven by mutation — drifting `SHORE_NORMAL_BEARING_RADIUS_KM` to
# '1.0' in ONE lane left this suite at 13 passed.
#
# That is the SAME SHAPE as the defect `0f7076a6` fixed (collected 8, compared 4), arriving from the
# opposite direction, and it is the repo's recorded "a duplicated constant only diverges on a
# boundary" class: two lists agree until someone edits one. There is now one list.
_COLLECT_RE = r"\s+((?:" + "|".join(DRIFT_PREFIXES) + r")[A-Z0-9_]+):\s*'([^']*)'"


def _workflow_flags(filename):
    """Science flags a workflow sets, as {FLAG: 'value'}. Regex, because that is how a human greps
    these files and the comments in them are longer than the YAML."""
    path = os.path.join(WORKFLOWS, filename)
    if not os.path.exists(path):
        return {}
    out = {}
    with open(path, encoding="utf-8") as fh:
        for line in fh:
            m = re.match(_COLLECT_RE, line)
            if m:
                out[m.group(1)] = m.group(2)
    return out


REGISTRY = _load_registry()
ALL_LANE_FLAGS = {f: _workflow_flags(f) for f in INGEST_LANES}


def test_registry_parses_and_is_not_empty():
    assert len(REGISTRY) >= 10, f"registry looks truncated: {sorted(REGISTRY)}"
    for name, entry in REGISTRY.items():
        assert len(entry) == 3, f"{name} should be (default, description, where_to_flip)"
        # ⚠️ RELAXED 2026-08-02 from `in ("0", "1")`. That assertion encoded an assumption — every
        # science switch is a boolean — which held until `SHORE_NORMAL_BEARING_RADIUS_KM` (a
        # RADIUS in km, default '3.0'). The choice was to keep the tighter assertion and leave the
        # #1 Jacobian variable's switch OUT of the operator's only view of Render, or to admit
        # non-boolean switches. Excluding it is the worse failure: an unregistered kill switch is
        # one an operator cannot find mid-incident.
        # ★ The guard is NOT weakened to "anything goes" — a default must still be a value the
        # process could actually read from an environment variable, i.e. a non-empty string that
        # parses as a bool-like or a number. A `None`, a `True`, or an empty default would mean the
        # registry is documenting something env parsing cannot produce.
        assert isinstance(entry[0], str) and entry[0] != "", \
            f"{name} default must be a non-empty string (env values are strings), got {entry[0]!r}"
        if entry[0] not in ("0", "1"):
            try:
                float(entry[0])
            except ValueError:
                raise AssertionError(
                    f"{name} default {entry[0]!r} is neither a boolean '0'/'1' nor numeric — a "
                    f"registry entry must describe a value the environment can actually supply")
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
        # ⚠️ `LANE_EXCEPTIONS` is deliberately NOT consulted here, and that is a 2026-08-02 fix to a
        # defect I introduced the same hour. Every entry in it excuses an ABSENCE — "precompute runs
        # no marine ingest, so the flag is inert there". This loop iterates the INTERSECTION, so
        # both lanes have supplied a value and a difference between them is always real drift.
        # Consulting the exception here made the two meanings one: adding `ECMWF_PERIOD_BANDS` to
        # excuse its absence from precompute silently excused DRIFT between the core and pilot
        # lanes too, and setting pilots to '1' against the core's '0' left this suite at 13 passed.
        # An exception scoped wider than the fact it documents is a hole, not a waiver.
        for flag in sorted(set(PILOT_FLAGS) & set(other)):
            if not flag.startswith(DRIFT_PREFIXES):
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
    # ⬆ ADDED 2026-08-02 (audit v5 F5/F10). These three resolve or convert the numbers the surfaces
    # above rate, and every switch in them was invisible to this scan purely because the FILE was
    # not listed. Measured before the change: the scan saw 17 science flags while 35 were read
    # across the chain — blind to more than it could see. What these three add is not obscure:
    #   surf_point.py             SURF_V3_NORMAL_OVERRIDES — the kill switch for human ground truth
    #   shore_normal_asset.py     the #1 Jacobian variable's own switches
    #   surf_height_convention.py SURF_HEIGHT_H110 — the recorded "+25.5% too high" landmine
    # ⚠️ `ecmwf_opendata_fetcher.py` is deliberately NOT here. It reads six ECMWF_* knobs, but it is
    # an INGEST fetcher, not a rating surface; pulling it in would demand that operational knobs be
    # declared in a SCIENCE registry, which is a different contract. Scope by role, not by grep hit.
    "services/weather_pipeline/surf_point.py",
    "services/weather_pipeline/shore_normal_asset.py",
    "services/weather_pipeline/surf_height_convention.py",
)
_SCIENCE_PREFIXES = ("RATING_", "SURF_", "SPOT_HUB_", "SHORE_NORMAL_")

# ★ THE SECOND ESCAPE ROUTE. `surf_transform._v3(flag)` is `os.environ.get(flag, "1") != "0"` — the
# name arrives as a VARIABLE, so a scan matching only `os.environ.get("LITERAL")` cannot see it.
# Four physics switches sat inside a file this scan ALREADY walked and were invisible anyway:
# SURF_V3_EXPOSURE, SURF_V3_KOMAR, SURF_V3_MAGNETS, SURF_V3_SHELF_RECAL. A guard keyed on a syntax
# rather than on a fact is blind to every wrapper anyone writes.
_ENV_READ_PATTERNS = (
    r'os\.environ\.get\(\s*["\']([A-Z][A-Z0-9_]{3,})["\']',
    r'_v3\(\s*["\']([A-Z][A-Z0-9_]{3,})["\']',
)


def _science_flags_read_by_surfaces():
    """{FLAG: {file, ...}} for every science switch a rating surface reads, by ANY known form."""
    import re
    pats = [re.compile(p) for p in _ENV_READ_PATTERNS]
    read = {}
    for rel in _RATING_SURFACES:
        path = os.path.join(REPO, "backend", rel)
        if not os.path.exists(path):
            continue
        with open(path, encoding="utf-8") as fh:
            src = fh.read()
        for pat in pats:
            for m in pat.finditer(src):
                if m.group(1).startswith(_SCIENCE_PREFIXES):
                    read.setdefault(m.group(1), set()).add(os.path.basename(rel))
    return read
# NAMED exemptions with reasons — not a silencer. Each entry states why the registry is the wrong
# home for that flag, so removing an exemption is a deliberate act visible in a diff.
_REGISTRY_EXEMPT = {
    # The registry's own contract is a boolean default (`test_registry_parses_and_is_not_empty`
    # asserts entry[0] in ("0","1")). These two are CALIBRATION SCALARS, not switches; declaring
    # them would force widening that contract for every flag. They belong with the physics.
    "SURF_SHELF_CF_SCALE": "calibration scalar (default '0.25'), not a boolean switch",
    "SURF_V3_JACK_MAX": "calibration scalar (default '2.0'), not a boolean switch",
    # A FILESYSTEM PATH, not a science switch. It relocates the overlay file for tests; it cannot
    # change a number. The registry's "where to flip" column would have nothing true to say about
    # it, and an operator scanning that panel during an incident should not meet it.
    # ⚠️ Its SIBLING `SHORE_NORMAL_OVERLAY` — which does gate behaviour — IS declared. The two names
    # are one character apart, so the reason for the split is written here rather than assumed.
    "SHORE_NORMAL_OVERLAY_PATH": "filesystem path for test relocation, not a behaviour switch",
}


def test_every_science_switch_a_rating_surface_reads_is_declared_in_the_registry():
    """An undeclared switch is invisible to the admin panel AND to every guard in this file — so it
    can be flipped in one lane and drift with nothing to catch it."""
    read = _science_flags_read_by_surfaces()
    # ★ A COVERAGE FLOOR, not just "read is non-empty". Once every switch is declared, this test
    # passes whether the scan sees 27 flags or 3 — so NARROWING it (dropping a file from
    # `_RATING_SURFACES`, or a pattern from `_ENV_READ_PATTERNS`) becomes undetectable, and the
    # next undeclared switch lands in a blind spot with the suite green. That is exactly how the
    # scan came to see 17 of 35. Shrink-only, same contract as `ci.yml`'s MIN_FILES: raise it when
    # coverage genuinely grows, never lower it to make a red go away.
    # Measured on origin/dev @ 2026-08-02 after closing both escape routes: 27.
    assert len(read) >= 27, (
        f"the scan now sees only {len(read)} science flags, down from a measured 27 — a file or an "
        f"env-read pattern has been dropped, so switches are once again invisible to this guard.\n"
        f"  visible: {sorted(read)}")
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
    # ONE reader, shared with the test above. Two copies of a scan is how the first version came to
    # see 17 flags of 35 — and how the two would have drifted the moment either grew a pattern.
    read = set(_science_flags_read_by_surfaces())
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


# ══════════════════════════════════════════════════════════════════════════════════════════════
# THE COMPOSITION FILE LIST IS DUPLICATED ACROSS TWO LANES, AND ONLY ONE OF THEM SELECTS
# ══════════════════════════════════════════════════════════════════════════════════════════════
# ci.yml:383   FILES=$(ls tests/test_sim_*.py ...)          the composition lane's ACTUAL SELECTOR
# ci.yml:~500  COMPOSITION = ["tests/test_sim_*.py", ...]   the CHAIN lane's EXCLUSION list, so the
#                                                           chain does not re-run composition's files
#
# They must describe the same set, and nothing checked that. On 2026-08-02 two orphaned forecast
# guards were adopted by editing only the Python literal — which told the chain lane to keep
# excluding files the composition lane had never heard of. The count did not move, the ratchet went
# red, and the fix was a second edit to the `ls` glob.
#
# ★ The failure mode is worse than a wrong number. A pattern present in the EXCLUSION list and absent
# from the SELECTOR produces a file that runs in NEITHER lane — silently, with every gate green. That
# is this repo's most-recorded defect class, and here it is a data structure that invites it.
# Recorded sibling: a duplicated constant only diverges on a boundary (seven copies of the knots pair).

_CI_YML = os.path.join(WORKFLOWS, "ci.yml")
# Deliberate, documented, and NOT a defect: these need a `dev.db` GitHub Actions does not have
# (ci.yml's own note at the composition ratchet). They are named here so the exclusion stays VISIBLE
# and cannot quietly grow — anything else dropping out of both lanes fails this test.
_COMPOSITION_EXEMPT = {"test_weather_sim_mcp.py", "test_weather_sim_mcp_server_startup.py"}


def _composition_selector_patterns(text):
    """The `ls` glob the composition lane actually runs, plus its grep -vE exclusion."""
    m = re.search(r"FILES=\$\(ls\s+(.*?)\s+2>/dev/null", text, re.S)
    assert m, "ci.yml's composition `ls` glob no longer parses — the guard is blind, fix the regex"
    pats = [t for t in m.group(1).split() if t.startswith("tests/")]
    ex = re.search(r"grep -vE '([^']+)'", text)
    return pats, (ex.group(1) if ex else None)


def _chain_exclusion_patterns(text):
    """The COMPOSITION literal the chain lane subtracts from its own candidate set."""
    m = re.search(r"COMPOSITION = \[(.*?)\]\n", text, re.S)
    assert m, "ci.yml's COMPOSITION literal no longer parses — the guard is blind, fix the regex"
    return re.findall(r'"([^"]+)"', m.group(1))


def _resolve(patterns):
    import glob as _glob
    base = os.path.join(REPO, "backend")
    out = set()
    for p in patterns:
        out |= {os.path.basename(f) for f in _glob.glob(os.path.join(base, p))}
    return out


def test_the_two_composition_file_lists_resolve_to_the_same_set():
    text = open(_CI_YML, encoding="utf-8").read()
    sel_pats, excl = _composition_selector_patterns(text)
    chain_pats = _chain_exclusion_patterns(text)

    selected = _resolve(sel_pats)
    if excl:
        rx = re.compile(excl)
        selected = {f for f in selected if not rx.search(f)}
    excluded_from_chain = _resolve(chain_pats)

    # Setup assertion: a guard over empty sets proves nothing.
    assert len(selected) > 50 and len(excluded_from_chain) > 50, (
        f"resolved too few files (selector {len(selected)}, chain {len(excluded_from_chain)}) — "
        "the patterns did not match, so this test would pass vacuously")

    runs_nowhere = (excluded_from_chain - selected) - _COMPOSITION_EXEMPT
    assert runs_nowhere == set(), (
        "these test files are EXCLUDED from the chain lane and NOT SELECTED by the composition lane, "
        "so they run in NEITHER and every gate stays green:\n  " + "\n  ".join(sorted(runs_nowhere))
        + "\n\nFix by adding them to ci.yml's composition `ls` glob (the SELECTOR at :383), not only "
          "to the COMPOSITION literal — editing the literal alone is what caused this.")

    twice = selected - excluded_from_chain
    assert twice == set(), (
        "these files are selected by the composition lane but NOT excluded from the chain lane, so "
        "both lanes run them and the two ratchets double-count:\n  " + "\n  ".join(sorted(twice)))


def test_the_composition_list_guard_can_actually_FAIL():
    """NEGATIVE CONTROL, both directions — without it the test above passes on a broken parser.

    The two real mutations are simulated on the parsed sets rather than on disk: a pattern added to
    the chain literal only (the 2026-08-02 mistake), and one added to the selector only.
    """
    text = open(_CI_YML, encoding="utf-8").read()
    sel_pats, excl = _composition_selector_patterns(text)
    chain_pats = _chain_exclusion_patterns(text)
    rx = re.compile(excl) if excl else None
    selected = {f for f in _resolve(sel_pats) if not (rx and rx.search(f))}
    chain = _resolve(chain_pats)
    assert selected and chain                                  # setup landed

    # (a) the real mistake: adopted into the chain literal only -> the file runs NOWHERE
    victim = sorted(selected)[0]
    broken_chain = chain | {"test_a_file_the_selector_never_sees.py"}
    assert (broken_chain - selected) - _COMPOSITION_EXEMPT, "the runs-nowhere check cannot fail — it is decoration"

    # (b) the inverse: selected but not excluded -> BOTH lanes run it, ratchets double-count
    broken_sel = selected | {"test_a_file_the_chain_still_runs.py"}
    assert broken_sel - chain, "the run-twice check cannot fail — it is decoration"
    assert victim in selected                                  # the fixture is real, not invented


# ── THE E2E TRIGGER CONTRACT (2026-08-10) ─────────────────────────────────────────────────────
# Measured over the 30 most recent E2E runs: 9 (30%) fired on commits touching nothing but
# markdown, and `cancel-in-progress` means such a push KILLS the in-flight run of the code commit
# before it. From 16:25Z to 17:11Z eight consecutive runs were cancelled and none completed --
# six of those commits were CODE, so end-to-end coverage over that window was ZERO.
E2E_WORKFLOW = os.path.join(WORKFLOWS, "e2e-tests.yml")

# Paths that MUST still trigger the lane. A `paths-ignore` is a silent kill switch if it widens:
# `paths-ignore: ['**']` disables E2E forever and a presence-only check would pass.
E2E_MUST_TRIGGER = ("frontend/src/App.js", "frontend/e2e/weather-simulation.spec.js",
                    "backend/routes/weather.py", "package.json",
                    ".github/workflows/e2e-tests.yml")


def _e2e_yaml():
    yaml = pytest.importorskip("yaml")
    with open(E2E_WORKFLOW, encoding="utf-8") as fh:
        return yaml.safe_load(fh)


def _e2e_push_block():
    # PyYAML parses a bare `on:` key as the BOOLEAN True (YAML 1.1 truthiness), which is why this
    # looks up both -- a guard that only checked "on" would silently read None and pass vacuously.
    doc = _e2e_yaml()
    on = doc.get("on", doc.get(True))
    assert isinstance(on, dict), "e2e-tests.yml `on:` did not parse as a mapping"
    push = on.get("push")
    assert isinstance(push, dict), "the push trigger is missing"
    return push


def test_e2e_does_not_run_on_documentation_only_commits():
    """A docs commit cannot change what this lane tests, and it can destroy another commit's
    only evidence. `7e231c1b` -- a SINGLE markdown file -- produced the only genuine E2E failure
    in the 30-run sample (11 failed, all navigation timeouts, on a diff that touches no code)."""
    ignore = _e2e_push_block().get("paths-ignore")
    assert ignore, "paths-ignore is absent -- docs commits will trigger a ~20 min browser lane"
    assert any(p.endswith("*.md") for p in ignore), "markdown must not trigger the lane"
    assert any(p.startswith("docs/") for p in ignore)
    assert any(p.startswith("audit/") for p in ignore)


@pytest.mark.parametrize("path", E2E_MUST_TRIGGER)
def test_the_ignore_list_never_swallows_a_path_that_must_still_run(path):
    """KNOWN-PRESENT CONTROL, and the one that matters. A presence-only check on `paths-ignore`
    would pass just as happily with `['**']`, which turns the whole lane off and reports green
    forever -- the 'guard that runs nowhere' shape, self-inflicted via a trigger.
    """
    import fnmatch
    ignore = _e2e_push_block().get("paths-ignore") or []
    hit = [p for p in ignore if fnmatch.fnmatch(path, p) or (p.endswith("/**") and path.startswith(p[:-3] + "/"))]
    assert not hit, f"{path} would be IGNORED by {hit} -- the lane would not run on real changes"


def test_superseded_runs_are_still_cancelled_and_the_reason_is_recorded():
    """⭐ THE OBVIOUS FIX FOR A 65% CANCELLATION RATE IS WRONG, so it is pinned against.

    This lane drives the LIVE DEPLOYED site, not a build of the checked-out tree. With
    `cancel-in-progress: false` a queued run for commit N would execute against the deployment of
    commit N+3 and publish its verdict under N's SHA -- a MISLABELLED result, worse than none.
    Superseded runs are genuinely obsolete the moment a newer commit deploys.
    """
    doc = _e2e_yaml()
    conc = doc.get("concurrency") or {}
    assert conc.get("cancel-in-progress") is True, (
        "cancel-in-progress must stay true: this lane tests the LIVE deployment, so a superseded "
        "run would report another commit's deployment under this commit's SHA")
    # ⚠️ THIS ASSERTION WAS FIRST WRITTEN AS `"LIVE DEPLOYED" in src` AND A MUTATION PROVED IT
    # HOLLOW: the phrase survives anywhere in a 200-line file, so gutting the explanation next to
    # the setting left the guard green. `"x" in src` is never a real needle. Structural instead:
    # the reason must sit in the comment block IMMEDIATELY ABOVE `concurrency:`, which is the only
    # place a reader flipping that setting will actually look.
    with open(E2E_WORKFLOW, encoding="utf-8") as fh:
        lines = fh.read().splitlines()
    idx = next(i for i, l in enumerate(lines) if l.startswith("concurrency:"))
    preamble = []
    for l in reversed(lines[:idx]):
        if not l.lstrip().startswith("#"):
            break
        preamble.append(l)
    block = "\n".join(preamble)
    assert "LIVE DEPLOYED" in block, (
        "the reason cancelling is correct must sit in the comment block directly above "
        "`concurrency:` -- without it the next reader sees a 65% cancellation rate and flips it, "
        f"and every superseded run then reports another commit's deployment. Found: {block[:200]!r}")
