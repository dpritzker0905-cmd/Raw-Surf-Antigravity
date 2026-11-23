"""The admin switch board, ops snapshot and Verification & skill view (Fable inspection 2026-11-23, P0-3 / P1-4 / P1-6).

Pins: a lane ON through a repository variable or a workflow literal reads ON (never "Off, code default"); with no
snapshot the lane reads "set in CI", never a guess; an hours setting is a setting; credential-like names and values
never leave the board; both endpoints require admin and write nothing; the snapshot builder drops credential names;
the workflow holds the storage secret only in its stdlib step.
"""
import json
import os

import pytest

from services import admin_ops_view as view
from services import admin_switch_board as board
from services import runtime_flags as rf

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
REPO = os.path.dirname(BACKEND)


@pytest.fixture(autouse=True)
def _isolated(monkeypatch):
    monkeypatch.setenv("RUNTIME_FLAGS_MANIFEST", "0")
    rf._reset_for_tests()
    view._reset_for_tests(lambda key: None)
    yield
    view._reset_for_tests()


FAKE = {
    "GFS_WORLD_FULL_HORIZON": {"kind": "switch", "defaults": ["0"], "files": ["backend/a.py"], "file_count": 1,
                               "lanes": [{"workflow": "forecast-ingest.yml", "form": "var",
                                          "var": "GFS_WORLD_FULL_HORIZON", "fallback": "0"}],
                               "repo_vars": ["GFS_WORLD_FULL_HORIZON"], "guarded": False, "registered": False},
    "MANIFEST_PUBLISH_ONE_STEP": {"kind": "switch", "defaults": ["0"], "files": [], "file_count": 1,
                                  "lanes": [{"workflow": "precompute.yml", "form": "literal", "value": "1"}],
                                  "repo_vars": [], "guarded": False, "registered": True},
    "MARINE_EXT_CEILING_MARGIN_H": {"kind": "switch", "defaults": ["0"], "files": [], "file_count": 1,
                                    "lanes": [{"workflow": "forecast-ingest.yml", "form": "var",
                                               "var": "MARINE_EXT_CEILING_MARGIN_H", "fallback": "0"}],
                                    "repo_vars": ["MARINE_EXT_CEILING_MARGIN_H"], "guarded": False, "registered": False},
    "SURF_FACE_RANGE": {"kind": "switch", "defaults": ["1"], "files": [], "file_count": 1, "lanes": [],
                        "repo_vars": [], "guarded": True, "registered": True},
}


@pytest.fixture
def fake_registry(monkeypatch):
    monkeypatch.setattr(board, "registry", lambda registered=None: FAKE)


def _rows(out):
    return {r["name"]: r for r in out["switches"]}


def test_a_lane_on_through_a_repo_variable_reads_on_not_code_default(fake_registry):
    out = board.board({"GFS_WORLD_FULL_HORIZON": "1", "MARINE_EXT_CEILING_MARGIN_H": "12"},
                      {"MANIFEST_PUBLISH_ONE_STEP": ("0", "one step", "lanes")})
    rows = _rows(out)
    gfs = rows["GFS_WORLD_FULL_HORIZON"]
    assert (gfs["state"], gfs["differs_from_default"]) == ("on", True)
    assert gfs["lanes"][0] == {"workflow": "forecast-ingest.yml", "form": "var", "var": "GFS_WORLD_FULL_HORIZON",
                               "value": "1", "source": "repo variable GFS_WORLD_FULL_HORIZON"}
    one = rows["MANIFEST_PUBLISH_ONE_STEP"]
    assert (one["state"], one["differs_from_default"], one["controls"]) == ("on", True, "one step")
    margin = rows["MARINE_EXT_CEILING_MARGIN_H"]
    assert (margin["kind"], margin["state"], margin["lanes"][0]["value"]) == ("setting", "setting", "12")
    assert out["counts"]["differs_from_default"] == 3
    assert {v["name"]: v["value"] for v in out["repo_vars"]}["GFS_WORLD_FULL_HORIZON"] == "1"


def test_without_a_snapshot_a_variable_lane_reads_set_in_ci(fake_registry):
    out = board.board(None)
    gfs = _rows(out)["GFS_WORLD_FULL_HORIZON"]
    assert gfs["state"] == "unknown" and gfs["lanes_unknown"] == 1
    assert gfs["lanes"][0]["value"] is None and gfs["lanes"][0]["source"].startswith("set in CI")
    assert out["repo_vars_known"] is False


def test_an_unset_variable_reads_its_workflow_fallback(fake_registry):
    gfs = _rows(board.board({}))["GFS_WORLD_FULL_HORIZON"]
    assert gfs["lanes"][0]["value"] == "0" and "fallback" in gfs["lanes"][0]["source"]
    assert gfs["state"] == "off" and gfs["differs_from_default"] is False


def test_a_guarded_flag_reads_env_then_manifest_then_default(fake_registry, monkeypatch):
    rows = _rows(board.board({}, coverage={"SURF_FACE_RANGE": {"class": "blind", "why": "x"}}))
    face = rows["SURF_FACE_RANGE"]
    assert (face["server"]["value"], face["server"]["source"], face["state"]) == ("1", "default", "on")
    assert face["coverage"]["class"] == "blind" and face["fix_version"] == rf.FIX_VERSION["SURF_FACE_RANGE"]
    monkeypatch.setenv("SURF_FACE_RANGE", "0")
    face = _rows(board.board({}))["SURF_FACE_RANGE"]
    assert (face["server"]["source"], face["state"], face["differs_from_default"]) == ("env", "off", True)


@pytest.mark.parametrize("value", ["postgres://user:pw@host/db", "sk_live_abc123", "db.internal.example", "a" * 30])
def test_an_unsafe_env_value_is_never_shown(monkeypatch, value):
    # default-deny (design review 2026-11-23): a credential can hide under a benign name and look like a plain token
    monkeypatch.setenv("SOME_SETTING_X", value)
    assert board.server_value("SOME_SETTING_X", ["0"])["value"] is None


def test_a_set_variable_whose_value_is_not_shown_says_so(fake_registry):
    gfs = _rows(board.board({"GFS_WORLD_FULL_HORIZON": None}))["GFS_WORLD_FULL_HORIZON"]
    assert gfs["lanes"][0]["value"] is None and "value not shown" in gfs["lanes"][0]["source"]
    assert gfs["state"] == "unknown"


def test_a_stale_snapshot_makes_variable_lanes_unknown(monkeypatch):
    from routes.admin import surf_switches
    view._reset_for_tests(lambda key: _snap(generated_at="2000-01-01T00:00:00Z", repo_vars={"GFS_WORLD_FULL_HORIZON": "1"}))
    monkeypatch.setattr(board, "registry", lambda registered=None: FAKE)
    out = surf_switches._switches()
    assert out["snapshot"]["status"] == "stale" and out["repo_vars_known"] is False
    assert _rows(out)["GFS_WORLD_FULL_HORIZON"]["state"] == "unknown"


def test_the_real_board_lists_far_more_than_the_hand_registry():
    from routes.admin.surf_forecast import _RATING_FLAGS
    board._reset_for_tests()
    out = board.board({}, _RATING_FLAGS)
    assert out["counts"]["registered"] == len(_RATING_FLAGS)
    assert out["counts"]["unregistered"] > 144
    names = {r["name"] for r in out["switches"]}
    assert {"CONSENSUS_SERVE", "SERVED_WAVE_VERIFY", "MANIFEST_PUBLISH_ONE_STEP"} <= names


# ── ops snapshot reader ────────────────────────────────────────────────────────────────────────────────────────────
def _snap(**over):
    d = {"schema": view.SCHEMA, "generated_at": "2099-01-01T00:00:00Z", "repo_vars": {"A_B": "1"},
         "verification": {"skill_pending": {"entries": 61093, "cap": 68000}}, "alerts": []}
    d.update(over)
    return json.dumps(d)


def test_snapshot_absent_error_and_ok():
    view._reset_for_tests(lambda key: None)
    assert view.read_snapshot()["status"] == "absent"
    view._reset_for_tests(lambda key: "{not json")
    assert view.read_snapshot()["status"] == "error"
    view._reset_for_tests(lambda key: _snap())
    r = view.read_snapshot()
    assert r["status"] == "ok" and r["snapshot"]["repo_vars"] == {"A_B": "1"}


def test_snapshot_stale_after_three_missed_runs():
    view._reset_for_tests(lambda key: _snap(generated_at="2000-01-01T00:00:00Z"))
    assert view.read_snapshot()["status"] == "stale"


def test_verification_view_carries_the_snapshot_and_guardrail_coverage():
    view._reset_for_tests(lambda key: _snap())
    out = view.verification_view()
    assert out["verification"]["skill_pending"]["entries"] == 61093
    cov = out["coverage"]
    assert cov["guarded"] == len(rf.GUARDED)
    assert sum(len(v) for v in cov["by_class"].values()) == len(rf.GUARDED)
    assert "none" not in cov["by_class"]                     # every guarded flag declares a coverage class
    assert set(cov["blind_effectively_on"]) <= set(cov["by_class"]["blind"])
    assert "SURF_FACE_RANGE" in cov["blind_effectively_on"]


# ── endpoints: admin only, read-only ───────────────────────────────────────────────────────────────────────────────
def test_endpoints_require_admin_and_only_read():
    from deps.admin_auth import get_current_admin
    from routes.admin import surf_switches
    paths = {}
    for route in surf_switches.router.routes:
        deps = {d.call for d in route.dependant.dependencies}
        paths[route.path] = (route.methods, get_current_admin in deps)
    assert paths == {"/admin/surf-forecast/switches": ({"GET"}, True),
                     "/admin/surf-forecast/verification": ({"GET"}, True)}


# ── the CI snapshot ────────────────────────────────────────────────────────────────────────────────────────────────
def test_snapshot_builder_drops_credentials_and_unsafe_values():
    from scripts import admin_ops_snapshot as snap
    out = snap.sanitize_vars(json.dumps({"GFS_WORLD_FULL_HORIZON": "1", "SUPABASE_URL": "https://x.invalid",
                                         "SOME_TOKEN": "abc", "NOTE_TEXT": "has spaces in it", "lower": "1"}))
    assert out == {"GFS_WORLD_FULL_HORIZON": "1", "NOTE_TEXT": None}


def test_memory_audit_output_is_parsed():
    from scripts import admin_ops_snapshot as snap
    text = ("WARN: OVERDUE commitment ledger.d/x.jsonl:5 (due 2026-11-08T00:00:00Z): D-059 read -- one live read\n"
            "NOTE: open commitment seq 9 (due 2026-11-30T00:00:00Z): y\n"
            "memory audit: 0 FAIL, 390 WARN, 19 NOTE (docs only)\n")
    out = snap.parse_memory_audit(text)
    assert (out["fail"], out["warn"], out["overdue_total"], out["open_total"]) == (0, 390, 1, 1)
    assert out["overdue"][0] == {"where": "ledger.d/x.jsonl:5", "due": "2026-11-08T00:00:00Z",
                                 "target": "D-059 read", "check": "one live read"}


def test_scoreboard_rows_are_read_and_pending_cap_from_source():
    from scripts import admin_ops_snapshot as snap
    sb = snap.scoreboard(os.path.join(REPO, "docs", "weather-program", "SCOREBOARD.md"))
    assert sb["total"] > 100 and set(sb["rows"][-1]) == {"date", "commit", "id", "metric", "value", "source"}
    from services.weather_pipeline.forecast_skill import PENDING_MAX_ENTRIES
    assert snap.pending_cap() == PENDING_MAX_ENTRIES


def test_pending_stats():
    from datetime import datetime, timezone
    from scripts import admin_ops_bucket_io as io
    now = datetime(2026, 11, 23, tzinfo=timezone.utc)
    rows = [{"target_time": "2026-11-23T06:00:00Z"}, {"target_time": "2026-11-26T00:00:00Z"}]
    assert io.pending_stats(rows, 4, now) == {"entries": 2, "cap": 4, "beyond_48h": 1, "fill_pct": 50.0, "headroom": 2}
    assert io.pending_stats({"pending": rows}, None, now)["entries"] == 2
    assert "error" in io.pending_stats("nope", 4, now)


def test_workflow_holds_the_storage_secret_only_in_its_stdlib_step():
    text = open(os.path.join(REPO, ".github", "workflows", "admin-ops-snapshot.yml"), encoding="utf-8").read()
    assert "pull_request" not in text.split("jobs:")[0]
    assert "environment: supabase-service" in text
    steps = text.split("- name: ")
    secret_steps = [st for st in steps if "secrets." in st]
    assert len(secret_steps) == 1 and "python3 -I -S backend/scripts/admin_ops_bucket_io.py" in secret_steps[0]
    assert "permissions:\n  contents: read\n  actions: read" in text
