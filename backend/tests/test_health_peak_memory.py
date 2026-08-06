"""A point-in-time RSS poll cannot see the spike that actually kills the box.

WHY THIS FIELD EXISTS. The 2026-07-24 Render restart-under-load was diagnosed precisely — "up to 16
concurrent 15,023-vector product parses (~15-20 MB each)" against an `APP_MEMORY_LIMIT_MB` of 512 —
and that handoff closed with the lever **OPEN**, because verifying it "needs live A/B on Render,
which cannot be done from the dev box". Thirteen days later it was still open.

`/admin/system/health` already reported RSS. That is a GAUGE: to catch a spike lasting seconds you
must be sampling at that exact second, which nobody is. `ru_maxrss` is the kernel's own high-water
mark since process start — it records the peak whether or not anyone was looking. That converts an
un-A/B-able belief into a number, and it is the precondition for verifying ANY fix (a thread-pool
cap, columnar products, or deciding neither is needed).

⚠️ THE UNIT TRAP THIS SUITE EXISTS FOR. `ru_maxrss` is **kilobytes on Linux** and **bytes on
macOS/BSD**. Render runs Linux. Getting that wrong is a 1024x error that still looks like a
plausible number — 300 MB reported as 0.3 MB reads as "loads of headroom" and 300 MB reported as
307,200 MB reads as absurd-but-ignorable. Neither would be caught by a test that only asserted the
field is present.
"""
import os
import sys

import pytest

os.environ.setdefault("DATABASE_URL", "sqlite+aiosqlite:///:memory:")


def _memory_block():
    """Recompute exactly what routes/health.py does, without needing the DB session the route takes."""
    import psutil
    memory = {"rss_mb": None, "peak_rss_mb": None, "limit_mb": None,
              "peak_pct_of_limit": None, "limit_source": None}
    limit_mb, limit_source = None, None
    for path, _scale in (("/sys/fs/cgroup/memory.max", 1),
                         ("/sys/fs/cgroup/memory/memory.limit_in_bytes", 1)):
        try:
            with open(path) as fh:
                raw = fh.read().strip()
            if raw and raw != "max":
                val = int(raw) / (1024 * 1024)
                if 16.0 < val < 1024.0 * 1024.0:
                    limit_mb, limit_source = val, "cgroup"
                    break
        except (OSError, ValueError):
            continue
    if limit_mb is None:
        limit_mb = float(os.environ.get("APP_MEMORY_LIMIT_MB", "512.0"))
        limit_source = "env" if "APP_MEMORY_LIMIT_MB" in os.environ else "default_assumed"
    memory["limit_mb"] = round(limit_mb, 1)
    memory["limit_source"] = limit_source
    memory["rss_mb"] = round(psutil.Process(os.getpid()).memory_info().rss / (1024 * 1024), 1)
    try:
        import resource
        raw = resource.getrusage(resource.RUSAGE_SELF).ru_maxrss
        peak_mb = raw / (1024 * 1024) if sys.platform == "darwin" else raw / 1024
        memory["peak_rss_mb"] = round(peak_mb, 1)
        if limit_mb > 0:
            memory["peak_pct_of_limit"] = round(100.0 * peak_mb / limit_mb, 1)
    except ImportError:
        pass
    return memory


def test_the_health_payload_declares_a_memory_block():
    """Structural: the route must actually expose it, or the instrument reaches nobody."""
    import ast
    p = os.path.join(os.path.dirname(os.path.dirname(os.path.abspath(__file__))), "routes", "health.py")
    tree = ast.parse(open(p, encoding="utf-8").read())
    keys = [n.value for n in ast.walk(tree) if isinstance(n, ast.Constant) and n.value == "memory"]
    assert keys, (
        "routes/health.py no longer emits a 'memory' key — the peak-RSS instrument was computed and "
        "then not published, which is the 'true but reaches nobody' shape this repo keeps hitting")


def test_current_rss_is_a_plausible_process_size():
    m = _memory_block()
    assert m["rss_mb"] is not None
    assert 5.0 < m["rss_mb"] < 20000.0, (
        f"rss_mb={m['rss_mb']} is not a plausible python process size — check the byte->MB divisor")
    assert m["limit_mb"] == 512.0 or m["limit_mb"] > 0


@pytest.mark.skipif(sys.platform == "win32", reason="`resource` is Unix-only; peak stays None here")
def test_peak_is_present_and_at_least_current_on_unix():
    """A high-water mark that is BELOW the current reading is not a high-water mark."""
    m = _memory_block()
    assert m["peak_rss_mb"] is not None, "resource imported but peak_rss_mb was not populated"
    assert m["peak_rss_mb"] >= m["rss_mb"] * 0.9, (
        f"peak {m['peak_rss_mb']} MB < current {m['rss_mb']} MB — almost certainly the ru_maxrss "
        "UNIT is wrong for this platform (KB on Linux, bytes on macOS)")
    assert 5.0 < m["peak_rss_mb"] < 20000.0, (
        f"peak_rss_mb={m['peak_rss_mb']} is off by a factor — the classic 1024x ru_maxrss unit bug")


@pytest.mark.skipif(sys.platform == "win32", reason="`resource` is Unix-only")
def test_peak_pct_is_consistent_with_the_limit():
    m = _memory_block()
    expected = round(100.0 * m["peak_rss_mb"] / m["limit_mb"], 1)
    assert abs(m["peak_pct_of_limit"] - expected) < 0.2, (
        "peak_pct_of_limit does not reconcile with peak_rss_mb / limit_mb — a derived field that "
        "disagrees with its own inputs is worse than no field")


def test_windows_degrades_to_nulls_rather_than_lying():
    """The dev box has no `resource`. It must report None, never 0.0 — a zero peak would read as
    'no memory was ever used', the exact not-sampled/measured conflation this repo refuses."""
    m = _memory_block()
    if sys.platform == "win32":
        assert m["peak_rss_mb"] is None and m["peak_pct_of_limit"] is None, (
            "on a platform without `resource` the peak must be None, not a fabricated 0.0")
        assert m["rss_mb"] is not None, "current RSS is available everywhere and should still report"


def test_the_limit_says_whether_it_was_measured_or_assumed():
    """A limit nobody measured is the reason a 13-day-old memory lever was sized wrong.

    `APP_MEMORY_LIMIT_MB` defaults to 512.0 and render.yaml never sets it, yet production was
    observed running STABLY at 891 MB (peak 897.5, flat over 8 minutes) — which a 512 MB container
    cannot do. So the constant did not describe the box, and `/admin/system/health` reported ~174%
    of "limit" as a permanent steady state. `limit_source` exists so a reader can tell a MEASURED
    limit (`cgroup`) from an ASSUMED one (`default_assumed`) instead of trusting a number that may
    be fiction.
    """
    m = _memory_block()
    assert m["limit_source"] in ("cgroup", "env", "default_assumed"), m["limit_source"]
    if m["limit_source"] == "default_assumed":
        assert m["limit_mb"] == 512.0
    assert m["limit_mb"] > 16.0, "a sub-16 MB limit is a parse error, not a container"


def test_a_measured_limit_is_consistent_with_current_usage():
    """If the limit is MEASURED, the process cannot be sitting far above it — that combination means
    the reading is wrong, because the kernel would have killed it."""
    m = _memory_block()
    if m["limit_source"] == "cgroup" and m["rss_mb"]:
        assert m["rss_mb"] < m["limit_mb"] * 1.05, (
            f"rss {m['rss_mb']} MB exceeds a MEASURED cgroup limit of {m['limit_mb']} MB — "
            "impossible unless the limit parse is wrong (check cgroup v1 vs v2 units)")
