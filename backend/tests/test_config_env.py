"""config_env — numeric configuration reads that cannot crash the boot or accept nonsense (MC-09).

Census 2026-08-15: 22 module-level `int()`/`float()` parses over `os.environ.get` across 13 files
in routes/ + weather_pipeline. Any one of them, fed a typo ("six", "0.5" into int, a stray unit),
raises at IMPORT time — the module dies at boot, taking its routes with it. And the values flow
into places with sharp edges: `SPOT_RATINGS_CONCURRENCY=0` reaches `asyncio.Semaphore(0)` in
conditions.py:73 with NO floor — every /conditions/batch request then waits forever (the audit's
MC-08 deadlock, confirmed at the line; weather.py's twin clamps with max(1,...) — one env var,
two hardenings).

The contract pinned here:
  * a VALID value passes through exactly (config behavior unchanged for every correct config);
  * an UNPARSEABLE value falls back to the shipped default, LOUDLY — degrading to the default is
    the correct failure for config (contrast auth, where fail-closed is right): a typo must cost
    a warning, never the boot;
  * an out-of-range value is CLAMPED to the nearest bound, LOUDLY — a semaphore of 0 becomes 1
    and says so, instead of deadlocking silently.
"""
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from services.weather_pipeline import config_env as CE   # noqa: E402


@pytest.fixture
def clean(monkeypatch):
    monkeypatch.delenv("CFGTEST_X", raising=False)
    return monkeypatch


# ── the pass-through control ────────────────────────────────────────────────────────────────────

def test_a_valid_value_passes_through_exactly__THE_CONTROL(clean, capsys):
    clean.setenv("CFGTEST_X", "6")
    assert CE.env_int("CFGTEST_X", 4, lo=1, hi=64) == 6
    clean.setenv("CFGTEST_X", "2.5")
    assert CE.env_float("CFGTEST_X", 1.0, lo=0.0) == 2.5
    assert capsys.readouterr().err == "", "a valid value must not warn"


def test_absent_env_yields_the_default_silently(clean, capsys):
    assert CE.env_int("CFGTEST_X", 4, lo=1) == 4
    assert CE.env_float("CFGTEST_X", 1.5) == 1.5
    assert capsys.readouterr().err == "", "the default path is the normal path — no noise"


# ── the typo cannot cost the boot ───────────────────────────────────────────────────────────────

def test_an_unparseable_value_falls_back_to_the_default_loudly(clean, capsys):
    clean.setenv("CFGTEST_X", "six")
    assert CE.env_int("CFGTEST_X", 4, lo=1) == 4
    err = capsys.readouterr().err
    assert "CFGTEST_X" in err and "six" in err, "the warning must name the var and the bad value"


def test_a_float_string_into_an_int_is_a_typo_not_a_crash(clean, capsys):
    clean.setenv("CFGTEST_X", "0.5")
    assert CE.env_int("CFGTEST_X", 6, lo=1) == 6
    assert "CFGTEST_X" in capsys.readouterr().err


# ── the range is enforced, loudly ───────────────────────────────────────────────────────────────

def test_below_the_floor_clamps_to_the_floor(clean, capsys):
    clean.setenv("CFGTEST_X", "0")
    assert CE.env_int("CFGTEST_X", 6, lo=1) == 1, "a semaphore of 0 is a deadlock, not a setting"
    assert "CFGTEST_X" in capsys.readouterr().err


def test_above_the_ceiling_clamps_to_the_ceiling(clean, capsys):
    clean.setenv("CFGTEST_X", "10000")
    assert CE.env_int("CFGTEST_X", 6, lo=1, hi=64) == 64
    assert "CFGTEST_X" in capsys.readouterr().err


def test_no_bounds_means_no_clamping(clean, capsys):
    clean.setenv("CFGTEST_X", "-40")
    assert CE.env_float("CFGTEST_X", 0.0) == -40.0
    assert capsys.readouterr().err == ""


# ── the fingerprint (the audit's Phase-1 config gate) ───────────────────────────────────────────

def test_the_fingerprint_is_stable_and_changes_with_a_flag(clean):
    """A redacted fingerprint: same resolved config → same hash; one flag flipped → different
    hash; and the output carries NO flag values — hash + counts only."""
    a = CE.compute_config_fingerprint()
    b = CE.compute_config_fingerprint()
    assert a["config_fingerprint"] == b["config_fingerprint"]
    assert len(a["config_fingerprint"]) == 12
    assert a["flags_declared"] > 20, "the declared registry should be the _RATING_FLAGS table"
    assert isinstance(a["flags_non_default"], int)
    clean.setenv("SURF_CAP_SEAM_MONOTONE", "1")   # a declared flag, default "0"
    c = CE.compute_config_fingerprint()
    assert c["config_fingerprint"] != a["config_fingerprint"], "a flipped flag must move the hash"
    assert c["flags_non_default"] == a["flags_non_default"] + 1
    for v in c.values():
        assert v != "1" and v != 1 or v == c["flags_non_default"] or v == c["flags_declared"], \
            "no raw flag value may appear in the fingerprint payload"


def test_health_serves_the_fingerprint():
    """The wiring: /api/health must publish the fingerprint block (AST-free source check with a
    positive control on the route actually existing)."""
    src = open(os.path.join(BACKEND, "routes", "health.py"), encoding="utf-8").read()
    assert '@router.get("/health")' in src, "the health route moved — this check is grading nothing"
    assert "compute_config_fingerprint" in src, (
        "/api/health does not publish the config fingerprint — incident response cannot tell "
        "two configurations apart")
