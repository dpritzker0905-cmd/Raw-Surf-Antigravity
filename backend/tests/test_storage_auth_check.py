"""Reliability lane PR 4: a rejected storage key is LOUD (one owner-assigned issue; blocks only when told to).

The 2026-11-19/20 outage (401 "Legacy API keys are disabled") kept ingest, precompute and the guardrail down 21-25 h
with red runs nobody was told about. Pins (with the advisor's limits on #1266): a rejection is a 401/403 or an
ALLOW-LISTED Supabase text, never a request-shape 400; it must repeat ~10 s later; warn is the default mode; the key
and any key-shaped token never reach the log or the issue; the probe reads the same object, the same way, as the
production code; every storage lane runs it right after Python setup."""
import io
import json
import sys
from pathlib import Path

import pytest
import yaml

HERE = Path(__file__).resolve().parent
sys.path.insert(0, str(HERE.parent / "scripts"))

import storage_auth_check as sac  # noqa: E402
from services import runtime_flags as rf  # noqa: E402

WF = HERE.parents[1] / ".github" / "workflows"
KEY = "sb_secret_test-placeholder-not-a-key"


def _body(**d):
    return json.dumps(d).encode()


@pytest.mark.parametrize("code,body,want", [
    (200, b"{}", sac.OK),
    (401, _body(message="Legacy API keys are disabled"), sac.AUTH),            # the 11-19 outage
    (403, b"", sac.AUTH),
    (400, _body(statusCode="403", message="signature verification failed"), sac.AUTH),
    (400, _body(message="Invalid API key"), sac.AUTH),
    (400, _body(message="Invalid Compact JWS"), sac.AUTH),
    # a REQUEST-SHAPE answer (measured 2026-11-24 for an unknown sb_secret_ key on another endpoint): not a verdict
    (400, _body(message="headers must have required property 'authorization'"), sac.UNKNOWN),
    (400, _body(statusCode="404", error="not_found", message="Object not found"), sac.UNKNOWN),
    (500, b"oops", sac.UNKNOWN),
    (503, b"", sac.UNKNOWN),
])
def test_classify(code, body, want):
    assert sac.classify(code, body)[0] == want


class _Opener:
    """Answers from a list, one per request."""
    def __init__(self, *answers):
        self.answers, self.reqs = list(answers), []

    def __call__(self, req, timeout=None):
        self.reqs.append(req)
        code, body = self.answers.pop(0) if len(self.answers) > 1 else self.answers[0]
        if isinstance(code, Exception):
            raise code
        if code != 200:
            raise sac.urllib.error.HTTPError(req.full_url, code, "x", {}, io.BytesIO(body))
        resp = io.BytesIO(body)
        resp.status = 200

        class _Ctx:
            def __enter__(s):
                return resp

            def __exit__(s, *a):
                return False
        return _Ctx()


REJECT = (401, _body(message="Legacy API keys are disabled"))
NOSLEEP = lambda s: None  # noqa: E731


def _env(**k):
    return dict({"SUPABASE_URL": "https://example.invalid", "SUPABASE_SERVICE_ROLE_KEY": KEY, "LANE": "Forecast"}, **k)


def test_the_probe_reads_what_production_reads_the_way_it_reads_it():
    assert sac.OBJECT == rf.MANIFEST_KEY
    op = _Opener((200, b"{}"))
    assert sac.probe("https://example.invalid", KEY, op)[0] == sac.OK
    url = op.reqs[0].full_url
    assert url.startswith("https://example.invalid/storage/v1/object/weather-products/control/flags.json?cb=")
    assert op.reqs[0].get_header("Apikey") == KEY and op.reqs[0].get_header("Authorization") is None   # sb_secret: apikey only


def test_warn_is_the_default_and_block_stops_the_lane(capsys):
    assert sac.main(_env(), opener=_Opener(REJECT), sleep=NOSLEEP) == 0                         # default: warn
    out = capsys.readouterr().out
    assert "::error title=Storage credential rejected::HTTP 401 Legacy API keys are disabled (twice" in out
    assert "warn: this lane goes on" in out and KEY not in out
    assert sac.main(_env(STORAGE_AUTH_CHECK="block"), opener=_Opener(REJECT), sleep=NOSLEEP) == 2
    assert sac.main(_env(STORAGE_AUTH_CHECK="1"), opener=_Opener(REJECT), sleep=NOSLEEP) == 2
    assert sac.main(_env(STORAGE_AUTH_CHECK="0"), opener=_Opener(REJECT), sleep=NOSLEEP) == 0      # fully off


def test_a_single_rejection_is_not_confirmed():
    waits = []
    op = _Opener(REJECT, (200, b"{}"))
    assert sac.confirmed_probe("https://x", KEY, op, sleep=waits.append)[0] == sac.OK
    assert waits == [sac.CONFIRM_DELAY_S] and len(op.reqs) == 2
    assert sac.main(_env(STORAGE_AUTH_CHECK="block"), opener=_Opener(REJECT, (503, b"")), sleep=NOSLEEP) == 0


def test_a_request_shape_400_never_stops_a_lane(capsys):
    shape = (400, _body(message="headers must have required property 'authorization'"))
    assert sac.main(_env(STORAGE_AUTH_CHECK="block"), opener=_Opener(shape), sleep=NOSLEEP) == 0
    assert "inconclusive" in capsys.readouterr().out


def test_a_blip_never_blocks_a_lane(capsys):
    assert sac.main(_env(STORAGE_AUTH_CHECK="block"), opener=_Opener((TimeoutError(), b"")), sleep=NOSLEEP) == 0
    assert sac.main(_env(STORAGE_AUTH_CHECK="block"), opener=_Opener((502, b"")), sleep=NOSLEEP) == 0
    assert sac.main({"SUPABASE_URL": ""}, opener=_Opener(REJECT), sleep=NOSLEEP) == 0             # not configured


def test_tokens_are_scrubbed_from_what_is_printed_and_posted(capsys):
    leak = (401, _body(message=f"Invalid API key {KEY} or eyJhbGciOi.eyJzdWIi.sig or sb_secret_OTHERKEY123"))
    assert sac.main(_env(), opener=_Opener(leak), sleep=NOSLEEP) == 0
    out = capsys.readouterr().out
    assert KEY not in out and "eyJ" not in out and "sb_secret_" not in out and "[redacted]" in out
    p = sac.plan(sac.AUTH, 401, sac.scrub(f"bad {KEY}", KEY), [], "x", "r", False)
    assert KEY not in p["body"] and "[redacted]" in p["body"]


def test_one_issue_per_outage_closed_on_recovery():
    p = sac.plan(sac.AUTH, 401, "Legacy API keys are disabled", [], "Forecast Ingestion", "https://run/1", False)
    assert p["action"] == "open" and p["labels"] == ["storage-auth", "severity:critical"]
    assert "HTTP 401" in p["title"] and "SUPABASE_SERVICE_ROLE_KEY" in p["body"] and "Warn mode" in p["body"]
    assert sac.plan(sac.AUTH, 401, "", [{"number": 5}], "Precompute", "r", True)["action"] == "comment"
    assert sac.plan(sac.OK, 200, "", [{"number": 5}], "Precompute", "r", False) == {
        "action": "close", "number": 5, "body": "Recovered: `Precompute` was accepted by storage. Run: r"}
    assert sac.plan(sac.UNKNOWN, 502, "", [{"number": 5}], "x", "r", False)["action"] == "none"   # a blip closes nothing
    assert sac.plan(sac.OK, 200, "", [], "x", "r", False)["action"] == "none"


def test_the_issue_is_opened_assigned_to_the_owner(monkeypatch):
    calls = []
    monkeypatch.setattr(sac, "_gh", lambda *a: calls.append(a) or ("[]" if a[:2] == ("issue", "list") else "url"))
    sac.main(_env(GH_TOKEN="t", GITHUB_REPOSITORY="o/r", OWNER="the-owner", RUN_URL="u"), opener=_Opener(REJECT),
             sleep=NOSLEEP)
    create = next(c for c in calls if c[:2] == ("issue", "create"))
    assert "--assignee" in create and create[create.index("--assignee") + 1] == "the-owner"


LANES = [("forecast-ingest.yml", "ingest"), ("forecast-ingest-pilots.yml", "ingest-pilots"),
         ("precompute.yml", "precompute"), ("flag-guardrail.yml", "guardrail")]


@pytest.mark.parametrize("wf,job", LANES)
def test_every_storage_lane_checks_first_in_warn_mode(wf, job):
    doc = yaml.safe_load((WF / wf).read_text(encoding="utf-8"))
    j = doc["jobs"][job]
    steps = j["steps"]
    k = [s.get("id") for s in steps].index("storage_auth")
    assert "setup-python" in steps[k - 1].get("uses", ""), "the check runs right after Python setup, before pip"
    assert "storage_auth_check.py" in steps[k]["run"] and "continue-on-error" not in steps[k]
    assert steps[k]["env"]["GH_TOKEN"] == "${{ github.token }}"
    assert steps[k]["env"]["STORAGE_AUTH_CHECK"] == "${{ vars.STORAGE_AUTH_CHECK || 'warn' }}"   # blocking needs the owner
    perms = j.get("permissions") or doc.get("permissions") or {}
    assert perms.get("issues") == "write"
