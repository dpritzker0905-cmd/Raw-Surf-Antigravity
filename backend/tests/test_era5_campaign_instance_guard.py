"""The ERA5 campaign's concurrency guard must block a SECOND CAMPAIGN and nothing else.

WHAT THIS CAUGHT (2026-08-03). `_another_instance_pid` asked
`any(basename in part for part in proc.cmdline())` over every process on the box. A shell that
launches this script carries the script's name in its OWN command line, so
`bash -c "python scripts/era5_deepen_climatology.py --all --upload"` matched ITSELF. The guard
printed "another ERA5 campaign is already running (pid <the launching shell>)" and exited before the
first fetch. Every wrapper launch — `bash -c`, the nightly scheduled task, CI — self-aborted. The
campaign was never established at scale, and the handoff recorded that as "not verified" rather than
as a defect, because nothing had ever run the guard against its own launcher.

★ THE TWO CONTROLS ARE THE POINT. A test that only asserts the shell is ignored passes with the fix
REVERTED-TO-NOTHING (a guard that always returns False ignores shells beautifully and also lets two
campaigns hammer the CDS queue). So every case below is paired: a KNOWN-PRESENT instance that MUST
be detected sits beside each false positive that must not be.
"""
import os

import pytest

from scripts.era5_deepen_climatology import _another_instance_pid, _is_this_script

SCRIPT = "era5_deepen_climatology.py"


# ── KNOWN-PRESENT CONTROLS: a real second campaign MUST be detected ────────────────────────────
@pytest.mark.parametrize("name,cmdline", [
    ("python.exe", ["python.exe", f"scripts/{SCRIPT}", "--all", "--upload"]),
    ("python3.exe", ["C:\\py\\python3.exe", f"C:\\Raw-Surf\\backend\\scripts\\{SCRIPT}", "--all"]),
    ("python3", ["python3", f"./scripts/{SCRIPT}"]),
    ("Python", ["python", f"scripts\\{SCRIPT}", "--query", "arugam"]),
])
def test_a_real_second_campaign_is_detected(name, cmdline):
    assert _is_this_script(name, cmdline) is True


# ── FALSE POSITIVES: each of these aborted the campaign and must not ───────────────────────────
def test_the_launching_shell_is_not_a_second_campaign():
    """THE BUG. The shell's own command line contains the script name because it is launching it."""
    assert _is_this_script(
        "bash.exe", ["bash.exe", "-c", f"python scripts/{SCRIPT} --all --upload"]) is False


@pytest.mark.parametrize("blob", [
    f"import x  # inspects scripts/{SCRIPT} for audit",
    # ⚠️ THE ONE THE FIRST FIX GOT WRONG: a blob whose LAST characters are the script name.
    # `endswith` and `posixpath.basename` both accept it, because basename splits a code blob on
    # '/' exactly as it splits a path. Only the argv-script-slot rule rejects it. Caught by the
    # mutation harness, not by the original version of this test.
    f"import x  # see scripts/{SCRIPT}",
    f"open('scripts/{SCRIPT}')",
])
def test_a_python_dash_c_blob_that_merely_mentions_the_script_is_not_a_campaign(blob):
    """A diagnostic or a test that names the script in a -c payload is not running it."""
    assert _is_this_script("python3.exe", ["python3.exe", "-c", blob]) is False


def test_a_module_run_and_a_bare_repl_are_not_campaigns():
    assert _is_this_script("python.exe", ["python.exe", "-m", f"scripts.{SCRIPT[:-3]}"]) is False
    assert _is_this_script("python.exe", ["python.exe"]) is False


def test_interpreter_flags_before_the_script_do_not_hide_a_real_campaign():
    """`python -u script.py` IS a campaign — skipping flags must not skip the script slot."""
    assert _is_this_script("python.exe", ["python.exe", "-u", f"scripts/{SCRIPT}", "--all"]) is True


def test_a_powershell_or_scheduled_task_wrapper_is_not_a_campaign():
    assert _is_this_script(
        "pwsh.exe", ["pwsh.exe", "-Command", f"python scripts/{SCRIPT} --all"]) is False


def test_an_unrelated_process_is_not_a_campaign():
    assert _is_this_script("python.exe", ["python.exe", "scripts/other_thing.py"]) is False
    assert _is_this_script("chrome.exe", ["chrome.exe", "--type=renderer"]) is False


def test_empty_and_malformed_input_never_raises():
    assert _is_this_script(None, None) is False
    assert _is_this_script("python", []) is False
    assert _is_this_script("python", [None]) is False


# ── THE END-TO-END CLAIM, run in THIS process ─────────────────────────────────────────────────
def test_the_guard_never_names_our_own_process_tree():
    """The decisive LIVE assertion, and note what it does NOT say.

    ⛔ The obvious version — `assert _another_instance_pid() is None` — is WRONG, and it failed the
    first time this file ran, correctly: a real campaign was in flight in another window, the guard
    detected it, and the test called that a bug. A guard whose job is to notice concurrent runs
    cannot be tested by asserting no concurrent run exists; the assertion is about the ENVIRONMENT,
    not the code, and it inverts the guard's own success into a red suite.

    ★ The claim that is actually about the fix: whatever the guard returns, it must never be US or
    one of our ANCESTORS. That is precisely the defect (it returned the launching shell), it holds
    whether or not a legitimate campaign is running, and it needs no fixture. Deterministic coverage
    of the peer-detection half lives in `test_the_guard_would_still_catch_a_genuine_peer`, so an
    always-None mutant does not survive the file.

    ⚠️ REFUSES when psutil is unavailable: without it the guard returns None for a reason unrelated
    to the fix, and passing on that is the 'reports success having tested nothing' failure."""
    psutil = pytest.importorskip("psutil")
    kin = {os.getpid()}
    try:
        kin |= {a.pid for a in psutil.Process().parents()}
    except Exception:
        kin.add(os.getppid())
    assert _another_instance_pid() not in kin


def test_the_guard_would_still_catch_a_genuine_peer(monkeypatch):
    """The other half: with a REAL second campaign on the process table, the guard must return its
    pid. Without this, deleting the guard's body passes every test above."""
    psutil = pytest.importorskip("psutil")

    class FakeProc:
        info = {"pid": 999999, "name": "python.exe",
                "cmdline": ["python.exe", f"scripts/{SCRIPT}", "--all", "--upload"]}

    monkeypatch.setattr(psutil, "process_iter", lambda attrs=None: [FakeProc()])
    assert _another_instance_pid() == 999999


def test_a_peer_that_is_our_own_ancestor_is_excluded(monkeypatch):
    """Same fake instance, but wearing OUR parent's pid: that is this campaign, not a competitor."""
    psutil = pytest.importorskip("psutil")
    ppid = os.getppid()

    class FakeParent:
        info = {"pid": ppid, "name": "python.exe",
                "cmdline": ["python.exe", f"scripts/{SCRIPT}", "--all"]}

    monkeypatch.setattr(psutil, "process_iter", lambda attrs=None: [FakeParent()])
    assert _another_instance_pid() is None
