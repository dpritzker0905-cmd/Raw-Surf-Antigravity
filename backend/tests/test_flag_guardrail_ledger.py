"""G1a in the flag guardrail: the LEDGER coverage class and the kill-switch contract (D-080 suite).

A ledger FIRE is a WORSE strike, so the guardrail's own 2-strikes-over-24-h rule turns CONSENSUS_DIRECTION_VECTOR off in
control/flags.json; VOID, INSUFFICIENT or an unreadable archive never strike; a default-off flag is never touched; the
replay is never staged for a ledger flag; CONSENSUS_SERVE is readiness only and never written."""
import argparse
from datetime import datetime, timedelta, timezone

from scripts import flag_guardrail as fg
from services import runtime_flags as rf
from services.weather_pipeline import guardrail_stats as gs

NOW = datetime(2026, 11, 18, 12, tzinfo=timezone.utc)
FLAG = "CONSENSUS_DIRECTION_VECTOR"


def led(state, serve_state="NO_FIRE"):
    cell = {lead: {"mae": {"suppressed": True}, "bias": {"suppressed": True}, "n": 0} for lead in (24, 48, 72)}
    base = {"controls": {"null": False, "shuffled-day null": False, "positive": True}, "coverage": [],
            "classes": {"stored-regional": cell}, "fire": state == "FIRE", "decidable": True, "reasons": [],
            "families": [{"family": "pooled mae across leads", "m": 3, "resolved": True}], "reps": 10000}
    return {FLAG: dict(base, state=state, quantity="dir", role="guard",
                       why=["stored-regional pooled +48 h: lower bound +3.100 > +2.000 deg (n 400)"] if state == "FIRE" else []),
            "CONSENSUS_SERVE": dict(base, state=serve_state, quantity="hs", role="readiness", why=[])}


STAGED = []


def no_stage(*_a, **_k):
    STAGED.append(1)
    return None


def score(flags, now, state, **kw):
    return fg.score_flags(flags, now, "c", "o", stage=no_stage, replay=lambda f, ctx: {"verdict": gs.NOT_WORSE},
                          ledger=lambda _now: led(state), **kw)


def test_the_consensus_direction_flag_is_seen_by_the_ledger_not_blind():
    assert fg.coverage(FLAG)[0] == fg.LEDGER


def test_a_ledger_flag_alone_never_stages_the_replay():
    STAGED.clear()
    score([FLAG], NOW, "FIRE")
    assert not STAGED


def test_fire_is_a_worse_strike_and_void_or_insufficient_never_strike():
    assert score([FLAG], NOW, "FIRE")[FLAG]["verdict"] == gs.WORSE
    assert score([FLAG], NOW, "NO_FIRE")[FLAG]["verdict"] == gs.NOT_WORSE
    for state in ("VOID", "INSUFFICIENT", "UNDER_RESOLVED"):
        assert score([FLAG], NOW, state)[FLAG]["verdict"] == gs.UNTESTABLE


def test_an_unreadable_archive_leaves_the_flag_untestable():
    def boom(_now):
        raise RuntimeError("archive down")
    r = fg.score_flags([FLAG], NOW, "c", "o", stage=no_stage, ledger=boom)
    assert r[FLAG]["verdict"] == gs.UNTESTABLE and "__ledger__" not in r


def _args():
    return argparse.Namespace(enforce="0", reenable="", owner_words="", actor="", cache_dir="c", out="o", alert_cap=2,
                              run_url="run")


def _run(state, now, watch, manifest=None):
    return fg.run(_args(), now=now, manifest=manifest or fg.empty_manifest(), watch=watch, volumes=lambda *a: {},
                  scorer=lambda flags, n, c, o: score(flags, n, state))


def test_kill_switch_contract_two_fires_a_day_apart_write_off_and_leave_default_off_flags_alone(monkeypatch):
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    first = _run("FIRE", NOW, {})
    assert first["decisions"][FLAG]["action"] == "strike" and not first["changed"]
    second = _run("FIRE", NOW + timedelta(hours=25), first["watch"])
    assert second["decisions"][FLAG]["action"] == "disable"
    entry = second["manifest"]["flags"][FLAG]
    assert entry["state"] == "off" and entry["set_by"] == fg.SET_BY and "lower bound" in entry["reason"]
    off_by_default = [f for f, d in rf.GUARDED.items() if d == "0"]
    assert off_by_default and not any(f in second["manifest"]["flags"] for f in off_by_default)
    assert "CONSENSUS_SERVE" not in second["manifest"]["flags"]            # readiness only, never written


def test_a_quiet_run_between_fires_resets_the_count(monkeypatch):
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    first = _run("FIRE", NOW, {})
    quiet = _run("VOID", NOW + timedelta(hours=6), first["watch"])
    assert quiet["decisions"][FLAG]["action"] == "none" and FLAG not in quiet["watch"]
    again = _run("FIRE", NOW + timedelta(hours=30), quiet["watch"])
    assert again["decisions"][FLAG]["action"] == "strike"


def test_the_report_carries_the_readiness_section_and_no_identifier(monkeypatch):
    monkeypatch.setattr(fg, "save_watch", lambda *a: None)
    md = fg.markdown(_run("NO_FIRE", NOW, {}))
    assert "Consensus guard from the scored ledger" in md and "READINESS (pre-flip; no kill path)" in md
    assert "buoy" not in md.lower().split("consensus guard")[1]


def test_kill_switch_reaches_the_build_lane_through_an_empty_env(monkeypatch):
    """The lane that builds the consensus passes CONSENSUS_DIRECTION_VECTOR: '' (G1a). Empty = unset, so the manifest
    decides: an 'off' written by the guardrail turns the vector off there; with no entry the code default '1' holds.
    An explicit '1' would outrank the manifest, which is the gap this closes."""
    from services.weather_pipeline import consensus_product as cp
    monkeypatch.setenv("CONSENSUS_DIRECTION_VECTOR", "")
    monkeypatch.delenv("RUNTIME_FLAGS_MANIFEST", raising=False)
    try:
        rf._reset_for_tests(lambda: {"schema": rf.SCHEMA, "flags": {}})
        assert cp.direction_mode() == "vector"
        off = {"state": "off", "reason": "auto-disabled", "set_by": fg.SET_BY, "set_at": "2026-11-18T12:00:00Z",
               "evidence": "run"}
        rf._reset_for_tests(lambda: {"schema": rf.SCHEMA, "flags": {FLAG: off}})
        assert cp.direction_mode() == "primary"
        monkeypatch.setenv("CONSENSUS_DIRECTION_VECTOR", "1")              # the old explicit value: the kill is lost
        assert cp.direction_mode() == "vector"
    finally:
        rf._reset_for_tests(None)
