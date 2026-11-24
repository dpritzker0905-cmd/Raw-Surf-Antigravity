"""D-065: the filter's verdicts (guardrail_stats) and the guardrail's auto-disable / no-flap / dry-run, on synthetic data.

No network, no storage: the guardrail's scorer, manifest and volume reader are injected."""
import os
import random
import sys
from pathlib import Path
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import default_on_filter as dof  # noqa: E402
import flag_guardrail as fg  # noqa: E402
from services import runtime_flags as rf  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

T0 = datetime(2026, 10, 1, tzinfo=timezone.utc)
STATIONS = {"a": {"id": "a", "lat": 33.0, "lng": -117.3}, "b": {"id": "b", "lat": 37.8, "lng": -122.6}}


def items(harm=0.0, n_hours=80, noise=0.15, seed=1, only=None, months=(10,)):
    """Pairs at two buoys; ON's error = OFF's error + harm (+ noise), so harm > 0 = ON worse."""
    rng = random.Random(seed)
    out = []
    for h in range(n_hours):
        t = T0.replace(month=months[h % len(months)]) + timedelta(hours=6 * h)
        for b in ("a", "b"):
            obs = 1.5 + 0.5 * rng.random()
            e_off = rng.gauss(0, noise)
            extra = harm if (only is None or only == b) else 0.0
            e_on = e_off + (extra if e_off >= 0 else -extra) + rng.gauss(0, 0.002)
            out.append({"t": t, "buoy": b, "lead": 24, "obs": obs, "f_ref": obs + e_off, "f_cand": obs + e_on})
    return out


# ---- filter verdicts ------------------------------------------------------------------------------------------------
def test_identical_arms_are_no_change_and_never_block():
    its = [dict(i, f_cand=i["f_ref"]) for i in items()]
    assert gs.verdict(its, STATIONS)["verdict"] == gs.NO_CHANGE


def test_a_clearly_worse_fix_is_worse():
    v = gs.verdict(items(harm=0.05), STATIONS)
    assert v["verdict"] == gs.WORSE and v["members"]["pooled"]["worse"]


def test_a_clearly_better_fix_is_better():
    assert gs.verdict(items(harm=-0.05), STATIONS)["verdict"] == gs.BETTER


def test_a_tiny_significant_loss_inside_the_margin_does_not_block():
    v = gs.verdict(items(harm=0.002, noise=0.15), STATIONS)
    assert v["verdict"] in (gs.NOT_WORSE, gs.BETTER), v["reasons"]


def test_harm_in_one_region_only_is_caught_after_holm():
    v = gs.verdict(items(harm=0.08, only="b"), STATIONS)
    assert v["verdict"] == gs.WORSE
    assert any("region lat 36..39 W" in r for r in v["reasons"])


def test_too_little_data_is_untestable_not_a_pass_or_a_block():
    assert gs.verdict(items(harm=0.3, n_hours=5), STATIONS)["verdict"] == gs.UNTESTABLE
    # 25 hours x 2 buoys = 50 pairs: enough hours for DM, too few pairs for the floor
    assert gs.verdict(items(harm=0.3, n_hours=25), STATIONS)["verdict"] == gs.UNTESTABLE


def test_seasons_are_hemisphere_aware():
    t = datetime(2026, 7, 1, tzinfo=timezone.utc)
    assert gs.season_of(t, 33.0) == "JJA" and gs.season_of(t, -33.0) == "DJF"


def test_sanity_rows_report_only_new_breaches():
    off = [{"spot": "s", "valid": "v1", "lead_h": 24, "outputs": {"surf_height_m": 50.0, "score": 50}}]
    on = off + [{"spot": "s", "valid": "v2", "lead_h": 24, "outputs": {"surf_height_m": 1.0, "score": 140}}]
    assert gs.sanity_rows(on, off) == ["s v2 +24 h: score 140"]


def test_monotone_and_volume_breaches():
    assert gs.monotone_breaches([(1, 1.0), (2, 2.0), (3, 1.5)]) == ["swell 2.00 -> 3.00 m: surf 2.000 -> 1.500 m"]
    assert gs.monotone_breaches([(1, 1.0), (2, 1.995)]) == []
    assert gs.volume_breaches({"user-day #1": 5, "user-day #2": 2}, 2) == ["user-day #1: 5 > cap 2"]


def test_filter_detects_the_flags_a_change_turns_on():
    base = 'GUARDED = {"A": "0", "B": "1"}'
    head = 'GUARDED = {"A": "1", "B": "1", "C": "1", "D": "0"}'
    reg = '_RATING_FLAGS = {"E": ("0", "x", "y")}'
    assert dof.declared_on(dof.on_defaults(reg, base), dof.on_defaults(reg, head)) == ["A", "C"]


def test_filter_blocks_only_on_worse_or_a_sanity_breach(monkeypatch):
    monkeypatch.setattr(dof, "sweep", lambda f, v: [(1, 1.0), (2, 2.0)])
    monkeypatch.setattr(dof, "replay_pair", lambda ctx, f, v: (items(harm=0.06), [], []))
    ctx = {"stations": list(STATIONS.values())}
    assert dof.evaluate("SURF_TIDE_DEPTH", ctx)["blocks"] is True
    monkeypatch.setattr(dof, "replay_pair", lambda ctx, f, v: (items(harm=0.0), [], []))
    r = dof.evaluate("SURF_TIDE_DEPTH", ctx)
    assert r["blocks"] is False and r["verdict"] in (gs.NOT_WORSE, gs.BETTER)
    r = dof.evaluate("SURF_TIDE_DEPTH", None)          # no cache: skipped, not blocked
    assert r["verdict"] == "SKIPPED" and r["blocks"] is False


# ---- guardrail decisions --------------------------------------------------------------------------------------------
NOW = datetime(2026, 11, 4, 12, tzinfo=timezone.utc)
STRUCK = {"SURF_TIDE_DEPTH": {"strikes": 1, "first_worse_at": "2026-11-03T10:00:00Z"}}     # 26 h before NOW


@pytest.fixture(autouse=True)
def _tmp_cache(tmp_path, monkeypatch):
    monkeypatch.setenv("PYTEST_TMP_GUARD", str(tmp_path))


def args(**k):
    d = dict(enforce="0", cache_dir=os.path.join(os.environ.get("PYTEST_TMP_GUARD", "."), "gcache"), out="o",
             alert_cap=2, run_url="https://run", reenable="", owner_words="",
             actor="owner", owner_login="owner")
    d.update(k)
    return SimpleNamespace(**d)


def scorer(verdicts):
    def f(flags, now, cache_dir, out):
        return {fl: {"verdict": verdicts.get(fl, gs.NOT_WORSE), "reasons": ["synthetic"], "sanity": [],
                     "window": "w"} for fl in flags}
    return f


def test_a_worse_on_fix_is_disabled_with_a_reason(monkeypatch):
    writes = []
    monkeypatch.setattr(fg, "write_object", lambda k, b, *a: writes.append(k))
    monkeypatch.setattr(fg, "read_manifest", lambda: {"schema": rf.SCHEMA, "flags": {}})
    monkeypatch.setattr(fg, "append_actions", lambda lines: writes.append("actions"))
    rep = fg.run(args(enforce="1"), NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *a: {},
                 watch=STRUCK)
    d = rep["decisions"]["SURF_TIDE_DEPTH"]
    assert d["action"] == "disable" and "auto-disabled" in d["reason"]
    e = rep["manifest"]["flags"]["SURF_TIDE_DEPTH"]
    assert e["state"] == "off" and e["set_by"] == fg.SET_BY and e["fix_version"] == rf.FIX_VERSION["SURF_TIDE_DEPTH"]
    assert set(e) >= set(rf.ENTRY_KEYS)
    assert rf.MANIFEST_KEY in writes and "actions" in writes
    assert rep["ledger_commands"] and "--kind flag_flip" in rep["ledger_commands"][0]


def rf_manifest(**flags):
    return {"schema": rf.SCHEMA, "flags": dict(flags)}


def test_dry_run_writes_nothing(monkeypatch):
    monkeypatch.setattr(fg, "write_object", lambda *a: pytest.fail("dry run wrote"))
    rep = fg.run(args(enforce="0"), NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *a: {},
                 watch=STRUCK)
    assert rep["mode"] == "dry-run" and rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "disable"
    assert "would disable" in fg.markdown(rep)


def test_not_proven_better_is_left_on():
    rep = fg.run(args(), NOW, rf_manifest(), scorer({}), lambda *a: {})
    assert all(d["action"] == "none" for d in rep["decisions"].values())
    assert not rep["changed"]


def test_a_sanity_breach_disables_without_statistics():
    def s(flags, now, c, o):
        return {f: {"verdict": gs.UNTESTABLE, "reasons": [], "sanity": ["score 140"] if f == "RATING_LOCAL_SIZE"
                    else []} for f in flags}
    rep = fg.run(args(), NOW, rf_manifest(), s, lambda *a: {})
    assert rep["decisions"]["RATING_LOCAL_SIZE"]["action"] == "disable"


def test_no_flap_an_off_stays_off_when_the_fix_later_measures_fine():
    off = {"state": "off", "reason": "r", "set_by": fg.SET_BY, "set_at": "x", "evidence": "e",
           "fix_version": rf.FIX_VERSION["SURF_TIDE_DEPTH"]}
    rep = fg.run(args(), NOW, rf_manifest(SURF_TIDE_DEPTH=off), scorer({"SURF_TIDE_DEPTH": gs.BETTER}), lambda *a: {})
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "hold"
    assert rep["manifest"]["flags"]["SURF_TIDE_DEPTH"]["state"] == "off"


def test_a_new_fix_version_clears_the_guardrails_own_off():
    off = {"state": "off", "reason": "r", "set_by": fg.SET_BY, "set_at": "x", "evidence": "e", "fix_version": "old"}
    rep = fg.run(args(), NOW, rf_manifest(SURF_TIDE_DEPTH=off), scorer({}), lambda *a: {})
    # D-087 HYBRID: version bump keeps flag off and starts shadow run (replaces the old 'clear' + removal)
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "version_hold"
    assert "SURF_TIDE_DEPTH" in rep["manifest"]["flags"]
    assert rep["manifest"]["flags"]["SURF_TIDE_DEPTH"]["state"] == "off"
    assert "shadow" in rep["manifest"]["flags"]["SURF_TIDE_DEPTH"]


def test_an_owner_off_is_never_cleared_by_a_version_bump():
    off = {"state": "off", "reason": "owner", "set_by": "owner", "set_at": "x", "evidence": "e", "fix_version": "old"}
    d = fg.decide("SURF_TIDE_DEPTH", {"verdict": gs.BETTER}, rf_manifest(SURF_TIDE_DEPTH=off), "new", NOW)
    assert d["action"] == "hold"


def test_owner_reenable_needs_words_and_writes_on():
    with pytest.raises(ValueError):
        fg.owner_reenable(rf_manifest(), "SURF_TIDE_DEPTH", "", "owner", NOW)
    new = fg.owner_reenable(rf_manifest(), "SURF_TIDE_DEPTH", "turn tide depth back on", "owner", NOW,
                            expected_owner="owner")
    assert new["flags"]["SURF_TIDE_DEPTH"]["state"] == "on" and new["flags"]["SURF_TIDE_DEPTH"]["set_by"] == "owner"


def test_alert_volume_over_cap_disables_a_sending_flag(monkeypatch):
    monkeypatch.setitem(rf.GUARDED, "ALERTS_FORECAST_WINDOWS", "1")
    rep = fg.run(args(alert_cap=2), NOW, rf_manifest(), scorer({}), lambda nt, since: {"user-day #1 (2026-11-03)": 5})
    d = rep["decisions"]["ALERTS_FORECAST_WINDOWS"]
    assert d["action"] == "disable" and "5 > cap 2" in d["reason"]


def test_a_held_off_flag_is_not_watched_for_harm():
    rep = fg.run(args(), NOW, rf_manifest(), scorer({"SURF_EXPOSURE_RECONCILED": gs.WORSE}), lambda *a: {})
    assert "SURF_EXPOSURE_RECONCILED" not in rep["decisions"]


def test_one_worse_run_is_a_strike_not_a_disable():
    rep = fg.run(args(), NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *a: {}, watch={})
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "strike"
    assert not rep["changed"] and rep["watch"]["SURF_TIDE_DEPTH"]["strikes"] == 1


def test_two_strikes_inside_the_span_are_still_a_strike():
    w = {"SURF_TIDE_DEPTH": {"strikes": 1, "first_worse_at": "2026-11-04T06:00:00Z"}}       # 6 h before NOW
    rep = fg.run(args(), NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *a: {}, watch=w)
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "strike"


def test_a_non_worse_run_resets_the_strikes():
    rep = fg.run(args(), NOW, rf_manifest(), scorer({}), lambda *a: {}, watch=dict(STRUCK))
    assert "SURF_TIDE_DEPTH" not in rep["watch"]


def test_the_strike_counter_persists_in_the_cache_across_runs():
    a = args()
    fg.run(a, NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *x: {})
    later = NOW + timedelta(hours=30)
    rep = fg.run(a, later, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *x: {})
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "disable"


def test_p_worse_tests_the_margin_shifted_null():
    """A steady 3 mm loss (inside the 5 mm margin) is 'significantly nonzero' but NOT significantly beyond the margin."""
    its = items(harm=0.003, noise=0.15)
    m = gs.two_way(its)
    assert m["testable"] and m["mean_gain"] < 0
    assert m["p_worse"] > 0.5, m


# ---- D-090: the guardrail never reads a 400/404 as an empty manifest (an enforce run would rewrite the manifest
# without every existing kill), and it reports drift between the live kills and the committed cold-start snapshot. ----

class _GResp:
    def __init__(self, code):
        self.status_code = code

    def json(self):
        return {"schema": rf.SCHEMA, "flags": {}}


@pytest.mark.parametrize("code", [400, 401, 403, 404, 500])
def test_read_manifest_refuses_a_non_200(monkeypatch, code):
    import requests
    monkeypatch.setattr(fg, "_creds", lambda: ("https://example.invalid", {}))
    monkeypatch.setattr(requests, "get", lambda *a, **k: _GResp(code))
    with pytest.raises(rf.ManifestUnreadable):
        fg.read_manifest()


def test_read_manifest_bootstraps_empty_only_by_a_persons_choice(monkeypatch):
    import requests
    monkeypatch.setattr(fg, "_creds", lambda: ("https://example.invalid", {}))
    monkeypatch.setattr(requests, "get", lambda *a, **k: _GResp(404))
    assert fg.read_manifest(allow_missing=True) == fg.empty_manifest()
    monkeypatch.setattr(requests, "get", lambda *a, **k: _GResp(401))
    with pytest.raises(rf.ManifestUnreadable):                    # an auth failure is never "missing"
        fg.read_manifest(allow_missing=True)


def test_snapshot_drift_names_the_kills_a_cold_process_would_lose_and_gives_the_file():
    import json
    off = {"state": "off", "reason": "t", "set_by": fg.SET_BY, "set_at": "x", "evidence": "y"}
    live = rf_manifest(SURF_TIDE_DEPTH=off, RATING_REF_PRIOR=dict(off, state="on"))
    assert fg.snapshot_drift(live, {"SURF_TIDE_DEPTH": off}) == {}
    d = fg.snapshot_drift(live, {"RATING_OBS_GATE": off})
    assert d["missing"] == ["SURF_TIDE_DEPTH"] and d["extra"] == ["RATING_OBS_GATE"]
    assert set(rf.validate(json.loads(d["text"]))) == {"SURF_TIDE_DEPTH"}   # kills only; an owner 'on' is not floored


def test_a_disable_reports_the_snapshot_drift_in_the_issue_text(monkeypatch):
    monkeypatch.setattr(fg, "write_object", lambda *a, **k: None)
    monkeypatch.setattr(fg, "append_actions", lambda lines: None)
    monkeypatch.setattr(rf, "snapshot_kills", lambda: {})
    monkeypatch.setattr(fg, "read_manifest", lambda *a: {"schema": rf.SCHEMA, "flags": {}})
    rep = fg.run(args(enforce="1"), NOW, rf_manifest(), scorer({"SURF_TIDE_DEPTH": gs.WORSE}), lambda *a: {},
                 watch=STRUCK)
    assert rep["decisions"]["SURF_TIDE_DEPTH"]["action"] == "disable"
    assert rep["snapshot_drift"]["missing"] == ["SURF_TIDE_DEPTH"]
    md = fg.markdown(rep)
    assert "Cold-start snapshot drift" in md and "runtime_flags_snapshot.json" in md
    # the advisor's operating condition on #1261: P0, a 24 h commit-and-deploy deadline, no served-number fix ON meanwhile,
    # the deploy branch named, and the exact file text
    assert "### P0 · Cold-start snapshot drift" in md and "within 24 h" in md
    assert "no new served-number fix ships ON" in md and "Render) deploys from `dev`" in md
    assert '"SURF_TIDE_DEPTH"' in md.split("```json")[1]


def test_drift_that_only_over_holds_is_not_p0_and_the_issue_title_says_which(tmp_path, monkeypatch):
    off = {"state": "off", "reason": "t", "set_by": fg.SET_BY, "set_at": "x", "evidence": "y"}
    rep = {"mode": "enforce", "decisions": {}, "results": {},
           "snapshot_drift": fg.snapshot_drift(rf_manifest(), {"SURF_TIDE_DEPTH": off})}
    md = fg.markdown(rep)
    assert "Cold-start snapshot drift" in md and "P0" not in md
    monkeypatch.setattr(fg, "run", lambda a: dict(rep, snapshot_drift=fg.snapshot_drift(
        rf_manifest(SURF_TIDE_DEPTH=off), {})))
    fg.main(["--out", str(tmp_path)])
    assert (tmp_path / "acted.txt").read_text(encoding="utf-8") == "kill-missing-from-committed-floor(see-critical-issue)"


GUARDRAIL_FAMILY_TITLES = {"Flag guardrail": "Flag guardrail: SURF_TIDE_DEPTH",
                           "PHYSICS guard blind": "PHYSICS guard blind: a check could not run",
                           "P0 cold-start snapshot drift": fg.P0_DRIFT_TITLE}


def test_the_p0_drift_gets_its_own_issue_and_the_titles_never_match_each_others_search(tmp_path, monkeypatch):
    """Advisor (c) on #1263: a P0 drift is a DEDICATED issue, never a comment buried on an old "Flag guardrail" issue."""
    off = {"state": "off", "reason": "t", "set_by": fg.SET_BY, "set_at": "x", "evidence": "y"}
    rep = {"mode": "enforce", "decisions": {}, "results": {},
           "snapshot_drift": fg.snapshot_drift(rf_manifest(SURF_TIDE_DEPTH=off), {})}
    monkeypatch.setattr(fg, "run", lambda a: rep)
    fg.main(["--out", str(tmp_path)])
    body = (tmp_path / "p0_drift.md").read_text(encoding="utf-8")
    assert body.startswith("### P0 · Cold-start snapshot drift") and "within 24 h" in body and "```json" in body
    for search, _ in GUARDRAIL_FAMILY_TITLES.items():   # GitHub `in:title` search is word-based: no title holds another's words
        words = set(search.lower().split())
        hits = [t for k, t in GUARDRAIL_FAMILY_TITLES.items() if words <= set(t.lower().replace(":", " ").split())]
        assert hits == [GUARDRAIL_FAMILY_TITLES[search]], (search, hits)
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "flag-guardrail.yml").read_text(encoding="utf-8")
    assert f'title="{fg.P0_DRIFT_TITLE}"' in wf and '--search "P0 cold-start snapshot drift in:title"' in wf
    assert '--label "severity:critical"' in wf


def test_no_p0_file_without_a_lost_kill(tmp_path, monkeypatch):
    off = {"state": "off", "reason": "t", "set_by": fg.SET_BY, "set_at": "x", "evidence": "y"}
    rep = {"mode": "enforce", "decisions": {}, "results": {},
           "snapshot_drift": fg.snapshot_drift(rf_manifest(), {"SURF_TIDE_DEPTH": off})}   # over-holds only
    monkeypatch.setattr(fg, "run", lambda a: rep)
    fg.main(["--out", str(tmp_path)])
    assert not (tmp_path / "p0_drift.md").exists()


def _p0_jq():
    import re
    wf = (Path(__file__).resolve().parents[2] / ".github" / "workflows" / "flag-guardrail.yml").read_text(encoding="utf-8")
    return re.search(r"P0_JQ='([^']+)'", wf).group(1)


def _word_search(query, issues):
    """GitHub `in:title` search, mirrored: every query word appears among the title's words (case-insensitive)."""
    import re
    tok = lambda s: set(re.findall(r"[a-z0-9]+", s.lower()))  # noqa: E731
    return [i for i in issues if tok(query) <= tok(i["title"])]


def _jq_mirror(issues):
    """Python mirror of P0_JQ: the first issue whose title STARTS with the P0 prefix, else '' (// empty)."""
    hits = [i for i in issues if i["title"].startswith("P0 cold-start snapshot drift")]
    return str(hits[0]["number"]) if hits else ""


# Four title sets (advisor, #1263): the main issue carrying the OLD tag (its words match the P0 search), the PHYSICS blind
# issue, the P0 issue, and none. The P0 lookup must find only the P0 issue, and an empty result must open a new one.
TITLE_SETS = {
    "main-with-tag": ([{"number": 11, "title": "Flag guardrail: SURF_TIDE_DEPTH P0-cold-start-snapshot-drift-24h"}], ""),
    "blind": ([{"number": 12, "title": "PHYSICS guard blind: a check could not run"}], ""),
    "p0": ([{"number": 13, "title": fg.P0_DRIFT_TITLE}], "13"),
    "none": ([], ""),
}


@pytest.mark.parametrize("name", sorted(TITLE_SETS))
def test_the_p0_lookup_finds_only_the_p0_issue(name):
    issues, want = TITLE_SETS[name]
    searched = _word_search("P0 cold-start snapshot drift", issues)   # what `gh issue list --search` may return
    assert _jq_mirror(searched) == want
    assert "startswith(\"P0 cold-start snapshot drift\")" in _p0_jq() and "// empty" in _p0_jq()


def test_the_p0_jq_filter_with_real_jq():
    """The exact P0_JQ string through real jq (present on GitHub's ubuntu runners; skipped where it is not installed)."""
    import json
    import shutil
    import subprocess
    if not shutil.which("jq"):
        pytest.skip("jq not installed here; the Python mirror above covers the same four sets")
    everything = [i for issues, _ in TITLE_SETS.values() for i in issues]
    for issues, want in list(TITLE_SETS.values()) + [(everything, "13")]:
        out = subprocess.run(["jq", "-r", _p0_jq()], input=json.dumps(issues), capture_output=True, text=True,
                             check=True).stdout.strip()
        assert out == want, (issues, out)


def test_the_new_main_title_tags_share_no_word_with_the_p0_search(tmp_path, monkeypatch):
    off = {"state": "off", "reason": "t", "set_by": fg.SET_BY, "set_at": "x", "evidence": "y"}
    for live, snap in ((rf_manifest(SURF_TIDE_DEPTH=off), {}), (rf_manifest(), {"SURF_TIDE_DEPTH": off})):
        rep = {"mode": "enforce", "decisions": {}, "results": {}, "snapshot_drift": fg.snapshot_drift(live, snap)}
        monkeypatch.setattr(fg, "run", lambda a, rep=rep: rep)
        fg.main(["--out", str(tmp_path)])
        main_title = "Flag guardrail: " + (tmp_path / "acted.txt").read_text(encoding="utf-8")
        assert _word_search("P0 cold-start snapshot drift", [{"number": 1, "title": main_title}]) == []
