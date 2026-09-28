"""A15-15 (audit 15.0, 2026-09-25): the spot-rating precompute must run AFTER the regional tiles land.

precompute.yml fired '45 3-23/4' and forecast-ingest-pilots.yml fires '45 3,11,19', so three of the six
rating runs a day started the same minute as the pilot ingest. GitHub drifts both lanes together, and the
rating lane finished first in 6 of 6 measured paired slots (2026-09-24/25). /point prefers the known-cycle
regional tile (#80), so each of those frames was rated on the PREVIOUS pilot cycle while the heatmap drew
the new one. The colliding slots were replaced by a workflow_run trigger on the pilots' completion.

These tests read the two workflow files as data, so a later cron edit on either side cannot reopen the race
silently, and the remaining cron alone must keep glyph coverage inside the stale ladder if GitHub drops a
scheduled pilot run.
"""
import re
from pathlib import Path

# A HARD import, not importorskip: PyYAML is not declared in requirements.txt (it arrives via
# copernicusmarine -> dask), and a guard that skips when it goes missing guards nothing.
import yaml

_REPO = Path(__file__).resolve().parents[2]
_WF = _REPO / ".github" / "workflows"
_PRECOMPUTE = _WF / "precompute.yml"
_PILOTS = _WF / "forecast-ingest-pilots.yml"
_STORE = _REPO / "backend" / "services" / "weather_pipeline" / "spot_ratings_precompute.py"


def _load(path):
    with open(path, encoding="utf-8") as fh:
        doc = yaml.safe_load(fh)
    # PyYAML reads the bare key `on:` as the boolean True.
    return doc, (doc.get("on") if "on" in doc else doc.get(True)) or {}


def _field(expr, lo, hi):
    """Expand one cron field of the forms '*', 'N', 'a,b', 'a-b', '*/s', 'a-b/s'."""
    out = set()
    for part in expr.split(","):
        rng, _, step = part.partition("/")
        if rng == "*":
            a, b = lo, hi
        elif "-" in rng:
            a, b = (int(x) for x in rng.split("-"))
        else:
            a = b = int(rng)
        out.update(range(a, b + 1, int(step) if step else 1))
    return out


def _daily_fires(on):
    """Minutes-of-day each daily cron entry fires at. Only '* * *' day fields are supported, so a
    weekday-only schedule fails loudly here instead of being mis-modelled."""
    fires = set()
    for entry in on.get("schedule") or []:
        minute, hour, dom, mon, dow = entry["cron"].split()
        assert (dom, mon, dow) == ("*", "*", "*"), f"non-daily cron not modelled: {entry['cron']}"
        fires.update(h * 60 + m for h in _field(hour, 0, 23) for m in _field(minute, 0, 59))
    return sorted(fires)


def _max_gap_min(fires):
    return max((b - a) % 1440 or 1440 for a, b in zip(fires, fires[1:] + fires[:1]))


def test_precompute_is_triggered_by_pilot_completion():
    pilots_doc, _ = _load(_PILOTS)
    _, on = _load(_PRECOMPUTE)
    wr = on.get("workflow_run")
    assert wr, "precompute.yml has no workflow_run trigger; ratings cannot follow the regional ingest"
    # workflow_run matches on the upstream workflow's NAME, so a rename of the pilots lane would
    # silently disconnect the trigger.
    assert pilots_doc["name"] in wr["workflows"]
    assert wr.get("types") == ["completed"]


def test_no_precompute_cron_slot_collides_with_a_pilot_slot():
    _, pilots_on = _load(_PILOTS)
    _, pre_on = _load(_PRECOMPUTE)
    pilots = set(_daily_fires(pilots_on))
    assert pilots, "pilots lane has no schedule; this guard would pass vacuously"
    clash = sorted(set(_daily_fires(pre_on)) & pilots)
    assert not clash, (f"precompute cron fires with pilots at {[f'{m // 60:02d}:{m % 60:02d}' for m in clash]} "
                       "and will rate the previous regional cycle; the workflow_run trigger covers those slots")


def test_rating_runs_per_day_did_not_drop():
    _, pilots_on = _load(_PILOTS)
    _, pre_on = _load(_PRECOMPUTE)
    assert len(_daily_fires(pre_on)) + len(_daily_fires(pilots_on)) >= 6


def test_cron_alone_stays_inside_the_stale_ladder():
    """If GitHub drops a scheduled pilot run, only the cron remains. The gap between its slots must stay
    within the last frame's offset plus the stale-serve bound, or glyphs fall off to the live path that
    melted the 1-CPU box on 2026-07-13."""
    _, on = _load(_PRECOMPUTE)
    fires = _daily_fires(on)
    assert fires
    hours = next(step.get("env", {}).get("SPOT_RATINGS_PRECOMPUTE_HOURS")
                 for step in yaml.safe_load(_PRECOMPUTE.read_text(encoding="utf-8"))["jobs"]["precompute"]["steps"]
                 if "SPOT_RATINGS_PRECOMPUTE_HOURS" in (step.get("env") or {}))
    max_offset_min = 60 * max(int(h) for h in str(hours).split(","))
    m = re.search(r'"SPOT_RATINGS_STALE_TOLERANCE_S",\s*"(\d+)"', _STORE.read_text(encoding="utf-8"))
    assert m, "stale-ladder default not found in spot_ratings_precompute.py"
    stale_min = int(m.group(1)) // 60
    assert _max_gap_min(fires) <= max_offset_min + stale_min


def test_field_expander_matches_the_forms_in_use():
    assert _field("3-23/4", 0, 23) == {3, 7, 11, 15, 19, 23}
    assert _field("3,11,19", 0, 23) == {3, 11, 19}
    assert _field("*/4", 0, 23) == {0, 4, 8, 12, 16, 20}
    assert _max_gap_min([7 * 60 + 45, 15 * 60 + 45, 23 * 60 + 45]) == 480


# ── RATINGS FOLLOW THE PHYSICS (2026-09-28) ─────────────────────────────────────────────────────────────────
# The frames are rated in the precompute job from the checked-out code; the hub, the sim and the live lanes run
# what Render deployed. After #146/#120 merged, the hub served the new chain for 2.5 h while every glyph showed
# the legacy one (Cocoa 0.789 vs 1.012 m) because no precompute ran in between. precompute.yml now re-rates on
# a dev push to the composition chain; these keep that path list from falling behind the code.

_WP = _REPO / "backend" / "services" / "weather_pipeline"
_ROOTS = ("surf_point", "surf_transform", "surf_rating", "spot_ratings")      # CLAUDE.md ONE FORECAST COMPOSITION
_IMPORT = re.compile(r"from services\.weather_pipeline(?:\.(\w+))? import ([\w, ()\n]+)")
_LEVER = re.compile(r'(?:os\.environ\.get|_v3|getenv)\(\s*"(?:SURF|RATING)_')


def _chain_closure():
    """Every weather_pipeline module the four composition roots import, transitively (lazy imports included:
    the chain imports inside functions on purpose, and those modules are the served number all the same)."""
    seen, todo = set(), list(_ROOTS)
    while todo:
        name = todo.pop()
        if name in seen or not (_WP / f"{name}.py").exists():
            continue
        seen.add(name)
        for mod, names in _IMPORT.findall((_WP / f"{name}.py").read_text(encoding="utf-8")):
            cands = [mod] if mod else [n.strip() for n in names.replace("(", "").replace(")", "").split(",")]
            todo += [c for c in cands if c and (_WP / f"{c}.py").exists()]
    return seen


def _push_paths():
    _, on = _load(_PRECOMPUTE)
    push = on.get("push") or {}
    return push, set(push.get("paths") or [])


def test_a_dev_push_to_the_composition_chain_re_rates():
    push, paths = _push_paths()
    assert push.get("branches") == ["dev"], "the served backend deploys from dev; re-rate on dev pushes"
    levers = sorted(m for m in _chain_closure()
                    if _LEVER.search((_WP / f"{m}.py").read_text(encoding="utf-8")))
    assert {"surf_point", "surf_transform", "surf_rating", "spot_ratings"} <= set(levers), (
        "the derivation stopped seeing the chain's own levers; fix the regex before trusting this guard")
    missing = [m for m in levers if f"backend/services/weather_pipeline/{m}.py" not in paths]
    assert not missing, (f"{missing} read a SURF_/RATING_ lever inside the composition chain but a push to them "
                         "does not re-rate: glyphs would keep the old physics while the hub serves the new")


def test_the_data_behind_the_height_re_rates_too():
    """The magnet table and the geometry assets move served heights without reading any env lever."""
    _, paths = _push_paths()
    assert "backend/services/weather_pipeline/surf_magnets.py" in paths
    assert "backend/services/weather_pipeline/data/**" in paths
    assert (_WP / "data" / "shore_normals.json").exists(), "the asset directory moved; update the path"


def test_the_trigger_list_names_only_files_that_exist():
    """A renamed module leaves a dead path that silently stops re-rating."""
    _, paths = _push_paths()
    dead = sorted(p for p in paths if not p.endswith("/**") and not (_REPO / p).exists())
    assert not dead, f"precompute push paths name missing files: {dead}"
