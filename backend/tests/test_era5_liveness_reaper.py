"""A SUPERVISOR HEALS A DEAD JOB, NOT A WEDGED ONE.

MEASURED 2026-08-04: the ERA5 campaign sat 49 minutes ALIVE on 10.3 s of CPU (0.35%), blocked inside
cdsapi on `502 ... attempt 1 of 500`, and because the scheduled task is `MultipleInstances:
IgnoreNew` every hourly trigger was SILENTLY SKIPPED. cdsapi retries 500 x 120 s, so one CDS blip
can hide ~16.7 h behind a process that looks healthy.

⭐ CPU CANNOT DISCRIMINATE — a wedged run accrues ~0 CPU and so does a legitimate CDS queue wait,
which is the normal case. PROGRESS is the only separating signal, hence the marker.

⛔⛔ THE PROPERTY MOST OF THIS FILE DEFENDS IS THE REFUSAL. `_stalled_minutes` returns None — never a
large number — whenever staleness is UNKNOWABLE (no marker, a marker from a different pid, corrupt
JSON, unparseable time). Treating absence as staleness would make this guard kill a healthy campaign
that predates the feature: the guard would commit the very failure it exists to prevent.
"""
import json
import os
import sys
from datetime import datetime, timedelta, timezone

import pytest

backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if backend_dir not in sys.path:
    sys.path.insert(0, backend_dir)
sys.path.insert(0, os.path.join(backend_dir, "scripts"))

import era5_deepen_climatology as E                                    # noqa: E402


@pytest.fixture()
def marker(tmp_path, monkeypatch):
    """Redirect the progress marker into tmp so a test can never disturb a live campaign."""
    p = tmp_path / "progress.json"
    monkeypatch.setattr(E, "_progress_path", lambda: p)
    return p


def _write(marker, pid, minutes_ago, **extra):
    ts = datetime.now(timezone.utc) - timedelta(minutes=minutes_ago)
    payload = {"pid": pid, "ts": ts.isoformat(), "i": 5, "total": 150, "spot": "Somewhere"}
    payload.update(extra)
    marker.write_text(json.dumps(payload), encoding="utf-8")


# ── the threshold is a measurement, not a preference ────────────────────────────────────────────

def test_the_stall_threshold_clears_the_measured_worst_case_spot():
    """Per-spot wall time over n=51 completed spots: p50 5 min, p90 21 min, p95 33 min, MAX 52.5 min.
    A threshold inside that distribution would kill working campaigns FOREVER, which is unbounded
    recurring harm — strictly worse than an occasional bounded wedge."""
    assert E.STALL_MINUTES > 52.5, (
        f"STALL_MINUTES={E.STALL_MINUTES} sits inside the measured per-spot distribution "
        f"(max 52.5 min) and would reap healthy runs")
    assert E.STALL_MINUTES >= 90.0, "leave real headroom above the measured tail"


# ── the refusal: no evidence must never mean "kill it" ──────────────────────────────────────────

def test_missing_marker_is_UNKNOWABLE_not_stalled(marker):
    assert not marker.exists()
    assert E._stalled_minutes(4242) is None
    assert E._reap_if_wedged(4242) is False


def test_a_marker_from_a_DIFFERENT_pid_is_unknowable(marker):
    _write(marker, pid=1111, minutes_ago=10_000)          # ancient, but not this pid's
    assert E._stalled_minutes(2222) is None
    assert E._reap_if_wedged(2222) is False


@pytest.mark.parametrize("body", ["", "not json", '{"pid": 1}', '{"pid":1,"ts":"nonsense"}'])
def test_corrupt_or_incomplete_markers_are_unknowable(marker, body):
    marker.write_text(body, encoding="utf-8")
    assert E._stalled_minutes(1) is None
    assert E._reap_if_wedged(1) is False


def test_peer_is_RESPECTED_when_staleness_cannot_be_established(marker):
    """The composed decision, and the most important single assertion here: an unmarked peer — e.g.
    a campaign started before this feature shipped — must still be stood down for."""
    assert E.peer_to_respect(9999) == 9999


# ── the positive path ───────────────────────────────────────────────────────────────────────────

def test_a_recent_marker_reports_a_small_idle_time(marker):
    _write(marker, pid=1234, minutes_ago=3)
    idle = E._stalled_minutes(1234)
    assert idle is not None and 2.0 < idle < 5.0


def test_a_working_run_inside_the_threshold_is_not_reaped(marker):
    _write(marker, pid=1234, minutes_ago=E.STALL_MINUTES - 10)
    assert E._reap_if_wedged(1234) is False
    assert E.peer_to_respect(1234) == 1234


def test_a_stalled_run_is_reaped_and_the_caller_may_proceed(marker, monkeypatch):
    """The behaviour the whole feature exists for. psutil.kill is stubbed — what is under test is
    the DECISION, and a test that killed a real pid would be a hazard, not a test."""
    killed = []

    class FakeProc:
        def __init__(self, pid):
            self.pid = pid

        def kill(self):
            killed.append(self.pid)

    monkeypatch.setitem(sys.modules, "psutil", type("M", (), {"Process": FakeProc})())
    _write(marker, pid=1234, minutes_ago=E.STALL_MINUTES + 5)

    assert E._reap_if_wedged(1234) is True
    assert killed == [1234]
    # and the composed decision lets this run continue
    killed.clear()
    _write(marker, pid=1234, minutes_ago=E.STALL_MINUTES + 5)
    assert E.peer_to_respect(1234) is None


def test_a_failed_kill_leaves_the_peer_respected(marker, monkeypatch):
    """If we cannot kill it we must not pretend we did — proceeding would put two campaigns on the
    same spots, which is the collision the original guard exists to prevent."""
    class Boom:
        def __init__(self, pid):
            raise OSError("access denied")

    monkeypatch.setitem(sys.modules, "psutil", type("M", (), {"Process": Boom})())
    _write(marker, pid=1234, minutes_ago=E.STALL_MINUTES + 5)
    assert E._reap_if_wedged(1234) is False
    assert E.peer_to_respect(1234) == 1234


def test_no_peer_means_proceed(marker):
    assert E.peer_to_respect(None) is None


# ── the marker writer ───────────────────────────────────────────────────────────────────────────

def test_mark_progress_writes_a_marker_this_process_can_read_back(marker):
    E._mark_progress(7, 150, "Pipeline")
    idle = E._stalled_minutes(os.getpid())
    assert idle is not None and idle < 1.0
    data = json.loads(marker.read_text(encoding="utf-8"))
    assert data["i"] == 7 and data["total"] == 150 and data["spot"] == "Pipeline"


def test_mark_progress_never_raises_when_the_path_is_unwritable(tmp_path, monkeypatch):
    """Telemetry must never kill a multi-day campaign -- the checkpoint lesson, applied to the
    marker: the code that exists to make failure survivable must not itself be a failure path."""
    monkeypatch.setattr(E, "_progress_path", lambda: tmp_path / "no_such_dir" / "p.json")
    E._mark_progress(1, 2, "X")          # must not raise


def test_marker_round_trip_survives_a_non_ascii_spot_name(marker):
    """Spot names in this catalogue include accents; the marker is JSON on a cp1252 console, and an
    encoding blow-up here would take down the campaign it is meant to protect."""
    E._mark_progress(3, 150, "Guethary Été — Pointe")
    assert E._stalled_minutes(os.getpid()) is not None
