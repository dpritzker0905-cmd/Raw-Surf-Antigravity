"""Reliability lane PR 4: a 401/403 from storage fails LOUD (stops the lane, opens ONE owner-assigned issue).

The 2026-11-19/20 outage (401 "Legacy API keys are disabled") kept ingest, precompute and the guardrail down 21-25 h
with red runs nobody was told about. Pins: what counts as rejected (incl. Supabase's 400-with-auth-body habit,
measured against this project 2026-11-24); a blip never blocks a lane; one issue per outage, closed on recovery; the
key never reaches the issue or the log; every storage lane runs the check right after Python setup."""
import io
import json
import sys
import urllib.error
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import storage_auth_check as sac  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows"
KEY = "sb_secret_test-placeholder-not-a-key"


def _body(**d):
    return json.dumps(d).encode()


@pytest.mark.parametrize("code,body,want", [
    (200, b"{}", sac.OK),
    (401, _body(message="Legacy API keys are disabled"), sac.AUTH),            # the 11-19 outage
    (403, b"", sac.AUTH),
    (400, _body(statusCode="403", message="signature verification failed"), sac.AUTH),
    (400, _body(message="headers must have required property 'authorization'"), sac.AUTH),
    (400, _body(statusCode="404", error="Bucket not found", message="Bucket not found"), sac.UNKNOWN),
    (500, b"oops", sac.UNKNOWN),
    (503, b"", sac.UNKNOWN),
])
def test_classify(code, body, want):
    assert sac.classify(code, body)[0] == want


class _Opener:
    def __init__(self, code, body=b"{}", exc=None):
        self.code, self.body, self.exc, self.req = code, body, exc, None

    def __call__(self, req, timeout=None):
        self.req = req
        if self.exc:
            raise self.exc
        if self.code != 200:
            raise urllib.error.HTTPError(req.full_url, self.code, "x", {}, io.BytesIO(self.body))
        ok = io.BytesIO(self.body)
        ok.status = 200
        ok.__enter__ = lambda *a: ok
        ok.__exit__ = lambda *a: None

        class _Ctx:
            def __enter__(s):
                return ok

            def __exit__(s, *a):
                return False
        return _Ctx()


def _env(**k):
    return dict({"SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": KEY, "LANE": "Forecast"}, **k)


def test_a_rejected_key_stops_the_lane_loudly_without_printing_the_key(capsys):
    op = _Opener(401, _body(message="Legacy API keys are disabled"))
    assert sac.main(_env(), opener=op) == 2
    out = capsys.readouterr().out
    assert "::error title=Storage credential rejected::HTTP 401 Legacy API keys are disabled" in out
    assert KEY not in out
    assert op.req.full_url == "https://example.invalid/storage/v1/bucket/weather-products"
    assert op.req.get_header("Apikey") == KEY and op.req.get_header("Authorization") is None   # sb_secret: apikey only


def test_a_blip_never_blocks_a_lane(capsys):
    assert sac.main(_env(), opener=_Opener(0, exc=TimeoutError())) == 0
    assert sac.main(_env(), opener=_Opener(502)) == 0
    assert "inconclusive" in capsys.readouterr().out


def test_accepted_unset_and_killed(capsys):
    assert sac.main(_env(), opener=_Opener(200)) == 0
    assert sac.main({"SUPABASE_URL": ""}, opener=_Opener(401)) == 0                  # not configured: warn only
    assert sac.main(_env(STORAGE_AUTH_CHECK="0"), opener=_Opener(401)) == 0         # the kill switch


def test_one_issue_per_outage_closed_on_recovery():
    p = sac.plan(sac.AUTH, 401, "Legacy API keys are disabled", [], "Forecast Ingestion", "https://run/1")
    assert p["action"] == "open" and p["labels"] == ["storage-auth", "severity:critical"]
    assert "HTTP 401" in p["title"] and "SUPABASE_SERVICE_ROLE_KEY" in p["body"] and KEY not in p["body"]
    assert sac.plan(sac.AUTH, 401, "", [{"number": 5}], "Precompute", "r")["action"] == "comment"
    assert sac.plan(sac.OK, 200, "", [{"number": 5}], "Precompute", "r") == {
        "action": "close", "number": 5, "body": "Recovered: `Precompute` was accepted by storage. Run: r"}
    assert sac.plan(sac.UNKNOWN, 502, "", [{"number": 5}], "x", "r")["action"] == "none"   # a blip closes nothing
    assert sac.plan(sac.OK, 200, "", [], "x", "r")["action"] == "none"


def test_the_issue_is_opened_assigned_to_the_owner(monkeypatch):
    calls = []
    monkeypatch.setattr(sac, "_gh", lambda *a: calls.append(a) or ("[]" if a[:2] == ("issue", "list") else "url"))
    sac.main(_env(GH_TOKEN="t", GITHUB_REPOSITORY="o/r", OWNER="the-owner", RUN_URL="u"), opener=_Opener(401))
    create = next(c for c in calls if c[:2] == ("issue", "create"))
    assert "--assignee" in create and create[create.index("--assignee") + 1] == "the-owner"


LANES = [("forecast-ingest.yml", "ingest"), ("forecast-ingest-pilots.yml", "ingest-pilots"),
         ("precompute.yml", "precompute"), ("flag-guardrail.yml", "guardrail")]


@pytest.mark.parametrize("wf,job", LANES)
def test_every_storage_lane_checks_first(wf, job):
    doc = yaml.safe_load((WF / wf).read_text(encoding="utf-8"))
    j = doc["jobs"][job]
    steps = j["steps"]
    k = [s.get("id") for s in steps].index("storage_auth")
    assert "setup-python" in steps[k - 1].get("uses", ""), "the check runs right after Python setup, before pip"
    assert "storage_auth_check.py" in steps[k]["run"] and "continue-on-error" not in steps[k]
    assert steps[k]["env"]["GH_TOKEN"] == "${{ github.token }}"
    perms = j.get("permissions") or doc.get("permissions") or {}
    assert perms.get("issues") == "write"
