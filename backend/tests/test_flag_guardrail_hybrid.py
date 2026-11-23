"""HYBRID shadow-run design (D-087): stays off on FIX_VERSION bump; shadow scoring; evidence binding.

Nine end-to-end tests:
  1. FIX_VERSION bump → version_hold; flag stays off with shadow init.
  2. N-1 passes then one more NOT_WORSE → shadow_proposal; flag still off, no auto-enable.
  3. WORSE during shadow → consecutive pass count resets; proposal never fires.
  4. shadow.feature_id mismatch → evidence rejected (hold).
  5. UNTESTABLE during shadow → no-evidence (no pass, no reset).
  6. SKIPPED ×3 → no proposal (no-evidence: no pass, no reset).
  7. NO_CHANGE ×3 → no proposal (no-evidence: no pass, no reset).
  8. Sanity breach during shadow → pass count resets like WORSE.
  9. LEDGER coverage flag → never proposes; owner decides.
"""
import os
import sys
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

HERE = os.path.dirname(os.path.abspath(__file__))
sys.path.insert(0, os.path.join(os.path.dirname(HERE), "scripts"))

import flag_guardrail as fg  # noqa: E402
from services import runtime_flags as rf  # noqa: E402
from services.weather_pipeline import guardrail_stats as gs  # noqa: E402

NOW = datetime(2026, 11, 23, 0, 0, tzinfo=timezone.utc)
_FLAG = "SURF_TIDE_DEPTH"
_VER = rf.FIX_VERSION[_FLAG]


def iso(t):
    return t.astimezone(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ")


def _manifest(**flags):
    return {"schema": rf.SCHEMA, "flags": dict(flags)}


def _args(**k):
    d = dict(enforce="0", cache_dir=".", out="o", alert_cap=2, run_url="https://run",
             reenable="", owner_words="", actor="owner", owner_login="owner", commit="abc123")
    d.update(k)
    return SimpleNamespace(**d)


def _scorer(verdicts=None):
    def f(flags, now, cache_dir, out):
        return {fl: {"verdict": (verdicts or {}).get(fl, gs.NOT_WORSE), "reasons": ["synthetic"],
                     "sanity": [], "window": "w"} for fl in flags}
    return f


def _shadow(passes=0, fails=0, feature_id=_FLAG, version=None):
    return {"feature_id": feature_id, "version": version or _VER, "commit": "abc123",
            "required_passes": fg.SHADOW_REQUIRED_PASSES, "passes": passes, "fails": fails,
            "verdicts": [gs.NOT_WORSE] * passes, "run_urls": [], "started_at": iso(NOW)}


def _off_entry(fix_version=None, shadow=None):
    e = {"state": "off", "reason": "r", "set_by": fg.SET_BY, "set_at": "x", "evidence": "e",
         "fix_version": fix_version or _VER}
    if shadow is not None:
        e["shadow"] = shadow
    return e


def test_bump_stays_off_starts_shadow():
    """FIX_VERSION bump keeps the flag off and initializes shadow run."""
    off = _off_entry(fix_version="old_version")
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off), _scorer({}), lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "version_hold"
    assert _FLAG in rep["manifest"]["flags"]
    e = rep["manifest"]["flags"][_FLAG]
    assert e["state"] == "off"
    assert e["shadow"]["passes"] == 0
    assert e["shadow"]["required_passes"] == fg.SHADOW_REQUIRED_PASSES
    assert e["shadow"]["feature_id"] == _FLAG


def test_shadow_pass_writes_proposal_no_auto_enable():
    """After N consecutive shadow passes, write evidence bundle but keep flag off."""
    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1))
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                 _scorer({_FLAG: gs.NOT_WORSE}), lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "shadow_proposal"
    e = rep["manifest"]["flags"][_FLAG]
    assert e["state"] == "off"
    assert "shadow_proposal" in e
    assert e["shadow_proposal"]["feature_id"] == _FLAG
    assert e["shadow_proposal"]["passes"] == fg.SHADOW_REQUIRED_PASSES


def test_shadow_fail_resets_pass_count_no_proposal():
    """A WORSE verdict resets consecutive pass count; proposal never fires."""
    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1))
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                 _scorer({_FLAG: gs.WORSE}), lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "hold"
    e = rep["manifest"]["flags"][_FLAG]
    assert e["shadow"]["passes"] == 0
    assert "shadow_proposal" not in e


def test_mismatched_feature_id_in_shadow_is_rejected():
    """Shadow evidence bound to a different feature_id is rejected (LongCat safeguard)."""
    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1,
                                    feature_id="DIFFERENT_FLAG"))
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                 _scorer({_FLAG: gs.NOT_WORSE}), lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "hold"
    assert "shadow_proposal" not in rep["manifest"]["flags"][_FLAG]


def test_shadow_untestable_does_not_count_as_pass():
    """UNTESTABLE verdict is no-evidence: passes and fails are unchanged, no proposal."""
    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1))
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                 _scorer({_FLAG: gs.UNTESTABLE}), lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "hold"
    e = rep["manifest"]["flags"][_FLAG]
    assert e["shadow"]["passes"] == fg.SHADOW_REQUIRED_PASSES - 1  # unchanged
    assert e["shadow"]["fails"] == 0  # no-evidence: does not increment fails
    assert "shadow_proposal" not in e


def test_skipped_verdict_does_not_count_as_pass():
    """SKIPPED verdict is no-evidence: passes unchanged, no proposal even after 3 runs."""
    off = _off_entry(shadow=_shadow(passes=0))
    for _ in range(3):
        rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                     _scorer({_FLAG: "SKIPPED"}), lambda *a: {})
        d = rep["decisions"][_FLAG]
        assert d["action"] == "hold"
        e = rep["manifest"]["flags"][_FLAG]
        assert e["shadow"]["passes"] == 0  # unchanged each round
        assert "shadow_proposal" not in e
        off = e  # feed updated entry back for next round


def test_no_change_verdict_does_not_count_as_pass():
    """NO_CHANGE verdict is no-evidence: passes unchanged, no proposal even after 3 runs."""
    off = _off_entry(shadow=_shadow(passes=0))
    for _ in range(3):
        rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off),
                     _scorer({_FLAG: gs.NO_CHANGE}), lambda *a: {})
        d = rep["decisions"][_FLAG]
        assert d["action"] == "hold"
        e = rep["manifest"]["flags"][_FLAG]
        assert e["shadow"]["passes"] == 0  # unchanged each round
        assert "shadow_proposal" not in e
        off = e  # feed updated entry back for next round


def test_sanity_breach_resets_shadow_pass_count():
    """A sanity breach resets the consecutive pass count, like a WORSE verdict."""
    def scorer_with_breach(flags, now, cache_dir, out):
        return {fl: {"verdict": gs.NOT_WORSE, "reasons": [], "sanity": ["score 999"],
                     "window": "w"} for fl in flags}

    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1))
    rep = fg.run(_args(), NOW, _manifest(SURF_TIDE_DEPTH=off), scorer_with_breach, lambda *a: {})
    d = rep["decisions"][_FLAG]
    assert d["action"] == "hold"
    e = rep["manifest"]["flags"][_FLAG]
    assert e["shadow"]["passes"] == 0  # reset by breach
    assert e["shadow"]["fails"] == 1
    assert "shadow_proposal" not in e


def test_ledger_flag_never_proposes():
    """A LEDGER-coverage flag never writes a shadow_proposal; owner decides externally."""
    off = _off_entry(shadow=_shadow(passes=fg.SHADOW_REQUIRED_PASSES - 1))
    result = {"verdict": gs.NOT_WORSE, "reasons": [], "sanity": [], "coverage": fg.LEDGER}
    d = fg.decide(_FLAG, result, _manifest(SURF_TIDE_DEPTH=off), _VER, NOW)
    assert d["action"] == "hold"
    assert "shadow_proposal" not in d.get("entry", {})
    assert "owner decides" in d["reason"]
