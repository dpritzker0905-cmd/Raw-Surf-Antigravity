"""The flip-PR scorecard (scripts/flip_scorecard.py + the flip-scorecard job in eval-harness.yml): trigger parsing,
declaration parsing, the env / code-drift checks, the outcome mapping, the budget, and the workflow's own limits
(informational, never an activation). Offline: no git, no network, the harness is a fake where it runs."""
import json
import os
import sys
from datetime import datetime, timezone

import pytest
import yaml

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)
sys.path.insert(0, os.path.join(BACKEND, "scripts"))
import flip_scorecard as fs  # noqa: E402

from services.weather_pipeline import eval_provenance as pv  # noqa: E402

REPOSITORY = "owner/repo"
NOW = datetime(2026, 11, 3, 12, tzinfo=timezone.utc)
WF = os.path.join(REPO, ".github", "workflows", "eval-harness.yml")


def _event(action="labeled", labels=("flip-candidate",), added="flip-candidate", head_repo=REPOSITORY):
    ev = {"action": action, "pull_request": {"number": 7, "labels": [{"name": n} for n in labels],
                                             "head": {"sha": "h" * 40, "repo": {"full_name": head_repo}},
                                             "base": {"ref": "dev"}}}
    if action == "labeled":
        ev["label"] = {"name": added}
    return ev


# ---- trigger ----------------------------------------------------------------------------------------------------
@pytest.mark.parametrize("kw,run", [
    ({}, True),
    ({"action": "synchronize"}, True),
    ({"action": "reopened"}, True),
    ({"action": "opened"}, True),
    ({"added": "documentation"}, False),                         # another label added: no re-run
    ({"action": "synchronize", "labels": ("bug",)}, False),      # no flip-candidate label
    ({"head_repo": "someone/fork"}, False),                      # forks never run
    ({"action": "closed"}, False),
    ({"action": "edited"}, False),
])
def test_trigger(kw, run):
    t = fs.trigger(_event(**kw), REPOSITORY)
    assert t["run"] is run and t["reason"]
    if run:
        assert t["pr"] == 7 and t["head_sha"] == "h" * 40 and t["base_ref"] == "dev"


def test_trigger_refuses_a_non_pr_event():
    assert fs.trigger({"action": "labeled"}, REPOSITORY)["run"] is False


# ---- declaration ------------------------------------------------------------------------------------------------
def _decl(**over):
    d = {"schema": fs.DECL_SCHEMA, "slug": "kr-off", "flags": {"SURF_REFRACTION_KR": "1.0"},
         "window": {"start": "2026-10-20T00:00Z", "end": "2026-10-29T18:00Z"}, "rationale": "demo"}
    d.update(over)
    return json.dumps(d)


PATH = "docs/weather-program/flip-candidates/kr-off.json"


def test_a_valid_declaration_parses_with_its_plan_inside_the_budget():
    d = fs.parse_declaration(_decl(), PATH, NOW)
    assert d["slug"] == "kr-off" and d["flags"] == {"SURF_REFRACTION_KR": "1.0"} and d["leads"] == [24, 48, 72]
    assert d["arm"] == "SURF_REFRACTION_KR=1.0" and d["primary"] == "hs_station"
    assert 0 < d["range_downloads_planned"] <= fs.MAX_RANGE_DOWNLOADS


@pytest.mark.parametrize("text,match", [
    ("not json", "not JSON"),
    (_decl(schema="x"), "schema"),
    (_decl(extra=1), "unknown keys"),
    (_decl(slug="other"), "slug"),
    (_decl(flags={}), "flags"),
    (_decl(flags={"SURF_PARTITIONS": "1"}), "SURF_PARTITIONS"),                      # unreplayable
    (_decl(window={"start": "2026-10-20T00:00Z", "end": "2026-10-24T00:00Z"}), "7-14 days"),
    (_decl(window={"start": "2026-10-01T00:00Z", "end": "2026-10-20T00:00Z"}), "7-14 days"),
    (_decl(window={"start": "2026-10-25T00:00Z", "end": "2026-11-02T00:00Z"}), "PINNED in the past"),
    (_decl(window={"start": "2026-10-20T03:00Z", "end": "2026-10-29T18:00Z"}), "00/06/12/18Z"),
    (_decl(window={"start": "soon", "end": "2026-10-29T18:00Z"}), "ISO UTC"),
    (_decl(leads=[25]), "multiples of 6"),
    (_decl(primary="rating"), "primary"),
])
def test_a_bad_declaration_is_invalid(text, match):
    with pytest.raises(fs.Invalid, match=match):
        fs.parse_declaration(text, PATH, NOW)


def test_a_plan_over_400_range_downloads_is_refused_before_any_download():
    with pytest.raises(fs.Refused, match="400 budget"):
        fs.parse_declaration(_decl(leads=[24, 48, 72, 96, 120, 144]), PATH, NOW)


def test_exactly_one_declaration_is_found_among_the_changed_files():
    changed = [PATH, "docs/weather-program/flip-candidates/README.md", "docs/weather-program/flip-candidates/a/b.json",
               ".github/workflows/precompute.yml"]
    assert fs.find_declarations(changed) == [PATH]
    assert fs.find_declarations([".github/workflows/precompute.yml"]) == []


# ---- the change -------------------------------------------------------------------------------------------------
def test_env_consistency():
    base = {"SURF_A": "1", "SURF_B": "0"}
    assert fs.env_consistency(base, dict(base), {"SURF_B": "1"}) == "unchanged"
    assert fs.env_consistency(base, {"SURF_A": "1", "SURF_B": "1"}, {"SURF_B": "1"}) == "flipped"
    with pytest.raises(fs.Invalid, match="SURF_C"):
        fs.env_consistency(base, {"SURF_A": "1", "SURF_B": "1", "SURF_C": "1"}, {"SURF_B": "1"})
    with pytest.raises(fs.Invalid, match="SURF_A"):
        fs.env_consistency(base, {"SURF_A": "0", "SURF_B": "0"}, {"SURF_B": "1"})


def test_code_drift_names_served_code_only():
    changed = [".github/workflows/precompute.yml", "docs/x.md", "backend/tests/test_x.py", "README.md",
               "backend/services/weather_pipeline/surf_point.py", "backend/routes/weather.py"]
    assert fs.code_drift(changed) == ["backend/routes/weather.py", "backend/services/weather_pipeline/surf_point.py"]


# ---- outcomes ---------------------------------------------------------------------------------------------------
def _card(verdict="PASS", controls=True, parity=True, changed=12, reasons=()):
    return {"primary": "hs_station", "controls_state": controls, "input_parity": {"production_parity": parity},
            "alarms": [], "budget": {"range_downloads": 10},
            "arms": {"A=1": {"impact": {"spot_hours": 100, "height_changed": changed, "level_changed": 0},
                             "quantities": {"hs_station": {"verdict": {"verdict": verdict, "reasons": list(reasons)},
                                                           "summary": {"n": 300, "crps_gain": 0.01,
                                                                       "crps_gain_ci": [0.001, 0.02],
                                                                       "dm_p_better": 0.01}}}}}}


@pytest.mark.parametrize("card,want", [
    (_card(), "PASS"),
    (_card("FAIL", reasons=["worse"]), "FAIL"),
    (_card("REFUSED", reasons=["underpowered"]), "REFUSED"),
    (_card(changed=0), "REFUSED"),                    # zero changed spot-hours
    (_card(parity=False), "REFUSED"),                 # substitutions
    (_card(controls=False), "INVALID"),
    (_card("INVALID"), "INVALID"),
])
def test_outcomes_stay_distinct(card, want):
    assert fs.outcome(card, "A=1")["outcome"] == want
    assert fs.outcome(card, "B=1")["outcome"] == "INVALID"


def test_run_scorecard_maps_the_harness_and_its_errors(tmp_path):
    prepared = {"run": True, "served_env_root": str(tmp_path), "base_sha": "b" * 40, "head_sha": "h" * 40,
                "declaration": {"start": "2026-10-20T00:00Z", "end": "2026-10-29T18:00Z", "leads": [24],
                                "primary": "hs_station", "arm": "A=1", "slug": "x"}}
    seen = {}

    def fake(args):
        seen["args"] = args
        return _card()
    r = fs.run_scorecard(prepared, str(tmp_path / "c"), str(tmp_path / "o"), run_harness=fake)
    a = seen["args"]
    assert r["outcome"] == "PASS" and a.max_range_downloads == 400 and a.served_env_root == str(tmp_path)
    assert a.arm == ["A=1"] and a.update_ratchet is False                    # the PR job never writes the floor
    assert json.load(open(tmp_path / "o" / "result.json"))["outcome"] == "PASS"

    def over(args):
        raise pv.BudgetExceeded("range-download budget 400 reached")
    assert fs.run_scorecard(prepared, str(tmp_path / "c"), str(tmp_path / "o"), run_harness=over)["outcome"] == "REFUSED"

    def boom(args):
        raise RuntimeError("x")
    assert fs.run_scorecard(prepared, str(tmp_path / "c"), str(tmp_path / "o"), run_harness=boom)["outcome"] == "INVALID"


def test_prepare_stops_without_a_declaration_and_never_runs_for_a_fork(tmp_path):
    ev = tmp_path / "event.json"
    ev.write_text(json.dumps(_event()), encoding="utf-8")
    r = fs.prepare(str(ev), REPOSITORY, "HEAD", str(tmp_path / "o"), now=NOW)   # HEAD..HEAD: nothing changed
    assert r["run"] is False and r["outcome"] == "INVALID" and "exactly one" in r["reasons"][0]
    ev.write_text(json.dumps(_event(head_repo="someone/fork")), encoding="utf-8")
    r = fs.prepare(str(ev), REPOSITORY, "HEAD", str(tmp_path / "p"), now=NOW)
    assert r["run"] is False and r["outcome"] is None                          # not triggered: no comment at all
    assert fs.main(["run", "--prepared", str(tmp_path / "p" / "prepared.json"), "--cache-dir", str(tmp_path / "c"),
                    "--out", str(tmp_path / "p")]) == 0
    assert not (tmp_path / "p" / "comment.md").exists()


def test_the_comment_carries_the_marker_and_says_it_is_informational():
    body = fs.comment({"outcome": "REFUSED", "reasons": ["no change"], "declaration": {"slug": "x", "arm": "A=1"},
                       "base_sha": "b", "head_sha": "h"}, "https://example/run")
    assert body.startswith(fs.COMMENT_MARKER) and "**REFUSED**" in body and "Informational only" in body
    assert "never activates a flag" in body and "https://example/run" in body


def test_the_cache_budget_counts_network_range_gets_only(tmp_path):
    def get(url, rng=None, max_bytes=None):
        return b"x" * 10, (206 if rng else 200)
    c = pv.Cache(str(tmp_path / "c"), get=get, pause_s=0, max_range_downloads=2, max_total_bytes=35)
    u = "https://noaa-gfs-bdp-pds.s3.amazonaws.com/f"
    c.fetch("a", u, (0, 9), source="s", parser="p")
    c.fetch("a", u, (0, 9), source="s", parser="p")                       # a cache hit costs nothing
    c.fetch("i", u + ".idx", source="s", parser="p")                      # not a range GET
    c.fetch("b", u, (0, 9), source="s", parser="p")
    with pytest.raises(pv.BudgetExceeded, match="range-download budget 2"):
        c.fetch("c", u, (0, 9), source="s", parser="p")
    c2 = pv.Cache(str(tmp_path / "d"), get=get, pause_s=0, max_total_bytes=15)
    c2.fetch("a", u + "1", source="s", parser="p")
    with pytest.raises(pv.BudgetExceeded, match="bytes"):
        c2.fetch("b", u + "2", source="s", parser="p")


# ---- the workflow ------------------------------------------------------------------------------------------------
def _wf():
    with open(WF, encoding="utf-8") as f:
        text = f.read()
    return text, yaml.safe_load(text)


def test_the_workflow_triggers_on_labelled_same_repo_prs_with_the_contract_limits():
    text, d = _wf()
    on = d[True]                                                          # PyYAML reads `on:` as True
    assert on["pull_request"]["types"] == ["opened", "labeled", "synchronize", "reopened"]
    assert "workflow_dispatch" in on and "pull_request_target" not in on
    j = d["jobs"]["flip-scorecard"]
    assert "github.event.pull_request.head.repo.full_name == github.repository" in j["if"]
    assert "contains(github.event.pull_request.labels.*.name, 'flip-candidate')" in j["if"]
    assert j["permissions"] == {"contents": "read", "pull-requests": "write"}
    assert j["timeout-minutes"] == 60 and d["permissions"] == {"contents": "read"}
    up = [s for s in j["steps"] if "upload-artifact" in str(s.get("uses"))]
    assert up and up[0]["with"]["retention-days"] == 14
    assert d["jobs"]["harness"]["if"] == "github.event_name == 'workflow_dispatch'"


def test_the_workflow_never_activates_merges_deploys_or_dispatches():
    text, d = _wf()
    j = d["jobs"]["flip-scorecard"]
    runs = "\n".join(str(s.get("run") or "") for s in j["steps"])
    for banned in ("secrets.", "gh workflow run", "gh pr merge", "gh pr review", "git push", "render", "netlify",
                   "supabase", "--update-ratchet", "gh variable", "gh secret", "workflow_dispatch", "repository_dispatch"):
        assert banned not in runs.lower() if banned.islower() else banned not in runs, banned
    assert "secrets." not in text
    comment_steps = [s for s in j["steps"] if "comments" in str(s.get("run") or "")]
    assert len(comment_steps) == 1 and fs.COMMENT_MARKER in comment_steps[0]["run"]     # one comment, edited
    assert "continue-on-error" not in json.dumps(j)
