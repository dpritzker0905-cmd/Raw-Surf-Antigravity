"""POST /client-diagnostics is an UNAUTHENTICATED public ingress — it must be BOUNDED (MC-07).

Measured before repair (Master Codex Audit 1.0, re-confirmed at HEAD 2026-08-15): unconstrained
`str` fields and an arbitrary dict, converted to text and appended to a local file with no size
bound, no rotation, no newline sanitisation — and the 500 handler returned `str(e)` to the caller.
The local artifact showed what that produces: 429,587 bytes / 2,620 lines dominated by duplicated
test traffic (one record repeated 250 times).

The bounds, each pinned below:
  * schema: every string field carries a max length; `details` is capped at 4 KB serialized —
    an oversized payload is a 422 at the door, not a durable log line;
  * the log file rotates once at DIAG_LOG_MAX_BYTES (default 5 MB), bounding disk at ~2x the cap;
  * user-controlled newlines cannot forge log records (sanitized to literal \\n);
  * the 500 detail never carries exception text (the WS-CAN-0009 pattern: log it, don't serve it).
"""
import ast
import inspect
import os
import sys
import textwrap

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

from fastapi import FastAPI                     # noqa: E402
from fastapi.testclient import TestClient       # noqa: E402

import routes.weather as rw                     # noqa: E402


@pytest.fixture(scope="module")
def client():
    app = FastAPI()
    app.include_router(rw.router)
    return TestClient(app, raise_server_exceptions=False)


BASE = {"timestamp": "2026-08-15T00:00:00Z", "event_type": "render_warning"}


# ── the door ────────────────────────────────────────────────────────────────────────────────────

def test_a_normal_report_is_accepted__THE_CONTROL(client):
    """Without this the bounds below could pass on a route that rejects everything."""
    r = client.post("/weather/client-diagnostics", json={**BASE, "model": "GFS", "fps": 30.0})
    assert r.status_code == 200 and r.json().get("status") == "success"


def test_an_oversized_event_type_is_rejected_at_the_door(client):
    r = client.post("/weather/client-diagnostics", json={**BASE, "event_type": "x" * 5000})
    assert r.status_code == 422, (
        f"a 5,000-char event_type was accepted (HTTP {r.status_code}) — the ingress is unbounded")


def test_oversized_details_are_rejected_at_the_door(client):
    r = client.post("/weather/client-diagnostics",
                    json={**BASE, "details": {"blob": "y" * 20_000}})
    assert r.status_code == 422, (
        f"a 20 KB details blob was accepted (HTTP {r.status_code}) — the ingress is unbounded")


def test_details_under_the_cap_still_pass__THE_CONTROL(client):
    r = client.post("/weather/client-diagnostics", json={**BASE, "details": {"note": "z" * 1000}})
    assert r.status_code == 200


# ── the file ────────────────────────────────────────────────────────────────────────────────────

def test_the_append_helper_rotates_at_the_cap(tmp_path):
    """The log cannot grow unbounded: at the cap the file becomes .1 (previous .1 discarded), so
    total disk is ~2x the cap whatever a client sends."""
    p = tmp_path / "diag.log"
    line = "e" * 100
    for _ in range(10):
        rw.append_diagnostic_line(p, line, max_bytes=350)
    rotated = tmp_path / "diag.log.1"
    assert rotated.exists(), "no rotation happened at the cap"
    assert p.stat().st_size <= 350 + len(line) + 2, "the live file kept growing past the cap"
    assert rotated.stat().st_size <= 350 + len(line) + 2, "the rotated file is unbounded too"


def test_the_append_helper_neutralises_newlines(tmp_path):
    """A client-controlled newline must not forge a second log record."""
    p = tmp_path / "diag.log"
    rw.append_diagnostic_line(p, "one[FAKE 2026] forged\ntwo\rthree", max_bytes=10_000)
    lines = p.read_text(encoding="utf-8").splitlines()
    assert len(lines) == 1, f"newline injection produced {len(lines)} records"
    assert "\\n" in lines[0] and "\\r" in lines[0]


# ── the 500 ─────────────────────────────────────────────────────────────────────────────────────

def test_the_500_detail_never_carries_the_exception_text():
    """AST, not a needle: walk the handler for `raise HTTPException(...)` whose detail expression
    references the caught exception. Pre-repair the handler served `str(e)` to an anonymous
    caller — internals belong in the server log, not the response (the WS-CAN-0009 pattern)."""
    src = textwrap.dedent(inspect.getsource(rw.post_client_diagnostics))
    tree = ast.parse(src)
    raises = []
    offenders = []
    for node in ast.walk(tree):
        if not (isinstance(node, ast.Raise) and isinstance(node.exc, ast.Call)
                and getattr(node.exc.func, "id", None) == "HTTPException"):
            continue
        raises.append(node)
        for kw in node.exc.keywords:
            if kw.arg != "detail":
                continue
            for sub in ast.walk(kw.value):
                if isinstance(sub, ast.Name) and sub.id == "e":
                    offenders.append(f"line {node.lineno}: {ast.unparse(kw.value)}")
    assert raises, "the handler no longer raises HTTPException at all — this scan is grading nothing"
    assert not offenders, (
        "the 500 detail interpolates the caught exception:\n  " + "\n  ".join(offenders))
