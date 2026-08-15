"""WS-CAN-0017 / WS-OBJ-304 — a byte range that came back the wrong size must not become a product.

THE DEFECT, and it is NOT the one the register describes. The task is filed as "byte-count/Range
validation", i.e. TRUNCATION — but truncation is already caught downstream: too few bytes decode to
too few GRIB messages and `len(msgs) < N` raises. The hole is the OPPOSITE direction, and it is
silent:

    _fetch_message_bytes()   accepts status 200 as well as 206
                             — 200 is exactly what a server returns when it IGNORES the Range
                               header and sends the WHOLE FILE
                             — and the returned length is never compared to the range requested
    ...
    if len(msgs) < len(OM_ORDER):        <-- ONE-SIDED
        raise
    for mi, om in enumerate(OM_ORDER):
        vals = msgs[mi].values           <-- POSITIONAL

So an over-fetch concatenates whole files, produces MORE messages than expected, sails past a `<`
check, and then every variable is read BY POSITION — wave height receives whichever message happens
to land at that index.

⚠️ THE WIND LANE IS THE SHARPEST CASE: `msgs[0]` is U and `msgs[1]` is V behind `len(msgs) < 2`.
Extra messages there mean wrong wind vectors on every wind surface.

⚠️ HONEST ABOUT REACHABILITY: NOAA honours Range, so this is a LATENT risk, not an observed incident
— there is no evidence any served product was corrupted this way. It earns a guard because a
one-sided check costs nothing to make two-sided, because the failure is silent rather than loud, and
because 23,778 products flow through this path with nothing downstream that would notice a
variable-to-message mis-mapping.
"""
import ast
import importlib
import os
import sys

import pytest

BACKEND = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if BACKEND not in sys.path:
    sys.path.insert(0, BACKEND)

FETCHERS = ("noaa_gfs_wave_fetcher", "noaa_gfs_wind_fetcher", "noaa_gfs_pressure_fetcher")


def _mod(name):
    return importlib.import_module(f"services.{name}")


class _Resp:
    def __init__(self, status, body):
        self.status_code = status
        self.content = body


class _FakeRequests:
    """A `requests` module double. `body_for` decides what the server sends back."""

    def __init__(self, status, body):
        self._status, self._body = status, body
        self.calls = []

    def get(self, url, headers=None, timeout=None, **kw):
        self.calls.append((url, (headers or {}).get("Range")))
        return _Resp(self._status, self._body)


# ── the behaviour ───────────────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", FETCHERS)
def test_a_range_request_answered_with_the_WHOLE_FILE_is_rejected(name):
    """THE DEFECT. A server that ignores `Range` answers 200 with the entire file. That is not a
    truncation — it is an OVER-fetch, and it is the case every downstream `<` check misses."""
    m = _mod(name)
    whole_file = b"G" * 50_000                      # far more than the 100 bytes requested
    fake = _FakeRequests(200, whole_file)
    with pytest.raises(Exception) as ei:
        m._fetch_message_bytes(fake, "http://x/f.grb2", 0, 99)
    assert "200" in str(ei.value) or "byte" in str(ei.value).lower() or "range" in str(ei.value).lower(), (
        f"raised, but not about the range/length mismatch: {ei.value!r}")


@pytest.mark.parametrize("name", FETCHERS)
def test_a_SHORT_range_response_is_rejected(name):
    """The truncation half. 206 with fewer bytes than asked for is a partial read, and concatenating
    it silently corrupts the message boundary of everything that follows it in the file."""
    m = _mod(name)
    fake = _FakeRequests(206, b"G" * 10)            # asked for 100
    with pytest.raises(Exception):
        m._fetch_message_bytes(fake, "http://x/f.grb2", 0, 99)


@pytest.mark.parametrize("name", FETCHERS)
def test_a_CORRECT_range_response_still_passes__THE_CONTROL(name):
    """Without this the guard above passes on a function that rejects everything, which would take
    the entire ingest lane down rather than protect it."""
    m = _mod(name)
    body = b"G" * 100
    fake = _FakeRequests(206, body)
    assert m._fetch_message_bytes(fake, "http://x/f.grb2", 0, 99) == body


@pytest.mark.parametrize("name", FETCHERS)
def test_an_OPEN_ENDED_range_is_still_allowed(name):
    """`end=None` emits `bytes=<start>-`, whose length is unknowable in advance. It must NOT be
    rejected — validating a length nobody stated would break the callers that use it."""
    m = _mod(name)
    body = b"G" * 4096
    fake = _FakeRequests(206, body)
    assert m._fetch_message_bytes(fake, "http://x/f.grb2", 10, None) == body


# ── the one-sided comparison ────────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("name", FETCHERS)
def test_every_decoded_message_count_check_is_TWO_SIDED(name):
    """⭐ THE HALF THAT MAKES THE OVER-FETCH SILENT. `if len(msgs) < N` accepts N+k messages, and the
    variables are then read positionally — `msgs[0]` is U, `msgs[1]` is V in the wind lane. A `<`
    here is not a smaller check than `!=`, it is a DIFFERENT one: it grades "did we get enough"
    when the code depends on "did we get exactly these".

    ⚠️ AST, not a string search: `len(msgs) < 2` and `len( msgs )<2` are the same defect and a grep
    for one misses the other."""
    src = open(os.path.join(BACKEND, "services", f"{name}.py"), encoding="utf-8").read()
    offenders = []
    for node in ast.walk(ast.parse(src)):
        if not isinstance(node, ast.Compare) or len(node.ops) != 1:
            continue
        left = node.left
        if not (isinstance(left, ast.Call) and getattr(left.func, "id", None) == "len"):
            continue
        if not left.args or getattr(left.args[0], "id", "") != "msgs":
            continue
        if isinstance(node.ops[0], (ast.Lt, ast.LtE)):
            offenders.append(f"line {node.lineno}: {ast.unparse(node)}")
    assert not offenders, (
        f"{name} grades the decoded message count one-sidedly, so MORE messages than expected pass "
        f"while the variables are read positionally:\n  " + "\n  ".join(offenders))


def test_the_ast_scan_can_actually_find_a_len_msgs_compare__THE_CONTROL():
    """REFUSE rather than pass vacuously: if `msgs` is ever renamed, the scan above silently grades
    nothing and every fetcher looks clean."""
    seen = 0
    for name in FETCHERS:
        src = open(os.path.join(BACKEND, "services", f"{name}.py"), encoding="utf-8").read()
        for node in ast.walk(ast.parse(src)):
            if (isinstance(node, ast.Compare) and isinstance(node.left, ast.Call)
                    and getattr(node.left.func, "id", None) == "len"
                    and node.left.args and getattr(node.left.args[0], "id", "") == "msgs"):
                seen += 1
    assert seen >= 2, (
        f"the scan found only {seen} `len(msgs)` comparisons across the three fetchers — the "
        "variable was renamed and the guard above is grading nothing")
