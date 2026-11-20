"""Supabase project API keys ride on `apikey`; Bearer only for a legacy JWT key (2026-11-19 ingest outage).

Supabase's new secret keys (sb_secret_...) are not JWTs. When the project's legacy JWT keys were
disabled, every backend call that copied the service key onto `Authorization: Bearer` began to 401
and the forecast ingest stopped. `core.supabase_auth.supabase_headers` is the one rule; scripts that
run by path with `-I -S` inline it as `_supabase_headers`. This file pins the rule, every inline
copy of it, and scans the backend so a new Bearer-from-service-key call cannot come back.
User access tokens (auth flows), Render, OpenAI, SendGrid and GitHub Bearer tokens are not
Supabase API keys and are not flagged: the scan only fires when the Bearer value is a SUPABASE_*
variable or the same header block also carries `apikey`.
"""
import ast
import re
from pathlib import Path

import pytest

from core.supabase_auth import is_legacy_jwt_key, supabase_headers

BACKEND = Path(__file__).resolve().parents[1]
HELPER = BACKEND / "core" / "supabase_auth.py"
NEW_KEY = "sb_secret_fake"        # shapes only, never real keys (public repo)
LEGACY_KEY = "eyJfake.legacy.jwt"

_BEARER = re.compile(r"""Bearer\s*(?:\{(?P<f>[^}]+)\}|["']\s*\+\s*(?P<p>[\w.]+)|%s["']\s*%\s*(?P<m>[\w.]+))""")
_GATED = 'startswith("eyJ")'
_WINDOW = 4


def _source_files():
    for path in BACKEND.rglob("*.py"):
        rel = path.relative_to(BACKEND).as_posix()
        if rel.startswith(("tests/", ".venv/", "venv/")) or "/site-packages/" in rel or path == HELPER:
            continue
        yield rel, path


def bearer_key_offences(text):
    """(line number, line) for each Bearer built from a Supabase API key without the JWT gate."""
    lines = text.splitlines()
    out = []
    for i, line in enumerate(lines):
        m = _BEARER.search(line)
        if not m or _GATED in line:
            continue
        expr = m.group("f") or m.group("p") or m.group("m") or ""
        window = "\n".join(lines[max(0, i - _WINDOW): i + _WINDOW + 1]).lower()
        if "SUPABASE_" in expr or "apikey" in window:
            out.append((i + 1, line.strip()))
    return out


def test_new_secret_key_rides_on_apikey_only():
    assert supabase_headers(NEW_KEY) == {"apikey": NEW_KEY}
    assert supabase_headers("sb_publishable_x") == {"apikey": "sb_publishable_x"}
    assert not is_legacy_jwt_key(NEW_KEY)


def test_legacy_jwt_key_keeps_its_bearer_copy():
    assert supabase_headers(LEGACY_KEY) == {"apikey": LEGACY_KEY, "Authorization": "Bearer " + LEGACY_KEY}
    assert is_legacy_jwt_key(LEGACY_KEY)


def test_extra_headers_merge_without_reintroducing_bearer():
    h = supabase_headers(NEW_KEY, {"Content-Type": "application/json", "x-upsert": "true"})
    assert h == {"apikey": NEW_KEY, "Content-Type": "application/json", "x-upsert": "true"}
    assert supabase_headers(None) == {"apikey": None}   # unset key: no crash, no Bearer


def _inline_copies():
    found = []
    for rel, path in _source_files():
        text = path.read_text(encoding="utf-8", errors="replace")
        if "def _supabase_headers" not in text:
            continue
        for node in ast.parse(text).body:
            if isinstance(node, ast.FunctionDef) and node.name == "_supabase_headers":
                found.append((rel, ast.get_source_segment(text, node)))
    return found


def test_every_inline_copy_applies_the_same_rule():
    copies = _inline_copies()
    assert len(copies) >= 20, copies   # the by-path scripts that talk to Supabase
    for rel, src in copies:
        ns = {}
        exec(compile(src, rel, "exec"), ns)   # the function alone: no module import side effects
        fn = ns["_supabase_headers"]
        assert fn(NEW_KEY) == {"apikey": NEW_KEY}, rel
        assert fn(LEGACY_KEY) == {"apikey": LEGACY_KEY, "Authorization": "Bearer " + LEGACY_KEY}, rel


@pytest.mark.parametrize("snippet, flagged", [
    ('h = {"Authorization": f"Bearer {key}", "apikey": key}', True),
    ('h = {"apikey": svc, "Authorization": "Bearer " + svc}', True),
    ('headers={"Authorization": "Bearer %s" % tok, "apikey": tok}', True),
    ('h = {"Authorization": f"Bearer {SUPABASE_SERVICE_ROLE_KEY}"}', True),
    ('h = {\n  "apikey": k,\n  "Authorization": f"Bearer {k}",\n}', True),
    ('h = {"Authorization": f"Bearer {access_token}"}', False),       # a user's session token
    ('h = {"Authorization": "Bearer " + key}', False),                # e.g. OpenAI / Render
    ('return {"apikey": key, **({"Authorization": "Bearer " + key} if str(key).startswith("eyJ") else {})}', False),
])
def test_scan_flags_service_key_bearer_and_spares_user_tokens(snippet, flagged):
    assert bool(bearer_key_offences(snippet)) is flagged


def test_no_backend_file_sends_a_supabase_key_as_bearer():
    offences = []
    for rel, path in _source_files():
        for lineno, line in bearer_key_offences(path.read_text(encoding="utf-8", errors="replace")):
            offences.append(f"{rel}:{lineno}: {line}")
    assert not offences, (
        "Supabase API key sent as Bearer (sb_secret_ keys are rejected there; use "
        "core.supabase_auth.supabase_headers, or an inline _supabase_headers in by-path scripts):\n"
        + "\n".join(offences))
