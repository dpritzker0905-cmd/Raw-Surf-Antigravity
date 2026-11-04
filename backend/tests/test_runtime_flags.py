"""D-065: the runtime flag manifest's precedence and fail-safe, and the guarded-read contract.

Precedence: explicit env (both ways) > manifest > code default. Fail-safe: an unreadable manifest never raises and
falls back to the last good manifest (bounded staleness), else the code default. Contract: every GUARDED flag is
read through runtime_flags (never straight from os.environ) and its code default equals the registry's."""
import ast
import os
import re
import time

import pytest

from services import runtime_flags as rf

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def _doc(**flags):
    entry = {"reason": "t", "set_by": "flag-guardrail", "set_at": "2026-11-04T00:00:00Z", "evidence": "x"}
    return {"schema": rf.SCHEMA, "flags": {k: dict(entry, state=v) for k, v in flags.items()}}


@pytest.fixture(autouse=True)
def _clean(monkeypatch):
    for k in list(rf.GUARDED) + ["RUNTIME_FLAGS_MANIFEST", "RUNTIME_FLAGS_TTL_S", "RUNTIME_FLAGS_MAX_STALE_S"]:
        monkeypatch.delenv(k, raising=False)
    rf._reset_for_tests()
    yield
    rf._reset_for_tests()


def test_code_default_when_nothing_is_set():
    rf._reset_for_tests(lambda: None)
    assert rf.flag("SURF_TIDE_DEPTH") == "1"
    assert rf.flag("SURF_EXPOSURE_RECONCILED") == "0"
    assert rf.resolve("SURF_TIDE_DEPTH", "1")["source"] == "default"


def test_manifest_overrides_the_code_default_both_ways():
    rf._reset_for_tests(lambda: _doc(SURF_TIDE_DEPTH="off", RATING_BREAKER_TYPE="on"))
    assert rf.flag("SURF_TIDE_DEPTH") == "0"
    assert rf.flag("RATING_BREAKER_TYPE") == "1"
    assert rf.resolve("SURF_TIDE_DEPTH", "1")["source"] == "manifest"


@pytest.mark.parametrize("env,manifest,want", [("1", "off", "1"), ("0", "on", "0")])
def test_explicit_env_is_a_hard_override_both_ways(monkeypatch, env, manifest, want):
    rf._reset_for_tests(lambda: _doc(SURF_TIDE_DEPTH=manifest))
    monkeypatch.setenv("SURF_TIDE_DEPTH", env)
    assert rf.flag("SURF_TIDE_DEPTH") == want
    assert rf.resolve("SURF_TIDE_DEPTH", "1")["source"] == "env"


def test_empty_env_counts_as_unset_so_a_lane_can_defer_to_the_manifest(monkeypatch):
    rf._reset_for_tests(lambda: _doc(SURF_TIDE_DEPTH="off"))
    monkeypatch.setenv("SURF_TIDE_DEPTH", "")
    assert rf.flag("SURF_TIDE_DEPTH") == "0"


def test_unreadable_manifest_fails_safe_to_the_code_default():
    def boom():
        raise OSError("storage down")
    rf._reset_for_tests(boom)
    assert rf.flag("SURF_TIDE_DEPTH") == "1"
    assert "storage down" in rf.status()["error"]


def test_malformed_manifest_fails_safe_and_a_bad_state_is_dropped():
    rf._reset_for_tests(lambda: {"schema": "nope"})
    assert rf.flag("SURF_TIDE_DEPTH") == "1"
    rf._reset_for_tests(lambda: {"schema": rf.SCHEMA, "flags": {"SURF_TIDE_DEPTH": {"state": "maybe"}}})
    assert rf.flag("SURF_TIDE_DEPTH") == "1"


def test_a_storage_outage_never_resurrects_a_kill_but_a_stale_on_falls_back(monkeypatch):
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        if calls["n"] == 1:
            return _doc(SURF_TIDE_DEPTH="off", RATING_BREAKER_TYPE="on")
        raise OSError("blip")
    rf._reset_for_tests(fetch)
    monkeypatch.setenv("RUNTIME_FLAGS_TTL_S", "0")
    assert rf.flag("SURF_TIDE_DEPTH") == "0"
    rf._refresh()                                   # the refresh fails
    assert rf.flag("SURF_TIDE_DEPTH") == "0"        # the kill survives the blip
    assert rf.flag("RATING_BREAKER_TYPE") == "1"
    monkeypatch.setenv("RUNTIME_FLAGS_MAX_STALE_S", "0")
    time.sleep(0.01)
    assert rf.flag("SURF_TIDE_DEPTH") == "0"        # past the staleness bound a kill still holds
    assert rf.flag("RATING_BREAKER_TYPE") == "0"    # ...while a stale 'on' falls back to the code default


def test_reads_are_cached_within_the_ttl():
    calls = {"n": 0}

    def fetch():
        calls["n"] += 1
        return _doc()
    rf._reset_for_tests(fetch)
    for _ in range(50):
        rf.flag("SURF_TIDE_DEPTH")
    assert calls["n"] == 1


def test_the_manifest_can_be_disabled_entirely(monkeypatch):
    rf._reset_for_tests(lambda: _doc(SURF_TIDE_DEPTH="off"))
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    assert rf.flag("SURF_TIDE_DEPTH") == "1"


def test_no_supabase_url_means_no_fetch(monkeypatch):
    monkeypatch.delenv("SUPABASE_URL", raising=False)
    assert rf._fetch_bucket() is None


def _registry():
    src = open(os.path.join(BACKEND, "routes", "admin", "surf_forecast.py"), encoding="utf-8").read()
    for node in ast.walk(ast.parse(src)):
        if isinstance(node, ast.Assign) and any(getattr(t, "id", None) == "_RATING_FLAGS" for t in node.targets):
            return ast.literal_eval(node.value)


def test_guarded_defaults_equal_the_registry_defaults():
    reg = _registry()
    for name, default in rf.GUARDED.items():
        assert name in reg, f"{name} is guarded but not in _RATING_FLAGS"
        assert reg[name][0] == default, f"{name}: GUARDED {default!r} vs registry {reg[name][0]!r}"
    assert set(rf.FIX_VERSION) == set(rf.GUARDED)


def test_no_module_reads_a_guarded_flag_straight_from_the_environment():
    """A raw os.environ read is invisible to the manifest, so the guardrail's 'off' would not reach it."""
    names = "|".join(rf.GUARDED)
    pat = re.compile(r'os\.environ\.get\(\s*["\'](' + names + r')["\']')
    hits = []
    for root in ("services", "routes", "scheduler"):
        for dp, _, fs in os.walk(os.path.join(BACKEND, root)):
            for f in fs:
                if f.endswith(".py"):
                    p = os.path.join(dp, f)
                    for i, line in enumerate(open(p, encoding="utf-8"), 1):
                        if pat.search(line):
                            hits.append(f"{os.path.relpath(p, BACKEND)}:{i}")
    p = os.path.join(BACKEND, "scripts", "precompute_ci.py")
    hits += [f"scripts/precompute_ci.py:{i}" for i, line in enumerate(open(p, encoding="utf-8"), 1) if pat.search(line)]
    assert not hits, "guarded flags read around runtime_flags:\n  " + "\n  ".join(hits)
