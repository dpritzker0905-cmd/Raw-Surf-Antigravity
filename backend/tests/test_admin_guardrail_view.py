"""The admin Guardrail view: the live manifest entries and the guardrail's applied decisions, read-only."""
import json

from services import admin_guardrail_view as gv
from services import runtime_flags as rf

MANIFEST = {"schema": rf.SCHEMA, "flags": {
    "SURF_TIDE_DEPTH": {"state": "off", "reason": "auto-disabled: WORSE", "set_by": "flag-guardrail",
                        "set_at": "2026-11-18T02:30:00Z", "evidence": "https://example.invalid/run/1"},
    "RATING_REF_PRIOR": {"state": "maybe"}}}          # an invalid state is dropped, never guessed
ACTIONS = "\n".join([
    json.dumps({"at": "2026-11-17T20:30:00Z", "flag": "SURF_TIDE_DEPTH", "action": "clear", "reason": "new fix version",
                "run": "r0"}),
    "not json",
    json.dumps({"at": "2026-11-18T02:30:00Z", "flag": "SURF_TIDE_DEPTH", "action": "disable", "reason": "WORSE",
                "run": "r1", "extra": "ignored"}),
    "",
])


def _fetch(objects):
    def fetch(key):
        v = objects.get(key)
        if isinstance(v, Exception):
            raise v
        return v
    return fetch


def test_view_shows_live_entries_and_history_newest_first():
    view = gv.guardrail_view(_fetch({rf.MANIFEST_KEY: json.dumps(MANIFEST), gv.ACTIONS_KEY: ACTIONS}))
    assert list(view["entries"]) == ["SURF_TIDE_DEPTH"]
    assert view["entries"]["SURF_TIDE_DEPTH"]["reason"] == "auto-disabled: WORSE"
    assert [(a["action"], a["run"]) for a in view["actions"]] == [("disable", "r1"), ("clear", "r0")]
    assert "extra" not in view["actions"][0]
    assert view["errors"] == ["1 unreadable line(s) in control/flags-actions.jsonl"]
    assert view["guarded"]["SURF_TIDE_DEPTH"] == {"code_default": rf.GUARDED["SURF_TIDE_DEPTH"],
                                                 "fix_version": rf.FIX_VERSION["SURF_TIDE_DEPTH"]}
    assert view["workflow_url"].endswith("/actions/workflows/flag-guardrail.yml")


def test_absent_objects_mean_nothing_recorded_and_failures_are_reported():
    empty = gv.guardrail_view(_fetch({}))
    assert empty["entries"] == {} and empty["actions"] == [] and empty["errors"] == []
    broken = gv.guardrail_view(_fetch({rf.MANIFEST_KEY: RuntimeError("timeout"), gv.ACTIONS_KEY: RuntimeError("403")}))
    assert broken["errors"] == ["manifest unreadable: timeout", "decision history unreadable: 403"]


def test_the_view_module_never_writes():
    import inspect
    src = inspect.getsource(gv)
    assert "requests.post" not in src and "requests.put" not in src and "x-upsert" not in src
