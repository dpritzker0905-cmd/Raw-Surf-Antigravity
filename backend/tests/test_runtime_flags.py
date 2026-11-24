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
def _clean(monkeypatch, tmp_path):
    for k in list(rf.GUARDED) + ["RUNTIME_FLAGS_MANIFEST", "RUNTIME_FLAGS_TTL_S", "RUNTIME_FLAGS_MAX_STALE_S"]:
        monkeypatch.delenv(k, raising=False)
    # These tests own the cold-start floor: an empty snapshot unless a test writes one (the committed file may hold kills).
    snap = tmp_path / "snapshot.json"
    snap.write_text('{"schema": "%s", "flags": {}}' % rf.SCHEMA, encoding="utf-8")
    monkeypatch.setattr(rf, "SNAPSHOT_PATH", str(snap))
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


def test_unreadable_manifest_on_a_cold_process_holds_the_committed_kills_else_the_code_default():
    """CHANGED DELIBERATELY (D-090, 2026-11-24). This test used to pin "unreadable manifest -> code default" for a cold
    process, so a fix the guardrail killed came back ON at every restart during an outage (inspection finding 6,
    SOTA-INSPECTION-TIME-AND-FAILURE-2026-11-23). D-090 ships fixes ON because the guardrail can turn them OFF; that kill
    must hold. Now: the committed snapshot's 'off' entries hold; with none, the code default (as before)."""
    def boom():
        raise OSError("storage down")
    rf._reset_for_tests(boom)
    assert rf.flag("SURF_TIDE_DEPTH") == "1"                       # nothing killed anywhere: the code default
    assert "storage down" in rf.status()["error"]
    rf._reset_for_tests(boom, snapshot=_doc(SURF_TIDE_DEPTH="off")["flags"])
    r = rf.resolve("SURF_TIDE_DEPTH", "1")
    assert (r["value"], r["source"]) == ("0", "snapshot")          # the kill survives the restart
    assert rf.status()["floor"] == "snapshot"


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


# ---- D-090 fail-safe manifest reads (inspection findings 6 and 7, 2026-11-23). Measured before the change with a fake
# `requests` (no network): a warm process that had read a kill returned '1' / source default after an HTTP 400 or 404
# (and recorded NO error); a cold process returned '1' / default under 400, 404 and 500. ----

class _Resp:
    def __init__(self, code, doc=None):
        self.status_code, self._doc = code, doc

    def raise_for_status(self):
        if self.status_code >= 400:
            raise RuntimeError(f"HTTP {self.status_code}")

    def json(self):
        return self._doc


@pytest.fixture
def bucket(monkeypatch):
    """The real `_fetch_bucket` against a fake `requests`: set state['code'] per read."""
    import sys
    import types
    state = {"code": 200, "doc": _doc(SURF_NEARSHORE_MOP="off")}
    fake = types.ModuleType("requests")
    fake.get = lambda *a, **k: _Resp(state["code"], state["doc"])
    monkeypatch.setitem(sys.modules, "requests", fake)
    monkeypatch.setenv("SUPABASE_URL", "https://example.invalid")
    monkeypatch.setenv("SUPABASE_SERVICE_ROLE_KEY", "placeholder-not-a-key")
    rf._reset_for_tests(None)                         # None = the bucket path
    return state


@pytest.mark.parametrize("code", [400, 401, 403, 404, 500, 503])
def test_a_non_200_after_a_good_read_keeps_the_kill_and_records_the_error(bucket, code):
    assert rf.flag("SURF_NEARSHORE_MOP") == "0"
    bucket["code"] = code
    rf._refresh()
    r = rf.resolve("SURF_NEARSHORE_MOP", "1")
    assert (r["value"], r["source"]) == ("0", "manifest")          # was ('1', 'default') for 400/404
    assert f"HTTP {code}" in rf.status()["error"]                  # was None for 400/404: the clear was silent


@pytest.mark.parametrize("code", [400, 404, 401, 500])
def test_a_cold_process_during_an_outage_holds_the_committed_kills(bucket, code):
    bucket["code"] = code
    rf._reset_for_tests(None, snapshot=_doc(SURF_NEARSHORE_MOP="off")["flags"])
    r = rf.resolve("SURF_NEARSHORE_MOP", "1")
    assert (r["value"], r["source"]) == ("0", "snapshot")          # was ('1', 'default')
    assert rf.flag("SURF_TIDE_DEPTH") == "1"                       # not killed: its code default, untouched


def test_the_first_good_read_replaces_the_floor_so_an_owner_re_enable_wins(bucket, monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_TTL_S", "0")
    bucket["code"] = 404
    rf._reset_for_tests(None, snapshot=_doc(SURF_NEARSHORE_MOP="off")["flags"])
    assert rf.flag("SURF_NEARSHORE_MOP") == "0"                    # cold, unknown: the committed kill holds
    bucket["code"], bucket["doc"] = 200, _doc(SURF_NEARSHORE_MOP="on")
    rf._refresh()
    assert rf.resolve("SURF_NEARSHORE_MOP", "1")["source"] == "manifest"
    assert rf.flag("SURF_NEARSHORE_MOP") == "1"                    # the owner's re-enable, not the stale floor
    bucket["doc"] = _doc()
    rf._refresh()
    assert rf.flag("SURF_NEARSHORE_MOP") == "1"                    # a good EMPTY manifest = no overrides (not the floor)
    assert rf.status()["floor"] == "manifest"


def test_an_env_override_still_beats_the_floor(bucket, monkeypatch):
    bucket["code"] = 404
    rf._reset_for_tests(None, snapshot=_doc(SURF_NEARSHORE_MOP="off")["flags"])
    monkeypatch.setenv("SURF_NEARSHORE_MOP", "1")
    assert rf.resolve("SURF_NEARSHORE_MOP", "1")["source"] == "env"


def test_the_floor_is_off_when_the_manifest_is_disabled(monkeypatch):
    rf._reset_for_tests(lambda: None, snapshot=_doc(SURF_TIDE_DEPTH="off")["flags"])
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    assert rf.flag("SURF_TIDE_DEPTH") == "1"


def test_an_unreadable_snapshot_file_is_no_floor_and_is_reported(monkeypatch, tmp_path):
    bad = tmp_path / "bad.json"
    bad.write_text("{not json", encoding="utf-8")
    monkeypatch.setattr(rf, "SNAPSHOT_PATH", str(bad))
    rf._reset_for_tests(lambda: None)
    assert rf.flag("SURF_TIDE_DEPTH") == "1"
    assert rf.status()["snapshot_error"]


def test_the_committed_snapshot_is_valid_and_holds_only_guarded_kills():
    """The file Render and every CI process ship with: a manifest document whose entries are 'off' kills of GUARDED
    flags (an 'on' entry would never be applied, so it must not sit there looking like it is)."""
    import json
    path = os.path.join(BACKEND, "services", "runtime_flags_snapshot.json")
    doc = json.load(open(path, encoding="utf-8"))
    entries = rf.validate(doc)
    assert len(entries) == len(doc["flags"]), "every entry must have state on/off"
    for name, e in entries.items():
        assert name in rf.GUARDED, f"{name} is not a guarded flag"
        assert e["state"] == "off", f"{name}: only kills belong in the cold-start floor"
