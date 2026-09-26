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
