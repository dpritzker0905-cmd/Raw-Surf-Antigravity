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


def _report():
    return {"skipped": [], "unavailable": []}


def test_one_failed_head_is_retried():
    m, rep = _Model({TODAY: [False, False, True]}), _report()
    jobs = C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0))
    assert [j[1] for j in jobs] == [TODAY] and rep["unavailable"] == []


def test_a_stored_yesterday_never_hides_a_missed_today():
    """The 2026-11-22 case: today unavailable, yesterday stored. The miss is recorded, not skipped quietly."""
    m, rep = _Model({TODAY: [False]}), _report()
    jobs = C.plan_daily(m, TODAY, {"cycles/ICON_2026112100.json.gz"}, rep, waits=(0, 0, 0))
    assert jobs == [] and rep["unavailable"] == ["ICON 2026112200"]
    assert rep["skipped"] == ["cycles/ICON_2026112100.json.gz"] and m.asked.count(TODAY) == 4


def test_an_unstored_yesterday_is_still_collected_and_today_still_recorded():
    m, rep = _Model({TODAY: [False], YDAY: [True]}), _report()
    jobs = C.plan_daily(m, TODAY, set(), rep, waits=(0, 0, 0))
    assert [j[1] for j in jobs] == [YDAY] and rep["unavailable"] == ["ICON 2026112200"]


def test_a_stored_today_is_skipped_without_asking():
    m, rep = _Model({}), _report()
    assert C.plan_daily(m, TODAY, {"cycles/ICON_2026112200.json.gz"}, rep, waits=(0, 0, 0)) == []
    assert m.asked == [] and rep["skipped"] == ["cycles/ICON_2026112200.json.gz"]
