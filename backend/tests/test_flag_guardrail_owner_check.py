"""owner_reenable actor-check and FIX_VERSION-clear safety (P0 fix).

Three targeted tests:
  1. A non-owner actor is refused (ValueError).
  2. The correct owner is accepted and writes on.
  3. A FIX_VERSION bump does NOT auto-enable — flag stays off until an explicit owner re-enable.
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


def _manifest(**flags):
    return {"schema": rf.SCHEMA, "flags": dict(flags)}


def _args(**k):
    d = dict(enforce="0", cache_dir=".", out="o", alert_cap=2, run_url="https://run",
             reenable="", owner_words="", actor="owner", owner_login="owner")
    d.update(k)
    return SimpleNamespace(**d)


def _scorer(verdicts=None):
    def f(flags, now, cache_dir, out):
        return {fl: {"verdict": (verdicts or {}).get(fl, gs.NOT_WORSE), "reasons": ["synthetic"], "sanity": [],
                     "window": "w"} for fl in flags}
    return f


def test_non_owner_actor_refused():
    """A workflow dispatch from someone who is not the repo owner must be refused."""
    with pytest.raises(ValueError, match="not the configured owner"):
        fg.owner_reenable(_manifest(), _FLAG, "turn it back on", "intruder", NOW, expected_owner="owner")


def test_owner_actor_accepted():
    """The configured owner's actor is accepted and writes state=on."""
    result = fg.owner_reenable(_manifest(), _FLAG, "turn it back on", "owner", NOW, expected_owner="owner")
    assert result["flags"][_FLAG]["state"] == "on"
    assert result["flags"][_FLAG]["set_by"] == "owner"


def test_fix_version_bump_does_not_auto_enable():
    """A FIX_VERSION bump triggers 'clear', but the flag stays OFF — not at code-default ON."""
    off = {"state": "off", "reason": "auto-disabled", "set_by": fg.SET_BY,
           "set_at": "2026-11-01T00:00:00Z", "evidence": "run/1", "fix_version": "old-version"}
    rep = fg.run(_args(), NOW, _manifest(**{_FLAG: off}), _scorer(), lambda *a: {})
    assert rep["decisions"][_FLAG]["action"] == "clear"
    # Must remain off, not jump to code-default ON
    assert _FLAG in rep["manifest"]["flags"], "flag entry must still exist after clear"
    assert rep["manifest"]["flags"][_FLAG]["state"] == "off", "flag must stay off after FIX_VERSION bump"
    # Subsequent run must hold (not score) — the flag is still guardrail-owned
    rep2 = fg.run(_args(), NOW, rep["manifest"], _scorer({_FLAG: gs.BETTER}), lambda *a: {})
    assert rep2["decisions"][_FLAG]["action"] == "hold", "flag must stay held after version-bump clear"
