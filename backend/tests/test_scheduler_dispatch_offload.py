"""The scheduler dispatcher must never run a sync job's body on the event loop.

BOTH 2026-08-09 production outages were this: `tracked()` wraps every job as a coroutine (so
APScheduler's own sync-dispatch executor never engages) and `_run_tracked_job`'s else-branch
called the sync function INLINE — the 30-min L2 manifest restore (a 12-16 MB Supabase read behind
a per-socket-read timeout) blocked the loop for ~20 min and the box went connection-level dark,
twice, at exactly the restore schedule's fire times. These tests pin the dispatcher's offload with
the audit's own instruments: a co-tenant liveness ticker (the §3.2 verifier's Control A shape) and
the run_until_complete legality that the in-process ingest fallback needs."""
import asyncio
import contextlib
import os
import sys
import time

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import scheduler.base as SB  # noqa: E402


class _NullSession:
    """The status-write half needs a DB; these tests pin the DISPATCH half, so the session yields
    a no-row lookup and the write block no-ops."""
    async def __aenter__(self):
        return self

    async def __aexit__(self, *a):
        return False

    async def execute(self, *_a, **_k):
        # Return an ENABLED status row: the real no-row path constructs an ORM model whose
        # is_enabled is None until DB defaults apply, and `if not is_enabled` would SKIP the job --
        # these tests pin dispatch, not the enable gate.
        import types
        row = types.SimpleNamespace(is_enabled=True, total_runs=0, success_count=0,
                                    failure_count=0)

        class _R:
            def scalar_one_or_none(self):
                return row
        return _R()

    def add(self, *_a, **_k):          # the no-row path CREATES the status row
        pass

    async def commit(self):
        pass

    async def refresh(self, *_a, **_k):
        pass

    async def rollback(self):
        pass

    async def flush(self, *_a, **_k):
        pass


@pytest.fixture(autouse=True)
def _null_db(monkeypatch):
    # _run_tracked_job imports async_session_maker FROM `database` inside the function body, so
    # the patch must land on the database module, not on scheduler.base.
    import database
    monkeypatch.setattr(database, "async_session_maker", lambda: _NullSession())


async def test_a_blocking_sync_job_does_not_starve_the_loop():
    """THE OUTAGE SIGNATURE, inverted: with the job inline, a co-tenant coroutine got 0 ticks for
    the job's whole duration (the audit measured 0 of ~426). Offloaded, the ticker must keep
    ticking while the sync job blocks in its worker thread."""
    ticks = []

    async def ticker():
        while True:
            ticks.append(time.perf_counter())
            await asyncio.sleep(0.01)

    def blocking_job():
        time.sleep(0.4)                    # the manifest-restore stand-in: pure blocking work

    t = asyncio.create_task(ticker())
    await SB._run_tracked_job("t1", "d", "s", blocking_job)
    t.cancel()
    with contextlib.suppress(asyncio.CancelledError):
        await t
    assert len(ticks) >= 20, (
        f"the loop got only {len(ticks)} ticks during a 0.4 s sync job — the dispatcher is "
        f"running sync work inline again, which is the exact mechanism of both 08-09 outages")


async def test_a_sync_job_that_runs_its_own_loop_is_legal_the_ingest_fallback_shape():
    """Pre-fix this raised 'Cannot run the event loop while another loop is running' and was then
    recorded as SUCCESS by the caller's swallow — the §3.2 finding. In a worker thread there is no
    running loop, so the in-process ingest fallback's run_until_complete works."""
    ran = []

    def ingest_shaped_job():
        async def inner():
            ran.append(True)
        asyncio.run(inner())

    await SB._run_tracked_job("t2", "d", "s", ingest_shaped_job)
    assert ran == [True], "the run_until_complete-style sync job never executed its body"


async def test_an_async_job_still_runs_on_the_loop_unchanged():
    seen = []

    async def async_job():
        seen.append(asyncio.get_running_loop())

    loop = asyncio.get_running_loop()
    await SB._run_tracked_job("t3", "d", "s", async_job)
    assert seen == [loop], "async jobs must stay ON the loop — only sync bodies offload"


async def test_a_raising_sync_job_is_contained_not_propagated():
    """The dispatcher records failure status and must not let a job exception escape into the
    scheduler (the never-raises contract every registration relies on)."""
    def bad_job():
        raise RuntimeError("job died")

    await SB._run_tracked_job("t4", "d", "s", bad_job)   # must not raise
