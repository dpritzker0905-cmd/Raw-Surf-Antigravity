"""Every GRIB fetcher paid a TLS handshake per call, because none of them used a Session.

THE DEFECT (measured 2026-08-06, MASTER-AUDIT-9.0 §1.3). `requests.Session()` count across the six
byte-range GRIB fetchers: **zero**. Every `.get`/`.head` was a bare module call, so each one opened a
fresh TCP connection and negotiated TLS again. Measured against the real upstream
(nomads.ncep.noaa.gov, n=6 after DNS warm):

    bare requests.head   480.6 ms/call
    pooled Session.head  134.1 ms/call     -> 346.5 ms/call saved (3.6x)

A NOAA wave step makes 4 calls (one `.idx` GET + three coalesced range GETs) = ~1.39 s/step, and a
14-day run is `range(0, 337, 3)` = 113 steps => **~157 s of pure handshake per run** — against a
`NOAA_FETCH_BUDGET_S` of 2400 with only 27% headroom. The 2026-08-02 lane loss was upstream merely
SLOWING into that margin, so seconds there are not cosmetic.

★ WHY IT WAS A ONE-LINE FIX. Every fetcher already INJECTED its client into the helpers that use it
(`_pick_cycle(requests, ...)`, `_fetch_message_bytes(requests, ...)`, `_download_grib(requests, ...)`,
`_download_decode(requests, pygrib, ...)`). The seam existed; nothing was using it. Verified before
relying on it: across all six modules the ONLY attributes touched are `.head` (14) and `.get` (9) —
no `requests.exceptions`, no `requests.codes` — so a Session is a complete drop-in.

⚠️ THESE TESTS DELIBERATELY MAKE NO NETWORK CALL and never import pygrib: the GRIB stack does not
build on the Windows dev box, and a test that can only run on the runner is a test nobody runs
locally. They assert the WIRING, which is the thing that regressed.
"""
import ast
import os

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")

_SERVICES = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "services")

# The surface list: every fetcher that speaks HTTP to an upstream GRIB source.
# ⚠️ SELF-CHECKED below — a renamed or deleted fetcher FAILS this suite rather than silently
# shrinking the set it guards (standing rule 27: a check that cannot tell "clean" from "not looking"
# must refuse). `ecmwf_opendata_fetcher` is absent on purpose: it goes through the
# `ecmwf.opendata.Client`, not `requests`, and has zero bare get/head calls.
POOLED_FETCHERS = (
    "noaa_gfs_wave_fetcher.py",
    "noaa_gfs_wind_fetcher.py",
    "noaa_gfs_pressure_fetcher.py",
    "dwd_gwam_fetcher.py",
    "dwd_icon_wind_fetcher.py",
    "dwd_icon_pressure_fetcher.py",
)


def _tree(fname):
    with open(os.path.join(_SERVICES, fname), encoding="utf-8") as f:
        return ast.parse(f.read())


def test_the_fetcher_list_is_not_stale():
    """REFUSE rather than pass vacuously if a fetcher was renamed or removed."""
    missing = [f for f in POOLED_FETCHERS if not os.path.exists(os.path.join(_SERVICES, f))]
    assert not missing, (
        "This guard's surface list has gone stale, so it is no longer checking what it claims: "
        f"{missing}. Update POOLED_FETCHERS deliberately — do not delete entries to make it pass.")


def _requests_call_count(fname):
    """How many `requests.<attr>(...)` calls a module makes, by AST — not by substring."""
    return sum(1 for n in ast.walk(_tree(fname))
               if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
               and getattr(n.func.value, "id", "") == "requests")


def test_NO_fetcher_escapes_the_pooling_contract():
    """⭐⭐⭐ THE STALENESS CHECK ABOVE IS ONE-DIRECTIONAL, AND THAT IS THE GAP.

    It refuses when a LISTED fetcher disappears. It cannot notice the opposite and likelier drift:
    a NEW `*_fetcher.py` landing outside the list, or an EXEMPT one starting to use `requests`.
    Either way the suite keeps passing while guarding a shrinking fraction of the real set — the
    exact shape recorded in this repo as "the salvage that reached 1 of 7 GRIB fetchers".

    ★ SO THE EXEMPTION IS VERIFIED, NOT DECLARED. Every `*_fetcher.py` on disk must be either in
    POOLED_FETCHERS or provably free of `requests.*` calls. That needs no second list to maintain:
    the day an exempt fetcher reaches for `requests`, this fails and names it.

    Measured 2026-08-07 — 9 fetchers on disk, 6 pooled, 3 exempt with 0 `requests.*` calls each
    (`copernicus_fetcher`, `copernicus_global_fetcher`, `ecmwf_opendata_fetcher` — all use client
    libraries). No live defect; this closes the direction the guard could not see.
    """
    on_disk = sorted(f for f in os.listdir(_SERVICES) if f.endswith("_fetcher.py"))
    assert len(on_disk) >= len(POOLED_FETCHERS), "no fetchers found — the scan path is wrong"

    escapees = {f: _requests_call_count(f) for f in on_disk
                if f not in POOLED_FETCHERS and _requests_call_count(f) > 0}
    assert not escapees, (
        "These fetchers speak HTTP through the bare `requests` module but are NOT in "
        f"POOLED_FETCHERS, so every pooling assertion in this file skips them: {escapees}\n"
        "Add them to POOLED_FETCHERS (and give them `http_session()`), or establish why they are "
        "exempt — but an exemption has to be true, not just declared.")


@pytest.mark.parametrize("fname", POOLED_FETCHERS)
def test_fetcher_uses_a_pooled_client_not_the_bare_module(fname):
    """The client that reaches .get/.head must come from `http_session()`, never `import requests`."""
    tree = _tree(fname)

    bare_imports = [
        n.lineno for n in ast.walk(tree)
        if isinstance(n, ast.Import) and any(a.name == "requests" for a in n.names)
    ]
    assert not bare_imports, (
        f"services/{fname} imports the bare `requests` module at line(s) {bare_imports}. Each call "
        "then opens a fresh TCP+TLS connection (~346 ms/call measured, ~157 s per 113-step run).\n"
        "Fix: `requests = http_session()` from _fetch_common — it is a drop-in with the same "
        ".get/.head interface, and every helper here already takes the client as a parameter.")

    calls_session = any(
        isinstance(n, ast.Call) and isinstance(n.func, ast.Name) and n.func.id == "http_session"
        for n in ast.walk(tree))
    assert calls_session, (
        f"services/{fname} never calls http_session(), so whatever it passes to its `.get`/`.head` "
        "helpers is not the pooled client this guard exists to enforce.")


@pytest.mark.parametrize("fname", POOLED_FETCHERS)
def test_fetcher_only_uses_attributes_a_session_provides(fname):
    """A Session is not the module: `requests.exceptions` & friends would raise at runtime.

    This is the precondition that made the swap safe, pinned so a later edit cannot quietly break it
    — the failure would only appear on the runner, mid-ingest, as an AttributeError.
    """
    with open(os.path.join(_SERVICES, fname), encoding="utf-8") as f:
        tree = ast.parse(f.read())

    session_api = {"get", "head", "post", "put", "delete", "patch", "request", "close"}
    bad = [
        f"line {n.lineno}: requests.{n.attr}"
        for n in ast.walk(tree)
        if isinstance(n, ast.Attribute) and isinstance(n.value, ast.Name)
        and n.value.id == "requests" and n.attr not in session_api
    ]
    assert not bad, (
        f"services/{fname} uses module-only attributes on what is now a Session: {bad}. "
        "Either import the module explicitly for those, or use an equivalent the Session exposes.")


def test_http_session_returns_a_pooled_client_and_honours_its_kill_switch(monkeypatch):
    """The helper itself: pooled by default, bare module when killed, both usable as a client."""
    from services._fetch_common import http_session

    import services._fetch_common as fc

    monkeypatch.delenv("FETCH_HTTP_SESSION", raising=False)
    # http_session() deliberately returns the bare module under pytest (see its docstring — a real
    # 2026-08-06 regression), so the pooling branch can only be asserted with that predicate off.
    monkeypatch.setattr(fc, "is_test_environment", lambda: False)
    pooled = http_session()
    assert type(pooled).__name__ == "Session", f"expected a Session, got {type(pooled).__name__}"
    assert hasattr(pooled, "get") and hasattr(pooled, "head")

    monkeypatch.setenv("FETCH_HTTP_SESSION", "0")
    killed = http_session()
    assert type(killed).__name__ == "module", (
        "FETCH_HTTP_SESSION=0 must restore the bare module byte-for-byte; got "
        f"{type(killed).__name__}")
    assert hasattr(killed, "get") and hasattr(killed, "head")


def test_http_session_honours_a_substituted_requests_module(monkeypatch):
    """A test double installed in sys.modules IS the client — never reach past it to a real Session.

    ⚠️ THIS IS THE SAFETY PROPERTY, not a convenience. The fetcher suites swap in a fake with
    `monkeypatch.setitem(sys.modules, "requests", fake)`; it exposes `.get`/`.head` only. Calling
    `.Session()` on that raised on this change's first run (6 failures in
    test_icon_wind_multi_bbox_fetch.py). The dangerous near-miss is the other repair: bypassing the
    double to build a real pooled Session would have made the suite issue LIVE requests to NOMADS
    and DWD while still reporting green.
    """
    import sys
    from services._fetch_common import http_session

    class _FakeRequestsModule:
        def get(self, url, **kw):   # pragma: no cover - interface shape only
            raise AssertionError("not called")

        def head(self, url, **kw):  # pragma: no cover - interface shape only
            raise AssertionError("not called")

    import services._fetch_common as fc

    fake = _FakeRequestsModule()
    monkeypatch.delenv("FETCH_HTTP_SESSION", raising=False)
    monkeypatch.setattr(fc, "is_test_environment", lambda: False)   # exercise the pooling branch
    monkeypatch.setitem(sys.modules, "requests", fake)

    client = http_session()
    assert client is fake, (
        "http_session() reached past a substituted requests module. In the fetcher suites that "
        "means real network calls to NOMADS/DWD from a test run that still reports green.")


def test_the_guard_can_actually_catch_the_defect():
    """MUTATION CONTROL. A guard that has never failed is not known to work."""
    pre_fix = ast.parse("def fetch():\n    import requests\n    import pygrib\n")
    caught = [n for n in ast.walk(pre_fix)
              if isinstance(n, ast.Import) and any(a.name == "requests" for a in n.names)]
    assert caught, "the bare-import rule failed to flag the known pre-fix shape — it is inert"

    post_fix = ast.parse("def fetch():\n    requests = http_session()\n    import pygrib\n")
    false_alarm = [n for n in ast.walk(post_fix)
                   if isinstance(n, ast.Import) and any(a.name == "requests" for a in n.names)]
    assert not false_alarm, "the rule flagged the fixed shape — it would block the fix"
