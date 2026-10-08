"""The data lanes fire when GitHub's schedule does not -- and only then, and only once a token exists.

GitHub dropped 44% / 11% / 75% of the core-ingest / pilots / MOP-ingest scheduled slots over three days and ran the
rest a median 106 / 305 / 290 min late (measured 2026-09-28). `services/workflow_dispatch.py` dispatches a lane
whose latest cron slot passed with no run. These pin: the slots ARE the workflow files' crons; a slot GitHub
honours, or a run in flight, is never doubled; nothing happens without a token; the token never leaves the request.
"""
import json
import logging
from datetime import datetime, timezone
from pathlib import Path

import pytest
import yaml

from services import workflow_dispatch as WD

_WF = Path(__file__).resolve().parents[2] / ".github" / "workflows"
FAKE_TOKEN = "test-dispatch-token-not-a-real-credential"


def _utc(h, m, d=28):
    return datetime(2026, 9, d, h, m, tzinfo=timezone.utc)


@pytest.fixture(autouse=True)
def clean(monkeypatch):
    for k in ("GITHUB_DISPATCH_TOKEN", "WORKFLOW_DISPATCH", "GITHUB_DISPATCH_REPO"):
        monkeypatch.delenv(k, raising=False)
    WD._last.clear()
    yield monkeypatch
    WD._last.clear()


@pytest.mark.parametrize("wf", sorted(WD.LANES))
def test_each_lane_is_its_workflows_own_cron_and_accepts_a_dispatch(wf):
    doc = yaml.safe_load((_WF / wf).read_text(encoding="utf-8"))
    on = doc.get("on") if "on" in doc else doc.get(True)
    crons = [e["cron"].split() for e in on.get("schedule") or []]
    assert len(crons) == 1, f"{wf}: one cron expected, the lane models exactly one"
    minute, hour, dom, mon, dow = crons[0]
    assert (dom, mon, dow) == ("*", "*", "*"), f"{wf}: only daily crons are modelled"
    assert WD.LANES[wf] == (minute, hour), f"{wf}: the dispatcher's slots drifted from the workflow's cron"
    assert "workflow_dispatch" in on, f"{wf}: without workflow_dispatch every POST would 422"


def test_the_slot_math():
    assert WD.daily_slots("15", "*/4") == [15, 255, 495, 735, 975, 1215]
    assert WD.daily_slots("45", "3,11,19") == [225, 705, 1185]
    slots = WD.daily_slots("15", "*/4")
    assert WD.last_slot(_utc(8, 20), slots) == _utc(8, 15)
    assert WD.last_slot(_utc(8, 15), slots) == _utc(8, 15), "a slot is reached AT its minute"
    assert WD.last_slot(_utc(0, 5), slots) == _utc(20, 15, d=27), "before today's first slot: yesterday's last"


SLOTS = WD.daily_slots("15", "*/4")


def _run(created, status="completed", rid=1, event="schedule"):
    return {"id": rid, "status": status, "event": event, "created_at": created}


def test_a_slot_inside_its_grace_is_left_to_github():
    fire, why = WD.decide([], _utc(8, 40), SLOTS)
    assert not fire and "GitHub may still fire it" in why


def test_a_late_slot_with_no_run_is_dispatched():
    fire, why = WD.decide([_run("2026-09-28T05:28:17Z")], _utc(8, 46), SLOTS)
    assert fire and "08:15Z" in why
    assert WD.decide([], _utc(8, 46), SLOTS)[0], "no runs at all is a missed slot too"


def test_a_slot_github_honoured_late_is_not_doubled():
    fire, why = WD.decide([_run("2026-09-28T10:01:00Z", rid=7)], _utc(10, 30), SLOTS)
    assert not fire and "served by run 7" in why
    assert not WD.decide([_run("2026-09-28T08:15:00Z")], _utc(9, 0), SLOTS)[0], "created AT the slot serves it"


def test_a_run_in_flight_is_never_stacked():
    fire, why = WD.decide([_run("2026-09-28T07:50:00Z", status="in_progress", rid=9)], _utc(9, 0), SLOTS)
    assert not fire and "run 9 is in_progress" in why
    assert not WD.decide([_run("2026-09-28T07:50:00Z", status="queued")], _utc(9, 0), SLOTS)[0]


class _Resp:
    def __init__(self, code, body=None):
        self.status_code, self._body = code, body or {}

    def json(self):
        return self._body


class _Http:
    """Fake GitHub: per-workflow runs; records every request."""

    def __init__(self, runs_by_wf, fail=()):
        self.runs, self.fail, self.gets, self.posts = runs_by_wf, set(fail), [], []

    def get(self, url, headers=None, params=None, timeout=None):
        self.gets.append((url, headers))
        wf = url.split("/workflows/")[1].split("/")[0]
        if wf in self.fail:
            raise ConnectionError("github unreachable")
        return _Resp(200, {"workflow_runs": self.runs.get(wf, [])})

    def post(self, url, headers=None, json=None, timeout=None):
        self.posts.append((url, headers, json))
        return _Resp(204)


class _Exploding:
    def get(self, *a, **k):
        raise AssertionError("a dark dispatcher made a request")

    post = get


def test_dark_without_a_token_asks_github_nothing(clean):
    assert WD.run_once(now=_utc(9, 0), http=_Exploding()) == {}
    clean.setenv("GITHUB_DISPATCH_TOKEN", FAKE_TOKEN)
    clean.setenv("WORKFLOW_DISPATCH", "0")
    assert WD.run_once(now=_utc(9, 0), http=_Exploding()) == {}, "the kill switch wins over a token"
    assert WD.status()["armed"] is False


def test_armed_it_dispatches_only_the_lane_whose_slot_was_missed(clean):
    clean.setenv("GITHUB_DISPATCH_TOKEN", FAKE_TOKEN)
    now = _utc(12, 20)   # core slot 12:15 (in grace), pilots slot 11:45, MOP slot 12:40 not yet -> 06:40
    http = _Http({
        "forecast-ingest.yml": [_run("2026-09-28T08:40:00Z")],             # 12:15 slot only 5 min old
        "forecast-ingest-pilots.yml": [_run("2026-09-28T10:10:47Z")],       # 11:45 slot missed
        "mop-nearshore-ingest.yml": [_run("2026-09-28T06:50:00Z")],         # 06:40 slot served
        "data-health-monitor.yml": [_run("2026-09-28T12:05:00Z")],         # monitor slot served
    })
    out = WD.run_once(now=now, http=http)
    assert [u for u, _h, _j in http.posts] == [
        f"{WD.API}/repos/{WD.DEFAULT_REPO}/actions/workflows/forecast-ingest-pilots.yml/dispatches"]
    assert http.posts[0][2] == {"ref": "dev"}
    assert http.posts[0][1]["Authorization"] == f"Bearer {FAKE_TOKEN}"
    assert out["forecast-ingest-pilots.yml"]["dispatched"] and not out["forecast-ingest.yml"]["dispatched"]
    assert not out["mop-nearshore-ingest.yml"]["dispatched"]


def test_the_token_never_reaches_the_log_or_health(clean, caplog):
    clean.setenv("GITHUB_DISPATCH_TOKEN", FAKE_TOKEN)
    caplog.set_level(logging.DEBUG, logger=WD.__name__)
    WD.run_once(now=_utc(12, 20), http=_Http({}, fail={"mop-nearshore-ingest.yml"}))
    assert FAKE_TOKEN not in caplog.text
    health = json.dumps(WD.status())
    assert FAKE_TOKEN not in health and '"armed": true' in health


def test_one_unreachable_lane_does_not_cost_the_others(clean):
    clean.setenv("GITHUB_DISPATCH_TOKEN", FAKE_TOKEN)
    http = _Http({}, fail={"forecast-ingest.yml"})
    out = WD.run_once(now=_utc(12, 20), http=http)
    assert out["forecast-ingest.yml"]["why"].startswith("error: ConnectionError")
    assert out["forecast-ingest-pilots.yml"]["dispatched"], "the missed pilots slot is still dispatched"


def test_a_refused_dispatch_is_reported_not_claimed(clean):
    clean.setenv("GITHUB_DISPATCH_TOKEN", FAKE_TOKEN)
    http = _Http({})
    http.post = lambda *a, **k: _Resp(403)
    out = WD.run_once(now=_utc(12, 20), http=http)
    assert out["forecast-ingest-pilots.yml"] == {"dispatched": False, "why": "error: RuntimeError: dispatch HTTP 403",
                                                 "at": "2026-09-28T12:20:00Z"}


def test_the_scheduler_registers_the_job():
    src = (Path(__file__).resolve().parents[1] / "scheduler" / "__init__.py").read_text(encoding="utf-8")
    assert "id='workflow_dispatch'" in src and "workflow_dispatch.run_once()" in src


def test_missing_half_hour_monitor_is_rescued_after_its_own_grace(clean):
    clean.setenv('GITHUB_DISPATCH_TOKEN', FAKE_TOKEN)
    http = _Http({})
    out = WD.run_once(now=_utc(12, 15), http=http)
    assert out['data-health-monitor.yml']['dispatched']
    assert any('/data-health-monitor.yml/dispatches' in u for u, _, _ in http.posts)


@pytest.mark.parametrize('status', ['queued', 'in_progress', 'completed'])
def test_existing_monitor_run_is_not_doubled(clean, status):
    clean.setenv('GITHUB_DISPATCH_TOKEN', FAKE_TOKEN)
    out = WD.run_once(now=_utc(12, 15), http=_Http({
        'data-health-monitor.yml': [_run('2026-09-28T12:05:00Z', status=status)]}))
    assert not out['data-health-monitor.yml']['dispatched']


@pytest.mark.parametrize('completed,expected', [('2026-09-28T12:10:00Z', False),
                                             ('2026-09-28T10:00:00Z', True), (None, True)])
def test_monitor_completion_liveness_is_distinct_from_dispatch_ack(clean, completed, expected):
    clean.setenv('GITHUB_DISPATCH_TOKEN', FAKE_TOKEN)
    runs = [_run('2026-09-28T12:01:00Z', status='in_progress')]
    if completed:
        runs.append({**_run('2026-09-28T09:00:00Z'), 'updated_at': completed})
    out = WD.run_once(now=_utc(12, 15), http=_Http({'data-health-monitor.yml': runs}))
    assert not out['data-health-monitor.yml']['dispatched']
    assert out['data-health-monitor.yml']['completion_overdue'] == expected
    assert out['data-health-monitor.yml']['last_completed_at'] == completed


def test_monitor_rescue_covers_every_half_hour_slot_over_a_day(clean):
    from datetime import timedelta
    clean.setenv('GITHUB_DISPATCH_TOKEN', FAKE_TOKEN)
    http = _Http({})
    start = _utc(0, 0)
    for step in range(96):
        now = start + timedelta(minutes=15 * step)
        out = WD.run_once(now=now, http=http)
        if out['data-health-monitor.yml']['dispatched']:
            stamp = now.isoformat()
            http.runs.setdefault('data-health-monitor.yml', []).append(
                {**_run(stamp, rid=step), 'updated_at': stamp})
    posts = [u for u, _, _ in http.posts if '/data-health-monitor.yml/' in u]
    assert len(posts) == 48  # One rescue per slot, no scheduled runs, no real GitHub calls.
