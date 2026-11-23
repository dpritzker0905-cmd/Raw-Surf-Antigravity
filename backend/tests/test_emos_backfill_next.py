"""The scheduled EMOS auto backfill (David, 2026-11-23: "Recover + backfill (Recommended)"): one monthly slice a day from
2025-07 through 2026-10, the cursor read from the stored record, refusing an unread fetch, wired into wind-emos-collect.yml
behind a kill switch and the supabase-service environment."""
import json
import os
import sys

import pytest
import yaml

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))
import emos_backfill_next as N  # noqa: E402

WF = os.path.join(os.path.dirname(os.path.dirname(HERE)), ".github", "workflows", "wind-emos-collect.yml")
JUNE = [f"202506{d:02d}00.npz" for d in range(1, 31) if d not in (14, 16, 18)]
DAILY = ["2026111700.npz", "2026111800.npz", "2026112000.npz"]


def test_starts_at_first_and_ignores_runs_outside_the_range():
    p = N.plan(JUNE + DAILY, "2025-07", "2026-10")
    assert p == {"go": "true", "start": "2025-07-01", "end": "2025-07-31", "month": "2025-07"}


def test_advances_past_the_newest_stored_month_even_when_partial():
    p = N.plan(JUNE + ["2025070300.npz", "2025071900.npz"] + DAILY, "2025-07", "2026-10")
    assert (p["start"], p["end"]) == ("2025-08-01", "2025-08-31")
    feb = N.plan(JUNE + ["2026011500.npz"], "2025-07", "2026-10")
    assert (feb["start"], feb["end"]) == ("2026-02-01", "2026-02-28")
    dec = N.plan(JUNE + ["2025111000.npz"], "2025-07", "2026-10")
    assert dec["month"] == "2025-12" and dec["end"] == "2025-12-31"


def test_stops_after_the_last_month():
    assert N.plan(JUNE + ["2026100100.npz"], "2025-07", "2026-10")["go"] == "false"


def test_refuses_an_unread_fetch():
    with pytest.raises(N.Unread):
        N.plan([], "2025-07", "2026-10")                                       # the 2026-11-19 401: an empty listing
    with pytest.raises(N.Unread):
        N.plan(JUNE, "2025-07", "2026-10", stations_present=False)


def test_cli_writes_github_output_and_exits_2_on_refusal(tmp_path, monkeypatch):
    ex, st, out = tmp_path / "existing.json", tmp_path / "st.json", tmp_path / "gh_out"
    ex.write_text(json.dumps(JUNE))
    st.write_text("{}")
    monkeypatch.setenv("GITHUB_OUTPUT", str(out))
    assert N.main(["--existing", str(ex), "--stations", str(st), "--first", "2025-07", "--last", "2026-10"]) == 0
    assert "start=2025-07-01" in out.read_text() and "go=true" in out.read_text()
    assert N.main(["--existing", str(ex), "--stations", str(tmp_path / "missing"), "--first", "2025-07", "--last", "2026-10"]) == 2


def test_workflow_wiring():
    wf = yaml.safe_load(open(WF, encoding="utf-8"))
    on = wf.get("on", wf.get(True))
    crons = [c["cron"] for c in on["schedule"]]
    assert "37 6 * * *" in crons and "7 10 * * *" in crons
    plan, bf, single = wf["jobs"]["plan"], wf["jobs"]["backfill"], wf["jobs"]["single"]
    assert "pull_request" not in on
    assert plan["environment"] == "supabase-service" and bf["environment"] == "supabase-service"
    assert "(vars.EMOS_BACKFILL_AUTO || '1') != '0'" in plan["if"] and "37 6 * * *" in plan["if"]
    assert "37 6 * * *" in single["if"]                                    # the daily job never runs on the backfill cron
    assert bf["needs"] == "plan" and "needs.plan.outputs.go == 'true'" in bf["if"]
    run = " ".join(s.get("run", "") for s in bf["steps"])
    assert "needs.plan.outputs.start" in run and "needs.plan.outputs.end" in run and "stored no run" in run
    nxt = [s for s in plan["steps"] if s.get("id") == "next"][0]["run"]
    assert "python3 -I -S" in nxt and "--first 2025-07 --last 2026-10" in nxt
