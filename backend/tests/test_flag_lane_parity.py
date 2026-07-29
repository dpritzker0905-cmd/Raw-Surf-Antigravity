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

# Flags whose value legitimately differs between the two lanes, with the reason. Empty by default:
# an entry here is a documented exception, not a place to silence a real drift.
LANE_EXCEPTIONS: dict = {}


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
    science = {f for f in ALL_LANE_FLAGS[lane] if f.startswith(("RATING_", "SURF_"))}
    missing = sorted(science - known)
    assert not missing, f"{lane} sets science flags absent from _RATING_FLAGS: {missing}"


def test_the_two_ingest_lanes_agree():
    """Both lanes write spot ratings. A flag set in one and not the other makes them produce
    inconsistent frames — the 07-08 cron-hang shape, recorded at POINT_CACHE_MAX in
    forecast-ingest.yml."""
    a, b = ALL_LANE_FLAGS[INGEST_LANES[0]], ALL_LANE_FLAGS[INGEST_LANES[1]]
    science = {f for f in set(a) | set(b) if f.startswith(("RATING_", "SURF_"))}
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
