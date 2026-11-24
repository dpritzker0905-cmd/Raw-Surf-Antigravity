"""Loud storage and a recorded miss (2026-11-19 and 11-22).
- On 11-19 a 401 from storage read as an empty bucket. The EMOS collector stopped on "no frozen station list", and the gust
  collector froze a new list, failed every write, and stayed green.
- On 11-22 one failed HEAD for ICON's 00Z made the gust collector fall back to the stored yesterday, so today was lost silently.
The storage helpers now exit on any answer but 200 or not-found, and refuse a green run after a refused write. The gust daily
plan retries availability and records a missed today."""
import os
import sys
from datetime import datetime, timezone

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "scripts"))

import emos_bucket_io as EB  # noqa: E402
import gust_bucket_io as GB  # noqa: E402
import gust_verify_collect as C  # noqa: E402


def _fake(status_for):
    def req(method, path, body=None, ctype=None, extra=None):
        return status_for(method, path), b"[]" if "/object/list/" in path else b"{}"
    return req


@pytest.mark.parametrize("B", [EB, GB])
@pytest.mark.parametrize("status", [401, 403, 500, 0])
def test_a_refused_read_fails_loudly_instead_of_reading_as_empty(B, status, tmp_path, monkeypatch):
    monkeypatch.setattr(B, "_req", _fake(lambda m, p: status))
    with pytest.raises(SystemExit) as e:
        B.main(["x", "fetch", "--dir", str(tmp_path)])
    assert "storage read failed" in str(e.value) and str(status) in str(e.value)


@pytest.mark.parametrize("B", [EB, GB])
@pytest.mark.parametrize("missing", [400, 404])
def test_a_missing_object_is_still_absent(B, missing, tmp_path, monkeypatch):
    monkeypatch.setattr(B, "_req", _fake(lambda m, p: 200 if "/object/list/" in p else missing))
    assert B.main(["x", "fetch", "--dir", str(tmp_path)]) == 0
    assert B.get("anything") is None


@pytest.mark.parametrize("B,sub,name", [(EB, "runs", "2026111900.npz.new"), (GB, "cycles", "GFS_2026111900.json.gz.new")])
def test_a_refused_write_fails_after_trying_every_file_and_a_duplicate_does_not(B, sub, name, tmp_path, monkeypatch):
    d = tmp_path / sub
    d.mkdir()
    (d / name).write_bytes(b"x")
    sent = []
    monkeypatch.setattr(B, "_req", lambda m, p, body=None, ctype=None, extra=None: sent.append(p) or (401, b""))
    with pytest.raises(SystemExit) as e:
        B.main(["x", "upload", "--dir", str(tmp_path)])
    assert "storage write failed" in str(e.value) and "401" in str(e.value) and sent
    monkeypatch.setattr(B, "_req", lambda m, p, body=None, ctype=None, extra=None: (409, b""))
    assert B.main(["x", "upload", "--dir", str(tmp_path)]) == 0


class _Model:
    name = "ICON"

    def __init__(self, answers):
        self.answers = answers                   # {cycle: [bool, ...]} consumed one per call
        self.asked = []

    def available(self, cycle):
        self.asked.append(cycle)
        a = self.answers.get(cycle, [False])
        return a.pop(0) if len(a) > 1 else a[0]


TODAY = datetime(2026, 11, 22, tzinfo=timezone.utc)
YDAY = datetime(2026, 11, 21, tzinfo=timezone.utc)
LATE = datetime(2026, 11, 22, 18, 33, tzinfo=timezone.utc)      # the 11-22 run's real time: today's run was long due


def _report():
    return {"skipped": [], "unavailable": []}


def test_one_failed_head_is_retried():
    m, rep = _Model({TODAY: [False, False, True]}), _report()
    jobs = C.plan_daily(m, TODAY, {"cycles/ICON_2026112100.json.gz"}, rep, waits=(0, 0, 0))
    assert [j[1] for j in jobs] == [TODAY] and rep["unavailable"] == []


def test_a_stored_yesterday_never_hides_a_missed_today():
    """The 2026-11-22 case: today unavailable, yesterday stored. The miss is recorded, not skipped quietly."""
    m, rep = _Model({TODAY: [False]}), _report()
    jobs = C.plan_daily(m, TODAY, {"cycles/ICON_2026112100.json.gz"}, rep, waits=(0, 0, 0), now=LATE)
    assert jobs == [] and rep["unavailable"] == ["ICON 2026112200"]
    assert rep["skipped"] == ["cycles/ICON_2026112100.json.gz"] and m.asked.count(TODAY) == 4


def test_an_unstored_yesterday_is_still_collected_and_today_still_recorded():
    m, rep = _Model({TODAY: [False], YDAY: [True]}), _report()
    jobs = C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0), now=LATE)
    assert [j[1] for j in jobs] == [YDAY] and rep["unavailable"] == ["ICON 2026112200"]


def test_a_stored_today_is_skipped_without_asking():
    m, rep = _Model({}), _report()
    both = {"cycles/ICON_2026112200.json.gz", "cycles/ICON_2026112100.json.gz"}
    assert C.plan_daily(m, TODAY, both, rep, waits=(0, 0, 0)) == []
    assert m.asked == [] and rep["skipped"] == ["cycles/ICON_2026112200.json.gz", "cycles/ICON_2026112100.json.gz"]


def test_a_dropped_scheduled_run_is_caught_the_next_day():
    """Advisor HOLD on #1255: today is available, but yesterday (its scheduled run dropped by GitHub) is neither stored nor
    available any more (ICON keeps only its latest run). That must end red, not green."""
    m, rep = _Model({TODAY: [True], YDAY: [False]}), _report()
    jobs = C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0), now=LATE)
    assert [j[1] for j in jobs] == [TODAY] and rep["unavailable"] == ["ICON 2026112100"]


def test_before_10z_a_missing_yesterday_is_still_red():
    early = datetime(2026, 11, 22, 0, 1, tzinfo=timezone.utc)
    m, rep = _Model({TODAY: [False], YDAY: [False]}), _report()
    assert C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0), now=early) == []
    assert rep["not_yet_due"] == ["ICON 2026112200"] and rep["unavailable"] == ["ICON 2026112100"]


def test_the_look_back_only_reports():
    done = {"cycles/ICON_2026112200.json.gz", "cycles/ICON_2026112100.json.gz", "cycles/ICON_2026111900.json.gz"}
    rep = _report()
    assert C.plan_daily(_Model({}), TODAY, done, rep, waits=(0,), now=LATE) == []
    assert rep["unavailable"] == [] and rep["missing_recent"] == ["ICON 2026112000", "ICON 2026111800"]


# ---------------------------------------------------------------------------------------------------- wind EMOS daily (11-16)
import wind_emos_collect as W  # noqa: E402

NOW = datetime(2026, 11, 16, 18, 0, tzinfo=timezone.utc)


def _ef(monkeypatch, answers):
    """answers: {(yyyymmdd, base): [result, ...]}; a result is True / False or an exception to raise."""
    calls = []

    def run_available(session, run, lead, base):
        k = (f"{run:%Y%m%d}", base)
        calls.append(k)
        seq = answers.get(k, [False])
        r = seq.pop(0) if len(seq) > 1 else seq[0]
        if isinstance(r, Exception):
            raise r
        return r
    monkeypatch.setattr(W.ef, "run_available", run_available)
    return calls


def test_emos_the_11_16_503_is_recorded_not_hidden_behind_a_stored_yesterday(monkeypatch):
    e503 = RuntimeError("HTTP 503 https://ecmwf-forecasts.s3.eu-central-1.amazonaws.com/20261116/00z/ifs/0p25/enfo/x.index")
    _ef(monkeypatch, {("20261116", W.ef.ECMWF_BASE): [e503], ("20261116", W.ef.AWS_BASE): [e503]})
    rep = {"skipped": [], "unavailable": [], "dropped": []}
    plan = W.daily_plan(None, NOW, {"2026111500.npz"}, rep, waits=(0, 0, 0))
    assert plan == [] and rep["unavailable"] == ["2026111600"] and rep["skipped"] == ["2026111500.npz"]
    assert W.daily_status(rep) == 3


def test_emos_a_transient_503_is_retried_and_collected(monkeypatch):
    e503 = RuntimeError("HTTP 503")
    _ef(monkeypatch, {("20261116", W.ef.ECMWF_BASE): [False], ("20261116", W.ef.AWS_BASE): [e503, True]})
    rep = {"skipped": [], "unavailable": [], "dropped": []}
    plan = W.daily_plan(None, NOW, {"2026111500.npz"}, rep, waits=(0, 0, 0))
    assert plan == [(datetime(2026, 11, 16, tzinfo=timezone.utc), W.ef.AWS_BASE)]
    assert rep["unavailable"] == [] and W.daily_status(rep) == 0


def test_emos_a_dropped_scheduled_run_is_caught_the_next_day(monkeypatch):
    _ef(monkeypatch, {("20261116", W.ef.ECMWF_BASE): [True]})                 # today fine; 11-15 unreachable everywhere
    rep = {"skipped": [], "unavailable": [], "dropped": []}
    plan = W.daily_plan(None, NOW, set(), rep, waits=(0,))
    assert [r for r, _ in plan] == [datetime(2026, 11, 16, tzinfo=timezone.utc)]
    assert rep["unavailable"] == ["2026111500"] and W.daily_status(rep) == 3


def test_emos_before_10z_a_missing_yesterday_is_still_red(monkeypatch):
    _ef(monkeypatch, {})
    rep = {"skipped": [], "unavailable": [], "dropped": []}
    assert W.daily_plan(None, datetime(2026, 11, 16, 0, 1, tzinfo=timezone.utc), set(), rep, waits=(0,)) == []
    assert rep["not_yet_due"] == ["2026111600"] and rep["unavailable"] == ["2026111500"] and W.daily_status(rep) == 3


def test_emos_a_dropped_daily_run_ends_red():
    assert W.daily_status({"unavailable": [], "dropped": [{"run": "2026111900.npz", "why": "x"}]}) == 3


def test_emos_the_daily_upload_runs_even_when_the_collect_step_fails():
    import yaml
    wf = yaml.safe_load(open(os.path.join(os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__)))),
                                          ".github", "workflows", "wind-emos-collect.yml"), encoding="utf-8"))
    up = [s for s in wf["jobs"]["single"]["steps"] if s.get("name", "").startswith("Upload new objects")][0]
    assert up["if"].replace(" ", "").startswith("${{always()&&")


# ---------------------------------------------------------------------------------------------------- EURO retry ladder (11-19)
def test_euro_uses_the_longer_ladder_and_others_keep_theirs(monkeypatch):
    assert C.EuroModel.retry_waits == (5, 15, 45, 120, 300)
    slept = []
    monkeypatch.setattr("time.sleep", lambda s: slept.append(s))

    class Flaky:
        name, steps, retry_waits = "EURO", (3,), C.EURO_RETRY_WAITS
        n = 0

        def window(self, f):
            return 1

        def step(self, cycle, f, nodes):
            Flaky.n += 1
            if Flaky.n < 5:                                   # throttled for the first four tries (the 11-19 pattern)
                raise RuntimeError("index not a GRIB index (HTTP 503; throttled mirror): retryable")
            return [1.0], [2.0]
    doc = C.collect_cycle(Flaky(), TODAY, [{"id": "A", "node": [1, 2]}], workers=1)
    assert [s["f"] for s in doc["steps"]] == [3] and doc["dropped"] == []
    assert slept == [0, 5, 15, 45, 120]                   # recovered on the 5th try, which the old 5/15/45 ladder never reached


def test_the_cycle_budget_drops_instead_of_waiting_past_it(monkeypatch):
    clock = [0.0]
    monkeypatch.setattr("time.monotonic", lambda: clock[0])
    monkeypatch.setattr("time.sleep", lambda s: clock.__setitem__(0, clock[0] + s))

    class Never:
        name, steps, retry_waits = "EURO", (3,), (5, 15, 45, 120, 300)

        def window(self, f):
            return 1

        def step(self, cycle, f, nodes):
            raise RuntimeError("HTTP 503")
    doc = C.collect_cycle(Never(), TODAY, [{"id": "A", "node": [1, 2]}], workers=1, budget_s=100)
    d = doc["dropped"][0]
    assert d["why"].endswith("(retry budget spent)") and d["attempts"] == 4 and clock[0] <= 100   # 0, 5, 15, 45; not 120


def test_an_error_page_is_not_a_grib_index():
    assert C.is_grib_index(200, '{"param": "10fg", "levtype": "sfc", "_offset": 0, "_length": 10}\n')
    assert not C.is_grib_index(503, '{"param": "10fg"}')
    assert not C.is_grib_index(200, "<?xml version='1.0'?><Error><Code>SlowDown</Code></Error>")
    assert not C.is_grib_index(200, "")


def test_before_the_run_is_due_a_missing_today_is_not_a_miss(monkeypatch):
    """The PR dry run at 00:01Z on 2026-11-24 found no 11-24 runs (not yet published) and wrongly ended red."""
    early = datetime(2026, 11, 22, 0, 1, tzinfo=timezone.utc)
    m, rep = _Model({TODAY: [False], YDAY: [True]}), _report()
    jobs = C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0), now=early)
    assert [j[1] for j in jobs] == [YDAY] and rep["unavailable"] == [] and rep["not_yet_due"] == ["ICON 2026112200"]
    monkeypatch.setattr(W.ef, "run_available", lambda session, run, lead, base: run.day == 15)
    rep2 = {"skipped": [], "unavailable": [], "dropped": []}
    plan = W.daily_plan(None, datetime(2026, 11, 16, 0, 1, tzinfo=timezone.utc), set(), rep2, waits=(0,))
    assert [r for r, _ in plan] == [datetime(2026, 11, 15, tzinfo=timezone.utc)]
    assert rep2["unavailable"] == [] and rep2["not_yet_due"] == ["2026111600"] and W.daily_status(rep2) == 0


def test_only_the_keyless_dry_run_reports_instead_of_failing():
    root = os.path.dirname(os.path.dirname(os.path.dirname(os.path.abspath(__file__))))
    dry = open(os.path.join(root, ".github", "workflows", "gust-verify-dry-run.yml"), encoding="utf-8").read()
    real = open(os.path.join(root, ".github", "workflows", "gust-verify.yml"), encoding="utf-8").read()
    assert "daily --cache \"$GV\" --report-only" in dry and "--report-only" not in real
