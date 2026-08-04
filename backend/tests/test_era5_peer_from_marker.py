"""THE SESSION FIX BLINDED THE COLLISION GUARD — this pins the repair.

MEASURED 2026-08-04, in this order:
  1. Six campaign deaths, all `0xC000013A` STATUS_CONTROL_C_EXIT. Cause: the scheduled task ran
     `LogonType: Interactive`, so it sat in the user's interactive session (campaign sessionId 1,
     agent shell sessionId 1) and any CTRL_C there killed it.
  2. Fixed by moving the task to `LogonType: S4U` (session 0). The kills stopped.
  3. ⛔ AND THAT BROKE SOMETHING ELSE. An unelevated `psutil` raises `AccessDenied` on a session-0
     process's `cmdline()`, so `_another_instance_pid()` returned **None while the campaign was
     demonstrably running** — task State: Running, log writing every few seconds. The guard that
     stops two campaigns re-fetching the same spots and doubling the CDS queue went blind.

★★ THE SHAPE WORTH REMEMBERING: a fix that removes one failure mode by CHANGING THE EXECUTION
CONTEXT can silently disarm a guard that depended on that context. The guard did not fail — it was
never told the ground had moved.

⇒ `peer_from_marker` identifies a peer by the pid IN THE PROGRESS MARKER, which needs no process
introspection at all. `peer_to_respect` now takes whichever of the two sources answers.
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
    p = tmp_path / "progress.json"
    monkeypatch.setattr(E, "_progress_path", lambda: p)
    return p


def _write(marker, pid, minutes_ago, ts=None):
    when = ts or (datetime.now(timezone.utc) - timedelta(minutes=minutes_ago))
    marker.write_text(json.dumps({"pid": pid, "ts": when.isoformat(), "i": 3,
                                  "total": 150, "spot": "S"}), encoding="utf-8")


# ── seeing a peer whose cmdline cannot be read ──────────────────────────────────────────────────

def test_a_running_peer_is_found_through_the_marker_even_when_cmdline_is_denied(marker, monkeypatch):
    """The S4U case. `_another_instance_pid` is forced to return None — exactly what it does live —
    and the run must STILL stand down."""
    _write(marker, pid=4321, minutes_ago=2)
    monkeypatch.setattr(E, "_another_instance_pid", lambda: None)
    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"pid_exists": staticmethod(lambda p: p == 4321)})())

    assert E.peer_from_marker() == 4321
    assert E.peer_to_respect(None) == 4321, "the run proceeded while a peer was live"


def test_a_marker_from_a_DEAD_pid_is_not_a_peer(marker, monkeypatch):
    _write(marker, pid=4321, minutes_ago=2)
    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"pid_exists": staticmethod(lambda p: False)})())
    assert E.peer_from_marker() is None
    assert E.peer_to_respect(None) is None


def test_our_own_marker_is_never_read_as_a_peer(marker, monkeypatch):
    """The run that wrote the marker must not stand down for itself — that would be a deadlock in
    which the campaign can never start again."""
    _write(marker, pid=os.getpid(), minutes_ago=1)
    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"pid_exists": staticmethod(lambda p: True)})())
    assert E.peer_from_marker() is None


@pytest.mark.parametrize("body", ["", "not json", "{}", '{"pid": "x"}', '{"pid": -1}'])
def test_a_missing_or_unusable_marker_reports_no_peer(marker, monkeypatch, body):
    marker.write_text(body, encoding="utf-8")
    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"pid_exists": staticmethod(lambda p: True)})())
    assert E.peer_from_marker() is None


def test_the_cmdline_scan_still_wins_when_it_can_see(marker, monkeypatch):
    """Both sources are kept: a MANUAL run in this session is visible to the scan and may have no
    marker yet. `peer_to_respect` must not discard that answer."""
    monkeypatch.setattr(E, "_another_instance_pid", lambda: 999)
    monkeypatch.setattr(E, "peer_from_marker", lambda: None)
    monkeypatch.setattr(E, "_reap_if_wedged", lambda pid, stall_minutes=None: False)
    assert E.peer_to_respect(E._another_instance_pid()) == 999


# ── the reaping safety the marker route makes necessary ─────────────────────────────────────────

def test_a_stalled_marker_does_NOT_kill_a_pid_that_started_AFTER_it(marker, monkeypatch):
    """⛔ PID RECYCLING. Identifying a peer by a bare pid means a dead pid can be reused by an
    unrelated process. Standing down wrongly costs one skipped run; KILLING wrongly terminates
    someone else's process. So a kill additionally requires the target to have STARTED BEFORE its
    marker was written."""
    stale = datetime.now(timezone.utc) - timedelta(minutes=E.STALL_MINUTES + 30)
    _write(marker, pid=777, ts=stale, minutes_ago=0)

    killed = []

    class Recycled:                              # started AFTER the marker -> not the same process
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            return datetime.now(timezone.utc).timestamp()

        def kill(self):
            killed.append(self.pid)

    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"Process": Recycled,
                                       "pid_exists": staticmethod(lambda p: True)})())
    assert E._reap_if_wedged(777) is False
    assert killed == [], "a recycled pid was killed"


def test_a_genuinely_wedged_peer_is_still_reaped(marker, monkeypatch):
    """The paired control: the safety check must not make the reaper inert."""
    stale = datetime.now(timezone.utc) - timedelta(minutes=E.STALL_MINUTES + 30)
    _write(marker, pid=777, ts=stale, minutes_ago=0)

    killed = []

    class Original:                              # started BEFORE the marker -> the real peer
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            return (stale - timedelta(hours=2)).timestamp()

        def kill(self):
            killed.append(self.pid)

    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"Process": Original,
                                       "pid_exists": staticmethod(lambda p: True)})())
    assert E._reap_if_wedged(777) is True
    assert killed == [777]


def test_an_unreadable_start_time_refuses_to_kill(marker, monkeypatch):
    """Unknowable => do not kill. Same asymmetry as everywhere else in this guard."""
    stale = datetime.now(timezone.utc) - timedelta(minutes=E.STALL_MINUTES + 30)
    _write(marker, pid=777, ts=stale, minutes_ago=0)

    class Opaque:
        def __init__(self, pid):
            self.pid = pid

        def create_time(self):
            raise OSError("access denied")

        def kill(self):
            raise AssertionError("must not be reached")

    monkeypatch.setitem(sys.modules, "psutil",
                        type("M", (), {"Process": Opaque,
                                       "pid_exists": staticmethod(lambda p: True)})())
    assert E._reap_if_wedged(777) is False
