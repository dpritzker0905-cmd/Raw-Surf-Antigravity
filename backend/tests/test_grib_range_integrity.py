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


# ── the escape hatch must EXTRACT or REFUSE, never accept (2026-08-15, Master Codex MC-05) ──────
# GRIB_RANGE_STRICT=0 exists for ONE scenario: a proxy on the egress path that rewrites/ignores
# `Range`. That scenario is PROVABLE — the server answers 200 with the WHOLE file, which CONTAINS
# the bytes we asked for, and every request starts on an .idx message boundary so the slice must
# begin with the GRIB magic. The hatch therefore extracts the requested slice when it can prove it,
# and still RAISES when it cannot — an escape hatch that keeps ingest alive on corrupt bytes is
# worse than an outage, because the corruption maps the wrong message to the wrong variable.

def _whole_file(sizes=(100, 156, 144)):
    """A fake GRIB file: messages at known offsets, each opening with the GRIB magic."""
    body = b""
    offsets = []
    for i, size in enumerate(sizes):
        offsets.append(len(body))
        body += b"GRIB" + bytes([65 + i]) * (size - 4)
    return body, offsets, list(sizes)


@pytest.mark.parametrize("name", FETCHERS)
def test_the_escape_hatch_EXTRACTS_a_provable_whole_file_slice(name, monkeypatch):
    """The proxy case the switch exists for: 200 + the whole file. The hatch must hand the caller
    EXACTLY the requested bytes — same as if the server had honoured the Range."""
    monkeypatch.setenv("GRIB_RANGE_STRICT", "0")
    m = _mod(name)
    body, offs, sizes = _whole_file()
    start, want = offs[1], sizes[1]
    fake = _FakeRequests(200, body)
    out = m._fetch_message_bytes(fake, "http://x/f.grb2", start, start + want - 1)
    assert out == body[start:start + want], "hatch did not slice the requested range"
    assert len(out) == want and out.startswith(b"GRIB")


@pytest.mark.parametrize("name", FETCHERS)
def test_the_escape_hatch_REFUSES_a_short_response(name, monkeypatch):
    """A short body proves nothing — it cannot contain the requested slice. Pre-2026-08-15 the
    hatch logged and RETURNED it anyway, which is the exact 'log and continue' MC-05 forbids."""
    monkeypatch.setenv("GRIB_RANGE_STRICT", "0")
    m = _mod(name)
    fake = _FakeRequests(206, b"GRIB" + b"x" * 6)      # 10 bytes for a 100-byte range
    with pytest.raises(Exception):
        m._fetch_message_bytes(fake, "http://x/f.grb2", 0, 99)


@pytest.mark.parametrize("name", FETCHERS)
def test_the_escape_hatch_REFUSES_when_the_slice_is_not_a_message_boundary(name, monkeypatch):
    """Over-long 200 whose bytes at the requested offset are NOT a GRIB message start: either the
    response is a different file than the .idx described, or the idx is stale. No proof, no slice."""
    monkeypatch.setenv("GRIB_RANGE_STRICT", "0")
    m = _mod(name)
    body, offs, sizes = _whole_file()
    start = offs[1] + 10                                # mid-message — no magic here
    fake = _FakeRequests(200, body)
    with pytest.raises(Exception):
        m._fetch_message_bytes(fake, "http://x/f.grb2", start, start + sizes[1] - 1)


@pytest.mark.parametrize("name", FETCHERS)
def test_the_escape_hatch_REFUSES_an_over_long_206(name, monkeypatch):
    """206 with the wrong length is a PROTOCOL VIOLATION, not the ignore-Range proxy: a server that
    claims partial content and miscounts it proves nothing about where our slice begins."""
    monkeypatch.setenv("GRIB_RANGE_STRICT", "0")
    m = _mod(name)
    body, offs, sizes = _whole_file()
    fake = _FakeRequests(206, body)                     # whole file under a 206 label
    with pytest.raises(Exception):
        m._fetch_message_bytes(fake, "http://x/f.grb2", offs[1], offs[1] + sizes[1] - 1)


@pytest.mark.parametrize("name", FETCHERS)
def test_strict_default_still_raises_on_a_whole_file__THE_CONTROL(name, monkeypatch):
    """Extraction lives ONLY behind the thrown switch. The default posture stays fail-closed."""
    monkeypatch.delenv("GRIB_RANGE_STRICT", raising=False)
    m = _mod(name)
    body, offs, sizes = _whole_file()
    fake = _FakeRequests(200, body)
    with pytest.raises(Exception):
        m._fetch_message_bytes(fake, "http://x/f.grb2", offs[1], offs[1] + sizes[1] - 1)


@pytest.mark.parametrize("name", FETCHERS)
def test_the_escape_hatch_leaves_correct_responses_untouched__THE_CONTROL(name, monkeypatch):
    """The hatch must not tax the healthy path: an honoured Range passes through byte-identically."""
    monkeypatch.setenv("GRIB_RANGE_STRICT", "0")
    m = _mod(name)
    body = b"GRIB" + b"y" * 96
    fake = _FakeRequests(206, body)
    assert m._fetch_message_bytes(fake, "http://x/f.grb2", 0, 99) == body


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


# ── the fixture census ──────────────────────────────────────────────────────────────────────────

def test_no_test_double_answers_a_RANGE_request_with_a_FIXED_body():
    """⭐ THIS GUARD EXISTS BECAUSE MY CENSUS MISSED TWO FILES, TWICE.

    Adding the length check broke test doubles that answered a `bytes=0-999` request with a fixed
    8 or 16 bytes. I grepped for one spelling, fixed four files, and shipped — then the full guards
    lane found a FIFTH (`test_noaa_multi_resolution.py`) and a sixth
    (`test_vector_blockmean_loop_shadow.py`) that my pattern had not matched.

    ⇒ ENUMERATE BY THE PROPERTY, NOT BY THE SPELLING. A double that returns a body whose length is
    independent of the Range it was handed is modelling a server that cannot exist, and it disarms
    `_fetch_message_bytes` for every test that uses it. This scans for the PROPERTY.
    """
    import glob
    import re

    tests_dir = os.path.dirname(os.path.abspath(__file__))
    offenders = []
    for path in glob.glob(os.path.join(tests_dir, "test_*.py")):
        src = open(path, encoding="utf-8").read()
        # only files that stub a partial-content response at all
        if "206" not in src:
            continue
        for m in re.finditer(r'content=b"\x00" \* (\d+)|_Resp\(b"\x00" \* (\d+)\)', src):
            line = src[:m.start()].count("\n") + 1
            offenders.append(f"{os.path.basename(path)}:{line}: {m.group(0)}")
    assert not offenders, (
        "these doubles answer a Range request with a FIXED-length body, which no real server does "
        "and which `_fetch_message_bytes` now rejects:\n  " + "\n  ".join(offenders)
        + "\n\nDerive the length from the Range header instead (see _range_len in the fetcher suites).")


def test_the_fixture_census_actually_reaches_the_test_tree__THE_CONTROL():
    """REFUSE rather than pass vacuously: if the glob stops matching, the scan above grades nothing."""
    import glob
    tests_dir = os.path.dirname(os.path.abspath(__file__))
    files = glob.glob(os.path.join(tests_dir, "test_*.py"))
    assert len(files) > 100, f"the census reached only {len(files)} test files — it is not scanning"
    with_206 = [f for f in files if "206" in open(f, encoding="utf-8").read()]
    assert len(with_206) >= 3, (
        f"only {len(with_206)} files stub a 206 at all — the census has gone blind to the class")
