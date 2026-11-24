"""Reliability lane PR 2: the stale-data alarm notifies the owner through ONE GitHub issue (no new secret).

Pins: the severity rules; one issue per outage (opened once, escalated once, closed on recovery, never re-commented
at the same severity); the forced-stale proof never touches a real issue; the workflow wires the step, the
permission and the force input; the Render dispatcher fires the monitor off GitHub's cron."""
import json
import subprocess
import sys
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import staleness_alert as sa  # noqa: E402
from services import workflow_dispatch as WD  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows" / "data-health-monitor.yml"
FRESH = {"status": "ok", "lanes": {"core": {"age_h": 2.0}, "ratings": {"age_h": 3.5}}}


def _issue(n, sev, title="Stale data: X"):
    return {"number": n, "title": title, "labels": [{"name": "stale-data"}, {"name": f"severity:{sev}"}]}


@pytest.mark.parametrize("health,code,want", [
    (FRESH, "200", "none"),
    (None, "000", "critical"),                                    # unreachable
    (FRESH, "503", "critical"),
    ({"status": "critical", "lanes": {}}, "200", "critical"),
    ({"status": "warn", "lanes": {"core": {"age_h": 8.2}}}, "200", "high"),   # the 07-13 deaf spot
    ({"status": "warn", "lanes": {"core": {"age_h": 6.9}}}, "200", "none"),   # a lag under the bound does not page
])
def test_severity(health, code, want):
    assert sa.assess(health, code, 7.0)[0] == want


def test_a_failed_raster_or_regional_step_is_high():
    assert sa.assess(FRESH, "200", 7.0, raster="failure")[0] == "high"
    assert sa.assess(FRESH, "200", 7.0, regional="failure")[0] == "high"
    assert sa.assess(FRESH, "200", 7.0, raster="skipped")[0] == "none"


def test_one_issue_per_outage():
    sev, why = sa.assess(None, "000", 7.0)
    d = sa.decide(sev, why, [])
    assert d["action"] == "open" and d["labels"] == ["stale-data", "severity:critical"]
    assert "CRITICAL" in d["title"] and "HTTP 000" in d["body"]
    assert sa.decide("critical", why, [_issue(7, "critical")])["action"] == "none"   # no comment every 30 min
    assert sa.decide("high", why, [_issue(7, "critical")])["action"] == "none"       # never de-escalates noisily
    up = sa.decide("critical", why, [_issue(7, "high")])
    assert up["action"] == "escalate" and up["number"] == 7 and up["remove_labels"] == ["severity:high"]
    assert sa.decide("none", [], [])["action"] == "none"


def _recovering(n, sev):
    i = _issue(n, sev)
    i["labels"].append({"name": sa.RECOVERING})
    return i


def test_hysteresis_two_healthy_runs_before_a_close_and_a_relapse_resets():
    """Advisor limit (b) on #1263: one healthy run never closes an issue."""
    one = sa.decide("none", [], [_issue(7, "high")])
    assert one["action"] == "recovering" and one["number"] == 7 and one["labels"] == [sa.RECOVERING]
    two = sa.decide("none", [], [_recovering(7, "high")])
    assert two["action"] == "close" and two["number"] == 7 and "two consecutive healthy runs" in two["body"]
    back = sa.decide("high", ["lane x"], [_recovering(7, "high")])
    assert back["action"] == "relapse" and back["remove_labels"] == [sa.RECOVERING]
    worse = sa.decide("critical", ["x"], [_recovering(7, "high")])
    assert worse["action"] == "escalate" and worse["remove_labels"] == ["recovering", "severity:high"]


def test_a_flapping_outage_reopens_the_recent_issue_instead_of_opening_a_new_one():
    now = datetime(2026, 11, 24, 12, tzinfo=timezone.utc)
    closed = [dict(_issue(7, "high"), closedAt="2026-11-24T06:00:00Z"),
              dict(_issue(9, "critical", title=sa.TEST_TAG + "Stale data"), closedAt="2026-11-24T11:00:00Z")]
    d = sa.decide("critical", ["x"], [], recent_closed=closed, now=now)
    assert d["action"] == "reopen" and d["number"] == 7 and d["remove_labels"] == ["severity:high"]   # never the [TEST] one
    old = [dict(_issue(7, "high"), closedAt="2026-11-22T06:00:00Z")]                                 # > 24 h ago
    assert sa.decide("critical", ["x"], [], recent_closed=old, now=now)["action"] == "open"


def test_the_forced_stale_proof_opens_a_test_issue_and_never_touches_a_real_one():
    sev, why = sa.assess(sa.forced_body(), "200", 7.0)
    assert sev == "critical"
    d = sa.decide(sev, why, [_issue(7, "high")], force=True)
    assert d["action"] == "open" and d["test"] and d["title"].startswith(sa.TEST_TAG) and d["close_tests"] == []


def test_a_leftover_test_issue_is_closed_and_never_escalated_or_adopted():
    """Advisor limit (c) on #1263: a [TEST] issue a failed close left open must not become the real issue and lose its
    [TEST] prefix through an escalation."""
    left = _issue(9, "high", title=sa.TEST_TAG + "Stale data: HIGH")
    d = sa.decide("critical", ["x"], [left])
    assert d["action"] == "open" and d["close_tests"] == [9] and not d["title"].startswith(sa.TEST_TAG)
    assert sa.decide("none", [], [left]) == {"severity": "none", "close_tests": [9], "action": "none"}


def test_census_cadence_on_dispatched_runs():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    steps = doc["jobs"]["check"]["steps"]
    ids = [s.get("id") for s in steps]
    assert ids.index("cadence") < ids.index("regional")
    assert "steps.cadence.outputs.census == '1'" in steps[ids.index("regional")]["if"]
    run = steps[ids.index("cadence")]["run"]
    assert '"$EVENT" = "schedule"' in run and "EVERY_H" in run


def test_the_cli_end_to_end_forced_stale(tmp_path):
    out = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "staleness_alert.py"),
                          "--health", str(tmp_path / "missing.json"), "--force-stale", "--run-url", "https://run"],
                         capture_output=True, text=True, check=True).stdout
    d = json.loads(out)
    assert d["action"] == "open" and d["severity"] == "critical" and "FORCED-STALE" in d["body"]


def test_the_workflow_wires_the_alert_with_no_new_secret():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    assert doc["permissions"].get("issues") == "write"
    trig = doc.get("on") or doc.get(True)
    assert "force_stale" in trig["workflow_dispatch"]["inputs"]
    steps = doc["jobs"]["check"]["steps"]
    step = next(s for s in steps if s.get("name", "").startswith("Stale-data issue"))
    assert step["if"].startswith("${{ always()")
    assert "scripts/staleness_alert.py" in step["run"] and "--assignee" in step["run"]
    assert set(step["env"]) == {"GH_TOKEN", "OWNER", "FORCE", "PAGE_HOURS", "RASTER", "REGIONAL", "RUN_URL"}
    assert step["env"]["GH_TOKEN"] == "${{ github.token }}"
    assert {s.get("id") for s in steps} >= {"health", "raster", "regional"}


def test_the_render_dispatcher_fires_the_monitor_off_githubs_cron():
    assert WD.LANES["data-health-monitor.yml"] == ("*/30", "*")
    grace = WD.LANE_GRACE_MIN["data-health-monitor.yml"]
    slots = WD.daily_slots("*/30", "*")
    from datetime import datetime, timezone
    now = datetime(2026, 11, 24, 9, 12, tzinfo=timezone.utc)                 # slot 09:00, 12 min ago, no run
    fire, why = WD.decide([{"id": 1, "status": "completed", "created_at": "2026-11-24T08:31:00Z"}], now, slots, grace)
    assert fire, why
    fire, _ = WD.decide([], datetime(2026, 11, 24, 9, 5, tzinfo=timezone.utc), slots, grace)
    assert not fire                                                          # inside its grace: GitHub may still fire


def test_an_off_cadence_run_never_advances_recovery_so_a_census_issue_does_not_flap():
    """Advisor (a) on #1263: a regional failure, then two runs where the census was SKIPPED: the issue stays open."""
    sev, why = sa.assess(FRESH, "200", 7.0, regional="failure")
    opened = sa.decide(sev, why, [])
    assert opened["action"] == "open" and sev == "high"
    issue = _issue(7, "high")
    for _ in range(2):                                    # health-only runs: the census was skipped (off-cadence)
        sev, why = sa.assess(FRESH, "200", 7.0, regional="skipped")
        d = sa.decide(sev, why, [issue], census_skipped=True)
        assert sev == "none" and d["action"] == "none" and "census skipped" in d["held"]
    assert sa.decide("none", [], [issue], census_skipped=False)["action"] == "recovering"   # a census run counts


def test_the_cli_passes_a_skipped_census_through(tmp_path):
    (tmp_path / "h.json").write_text(json.dumps(FRESH), encoding="utf-8")
    (tmp_path / "o.json").write_text(json.dumps([_issue(7, "high")]), encoding="utf-8")
    out = subprocess.run([sys.executable, str(HERE.parent / "scripts" / "staleness_alert.py"), "--health",
                          str(tmp_path / "h.json"), "--code", "200", "--regional", "skipped",
                          "--open-issues", str(tmp_path / "o.json")], capture_output=True, text=True, check=True).stdout
    assert json.loads(out)["action"] == "none"


def test_census_every_h_falls_back_to_3_on_zero_or_garbage():
    doc = yaml.safe_load(WF.read_text(encoding="utf-8"))
    run = next(s for s in doc["jobs"]["check"]["steps"] if s.get("id") == "cadence")["run"]
    assert "case \"$EVERY_H\" in ''|*[!0-9]*|0) EVERY_H=3 ;; esac" in run
    assert run.index("EVERY_H=3") < run.index("% EVERY_H")
